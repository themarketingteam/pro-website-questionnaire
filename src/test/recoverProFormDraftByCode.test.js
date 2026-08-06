import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  verifyRecoverySessionToken,
} from '../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  createRecoverProFormDraftByCodeHandler,
} from '../../base44/functions/_shared/proDraftCodeRecovery/entry.ts';
import {
  PRO_FORM_ABUSE_HASH_SECRET_NAME,
  deriveRecoveryAbuseHashes,
} from '../../base44/functions/_shared/proDraftRecoverySecurity/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  hashRecoveryCode,
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
const RAW_CODE = '2345-6789-ABCD-EFGH-JKMN';
const NORMALIZED_CODE = '23456789ABCDEFGHJKMN';
const WRONG_CODE = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ';
const REQUEST_ID = `pdrq_${'Q'.repeat(43)}`;
const CODE_SECRET = 'c'.repeat(32);
const ABUSE_SECRET = 'a'.repeat(32);
const SESSION_SECRET = 's'.repeat(32);
const IP = '192.0.2.8';

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
  PRO_FORM_RECOVERY_CODE_SECRET: CODE_SECRET,
  PRO_FORM_ABUSE_HASH_SECRET: ABUSE_SECRET,
  PRO_FORM_RECOVERY_SESSION_SECRET: SESSION_SECRET,
  PRO_FORM_RECOVERY_SESSION_TTL_SECONDS: '3600',
  PRO_DRAFT_CAPTCHA_PROVIDER: 'disabled',
  PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED: 'false',
  ...overrides,
});

const requestBody = (overrides = {}) => ({
  apiVersion: 1,
  recoveryCode: RAW_CODE,
  clientContext: {
    formType: 'pro-questionnaire',
    sourceTabId: 'synthetic-tab-1',
    appBuildSha: 'synthetic-build',
    environment: 'staging',
  },
  ...overrides,
});

