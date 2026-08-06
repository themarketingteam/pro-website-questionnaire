import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_RECOVERY_SECURITY_POLICY_VERSION,
  PRO_FORM_ABUSE_HASH_SECRET_NAME,
  RECOVERY_SECURITY_ERROR_CODES,
  calculateLockoutUntil,
  calculateRecoveryDelay,
  createGenericPublicRecoveryFailure,
  deriveRecoveryAbuseHashes,
  evaluateRecoveryAttempt,
  getRecentRecoverySecurityEvents,
  getRecoverySecurityPolicy,
  getSafeRecoverySecurityDiagnostics,
  readTrustedClientNetworkContext,
  recordRecoverySecurityEvent,
} from '../../base44/functions/_shared/proDraftRecoverySecurity/entry.ts';

const secret = Object.freeze({
  name: PRO_FORM_ABUSE_HASH_SECRET_NAME,
  value: 'a'.repeat(32),
});
const ipHash = '1'.repeat(64);
const subjectHash = '2'.repeat(64);
const now = Date.parse('2026-08-05T12:00:00.000Z');

const event = (offsetMs, overrides = {}) => ({
  request_id: `request-${Math.abs(offsetMs)}`,
  environment: 'test',
  outcome: 'not_found',
  ip_hash: ipHash,
  subject_hash: subjectHash,
  created_at_server: new Date(now + offsetMs).toISOString(),
  ...overrides,
});

describe('public recovery abuse-hash contract', () => {
  it('derives stable, purpose-separated IP/device/email/code hashes', async () => {
    const hashes = await deriveRecoveryAbuseHashes({
      trustedIpAddress: '192.0.2.8',
      deviceId: `pdd_${'D'.repeat(22)}`,
      normalizedEmail: 'synthetic@example.test',
      normalizedRecoveryCodeSubject: '2345-6789-ABCD',
    }, secret);
    expect(Object.values(hashes)).toHaveLength(4);
    expect(new Set(Object.values(hashes)).size).toBe(4);
    for (const hash of Object.values(hashes)) expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect((await deriveRecoveryAbuseHashes({ trustedIpAddress: '192.0.2.8' }, secret)).ipHash)
      .toBe(hashes.ipHash);
  });

  it('uses a stable unknown-IP bucket and enforces the separate secret purpose', async () => {
    const first = await deriveRecoveryAbuseHashes({}, secret);
    const second = await deriveRecoveryAbuseHashes({ trustedIpAddress: null }, secret);
    expect(first.ipHash).toBe(second.ipHash);
    await expect(deriveRecoveryAbuseHashes({}, {
      name: 'PRO_FORM_EMAIL_LOOKUP_SECRET', value: 'a'.repeat(32),
    })).rejects.toMatchObject({
      code: RECOVERY_SECURITY_ERROR_CODES.INVALID_SECRET_PURPOSE,
    });
  });

  it('normalizes only trusted forwarding headers and ignores request JSON IP', () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.000.002.008, 198.51.100.2' },
      body: JSON.stringify({ ip: '203.0.113.77' }),
    });
    expect(readTrustedClientNetworkContext(request)).toEqual({
      trustedAddress: '192.0.2.8',
      source: 'x-forwarded-for',
      available: true,
    });
    expect(readTrustedClientNetworkContext(new Request('https://example.test'))).toEqual({
      trustedAddress: 'unknown', source: 'unknown', available: false,
    });
  });
});

