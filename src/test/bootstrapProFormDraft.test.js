import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_SECRET_NAMES,
  PRO_DRAFT_AUTHORIZATION_VERSION,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  signStructuredToken,
} from '../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  createBootstrapProFormDraftHandler,
} from '../../base44/functions/_shared/proDraftBootstrapLoad/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  hashNormalizedRecoveryEmail,
  hmacSha256Hex,
  hashResumeToken,
} from '../../base44/functions/_shared/proDraftSecurity/entry.ts';
import { hashCanonicalDraftState } from '../lib/questionnaireDraftState.js';
import {
  CLIENT_BOOTSTRAP_TOKEN,
  NOW_SECONDS,
  SECRETS,
  bootstrapBody,
  clientContext,
  createMemorySdk,
  dependencies,
  request,
  responseJson,
} from './proDraftFunctionTestHarness.js';

const handlerFor = (memory, overrides) => createBootstrapProFormDraftHandler(
  dependencies(memory.sdk, overrides),
);

async function signedToken(context, overrides = {}) {
  const normalizedEmail = context.recoveryEmail.toLowerCase();
  const secret = {
    name: AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION,
    value: SECRETS.PRO_FORM_DRAFT_LINK_SECRET,
  };
  const emailSecret = {
    name: SECURITY_SECRET_NAMES.RECOVERY_EMAIL,
    value: SECRETS.PRO_FORM_EMAIL_LOOKUP_SECRET,
  };
  const claims = {
    version: PRO_DRAFT_AUTHORIZATION_VERSION,
    type: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
    scope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
    environment: 'staging',
    issuedAt: NOW_SECONDS,
    notBefore: NOW_SECONDS,
    expiresAt: NOW_SECONDS + 3600,
    tokenId: `pdti_${'I'.repeat(43)}`,
    grantVersion: 1,
    invitationId: 'invitation-synthetic-1',
    formType: 'pro-questionnaire',
    userIdHash: await hmacSha256Hex(
      `pro-draft:signed-visible-user:v1:${context.userId.toLowerCase()}`,
      secret.value,
    ),
    recoveryEmailLookupHash: await hashNormalizedRecoveryEmail(
      normalizedEmail,
      emailSecret,
    ),
    domainIdentityHash: await hmacSha256Hex(
      `pro-draft:signed-visible-domain:v1:${context.domainName.toLowerCase()}`,
      secret.value,
    ),
    allowedAssociation: 'current_invitation',
    linkVersion: 1,
    ...overrides,
  };
  return signStructuredToken(claims, { secret });
}

