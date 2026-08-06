import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_AUTH_ERROR_CODES,
  ADMIN_AUTH_SCOPES,
  createVerifyDraftRecoveryAccessHandler,
  derivePasswordComparisonValue,
  evaluateAdminRecoveryAttempt,
  getAdminRecoveryPolicy,
  getSafeAdminAuthorizationDiagnostics,
  issuePersistentAdminRecoveryGrant,
  normalizeSubmittedRecoveryPassword,
  recordAdminRecoverySecurityEvent,
  validateAdminDeviceBinding,
  verifyPersistentAdminRecoveryGrant,
  verifyRecoveryPassword,
} from '../../base44/functions/_shared/proDraftAdminAuthorization/entry.ts';
import { fromBase64Url, utf8Decode } from '../../base44/functions/_shared/proDraftSecurity/entry.ts';

const SECRET = 'synthetic-admin-grant-secret-value-0000000000000000';
const OTHER_SECRET = 'different-synthetic-admin-secret-1111111111111111';
const DEVICE_ID = `pdd_${'A'.repeat(22)}`;
const NOW_SECONDS = 2_000_000_000;
const NOW = new Date(NOW_SECONDS * 1000);
const IP_HASH = '1'.repeat(64);
const DEVICE_HASH = '2'.repeat(64);

const policy = (values = {}) => Object.freeze({
  ...getAdminRecoveryPolicy({ PRO_DRAFT_ENVIRONMENT: 'test' }),
  ...values,
});

const issue = async (overrides = {}) => issuePersistentAdminRecoveryGrant({
  policy: policy(overrides.policy),
  deviceBindingHash: overrides.deviceBindingHash ?? DEVICE_HASH,
  adminGrantSecret: overrides.secret ?? SECRET,
  clock: () => NOW_SECONDS,
  tokenIdGenerator: () => `pdti_${'T'.repeat(43)}`,
});

const verify = async (grant, overrides = {}) => verifyPersistentAdminRecoveryGrant({
  grant,
  policy: policy(overrides.policy),
  deviceBindingHash: overrides.deviceBindingHash ?? DEVICE_HASH,
  adminGrantSecret: overrides.secret ?? SECRET,
  clock: () => NOW_SECONDS,
});

const decode = (grant) => JSON.parse(utf8Decode(fromBase64Url(grant.split('.')[0])));

describe('password-only admin authorization primitives', () => {
  it('uses exact safe defaults and clamps unsafe numeric configuration', () => {
    expect(policy()).toMatchObject({
      grantVersion: 1, passwordVersion: 1, recoveryPolicyVersion: 1,
      ipAttemptsPer15Min: 10, deviceAttemptsPer15Min: 10,
      failuresBeforeLockout: 10, lockoutSeconds: 1800,
      minResponseMs: 400, maxJitterMs: 200,
    });
    expect(getAdminRecoveryPolicy({
      PRO_DRAFT_ENVIRONMENT: 'production',
      PRO_FORM_ADMIN_RECOVERY_IP_ATTEMPTS_PER_15_MIN: '0',
      PRO_FORM_ADMIN_RECOVERY_DEVICE_ATTEMPTS_PER_15_MIN: '-9',
      PRO_FORM_ADMIN_RECOVERY_LOCKOUT_SECONDS: '999999',
    })).toMatchObject({
      ipAttemptsPer15Min: 1, deviceAttemptsPer15Min: 1, lockoutSeconds: 86400,
    });
  });

  it('accepts only nonempty bounded strings without trimming', () => {
    expect(normalizeSubmittedRecoveryPassword('  exact  ')).toBe('  exact  ');
    expect(() => normalizeSubmittedRecoveryPassword('')).toThrow();
    expect(() => normalizeSubmittedRecoveryPassword(42)).toThrow();
    expect(() => normalizeSubmittedRecoveryPassword('x'.repeat(1025))).toThrow();
  });

  it('derives stable constant-length HMAC values', async () => {
    const first = await derivePasswordComparisonValue('synthetic-pass', SECRET);
    const second = await derivePasswordComparisonValue('synthetic-pass', SECRET);
    const different = await derivePasswordComparisonValue('synthetic-pass-2', SECRET);
    expect(first).toHaveLength(32);
    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });

  it('compares exact equal and unequal password values', async () => {
    await expect(verifyRecoveryPassword({
      submittedPassword: ' synthetic ', configuredPassword: ' synthetic ',
      adminGrantSecret: SECRET,
    })).resolves.toBe(true);
    await expect(verifyRecoveryPassword({
      submittedPassword: 'synthetic', configuredPassword: ' synthetic ',
      adminGrantSecret: SECRET,
    })).resolves.toBe(false);
  });

  it('fails closed for a missing or short admin grant secret', async () => {
    await expect(derivePasswordComparisonValue('synthetic', '')).rejects.toMatchObject({
      code: ADMIN_AUTH_ERROR_CODES.INVALID_CONFIGURATION,
    });
  });

  it('derives a stable device HMAC and rejects malformed identifiers', async () => {
    const first = await validateAdminDeviceBinding({ deviceId: DEVICE_ID, adminGrantSecret: SECRET });
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(await validateAdminDeviceBinding({ deviceId: DEVICE_ID, adminGrantSecret: SECRET }))
      .toBe(first);
    await expect(validateAdminDeviceBinding({ deviceId: 'fingerprint', adminGrantSecret: SECRET }))
      .rejects.toMatchObject({ code: ADMIN_AUTH_ERROR_CODES.INVALID_INPUT });
  });
});