describe('recovery security policy and decisions', () => {
  it('uses the exact default thresholds', () => {
    expect(getRecoverySecurityPolicy({}, 'production')).toMatchObject({
      version: PRO_DRAFT_RECOVERY_SECURITY_POLICY_VERSION,
      ipAttemptsPer15Min: 10,
      subjectAttemptsPer15Min: 5,
      failuresBeforeCaptcha: 3,
      failuresBeforeLockout: 10,
      lockoutSeconds: 1800,
      globalAttemptsPerMin: 300,
      minResponseMs: 400,
      maxJitterMs: 200,
    });
  });

  it('rejects accidental zero/negative disablement and clamps unsafe values', () => {
    const policy = getRecoverySecurityPolicy({
      PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN: '0',
      PRO_DRAFT_RECOVERY_SUBJECT_ATTEMPTS_PER_15_MIN: '-2',
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '9999',
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_LOCKOUT: '1',
      PRO_DRAFT_RECOVERY_LOCKOUT_SECONDS: '99999999',
      PRO_DRAFT_RECOVERY_GLOBAL_ATTEMPTS_PER_MIN: '1',
      PRO_DRAFT_RECOVERY_MIN_RESPONSE_MS: '1',
      PRO_DRAFT_RECOVERY_MAX_JITTER_MS: '0',
    }, 'production');
    expect(policy.ipAttemptsPer15Min).toBe(10);
    expect(policy.subjectAttemptsPer15Min).toBe(5);
    expect(policy.failuresBeforeCaptcha).toBe(20);
    expect(policy.failuresBeforeLockout).toBe(21);
    expect(policy.lockoutSeconds).toBe(86400);
    expect(policy.globalAttemptsPerMin).toBe(50);
    expect(policy.minResponseMs).toBe(200);
    expect(policy.maxJitterMs).toBe(200);
  });

  it('enforces IP and subject attempt thresholds independently', () => {
    const policy = getRecoverySecurityPolicy({
      PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN: '2',
      PRO_DRAFT_RECOVERY_SUBJECT_ATTEMPTS_PER_15_MIN: '2',
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '5',
    }, 'test');
    const ipDecision = evaluateRecoveryAttempt({
      policy, now, ipHash, subjectHash: '3'.repeat(64),
      events: [event(-1000), event(-2000)],
    });
    expect(ipDecision).toMatchObject({
      allowed: false, rateLimited: true,
      errorCode: RECOVERY_SECURITY_ERROR_CODES.IP_RATE_LIMITED,
    });
    const subjectDecision = evaluateRecoveryAttempt({
      policy, now, ipHash: '4'.repeat(64), subjectHash,
      events: [event(-1000, { ip_hash: '5'.repeat(64) }), event(-2000, { ip_hash: '6'.repeat(64) })],
    });
    expect(subjectDecision.errorCode).toBe(RECOVERY_SECURITY_ERROR_CODES.SUBJECT_RATE_LIMITED);
  });

  it('escalates CAPTCHA only at the failure threshold or explicit risk signal', () => {
    const policy = getRecoverySecurityPolicy({}, 'test');
    expect(evaluateRecoveryAttempt({
      policy, now, ipHash, subjectHash, events: [event(-1000), event(-2000)],
    }).captchaRequired).toBe(false);
    expect(evaluateRecoveryAttempt({
      policy, now, ipHash, subjectHash,
      events: [event(-1000), event(-2000), event(-3000)],
    })).toMatchObject({
      captchaRequired: true,
      errorCode: RECOVERY_SECURITY_ERROR_CODES.CAPTCHA_REQUIRED,
    });
    expect(evaluateRecoveryAttempt({
      policy, now, ipHash, subjectHash, events: [], explicitRiskSignal: true,
    }).captchaRequired).toBe(true);
  });

  it('calculates temporary lockout and allows expiry', () => {
    const policy = getRecoverySecurityPolicy({
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_LOCKOUT: '2',
      PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA: '1',
      PRO_DRAFT_RECOVERY_LOCKOUT_SECONDS: '30',
    }, 'test');
    expect(calculateLockoutUntil(now, 1, policy)).toBeNull();
    expect(calculateLockoutUntil(now, 2, policy)).toBe('2026-08-05T12:00:30.000Z');
    expect(evaluateRecoveryAttempt({
      policy, now, ipHash, subjectHash,
      events: [event(-1000), event(-2000)],
    })).toMatchObject({ locked: true, allowed: false, retryAfterSeconds: 30 });
    expect(evaluateRecoveryAttempt({
      policy, now, ipHash, subjectHash,
      events: [event(-40000, { lockout_until: '2026-08-05T11:59:59.000Z' })],
    }).locked).toBe(false);
  });

  it('trips and marks the global circuit breaker', () => {
    const policy = getRecoverySecurityPolicy({
      PRO_DRAFT_RECOVERY_GLOBAL_ATTEMPTS_PER_MIN: '2',
    }, 'test');
    expect(evaluateRecoveryAttempt({
      policy, now, ipHash, subjectHash, events: [event(-1000), event(-2000)],
    })).toMatchObject({
      errorCode: RECOVERY_SECURITY_ERROR_CODES.GLOBAL_RATE_LIMITED,
      recordGlobalCircuitBreakerEvent: true,
    });
  });

  it('calculates a minimum response delay with bounded Web Crypto jitter', () => {
    const policy = getRecoverySecurityPolicy({}, 'test');
    const cryptoProvider = {
      getRandomValues: vi.fn((values) => {
        values[0] = 150;
        return values;
      }),
    };
    expect(calculateRecoveryDelay({
      requestStartedAtMs: 1000, nowMs: 1100, policy, cryptoProvider,
    })).toBe(450);
    expect(calculateRecoveryDelay({
      requestStartedAtMs: 1000, nowMs: 9999, policy, cryptoProvider,
    })).toBe(0);
  });
});