const request = (body = requestBody(), overrides = {}) => new Request(
  'https://synthetic.invalid/functions/recoverProFormDraftByCode',
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

async function draftRecord(overrides = {}) {
  const recoveryCodeHash = await hashRecoveryCode(NORMALIZED_CODE, {
    name: SECURITY_SECRET_NAMES.RECOVERY_CODE,
    value: CODE_SECRET,
  });
  return {
    id: 'draft-synthetic-code-1',
    session_id: 'session-synthetic-code-1',
    status: 'active',
    recovery_code_hash: recoveryCodeHash,
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

function createMemorySdk(draftsSeed = [], securitySeed = [], options = {}) {
  const drafts = draftsSeed.map((record) => ({ ...record }));
  const securityRows = securitySeed.map((record) => ({ ...record }));
  const draftEntity = entityMethods({
    filter: vi.fn(async (query) => drafts.filter((record) => Object.entries(query)
      .every(([key, value]) => record[key] === value))),
    get: vi.fn(async (id) => {
      const found = drafts.find((record) => record.id === id);
      if (!found) throw new Error('synthetic not found');
      return { ...found };
    }),
  });
  const securityEntity = entityMethods({
    filter: vi.fn(async (query) => securityRows.filter((record) => Object.entries(query)
      .every(([key, value]) => record[key] === value))),
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

async function hashes(code = NORMALIZED_CODE) {
  return deriveRecoveryAbuseHashes({
    trustedIpAddress: IP,
    normalizedRecoveryCodeSubject: code,
  }, { name: PRO_FORM_ABUSE_HASH_SECRET_NAME, value: ABUSE_SECRET });
}

let syntheticEventSequence = 0;

async function securityEvent(overrides = {}) {
  const derived = await hashes();
  syntheticEventSequence += 1;
  return {
    request_id: `prior-${syntheticEventSequence}`,
    environment: 'staging',
    attempt_type: 'code_recovery',
    outcome: 'not_found',
    ip_hash: derived.ipHash,
    subject_hash: derived.codeSubjectHash,
    created_at_server: new Date(NOW - 1000).toISOString(),
    ...overrides,
  };
}

async function successfulHarness(recordOverrides = {}, options = {}) {
  const record = await draftRecord(recordOverrides);
  const memory = createMemorySdk([record], options.securitySeed ?? [], options);
  const deps = dependencies(memory, options.dependencies ?? {});
  const handler = createRecoverProFormDraftByCodeHandler(deps);
  return { record, memory, deps, handler };
}

describe('recoverProFormDraftByCode request and runtime guards', () => {
  it('fails closed when durable draft runtime is disabled', async () => {
    const memory = createMemorySdk();
    const deps = dependencies(memory, {
      environment: { PRO_DRAFT_V2_SERVER_ENABLED: 'false' },
    });
    const { response, json } = await responseJson(
      await createRecoverProFormDraftByCodeHandler(deps)(request()),
    );
    expect(response.status).toBe(503);
    expect(json.errorCode).toBe('RECOVERY_NOT_COMPLETED');
    expect(memory.draftEntity.filter).not.toHaveBeenCalled();
  });

  it('fails closed when the public recovery flag is disabled', async () => {
    const memory = createMemorySdk();
    const deps = dependencies(memory, {
      environment: { PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'false' },
    });
    const { response } = await responseJson(
      await createRecoverProFormDraftByCodeHandler(deps)(request()),
    );
    expect(response.status).toBe(503);
    expect(memory.draftEntity.filter).not.toHaveBeenCalled();
  });

  it('accepts POST JSON only and advertises POST on method failure', async () => {
    const { handler } = await successfulHarness();
    const get = new Request('https://synthetic.invalid', { method: 'GET' });
    const { response, json } = await responseJson(await handler(get));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(json.message).toBe('We could not recover a questionnaire with the information provided.');
  });

  it('rejects a declared request over 32 KB before reading it', async () => {
    const { handler } = await successfulHarness();
    const oversized = request(requestBody(), {
      headers: {
        'content-type': 'application/json',
        'content-length': String(32 * 1024 + 1),
      },
    });
    expect((await handler(oversized)).status).toBe(413);
  });

  it.each([
    ['missing code', { apiVersion: 1, clientContext: {} }],
    ['client draft ID', requestBody({ draftId: 'draft-attacker' })],
    ['email', requestBody({ email: 'synthetic@example.test' })],
    ['recovery hash', requestBody({ recoveryCodeHash: 'f'.repeat(64) })],
    ['resume hash', requestBody({ resumeTokenHash: 'e'.repeat(64) })],
  ])('rejects forbidden or incomplete shape: %s', async (_label, body) => {
    const { handler, memory } = await successfulHarness();
    const { json } = await responseJson(await handler(request(body)));
    expect(json.errorCode).toBe('RECOVERY_NOT_COMPLETED');
    expect(memory.draftEntity.filter).not.toHaveBeenCalled();
  });

  it('records invalid format without querying a draft', async () => {
    const { handler, memory } = await successfulHarness();
    const { json } = await responseJson(await handler(request(requestBody({
      recoveryCode: 'malformed-code',
    }))));
    expect(json.errorCode).toBe('RECOVERY_NOT_COMPLETED');
    expect(memory.securityRows.at(-1).outcome).toBe('invalid_input');
    expect(memory.draftEntity.filter).not.toHaveBeenCalled();
  });

  it('accepts no device ID and rejects a malformed device ID', async () => {
    const { handler } = await successfulHarness();
    expect((await responseJson(await handler(request()))).json.success).toBe(true);
    const malformed = await responseJson(await handler(request(requestBody({
      deviceId: 'fingerprint-like-value',
    }))));
    expect(malformed.json.success).toBe(false);
  });

  it('accepts testRunId only outside production', async () => {
    const { handler } = await successfulHarness();
    expect((await responseJson(await handler(request(requestBody({
      testRunId: 'synthetic-run-1',
    }))))).json.success).toBe(true);
    const memory = createMemorySdk();
    const deps = dependencies(memory, { environment: {
      PRO_DRAFT_ENVIRONMENT: 'production',
      PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'production',
    } });
    const productionBody = requestBody({
      testRunId: 'synthetic-run-1',
      clientContext: { environment: 'production' },
    });
    expect((await responseJson(await createRecoverProFormDraftByCodeHandler(deps)(
      request(productionBody),
    ))).json.success).toBe(false);
  });
});

describe('recoverProFormDraftByCode status and token issuance', () => {
  it.each(['active', 'submit_attempted', 'submit_failed'])(
    'recovers exact %s draft with read/write/event scopes',
    async (status) => {
      const { handler, memory } = await successfulHarness({ status });
      const { response, json } = await responseJson(await handler(request()));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(json).toMatchObject({ success: true, recoveryCompleted: true });
      expect(json.draft).toEqual({
        draftId: 'draft-synthetic-code-1',
        status,
        readOnly: false,
        businessNameDisplay: 'Synthetic Business',
        createdAt: '2033-05-01T00:00:00.000Z',
        lastSavedAt: '2033-05-17T00:00:00.000Z',
        draftGeneration: 2,
        recoveryCodeHint: 'JKMN',
      });
      const claims = await verifyRecoverySessionToken(json.recoverySessionToken, {
        secret: {
          name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
          value: SESSION_SECRET,
        },
        expectedEnvironment: 'staging',
        expectedDraftId: 'draft-synthetic-code-1',
        expectedAuthorizationMethod: 'recovery_code',
        expectedRecoverySessionVersion: 1,
        expectedGrantVersion: 1,
        requiredScopes: [
          SIGNED_TOKEN_SCOPES.DRAFT_READ,
          SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
          SIGNED_TOKEN_SCOPES.DRAFT_EVENTS,
        ],
        clock: () => NOW_SECONDS,
      });
      expect(claims).not.toHaveProperty('recoveryEmailLookupHash');
      expect(memory.securityRows.at(-1)).toMatchObject({
        outcome: 'success', draft_id: 'draft-synthetic-code-1',
      });
    },
  );

  it('recovers submitted status with submitted-read and read only', async () => {
    const { handler } = await successfulHarness({ status: 'submitted' });
    const { json } = await responseJson(await handler(request()));
    expect(json.draft.readOnly).toBe(true);
    const claims = await verifyRecoverySessionToken(json.recoverySessionToken, {
      secret: { name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION, value: SESSION_SECRET },
      expectedEnvironment: 'staging',
      expectedDraftId: 'draft-synthetic-code-1',
      expectedAuthorizationMethod: 'recovery_code',
      expectedRecoverySessionVersion: 1,
      expectedGrantVersion: 1,
      requiredScopes: [
        SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ,
        SIGNED_TOKEN_SCOPES.DRAFT_READ,
      ],
      clock: () => NOW_SECONDS,
    });
    expect(claims.authorizedScopes).not.toContain(SIGNED_TOKEN_SCOPES.DRAFT_WRITE);
    expect(claims.authorizedScopes).not.toContain(SIGNED_TOKEN_SCOPES.DRAFT_EVENTS);
  });

  it.each([
    ['cleared_superseded', 'superseded'],
    ['expired', 'not_found'],
    ['deleted', 'not_found'],
  ])('returns generic failure for %s and records safe outcome', async (status, outcome) => {
    const { handler, memory } = await successfulHarness({ status });
    const { json } = await responseJson(await handler(request()));
    expect(json).toMatchObject({ success: false, errorCode: 'RECOVERY_NOT_COMPLETED' });
    expect(json).not.toHaveProperty('draft');
    expect(memory.securityRows.at(-1).outcome).toBe(outcome);
  });

  it('treats elapsed retention as expired without returning the draft', async () => {
    const { handler, memory } = await successfulHarness({
      retention_expires_at: '2033-05-18T03:33:19.000Z',
    });
    expect((await responseJson(await handler(request()))).json.success).toBe(false);
    expect(memory.securityRows.at(-1).outcome).toBe('not_found');
  });

  it('alerts and fails generically for unknown status', async () => {
    const safeLog = vi.fn();
    const record = await draftRecord({ status: 'future_unknown' });
    const memory = createMemorySdk([record]);
    const deps = dependencies(memory, { safeLog });
    const { json } = await responseJson(
      await createRecoverProFormDraftByCodeHandler(deps)(request()),
    );
    expect(json.success).toBe(false);
    expect(safeLog).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      errorCode: 'RECOVERY_CODE_UNKNOWN_STATUS',
    });
  });

  it('selects a canonical duplicate, records success, and logs only a safe warning', async () => {
    const safeLog = vi.fn();
    const older = await draftRecord({ id: 'draft-older', server_revision: 1 });
    const newer = await draftRecord({ id: 'draft-newer', server_revision: 9 });
    const memory = createMemorySdk([older, newer]);
    const deps = dependencies(memory, { safeLog });
    const { json } = await responseJson(
      await createRecoverProFormDraftByCodeHandler(deps)(request()),
    );
    expect(json.draft.draftId).toBe('draft-newer');
    expect(safeLog).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      errorCode: 'RECOVERY_CODE_DUPLICATE_HASH',
    });
    expect(JSON.stringify(safeLog.mock.calls)).not.toContain(RAW_CODE);
  });

  it('returns the same generic envelope for wrong and malformed codes', async () => {
    const { handler } = await successfulHarness();
    const wrong = (await responseJson(await handler(request(requestBody({
      recoveryCode: WRONG_CODE,
    }))))).json;
    const malformed = (await responseJson(await handler(request(requestBody({
      recoveryCode: 'wrong',
    }))))).json;
    expect(wrong.message).toBe(malformed.message);
    expect(wrong.errorCode).toBe(malformed.errorCode);
    expect(wrong).not.toHaveProperty('draft');
  });

  it('fails closed when success auditing fails', async () => {
    const { handler } = await successfulHarness({}, { failSecurityCreate: true });
    const { response, json } = await responseJson(await handler(request()));
    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json).not.toHaveProperty('recoverySessionToken');
  });

  it('returns no canonical state, email, recovery hash, or code hash', async () => {
    const { handler } = await successfulHarness();
    const { json } = await responseJson(await handler(request()));
    const serialized = JSON.stringify(json);
    expect(serialized).not.toMatch(/canonicalState|recoveryEmail|recovery_code_hash|codeHash/iu);
    expect(serialized).not.toContain(RAW_CODE);
  });
});

describe('recoverProFormDraftByCode abuse controls', () => {
  it('enforces IP, subject, and global thresholds before draft lookup', async () => {
    const derived = await hashes();
    const base = await securityEvent();
    const cases = [
      {
        environment: { PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN: '1' },
        seed: [{ ...base, subject_hash: 'b'.repeat(64) }],
      },
      {
        environment: { PRO_DRAFT_RECOVERY_SUBJECT_ATTEMPTS_PER_15_MIN: '1' },
        seed: [{ ...base, ip_hash: 'c'.repeat(64), subject_hash: derived.codeSubjectHash }],
      },
      {
        environment: { PRO_DRAFT_RECOVERY_GLOBAL_ATTEMPTS_PER_MIN: '1' },
        seed: [{ ...base, ip_hash: 'd'.repeat(64), subject_hash: 'e'.repeat(64) }],
      },
    ];
    for (const item of cases) {
      const record = await draftRecord();
      const memory = createMemorySdk([record], item.seed);
      const deps = dependencies(memory, { environment: item.environment });
      const { response, json } = await responseJson(
        await createRecoverProFormDraftByCodeHandler(deps)(request()),
      );
      expect(response.status).toBe(429);
      expect(json.retryAfterSeconds).toBeGreaterThan(0);
      expect(memory.draftEntity.filter).not.toHaveBeenCalled();
    }
  });

  it('applies an IP block before malformed-code handling', async () => {
    const prior = await securityEvent({ subject_hash: 'b'.repeat(64) });
    const { handler, memory } = await successfulHarness({}, {
      securitySeed: [prior],
      dependencies: {
        environment: { PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN: '1' },
      },
    });
    const { response } = await responseJson(await handler(request(requestBody({
      recoveryCode: 'malformed-code',
    }))));
    expect(response.status).toBe(429);
    expect(memory.draftEntity.filter).not.toHaveBeenCalled();
  });

  it('preserves an existing block when its security-event write fails', async () => {
    const safeLog = vi.fn();
    const prior = await securityEvent({ subject_hash: 'b'.repeat(64) });
    const record = await draftRecord();
    const memory = createMemorySdk([record], [prior], { failSecurityCreate: true });
    const deps = dependencies(memory, {
      safeLog,
      environment: { PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN: '1' },
    });
    const { response, json } = await responseJson(
      await createRecoverProFormDraftByCodeHandler(deps)(request()),
    );
    expect(response.status).toBe(429);
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
    expect(safeLog).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      errorCode: 'RECOVERY_CODE_EVENT_WRITE_FAILED',
    });
    expect(memory.draftEntity.filter).not.toHaveBeenCalled();
  });

  it('requires CAPTCHA at the failure threshold', async () => {
    const prior = await securityEvent();
    const { handler, memory } = await successfulHarness({}, {
      securitySeed: [prior],
      dependencies: {
        environment: { PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '1' },
      },
    });
    const { json } = await responseJson(await handler(request()));
    expect(json).toMatchObject({ success: false, captchaRequired: true });
    expect(memory.securityRows.at(-1).outcome).toBe('captcha_required');
  });

  it('accepts a valid staging CAPTCHA and rejects invalid or unavailable CAPTCHA', async () => {
    const prior = await securityEvent();
    const record = await draftRecord();
    const validMemory = createMemorySdk([record], [prior]);
    const validDeps = dependencies(validMemory, { environment: {
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '1',
      PRO_DRAFT_CAPTCHA_PROVIDER: 'staging_test',
      PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED: 'true',
    } });
    const valid = await responseJson(await createRecoverProFormDraftByCodeHandler(validDeps)(
      request(requestBody({ captchaToken: 'staging-test-valid' })),
    ));
    expect(valid.json.success).toBe(true);
    expect(validMemory.securityRows.at(-1).captcha_verified).toBe(true);

    const invalidMemory = createMemorySdk([record], [prior]);
    const invalidDeps = dependencies(invalidMemory, { environment: {
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '1',
      PRO_DRAFT_CAPTCHA_PROVIDER: 'staging_test',
      PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED: 'true',
    } });
    const invalid = await responseJson(await createRecoverProFormDraftByCodeHandler(invalidDeps)(
      request(requestBody({ captchaToken: 'staging-test-invalid' })),
    ));
    expect(invalid.json).toMatchObject({ success: false, captchaRequired: true });
    expect(invalidMemory.securityRows.at(-1).outcome).toBe('captcha_failed');

    const unavailableMemory = createMemorySdk([record], [prior]);
    const unavailableDeps = dependencies(unavailableMemory, { environment: {
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '1',
    } });
    const unavailable = await responseJson(
      await createRecoverProFormDraftByCodeHandler(unavailableDeps)(request(requestBody({
        captchaToken: 'synthetic-provider-token',
      }))),
    );
    expect(unavailable.json).toMatchObject({ success: false, captchaRequired: true });
    expect(unavailableMemory.draftEntity.filter).not.toHaveBeenCalled();
  });

  it('enforces lockout and permits an expired lockout', async () => {
    const priorFailures = await Promise.all(Array.from({ length: 10 }, (_, index) => (
      securityEvent({
        request_id: `prior-lock-${index}`,
        created_at_server: new Date(NOW - 1000 - index).toISOString(),
      })
    )));
    const record = await draftRecord();
    const lockedMemory = createMemorySdk([record], priorFailures);
    const lockedDeps = dependencies(lockedMemory);
    const locked = await responseJson(
      await createRecoverProFormDraftByCodeHandler(lockedDeps)(request()),
    );
    expect(locked.response.status).toBe(429);
    expect(lockedMemory.securityRows.at(-1).outcome).toBe('locked');

    const expiredLock = await securityEvent({
      outcome: 'rate_limited',
      lockout_until: new Date(NOW - 1).toISOString(),
    });
    const expiredMemory = createMemorySdk([record], [expiredLock]);
    const expiredDeps = dependencies(expiredMemory);
    expect((await responseJson(
      await createRecoverProFormDraftByCodeHandler(expiredDeps)(request()),
    )).json.success).toBe(true);
  });

  it('applies the minimum response delay with bounded injected sleep', async () => {
    const { handler, deps } = await successfulHarness();
    await handler(request());
    expect(deps.sleep).toHaveBeenCalledWith(400);
  });

  it('never stores or logs the raw code and persists only safe hashes', async () => {
    const safeLog = vi.fn();
    const { handler, memory } = await successfulHarness({}, {
      dependencies: { safeLog },
    });
    await handler(request(requestBody({ recoveryCode: WRONG_CODE })));
    expect(JSON.stringify(memory.securityRows)).not.toContain(WRONG_CODE);
    expect(JSON.stringify(safeLog.mock.calls)).not.toContain(WRONG_CODE);
    expect(memory.securityRows.at(-1).subject_hash).toMatch(/^[0-9a-f]{64}$/u);
    const source = readFileSync(
      'base44/functions/_shared/proDraftCodeRecovery/entry.ts',
      'utf8',
    );
    expect(source).not.toMatch(/console\.|request\.json\(\)|req\.json\(\)/gu);
  });
});