describe('bootstrapProFormDraft request boundary', () => {
  it.each([
    ['disabled', { PRO_DRAFT_V2_SERVER_ENABLED: 'false' }],
    ['kill switch', { PRO_DRAFT_V2_KILL_SWITCH: 'true' }],
  ])('fails closed when runtime is %s', async (_name, environment) => {
    const memory = createMemorySdk();
    const { response, json } = await responseJson(await handlerFor(memory, {
      environment,
    })(request(bootstrapBody())));
    expect(response.status).toBe(503);
    expect(json.errorCode).toBe('FEATURE_DISABLED');
    expect(memory.drafts.create).not.toHaveBeenCalled();
  });

  it('rejects wrong methods, content types, and oversized bodies', async () => {
    const handler = handlerFor(createMemorySdk());
    const wrongMethod = await handler(new Request('https://synthetic.invalid', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    }));
    expect(wrongMethod.status).toBe(405);
    const wrongType = await handler(new Request('https://synthetic.invalid', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    }));
    expect(wrongType.status).toBe(415);
    const oversized = await handler(request(bootstrapBody({
      localStateSummary: { padding: 'x'.repeat(1_100_000) },
    })));
    expect(oversized.status).toBe(413);
  });

  it('creates an acknowledged anonymous draft with complete protected fields', async () => {
    const memory = createMemorySdk();
    const { response, json } = await responseJson(await handlerFor(memory)(
      request(bootstrapBody()),
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(json).toMatchObject({
      success: true, created: true, resumed: false,
      recoveryCodeIssued: true, resumeTokenIssued: false, readOnly: false,
    });
    expect(json.recoveryCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}$/u);
    expect(json).not.toHaveProperty('resumeToken');
    expect(memory.records).toHaveLength(1);
    expect(memory.records[0]).toMatchObject({
      session_id: `pds_${'S'.repeat(43)}`,
      status: 'active', client_revision: 0, server_revision: 0,
      draft_generation: 1, recovery_code_version: 1,
      recovery_session_version: 1, status_version: 1,
      retention_policy_version: 1, environment: 'staging',
    });
    expect(memory.records[0].recovery_code_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(memory.records[0].resume_token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(memory.records[0].draft_state_json).toContain('draft-synthetic-1');
    expect(memory.records[0].state_hash).toBe(await hashCanonicalDraftState(
      JSON.parse(memory.records[0].draft_state_json),
    ));
    expect(JSON.stringify(memory.records[0])).not.toContain(json.recoveryCode);
    expect(JSON.stringify(memory.records[0])).not.toContain(CLIENT_BOOTSTRAP_TOKEN);
    expect(JSON.stringify(json)).not.toMatch(/(?:_hash|identityKeyHash|lookupHash)/u);
  });

  it('rejects an anonymous no-email draft without acknowledgement', async () => {
    const memory = createMemorySdk();
    const { json } = await responseJson(await handlerFor(memory)(request(
      bootstrapBody({
        clientContext: clientContext({ anonymousRecoveryAcknowledged: false }),
      }),
    )));
    expect(json.errorCode).toBe('INVALID_REQUEST');
    expect(memory.drafts.create).not.toHaveBeenCalled();
  });

  it('stores client-entered email only as an unverified association', async () => {
    const memory = createMemorySdk();
    const context = clientContext({
      associationIntent: 'anonymous_start',
      anonymousRecoveryAcknowledged: false,
      recoveryEmail: 'Synthetic.User@Example.invalid',
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
    });
    await handlerFor(memory)(request(bootstrapBody({ clientContext: context })));
    expect(memory.records[0]).toMatchObject({
      recovery_email: 'synthetic.user@example.invalid',
      recovery_email_source: 'client_entered',
      recovery_email_verification_status: 'unverified',
    });
    expect(memory.drafts.filter.mock.calls.some(
      ([query]) => Object.hasOwn(query, 'recovery_email_lookup_hash'),
    )).toBe(false);
    expect(memory.drafts.filter.mock.calls.some(
      ([query]) => Object.hasOwn(query, 'recovery_email'),
    )).toBe(false);
  });

  it('returns the same draft on idempotent retry without reissuing credentials', async () => {
    const memory = createMemorySdk();
    const handler = handlerFor(memory);
    const first = await responseJson(await handler(request(bootstrapBody())));
    const second = await responseJson(await handler(request(bootstrapBody())));
    expect(memory.records).toHaveLength(1);
    expect(second.json.draft.draftId).toBe(first.json.draft.draftId);
    expect(second.json).toMatchObject({
      created: false, resumed: true, credentialsReissueRequired: true,
      recoveryCodeReissueRequired: true, recoveryCodeIssued: false,
      resumeTokenIssued: false,
    });
    expect(second.json).not.toHaveProperty('recoveryCode');
    expect(second.json).not.toHaveProperty('resumeToken');
  });

  it('does not let an idempotency-key replay bypass the client token binding', async () => {
    const memory = createMemorySdk();
    const handler = handlerFor(memory);
    await handler(request(bootstrapBody()));
    const { json } = await responseJson(await handler(request(bootstrapBody({
      clientBootstrapToken: 'M'.repeat(43),
    }))));
    expect(json.errorCode).toBe('INVALID_AUTHORIZATION');
    expect(memory.records).toHaveLength(1);
  });

  it('issues a server resume token once when no client bootstrap token is supplied', async () => {
    const memory = createMemorySdk();
    const handler = handlerFor(memory);
    const body = bootstrapBody({ clientBootstrapToken: undefined });
    const first = await responseJson(await handler(request(body)));
    const second = await responseJson(await handler(request(body)));
    expect(first.json.resumeToken).toBe('R'.repeat(43));
    expect(first.json.resumeTokenIssued).toBe(true);
    expect(second.json).not.toHaveProperty('resumeToken');
  });

  it('resumes by hashed token, selects the canonical duplicate, and emits no credentials', async () => {
    const token = 'Z'.repeat(43);
    const tokenHash = await hashResumeToken(token, {
      name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
      value: SECRETS.PRO_FORM_DRAFT_TOKEN_SECRET,
    });
    const memory = createMemorySdk([
      { id: 'draft-old', session_id: 'session-old', status: 'active', server_revision: 1, client_revision: 1, resume_token_hash: tokenHash },
      { id: 'draft-new', session_id: 'session-new', status: 'active', server_revision: 3, client_revision: 3, resume_token_hash: tokenHash },
    ]);
    const body = bootstrapBody({
      authorization: { resumeToken: token },
      clientBootstrapToken: undefined,
      clientContext: clientContext({ associationIntent: 'resume_current_draft' }),
    });
    const { json } = await responseJson(await handlerFor(memory)(request(body)));
    expect(json.draft.draftId).toBe('draft-new');
    expect(json).not.toHaveProperty('recoveryCode');
    expect(json).not.toHaveProperty('resumeToken');
    expect(memory.records.find(({ id }) => id === 'draft-new').last_restored_at)
      .toBeDefined();
  });

  it('creates a changed signed-email association without querying the email', async () => {
    const signedContext = clientContext({
      associationIntent: 'changed_signed_email',
      anonymousRecoveryAcknowledged: false,
      userId: 'Synthetic-User', domainName: 'Example.invalid',
      recoveryEmail: 'replacement@example.invalid',
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
    });
    const token = await signedToken(signedContext, {
      recoveryEmailLookupHash: 'a'.repeat(64),
    });
    const memory = createMemorySdk();
    const body = bootstrapBody({
      authorization: { signedDraftAccessToken: token },
      clientContext: signedContext,
    });
    const { json } = await responseJson(await handlerFor(memory)(request(body)));
    expect(json.created).toBe(true);
    expect(memory.records[0].recovery_email_verification_status).toBe('unverified');
    expect(memory.records[0]).not.toHaveProperty('identity_key_hash');
    expect(memory.drafts.filter.mock.calls.some(([query]) => (
      Object.hasOwn(query, 'recovery_email_lookup_hash')
    ))).toBe(false);
  });

  it('resumes the current record for a valid unchanged signed invitation', async () => {
    const signedContext = clientContext({
      associationIntent: 'new_invitation',
      userId: 'Synthetic-User', domainName: 'Example.invalid',
      recoveryEmail: 'signed@example.invalid',
      recoveryEmailSource: 'signed_invitation',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
    });
    const token = await signedToken(signedContext);
    const memory = createMemorySdk();
    const handler = handlerFor(memory);
    const body = bootstrapBody({
      authorization: { signedDraftAccessToken: token },
      clientContext: signedContext,
    });
    const first = await responseJson(await handler(request(body)));
    const second = await responseJson(await handler(request({
      ...body,
      idempotencyKey: 'bootstrap.synthetic.unchanged.0002',
    })));
    expect(first.json.created).toBe(true);
    expect(second.json).toMatchObject({ created: false, resumed: true });
    expect(second.json.draft.draftId).toBe(first.json.draft.draftId);
    expect(memory.records).toHaveLength(1);
  });

  it.each([
    ['tampered', (token) => `${token.slice(0, -1)}X`],
    ['expired', (_token, context) => signedToken(context, {
      issuedAt: NOW_SECONDS - 7200,
      notBefore: NOW_SECONDS - 7200,
      expiresAt: NOW_SECONDS - 120,
    })],
    ['wrong environment', (_token, context) => signedToken(context, { environment: 'production' })],
  ])('rejects a %s signed invitation safely', async (_name, mutate) => {
    const signedContext = clientContext({
      associationIntent: 'new_invitation',
      userId: 'Synthetic-User', domainName: 'Example.invalid',
      recoveryEmail: 'signed@example.invalid',
      recoveryEmailSource: 'signed_invitation',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
    });
    const valid = await signedToken(signedContext);
    const changed = await mutate(valid, signedContext);
    const memory = createMemorySdk();
    const { json } = await responseJson(await handlerFor(memory)(request(
      bootstrapBody({
        authorization: { signedDraftAccessToken: changed },
        clientContext: signedContext,
      }),
    )));
    expect(json.errorCode).toBe('INVALID_AUTHORIZATION');
    expect(memory.drafts.create).not.toHaveBeenCalled();
  });
});