describe('security-event storage and public errors', () => {
  it('records an allowlisted hash-only event and drops unknown raw input', async () => {
    const create = vi.fn(async (row) => ({ id: 'synthetic-event', ...row }));
    await recordRecoverySecurityEvent({ create, filter: vi.fn() }, {
      request_id: 'request-1', environment: 'test', attempt_type: 'email_recovery',
      outcome: 'not_found', ip_hash: ipHash, subject_hash: subjectHash,
      created_at_server: '2026-08-05T12:00:00.000Z',
      failure_count_window: Number.NaN,
      attempt_count_window: 4.9,
      email: 'must-not-persist@example.test',
      ip_address: '192.0.2.8',
    });
    const stored = create.mock.calls[0][0];
    expect(stored).not.toHaveProperty('email');
    expect(stored).not.toHaveProperty('ip_address');
    expect(stored.failure_count_window).toBe(0);
    expect(stored.attempt_count_window).toBe(4);
    expect(JSON.stringify(stored)).not.toMatch(/must-not-persist|192\.0\.2\.8/u);
  });

  it('rejects malformed event timestamps before touching storage', async () => {
    const create = vi.fn();
    await expect(recordRecoverySecurityEvent({ create, filter: vi.fn() }, {
      request_id: 'request-bad-date', environment: 'test',
      created_at_server: 'not-a-date',
    })).rejects.toMatchObject({ code: RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT });
    expect(create).not.toHaveBeenCalled();
  });

  it('reads only bounded recent environment events through the injected entity', async () => {
    const filter = vi.fn(async () => [event(-1000), event(-9999999)]);
    const rows = await getRecentRecoverySecurityEvents({ create: vi.fn(), filter }, {
      environment: 'test', since: new Date(now - 900000), limit: 20,
    });
    expect(filter).toHaveBeenCalledWith({ environment: 'test' }, '-created_at_server', 20, 0);
    expect(rows).toHaveLength(1);
  });

  it('returns the same generic public error regardless of internal cause', () => {
    const missing = createGenericPublicRecoveryFailure({ requestId: 'request-missing' });
    const wrong = createGenericPublicRecoveryFailure({
      requestId: 'request-wrong', captchaRequired: true, retryAfterSeconds: 30,
    });
    expect(missing.message).toBe(wrong.message);
    expect(missing.errorCode).toBe('RECOVERY_NOT_COMPLETED');
    expect(JSON.stringify([missing, wrong])).not.toMatch(/does not exist|expired|drafts/iu);
  });

  it('returns diagnostics without hashes, subjects, secrets, or raw values', () => {
    const diagnostics = getSafeRecoverySecurityDiagnostics(
      getRecoverySecurityPolicy({}, 'test'),
    );
    expect(diagnostics).toMatchObject({
      policyVersion: 1,
      storesRawNetworkAddress: false,
      storesRawDeviceId: false,
      storesRawRecoverySubject: false,
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/example\.test|192\.0\.2|secret|hash/iu);
  });

  it('contains no logging or request-body parsing in the shared policy module', () => {
    const source = readFileSync(
      'base44/functions/_shared/proDraftRecoverySecurity/entry.ts',
      'utf8',
    );
    expect(source).not.toMatch(/console\.|\.json\(\)|request\.body|req\.body/gu);
  });
});
