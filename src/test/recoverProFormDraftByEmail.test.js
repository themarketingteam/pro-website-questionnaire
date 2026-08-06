import { describe, expect, it, vi } from 'vitest';
import {
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  verifyRecoverySessionToken,
} from '../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  createListProFormDraftRecoveryChoicesHandler,
  createRecoverProFormDraftByEmailHandler,
  createSelectProFormDraftRecoveryChoiceHandler,
  getSafeEmailRecoveryDiagnostics,
} from '../../base44/functions/_shared/proDraftEmailRecovery/entry.ts';
import {
  PRO_FORM_ABUSE_HASH_SECRET_NAME,
  deriveRecoveryAbuseHashes,
} from '../../base44/functions/_shared/proDraftRecoverySecurity/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  hashNormalizedRecoveryEmail,
} from '../../base44/functions/_shared/proDraftSecurity/entry.ts';
import {
  createBootstrapProFormDraftHandler,
  createLoadProFormDraftHandler,
} from '../../base44/functions/_shared/proDraftBootstrapLoad/entry.ts';
import {
  bootstrapBody,
  createMemorySdk as createDraftMemorySdk,
  dependencies as draftDependencies,
  loadBody,
  request as draftRequest,
} from './proDraftFunctionTestHarness.js';

const NOW = Date.parse('2033-05-18T03:33:20.000Z');
const NOW_SECONDS = Math.floor(NOW / 1000);
const EMAIL = 'synthetic.owner@example.test';
const NORMALIZED_EMAIL = EMAIL;
const OTHER_EMAIL = 'different.owner@example.test';
const REQUEST_ID = `pdrq_${'Q'.repeat(43)}`;
const EMAIL_SECRET = 'e'.repeat(32);
const ABUSE_SECRET = 'a'.repeat(32);
const SESSION_SECRET = 's'.repeat(32);
const IP = '192.0.2.9';

const cryptoProvider = {
  subtle: globalThis.crypto.subtle,
  getRandomValues(values) {
    values.fill(0);
    return values;
  },
};

const environment = (overrides = {}) => ({
  PRO_DRAFT_ENVIRONMENT: 'staging',
  PRO_DRAFT_V2_SERVER_ENABLED: 'true',
  PRO_DRAFT_V2_KILL_SWITCH: 'false',
  PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
  PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'true',
  PRO_FORM_EMAIL_LOOKUP_SECRET: EMAIL_SECRET,
  PRO_FORM_ABUSE_HASH_SECRET: ABUSE_SECRET,
  PRO_FORM_RECOVERY_SESSION_SECRET: SESSION_SECRET,
  PRO_FORM_RECOVERY_SESSION_TTL_SECONDS: '3600',
  PRO_DRAFT_CAPTCHA_PROVIDER: 'disabled',
  PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED: 'false',
  ...overrides,
});

const emailBody = (overrides = {}) => ({
  apiVersion: 1,
  email: EMAIL,
  clientContext: {
    formType: 'pro-questionnaire',
    sourceTabId: 'synthetic-email-tab',
    appBuildSha: 'synthetic-build',
    environment: 'staging',
  },
  ...overrides,
});

const request = (body, overrides = {}) => new Request(
  'https://synthetic.invalid/functions/recovery',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': IP },
    body: JSON.stringify(body),
    ...overrides,
  },
);

const responseJson = async (response) => ({ response, json: await response.json() });

function entityMethods(overrides = {}) {
  return {
    filter: vi.fn(async () => []),
    get: vi.fn(),
    create: vi.fn(async (row) => ({ id: 'synthetic-row', ...row })),
    update: vi.fn(),
    updateMany: vi.fn(),
    bulkCreate: vi.fn(async (rows) => rows),
    ...overrides,
  };
}

async function lookupHash(email = NORMALIZED_EMAIL) {
  return hashNormalizedRecoveryEmail(email, {
    name: SECURITY_SECRET_NAMES.RECOVERY_EMAIL,
    value: EMAIL_SECRET,
  });
}