describe('recoverProFormDraftByCode load handoff', () => {
  it('issues a token accepted by loadProFormDraft for the exact draft', async () => {
    const memory = createDraftMemorySdk();
    memory.sdk.asServiceRole.entities.ProFormRecoverySecurityEvent = entityMethods();
    const baseDeps = draftDependencies(memory.sdk);
    const bootstrap = await responseJson(await createBootstrapProFormDraftHandler(baseDeps)(
      draftRequest(bootstrapBody()),
    ));
    const code = bootstrap.json.recoveryCode;
    const recoveryDeps = {
      ...dependencies(memory),
      createClientFromRequest: vi.fn(() => memory.sdk),
    };
    const recovered = await responseJson(
      await createRecoverProFormDraftByCodeHandler(recoveryDeps)(request(requestBody({
        recoveryCode: code,
      }))),
    );
    expect(recovered.json.success).toBe(true);
    const loaded = await responseJson(await createLoadProFormDraftHandler(baseDeps)(
      draftRequest(loadBody(
        bootstrap.json.draft.draftId,
        { recoverySessionToken: recovered.json.recoverySessionToken },
      )),
    ));
    expect(loaded.json).toMatchObject({ success: true, canWrite: true });
    expect(loaded.json.draft.draftId).toBe(bootstrap.json.draft.draftId);
  });
});
