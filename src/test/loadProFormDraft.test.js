import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  issueRecoverySessionToken,
} from '../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  createBootstrapProFormDraftHandler,
  createLoadProFormDraftHandler,
} from '../../base44/functions/_shared/proDraftBootstrapLoad/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  hashResumeToken,
  sha256Hex,
} from '../../base44/functions/_shared/proDraftSecurity/entry.ts';
import {
  CLIENT_BOOTSTRAP_TOKEN,
  NOW_SECONDS,
  SECRETS,
  bootstrapBody,
  createMemorySdk,
  dependencies,
  loadBody,
  request,
  responseJson,
} from './proDraftFunctionTestHarness.js';

const recoverySecret = {
  name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
  value: SECRETS.PRO_FORM_RECOVERY_SESSION_SECRET,
};
const resumeSecret = {
  name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
  value: SECRETS.PRO_FORM_DRAFT_TOKEN_SECRET,
};

async function bootstrappedMemory() {
  const memory = createMemorySdk();
  const deps = dependencies(memory.sdk);
  const bootstrap = createBootstrapProFormDraftHandler(deps);
  const result = await responseJson(await bootstrap(request(bootstrapBody())));
  return { memory, deps, draftId: result.json.draft.draftId };
}

async function recoveryToken(record, scopes, overrides = {}) {
  const sessionIdHash = await sha256Hex(
    `pro-draft:session-id:v1:${record.session_id}`,
  );
  return issueRecoverySessionToken({
    environment: 'staging',
    draftId: record.id,
    sessionIdHash,
    authorizationMethod: 'recovery_code',
    authorizedScopes: scopes,
    recoveryEmailLookupHash: 'a'.repeat(64),
    recoveryCodeVersion: 1,
    recoverySessionVersion: record.recovery_session_version,
    grantVersion: 1,
    ...overrides,
  }, {
    secret: recoverySecret,
    clock: () => NOW_SECONDS,
    tokenIdGenerator: () => `pdti_${'K'.repeat(43)}`,
  });
}