async function draftRecord(overrides = {}) {
  return {
    id: 'draft-email-1',
    session_id: 'session-email-1',
    status: 'active',
    environment: 'staging',
    recovery_email_lookup_hash: await lookupHash(),
    recovery_code_version: 1,
    recovery_session_version: 1,
    recovery_code_hint: 'JKMN',
    server_revision: 4,
    client_revision: 3,
    draft_generation: 2,
    business_name: 'Synthetic Business',
    created_date: '2033-05-01T00:00:00.000Z',
    updated_date: '2033-05-17T00:00:00.000Z',
    last_saved_at: '2033-05-17T00:00:00.000Z',
    retention_expires_at: '2034-05-18T00:00:00.000Z',
    ...overrides,
  };
}

const matches = (record, query) => Object.entries(query)
  .every(([key, value]) => record[key] === value);

function createMemorySdk(draftsSeed = [], securitySeed = [], options = {}) {
  const drafts = draftsSeed.map((record) => ({ ...record }));
  const securityRows = securitySeed.map((record) => ({ ...record }));
  const draftEntity = entityMethods({
    filter: vi.fn(async (query) => drafts.filter((record) => matches(record, query))),
    get: vi.fn(async (id) => {
      const found = drafts.find((record) => record.id === id);
      if (!found) throw new Error('synthetic not found');
      return { ...found };
    }),
    update: vi.fn(async (id, data) => {
      const index = drafts.findIndex((record) => record.id === id);
      drafts[index] = { ...drafts[index], ...data };
      return { ...drafts[index] };
    }),
  });
  const securityEntity = entityMethods({
    filter: vi.fn(async (query) => securityRows.filter((record) => matches(record, query))),
    create: vi.fn(async (row) => {
      if (options.failSecurityCreate) throw new Error('synthetic audit failure');
      securityRows.push({ id: `security-${securityRows.length + 1}`, ...row });
      return securityRows.at(-1);
    }),
  });
  return {
    drafts,
    securityRows,
    draftEntity,
    securityEntity,
    sdk: {
      asServiceRole: {
        entities: {
          ProFormDraft: draftEntity,
          ProFormDraftEvent: entityMethods(),
          ProFormRecoverySecurityEvent: securityEntity,
        },
      },
    },
  };
}

function dependencies(memory, overrides = {}) {
  const env = environment(overrides.environment);
  const safeLog = overrides.safeLog ?? vi.fn();
  return {
    createClientFromRequest: vi.fn(() => memory.sdk),
    getEnvironmentValue: vi.fn((name) => env[name]),
    createRequestId: () => REQUEST_ID,
    now: () => new Date(NOW),
    clockMs: () => NOW,
    sleep: vi.fn(async () => {}),
    cryptoProvider,
    tokenIdGenerator: () => `pdti_${'T'.repeat(43)}`,
    safeLog,
    ...overrides,
    environment: undefined,
  };
}

async function abuseHashes() {
  return deriveRecoveryAbuseHashes({
    trustedIpAddress: IP,
    normalizedEmail: NORMALIZED_EMAIL,
  }, { name: PRO_FORM_ABUSE_HASH_SECRET_NAME, value: ABUSE_SECRET });
}

let eventSequence = 0;
async function securityEvent(overrides = {}) {
  eventSequence += 1;
  const hashes = await abuseHashes();
  return {
    request_id: `prior-email-${eventSequence}`,
    environment: 'staging',
    attempt_type: 'email_recovery',
    outcome: 'not_found',
    ip_hash: hashes.ipHash,
    subject_hash: hashes.emailSubjectHash,
    created_at_server: new Date(NOW - 1000).toISOString(),
    ...overrides,
  };
}

async function harness(records, options = {}) {
  const resolvedRecords = records ?? [await draftRecord()];
  const memory = createMemorySdk(resolvedRecords, options.securitySeed ?? [], options);
  const deps = dependencies(memory, options.dependencies ?? {});
  return {
    memory,
    deps,
    recover: createRecoverProFormDraftByEmailHandler(deps),
    list: createListProFormDraftRecoveryChoicesHandler(deps),
    select: createSelectProFormDraftRecoveryChoiceHandler(deps),
  };
}