describe('persistent signed admin grant', () => {
  it('issues the exact no-expiry claims without sensitive content', async () => {
    const grant = await issue();
    const claims = decode(grant);
    expect(claims).toMatchObject({
      version: 1, type: 'admin_recovery_grant', scope: ADMIN_AUTH_SCOPES.DRAFT_RECOVERY,
      environment: 'test', expiresAt: null, grantVersion: 1,
      passwordVersion: 1, recoveryPolicyVersion: 1, deviceBindingHash: DEVICE_HASH,
    });
    expect(claims).not.toHaveProperty('password');
    expect(claims).not.toHaveProperty('deviceId');
    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('draftId');
  });

  it('verifies and returns normalized claims', async () => {
    await expect(verify(await issue())).resolves.toMatchObject({
      scope: 'admin:draft-recovery', environment: 'test', expiresAt: null,
    });
  });

  it.each([
    ['environment', { policy: { environment: 'staging' } }, ADMIN_AUTH_ERROR_CODES.ENVIRONMENT_MISMATCH],
    ['device', { deviceBindingHash: '3'.repeat(64) }, ADMIN_AUTH_ERROR_CODES.DEVICE_MISMATCH],
    ['grant version', { policy: { grantVersion: 2 } }, ADMIN_AUTH_ERROR_CODES.GRANT_VERSION_MISMATCH],
    ['password version', { policy: { passwordVersion: 2 } }, ADMIN_AUTH_ERROR_CODES.PASSWORD_VERSION_MISMATCH],
    ['policy version', { policy: { recoveryPolicyVersion: 2 } }, ADMIN_AUTH_ERROR_CODES.POLICY_VERSION_MISMATCH],
    ['secret rotation', { secret: OTHER_SECRET }, ADMIN_AUTH_ERROR_CODES.INVALID_GRANT],
  ])('rejects %s mismatch', async (_label, overrides, code) => {
    await expect(verify(await issue(), overrides)).rejects.toMatchObject({ code });
  });

  it('rejects a tampered token', async () => {
    const grant = await issue();
    const tampered = `${grant.slice(0, -1)}${grant.endsWith('A') ? 'B' : 'A'}`;
    await expect(verify(tampered)).rejects.toMatchObject({
      code: ADMIN_AUTH_ERROR_CODES.INVALID_GRANT,
    });
  });

  it('exposes only safe diagnostic metadata', () => {
    const value = JSON.stringify(getSafeAdminAuthorizationDiagnostics({ policy: policy() }));
    expect(value).not.toContain(SECRET);
    expect(value).not.toContain(DEVICE_ID);
    expect(value).toContain('purpose-separated-hmac');
  });
});