describe('loadProFormDraft authorization and projection', () => {
  it('loads an exact active draft by resume token with write capability', async () => {
    const { memory, deps, draftId } = await bootstrappedMemory();
    const load = createLoadProFormDraftHandler(deps);
    const { response, json } = await responseJson(await load(request(
      loadBody(draftId, { resumeToken: CLIENT_BOOTSTRAP_TOKEN }),
    )));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(json).toMatchObject({ success: true, readOnly: false, canWrite: true });
    expect(json.draft).toMatchObject({ draftId, readOnly: false });
    expect(json.draft.canonicalState.responses).toEqual({});
    expect(memory.records[0].last_restored_at).toBeDefined();
    expect(memory.records[0].server_revision).toBe(0);
  });

  it('loads only the recovery-session token draft and honors read-only scope', async () => {
    const { memory, deps, draftId } = await bootstrappedMemory();
    const token = await recoveryToken(
      memory.records[0],
      [SIGNED_TOKEN_SCOPES.DRAFT_READ],
    );
    const load = createLoadProFormDraftHandler(deps);
    const { json } = await responseJson(await load(request(
      loadBody(draftId, { recoverySessionToken: token }),
    )));
    expect(json).toMatchObject({ success: true, readOnly: true, canWrite: false });
    expect(json.draft.draftId).toBe(draftId);
  });

  it('rejects a wrong requested draft for a recovery session', async () => {
    const { memory, deps } = await bootstrappedMemory();
    const token = await recoveryToken(
      memory.records[0],
      [SIGNED_TOKEN_SCOPES.DRAFT_READ],
    );
    const { json } = await responseJson(await createLoadProFormDraftHandler(deps)(
      request(loadBody('draft-synthetic-wrong', { recoverySessionToken: token })),
    ));
    expect(json.errorCode).toBe('INVALID_AUTHORIZATION');
  });

  it('returns a submitted draft read-only when submitted-read is authorized', async () => {
    const { memory, deps, draftId } = await bootstrappedMemory();
    const state = JSON.parse(memory.records[0].draft_state_json);
    state.draftStatus = 'submitted';
    state.submission.submittedAt = new Date(NOW_SECONDS * 1000).toISOString();
    memory.records[0].status = 'submitted';
    memory.records[0].submitted_at = state.submission.submittedAt;
    memory.records[0].draft_state_json = JSON.stringify(state);
    const { json } = await responseJson(await createLoadProFormDraftHandler(deps)(
      request(loadBody(draftId, { resumeToken: CLIENT_BOOTSTRAP_TOKEN })),
    ));
    expect(json).toMatchObject({ success: true, readOnly: true, canWrite: false });
    expect(json.draft.readOnly).toBe(true);
  });

  it('requires submitted-read rather than accepting an ordinary recovery read scope', async () => {
    const { memory, deps, draftId } = await bootstrappedMemory();
    memory.records[0].status = 'submitted';
    const token = await recoveryToken(
      memory.records[0],
      [SIGNED_TOKEN_SCOPES.DRAFT_READ],
    );
    const { json } = await responseJson(await createLoadProFormDraftHandler(deps)(
      request(loadBody(draftId, { recoverySessionToken: token })),
    ));
    expect(json.errorCode).toBe('SUBMITTED_SCOPE_REQUIRED');
  });

  it.each([
    ['cleared_superseded', 'DRAFT_SUPERSEDED'],
    ['expired', 'DRAFT_EXPIRED'],
    ['deleted', 'DRAFT_DELETED'],
  ])('returns the controlled %s lifecycle error', async (status, errorCode) => {
    const { memory, deps, draftId } = await bootstrappedMemory();
    memory.records[0].status = status;
    const { json } = await responseJson(await createLoadProFormDraftHandler(deps)(
      request(loadBody(draftId, { resumeToken: CLIENT_BOOTSTRAP_TOKEN })),
    ));
    expect(json.errorCode).toBe(errorCode);
  });

  it('reconstructs a legacy draft without writing canonical state back', async () => {
    const token = 'L'.repeat(43);
    const hash = await hashResumeToken(token, resumeSecret);
    const legacy = {
      id: 'draft-legacy-1', session_id: 'session-legacy-1', status: 'draft',
      client_revision: 2, server_revision: 3, resume_token_hash: hash,
      responses_json: JSON.stringify({ q1: 'preserved answer' }),
      validation_status_json: '{}', touched_questions_json: '{}',
      expanded_questions_json: '{}', text_validation_meta_json: '{}',
      credentials_json: '{}', ui_draft_state_json: '{}',
      field_change_metadata_json: '{}', metadata_json: '{malformed',
      mapped_payload_json: JSON.stringify({ metadata: {}, userdata: {} }),
    };
    const memory = createMemorySdk([legacy]);
    const deps = dependencies(memory.sdk);
    const { json } = await responseJson(await createLoadProFormDraftHandler(deps)(
      request(loadBody(legacy.id, { resumeToken: token })),
    ));
    expect(json.success).toBe(true);
    expect(json.draft.canonicalState.responses).toEqual({ q1: 'preserved answer' });
    expect(json.warnings).toContain('LEGACY_DRAFT_RECONSTRUCTED');
    expect(json.warnings).toContain('LEGACY_METADATA_MALFORMED');
    expect(memory.records[0]).not.toHaveProperty('draft_state_json');
    expect(memory.drafts.update).toHaveBeenCalledWith(
      legacy.id,
      { last_restored_at: expect.any(String) },
    );
  });

  it('rejects upgradeLegacyOnLoad=true and never mutates the draft', async () => {
    const { memory, deps, draftId } = await bootstrappedMemory();
    memory.drafts.update.mockClear();
    const { json } = await responseJson(await createLoadProFormDraftHandler(deps)(
      request(loadBody(draftId, { resumeToken: CLIENT_BOOTSTRAP_TOKEN }, {
        upgradeLegacyOnLoad: true,
      })),
    ));
    expect(json.errorCode).toBe('INVALID_REQUEST');
    expect(memory.drafts.update).not.toHaveBeenCalled();
  });

  it('returns a safe authorization failure and no sensitive hashes', async () => {
    const { deps, draftId } = await bootstrappedMemory();
    const { json } = await responseJson(await createLoadProFormDraftHandler(deps)(
      request(loadBody(draftId, { resumeToken: 'X'.repeat(43) })),
    ));
    expect(['INVALID_AUTHORIZATION', 'DRAFT_LOAD_FAILED']).toContain(json.errorCode);
    expect(JSON.stringify(json)).not.toMatch(/(?:_hash|identityKeyHash|lookupHash)/u);
  });
});