async function recoverToken(subject) {
  const recovered = await responseJson(await subject.recover(request(emailBody())));
  expect(recovered.json.success).toBe(true);
  return recovered.json.recoverySessionToken;
}

describe('recoverProFormDraftByEmail guards and abuse controls', () => {
  it.each([
    ['runtime disabled', { PRO_DRAFT_V2_SERVER_ENABLED: 'false' }],
    ['public recovery disabled', { PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'false' }],
  ])('fails closed when %s', async (_label, env) => {
    const subject = await harness([], { dependencies: { environment: env } });
    const { response, json } = await responseJson(
      await subject.recover(request(emailBody())),
    );
    expect(response.status).toBe(503);
    expect(json.errorCode).toBe('RECOVERY_NOT_COMPLETED');
    expect(subject.memory.draftEntity.filter).not.toHaveBeenCalled();
  });

  it('rejects invalid email and forbidden caller bindings generically', async () => {
    const subject = await harness();
    for (const body of [
      emailBody({ email: 'not-an-email' }),
      emailBody({ draftId: 'draft-attacker' }),
      emailBody({ emailLookupHash: 'f'.repeat(64) }),
      emailBody({ verificationStatus: 'verified_otp' }),
      emailBody({ signedInvitationToken: 'synthetic-token' }),
    ]) {
      const { json } = await responseJson(await subject.recover(request(body)));
      expect(json).toMatchObject({
        success: false,
        errorCode: 'RECOVERY_NOT_COMPLETED',
      });
    }
  });

  it('applies IP, subject, global, CAPTCHA, and lockout controls before lookup', async () => {
    const prior = await securityEvent();
    const cases = [
      { PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN: '1' },
      { PRO_DRAFT_RECOVERY_SUBJECT_ATTEMPTS_PER_15_MIN: '1' },
      { PRO_DRAFT_RECOVERY_GLOBAL_ATTEMPTS_PER_MIN: '1' },
    ];
    for (const env of cases) {
      const subject = await harness([await draftRecord()], {
        securitySeed: [prior], dependencies: { environment: env },
      });
      const result = await responseJson(await subject.recover(request(emailBody())));
      expect(result.response.status).toBe(429);
      expect(subject.memory.draftEntity.filter).not.toHaveBeenCalled();
    }

    const captchaSubject = await harness([await draftRecord()], {
      securitySeed: [prior],
      dependencies: { environment: { PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '1' } },
    });
    expect((await responseJson(
      await captchaSubject.recover(request(emailBody())),
    )).json.captchaRequired).toBe(true);

    const lock = await securityEvent({
      lockout_until: new Date(NOW + 60_000).toISOString(),
    });
    const locked = await harness([await draftRecord()], { securitySeed: [lock] });
    expect((await locked.recover(request(emailBody()))).status).toBe(429);
  });

  it('accepts a valid staging CAPTCHA and rejects invalid CAPTCHA', async () => {
    const prior = await securityEvent();
    const env = {
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '1',
      PRO_DRAFT_CAPTCHA_PROVIDER: 'staging_test',
      PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED: 'true',
    };
    const valid = await harness([await draftRecord()], {
      securitySeed: [prior], dependencies: { environment: env },
    });
    expect((await responseJson(await valid.recover(request(emailBody({
      captchaToken: 'staging-test-valid',
    }))))).json.success).toBe(true);
    const invalid = await harness([await draftRecord()], {
      securitySeed: [prior], dependencies: { environment: env },
    });
    const result = await responseJson(await invalid.recover(request(emailBody({
      captchaToken: 'staging-test-invalid',
    }))));
    expect(result.json).toMatchObject({ success: false, captchaRequired: true });
    expect(invalid.memory.draftEntity.filter).not.toHaveBeenCalled();
  });
});