describe('admin authorization abuse policy and audit', () => {
  const event = (offset, overrides = {}) => ({
    request_id: `req-${Math.abs(offset)}`, environment: 'test',
    attempt_type: 'admin_password_authentication', outcome: 'invalid_password',
    ip_hash: IP_HASH, device_hash: DEVICE_HASH,
    created_at_server: new Date(NOW.getTime() + offset).toISOString(), ...overrides,
  });

  it('rate-limits password attempts by IP', () => {
    const events = Array.from({ length: 2 }, (_, index) => event(-(index + 1) * 1000));
    expect(evaluateAdminRecoveryAttempt({
      policy: policy({ ipAttemptsPer15Min: 2, deviceAttemptsPer15Min: 10 }),
      events, ipHash: IP_HASH, deviceHash: '4'.repeat(64), mode: 'password', now: NOW,
    })).toMatchObject({ allowed: false, rateLimited: true });
  });

  it('rate-limits password attempts by device', () => {
    const events = Array.from({ length: 2 }, (_, index) => event(-(index + 1) * 1000, {
      ip_hash: `${index + 5}`.repeat(64),
    }));
    expect(evaluateAdminRecoveryAttempt({
      policy: policy({ ipAttemptsPer15Min: 10, deviceAttemptsPer15Min: 2 }),
      events, ipHash: IP_HASH, deviceHash: DEVICE_HASH, mode: 'password', now: NOW,
    })).toMatchObject({ allowed: false, rateLimited: true });
  });

  it('allows four times the password threshold for grant validation', () => {
    const events = Array.from({ length: 3 }, (_, index) => event(-(index + 1) * 1000));
    expect(evaluateAdminRecoveryAttempt({
      policy: policy({ ipAttemptsPer15Min: 1, deviceAttemptsPer15Min: 1 }),
      events, ipHash: IP_HASH, deviceHash: DEVICE_HASH, mode: 'grant', now: NOW,
    }).allowed).toBe(true);
  });

  it('enforces device-scoped lockout and allows lockout expiry', () => {
    const active = event(-1000, { lockout_until: new Date(NOW.getTime() + 30_000).toISOString() });
    expect(evaluateAdminRecoveryAttempt({
      policy: policy(), events: [active], ipHash: IP_HASH,
      deviceHash: DEVICE_HASH, mode: 'password', now: NOW,
    })).toMatchObject({ allowed: false, locked: true, retryAfterSeconds: 30 });
    expect(evaluateAdminRecoveryAttempt({
      policy: policy(), events: [active], ipHash: IP_HASH,
      deviceHash: DEVICE_HASH, mode: 'password', now: NOW.getTime() + 31_000,
    }).locked).toBe(false);
    expect(evaluateAdminRecoveryAttempt({
      policy: policy(), events: [active], ipHash: IP_HASH,
      deviceHash: '9'.repeat(64), mode: 'password', now: NOW,
    }).locked).toBe(false);
  });

  it('records only hashed/safe event fields', async () => {
    const create = vi.fn(async (value) => value);
    await recordAdminRecoverySecurityEvent({ create, filter: vi.fn() }, event(-1000));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      ip_hash: IP_HASH, device_hash: DEVICE_HASH, outcome: 'invalid_password',
    }));
    const recorded = create.mock.calls[0][0];
    expect(recorded).not.toHaveProperty('password');
    expect(recorded).not.toHaveProperty('grant');
    expect(JSON.stringify(recorded)).not.toContain(DEVICE_ID);
  });
});