describe('recoverProFormDraftByEmail selection and session issuance', () => {
  it.each([
    ['active', false],
    ['submitted', true],
  ])('recovers one eligible %s draft', async (status, readOnly) => {
    const subject = await harness([await draftRecord({ status })]);
    const { response, json } = await responseJson(
      await subject.recover(request(emailBody({ email: ' Synthetic.Owner@EXAMPLE.test ' }))),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(json).toMatchObject({
      success: true,
      recoveryCompleted: true,
      otherEligibleDraftsAvailable: false,
      draft: { status, readOnly },
    });
    expect(JSON.stringify(json)).not.toContain(EMAIL);
  });

  it('selects newest created regardless of status or later updates', async () => {
    const records = [
      await draftRecord({
        id: 'older-active', status: 'active',
        created_date: '2033-01-01T00:00:00.000Z',
        updated_date: '2033-12-01T00:00:00.000Z',
      }),
      await draftRecord({
        id: 'newer-submitted', status: 'submitted',
        created_date: '2033-02-01T00:00:00.000Z',
        updated_date: '2033-02-01T00:00:00.000Z',
      }),
    ];
    let subject = await harness(records);
    expect((await responseJson(
      await subject.recover(request(emailBody())),
    )).json.draft.draftId).toBe('newer-submitted');

    subject = await harness(records.map((record) => ({
      ...record,
      status: record.id === 'older-active' ? 'submitted' : 'active',
    })));
    expect((await responseJson(
      await subject.recover(request(emailBody())),
    )).json.draft.draftId).toBe('newer-submitted');
  });

  it('selects by logical creation time after blue-to-green migration', async () => {
    const subject = await harness([
      await draftRecord({
        id: 'historical-blue-import',
        origin_record_id: 'blue-record',
        origin_created_at: '2032-01-01T00:00:00.000Z',
        created_date: '2033-05-18T03:33:20.000Z',
      }),
      await draftRecord({
        id: 'native-green-newest',
        created_date: '2032-06-01T00:00:00.000Z',
      }),
    ]);
    const recovered = await responseJson(await subject.recover(request(emailBody())));
    expect(recovered.json.draft.draftId).toBe('native-green-newest');
  });

  it('excludes superseded, expired, deleted, retention-expired, and other environments', async () => {
    const records = [
      await draftRecord({ id: 'eligible-oldest', created_date: '2033-01-01T00:00:00.000Z' }),
      await draftRecord({ id: 'superseded', status: 'cleared_superseded', created_date: '2033-05-01T00:00:00.000Z' }),
      await draftRecord({ id: 'expired', status: 'expired', created_date: '2033-04-01T00:00:00.000Z' }),
      await draftRecord({ id: 'deleted', status: 'deleted', created_date: '2033-03-01T00:00:00.000Z' }),
      await draftRecord({ id: 'retention', retention_expires_at: '2033-05-18T03:33:19.000Z' }),
      await draftRecord({ id: 'production', environment: 'production' }),
    ];
    const subject = await harness(records);
    const recovered = await responseJson(await subject.recover(request(emailBody())));
    expect(recovered.json.draft.draftId).toBe('eligible-oldest');
    expect(recovered.json.otherEligibleDraftsAvailable).toBe(false);
  });

  it('uses deterministic descending ID tie-break and returns generic no-match failures', async () => {
    const sameTime = '2033-05-01T00:00:00.000Z';
    let subject = await harness([
      await draftRecord({ id: 'draft-a', created_date: sameTime }),
      await draftRecord({ id: 'draft-z', created_date: sameTime }),
    ]);
    expect((await responseJson(
      await subject.recover(request(emailBody())),
    )).json.draft.draftId).toBe('draft-z');
    subject = await harness([]);
    const missing = await responseJson(await subject.recover(request(emailBody())));
    expect(missing.json).toMatchObject({
      success: false,
      errorCode: 'RECOVERY_NOT_COMPLETED',
    });
    expect(missing.json).not.toHaveProperty('draftCount');
  });

  it('issues exact active/submitted scopes with list-associated and no raw email', async () => {
    for (const status of ['active', 'submitted']) {
      const subject = await harness([await draftRecord({ status })]);
      const recovered = await responseJson(await subject.recover(request(emailBody())));
      const requiredScopes = status === 'submitted'
        ? [SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ, SIGNED_TOKEN_SCOPES.DRAFT_READ,
          SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED]
        : [SIGNED_TOKEN_SCOPES.DRAFT_READ, SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
          SIGNED_TOKEN_SCOPES.DRAFT_EVENTS, SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED];
      const claims = await verifyRecoverySessionToken(recovered.json.recoverySessionToken, {
        secret: { name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION, value: SESSION_SECRET },
        expectedEnvironment: 'staging',
        expectedDraftId: 'draft-email-1',
        expectedAuthorizationMethod: 'email',
        expectedRecoverySessionVersion: 1,
        expectedGrantVersion: 1,
        requiredScopes,
        clock: () => NOW_SECONDS,
      });
      expect(claims.recoveryEmailLookupHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(JSON.stringify(claims)).not.toContain(EMAIL);
      if (status === 'submitted') {
        expect(claims.authorizedScopes).not.toContain(SIGNED_TOKEN_SCOPES.DRAFT_WRITE);
        expect(claims.authorizedScopes).not.toContain(SIGNED_TOKEN_SCOPES.DRAFT_EVENTS);
      }
    }
  });

  it('records safe events, fails closed on success-audit failure, and delays responses', async () => {
    const subject = await harness();
    await subject.recover(request(emailBody()));
    expect(subject.memory.securityRows.at(-1)).toMatchObject({
      attempt_type: 'email_recovery', outcome: 'success', draft_id: 'draft-email-1',
    });
    expect(JSON.stringify(subject.memory.securityRows)).not.toContain(EMAIL);
    expect(subject.deps.sleep).toHaveBeenCalledWith(400);
    const auditFailure = await harness([await draftRecord()], { failSecurityCreate: true });
    const failed = await responseJson(await auditFailure.recover(request(emailBody())));
    expect(failed.response.status).toBe(503);
    expect(failed.json).not.toHaveProperty('recoverySessionToken');
  });
});

describe('authorized draft recovery choices', () => {
  it('lists only safe eligible associated drafts newest first and ignores body email', async () => {
    const records = [
      await draftRecord({ id: 'draft-current', created_date: '2033-02-01T00:00:00.000Z' }),
      await draftRecord({ id: 'draft-newer', status: 'submitted', created_date: '2033-03-01T00:00:00.000Z' }),
      await draftRecord({ id: 'draft-superseded', status: 'cleared_superseded', created_date: '2033-04-01T00:00:00.000Z' }),
    ];
    const subject = await harness(records);
    const token = await recoverToken(subject);
    const listed = await responseJson(await subject.list(request({
      apiVersion: 1,
      recoverySessionToken: token,
      email: OTHER_EMAIL,
    })));
    expect(listed.json.success).toBe(true);
    expect(listed.json.choices.map((item) => item.draftId)).toEqual([
      'draft-newer', 'draft-current',
    ]);
    expect(listed.json.choices.find((item) => item.draftId === 'draft-newer').readOnly)
      .toBe(true);
    expect(Object.keys(listed.json.choices[0]).sort()).toEqual([
      'draftId', 'status', 'readOnly', 'businessNameDisplay', 'createdAt',
      'lastSavedAt', 'draftGeneration', 'isCurrentSelection',
    ].sort());
    expect(JSON.stringify(listed.json)).not.toMatch(/email|domain|hash|answer/iu);
    expect(subject.memory.securityRows.at(-1).attempt_type).toBe('list_choices');
  });

  it('requires an authorized email session and caps the list at 25', async () => {
    const records = await Promise.all(Array.from({ length: 30 }, (_, index) => draftRecord({
      id: `draft-choice-${String(index).padStart(2, '0')}`,
      created_date: new Date(Date.parse('2033-01-01T00:00:00.000Z') + index * 1000)
        .toISOString(),
    })));
    const subject = await harness(records);
    const unauthorized = await responseJson(await subject.list(request({
      apiVersion: 1,
      recoverySessionToken: `${'a'.repeat(43)}.${'b'.repeat(43)}`,
    })));
    expect(unauthorized.response.status).toBe(403);
    const token = await recoverToken(subject);
    const listed = await responseJson(await subject.list(request({
      apiVersion: 1, recoverySessionToken: token,
    })));
    expect(listed.json.choices).toHaveLength(25);
  });

  it('selects an eligible matching association without mutating creation order', async () => {
    const records = [
      await draftRecord({ id: 'draft-newest', created_date: '2033-03-01T00:00:00.000Z' }),
      await draftRecord({ id: 'draft-selected', status: 'submitted', created_date: '2033-01-01T00:00:00.000Z' }),
    ];
    const subject = await harness(records);
    const token = await recoverToken(subject);
    const selected = await responseJson(await subject.select(request({
      apiVersion: 1,
      recoverySessionToken: token,
      selectedDraftId: 'draft-selected',
    })));
    expect(selected.json).toMatchObject({
      success: true,
      draft: { draftId: 'draft-selected', status: 'submitted', readOnly: true },
    });
    expect(subject.memory.draftEntity.update).not.toHaveBeenCalled();
    expect(subject.memory.drafts.find((record) => record.id === 'draft-newest').created_date)
      .toBe('2033-03-01T00:00:00.000Z');
    expect(subject.memory.securityRows.at(-1).attempt_type).toBe('select_choice');
  });

  it.each([
    ['different hash', { recovery_email_lookup_hash: 'f'.repeat(64) }],
    ['superseded', { status: 'cleared_superseded' }],
  ])('rejects selecting a %s draft generically', async (_label, overrides) => {
    const records = [
      await draftRecord({ id: 'draft-current' }),
      await draftRecord({ id: 'draft-target', ...overrides }),
    ];
    const subject = await harness(records);
    const token = await recoverToken(subject);
    const selected = await responseJson(await subject.select(request({
      apiVersion: 1,
      recoverySessionToken: token,
      selectedDraftId: 'draft-target',
    })));
    expect(selected.response.status).toBe(403);
    expect(selected.json).not.toHaveProperty('draft');
  });

  it('issues a selected token accepted by loadProFormDraft', async () => {
    const memory = createDraftMemorySdk();
    memory.sdk.asServiceRole.entities.ProFormRecoverySecurityEvent = entityMethods();
    const baseDeps = draftDependencies(memory.sdk);
    const bootstrapped = await responseJson(await createBootstrapProFormDraftHandler(baseDeps)(
      draftRequest(bootstrapBody({
        clientContext: {
          ...bootstrapBody().clientContext,
          recoveryEmail: EMAIL,
          recoveryEmailSource: 'client_entered',
          recoveryEmailVerificationStatus: 'unverified',
        },
      })),
    ));
    expect(bootstrapped.json).toMatchObject({ success: true });
    const recoveryDeps = {
      ...dependencies(memory),
      createClientFromRequest: vi.fn(() => memory.sdk),
    };
    const recover = createRecoverProFormDraftByEmailHandler(recoveryDeps);
    const select = createSelectProFormDraftRecoveryChoiceHandler(recoveryDeps);
    const recovered = await responseJson(await recover(request(emailBody())));
    const selected = await responseJson(await select(request({
      apiVersion: 1,
      recoverySessionToken: recovered.json.recoverySessionToken,
      selectedDraftId: bootstrapped.json.draft.draftId,
    })));
    const loaded = await responseJson(await createLoadProFormDraftHandler(baseDeps)(
      draftRequest(loadBody(bootstrapped.json.draft.draftId, {
        recoverySessionToken: selected.json.recoverySessionToken,
      })),
    ));
    expect(loaded.json).toMatchObject({ success: true, canWrite: true });
  });

  it('keeps diagnostics value-free and explicit about the unverified policy', () => {
    const diagnostics = getSafeEmailRecoveryDiagnostics();
    expect(diagnostics).toMatchObject({
      emailOwnershipVerified: false,
      sendsEmail: false,
      storesRawEmail: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain(EMAIL);
  });
});