describe('verifyDraftRecoveryAccess handler', () => {
  const makeHandler = (overrides = {}) => {
    const create = vi.fn(async (value) => value);
    const filter = vi.fn(async () => overrides.events ?? []);
    const values = {
      PRO_DRAFT_ENVIRONMENT: 'test',
      DRAFT_RECOVERY_PASSWORD: 'synthetic correct value',
      PRO_FORM_ADMIN_GRANT_SECRET: SECRET,
      ...overrides.values,
    };
    const handler = createVerifyDraftRecoveryAccessHandler({
      createClientFromRequest: () => ({
        asServiceRole: { entities: { ProFormRecoverySecurityEvent: { create, filter } } },
      }),
      getEnvironmentValue: (name) => values[name],
      createRequestId: () => `pdrq_${'Q'.repeat(43)}`,
      now: () => NOW,
      clock: () => NOW_SECONDS,
      sleep: vi.fn(async () => {}),
    });
    return { handler, create, filter };
  };

  const request = (body, headers = {}) => new Request('https://synthetic.example/functions/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.8', ...headers },
    body: JSON.stringify(body),
  });

  it('fails closed with generic wording when configured password is missing', async () => {
    const { handler } = makeHandler({ values: { DRAFT_RECOVERY_PASSWORD: undefined } });
    const response = await handler(request({ mode: 'password', password: 'x', deviceId: DEVICE_ID }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, authorized: false });
  });

  it('fails closed when the grant secret is missing', async () => {
    const { handler } = makeHandler({ values: { PRO_FORM_ADMIN_GRANT_SECRET: undefined } });
    expect((await handler(request({
      mode: 'password', password: 'synthetic correct value', deviceId: DEVICE_ID,
    }))).status).toBe(503);
  });

  it('authorizes a correct password, issues one grant, and audits', async () => {
    const { handler, create } = makeHandler();
    const response = await handler(request({
      mode: 'password', password: 'synthetic correct value', deviceId: DEVICE_ID,
    }));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toMatchObject({ success: true, authorized: true, persistent: true });
    expect(data.grant).toEqual(expect.any(String));
    expect(data).not.toHaveProperty('expiresAt');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'authorized' }));
  });

  it('returns a generic failure and audits a wrong password', async () => {
    const { handler, create } = makeHandler();
    const response = await handler(request({
      mode: 'password', password: 'synthetic wrong value', deviceId: DEVICE_ID,
    }));
    const data = await response.json();
    expect(response.status).toBe(401);
    expect(data.error).toBe('Authorization could not be completed.');
    expect(JSON.stringify(data)).not.toContain('wrong value');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'invalid_password' }));
  });

  it('treats a missing submitted password as the same audited public failure', async () => {
    const { handler, create } = makeHandler();
    const response = await handler(request({ mode: 'password', deviceId: DEVICE_ID }));
    const data = await response.json();
    expect(response.status).toBe(401);
    expect(data.error).toBe('Authorization could not be completed.');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'invalid_password' }));
  });

  it('validates a grant without echoing it', async () => {
    const { handler } = makeHandler();
    const passwordData = await (await handler(request({
      mode: 'password', password: 'synthetic correct value', deviceId: DEVICE_ID,
    }))).json();
    const response = await handler(request({ mode: 'grant', grant: passwordData.grant, deviceId: DEVICE_ID }));
    const data = await response.json();
    expect(data).toMatchObject({ success: true, authorized: true });
    expect(data).not.toHaveProperty('grant');
  });

  it('rejects non-POST, non-JSON, oversized, and unexpected request fields', async () => {
    const { handler } = makeHandler();
    const getResponse = await handler(new Request('https://synthetic.example', { method: 'GET' }));
    const textResponse = await handler(request({ mode: 'password' }, { 'content-type': 'text/plain' }));
    const extraResponse = await handler(request({
      mode: 'password', password: 'x', deviceId: DEVICE_ID, redirect: '/admin',
    }));
    const oversizedResponse = await handler(new Request('https://synthetic.example', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(17 * 1024) }),
    }));
    expect([getResponse.status, textResponse.status, extraResponse.status, oversizedResponse.status])
      .toEqual([405, 415, 400, 413]);
  });
});
