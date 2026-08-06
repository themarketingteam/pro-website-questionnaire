import { describe, expect, it, vi } from 'vitest';
import {
  AUTHORIZATION_SECRET_NAMES,
  verifyRecoverySessionToken,
} from '../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  EMAIL_VERIFICATION_ERROR_CODES,
  EMAIL_VERIFICATION_FRAMEWORK_VERSION,
  EMAIL_VERIFICATION_METHODS,
  EMAIL_VERIFICATION_STATUSES,
  consumeMagicLinkAttempt,
  createMagicLinkAttempt,
  createOtpAttempt,
  generateMagicLinkToken,
  generateOtpCode,
  getSafeEmailVerificationDiagnostics,
  hashMagicLinkToken,
  hashOtpCode,
  isMagicLinkEnabled,
  isOtpEnabled,
  issueVerifiedEmailRecoverySession,
  validateEmailVerificationRedirectPath,
  verifyOtpAttempt,
} from '../../base44/functions/_shared/proDraftEmailVerification/entry.ts';

const NOW = new Date('2036-08-06T12:00:00.000Z');
const LOOKUP_HASH = 'a'.repeat(64);
const SESSION_HASH = 'b'.repeat(64);
const otpSecret = {
  name: AUTHORIZATION_SECRET_NAMES.EMAIL_OTP,
  value: 'o'.repeat(32),
};
const magicSecret = {
  name: AUTHORIZATION_SECRET_NAMES.MAGIC_LINK,
  value: 'm'.repeat(32),
};

function memoryRepository() {
  const records = [];
  return {
    records,
    create: vi.fn(async (record) => {
      const stored = { id: `record-${records.length + 1}`, ...record };
      records.push(stored);
      return { ...stored };
    }),
    findByAttemptId: vi.fn(async (attemptId) => {
      const found = records.find((record) => record.attempt_id === attemptId);
      return found ? { ...found } : null;
    }),
    conditionalUpdate: vi.fn(async (recordId, changes, expected) => {
      const index = records.findIndex((record) => (
        record.id === recordId || record.attempt_id === recordId
      ));
      if (index < 0) throw new Error('missing');
      if (records[index].status !== expected.status
        || records[index].attempt_count !== expected.attemptCount
        || records[index].verification_token_hash !== expected.verificationTokenHash) {
        throw new Error('conditional conflict');
      }
      records[index] = { ...records[index], ...changes };
      return { ...records[index] };
    }),
  };
}

function baseAttempt(repository, overrides = {}) {
  return {
    repository,
    environment: 'test',
    recoveryEmailLookupHash: LOOKUP_HASH,
    requestId: 'request-1',
    now: NOW,
    attemptIdGenerator: () => 'attempt-1',
    testRunId: 'test-run-1',
    ...overrides,
  };
}

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('future email verification service', () => {
  it('publishes frozen contracts and remains disabled unless both parent and method flags are true', () => {
    expect(EMAIL_VERIFICATION_FRAMEWORK_VERSION).toBe(1);
    expect(EMAIL_VERIFICATION_METHODS).toEqual(['otp', 'magic_link']);
    expect(EMAIL_VERIFICATION_STATUSES).toEqual([
      'pending', 'verified', 'expired', 'locked', 'consumed', 'cancelled',
    ]);
    expect(isOtpEnabled({ durableDraftV2Enabled: true, emailOtpEnabled: false })).toBe(false);
    expect(isOtpEnabled({ durableDraftV2Enabled: true, emailOtpEnabled: true })).toBe(true);
    expect(isMagicLinkEnabled({ durableDraftV2Enabled: false, magicLinkEnabled: true })).toBe(false);
  });

  it('uses rejection sampling to produce exactly six numeric OTP digits', () => {
    let calls = 0;
    const cryptoProvider = {
      getRandomValues(bytes) {
        calls += 1;
        bytes.fill(255);
        if (calls === 2) bytes.set([0, 1, 2, 3, 4, 5]);
        return bytes;
      },
    };
    expect(generateOtpCode({ cryptoProvider })).toBe('012345');
    expect(calls).toBe(2);
    expect(generateOtpCode()).toMatch(/^\d{6}$/u);
  });

  it('domain-separates OTP and magic-link hashes with separate secrets', async () => {
    const otpHash = await hashOtpCode('123456', otpSecret, {
      attemptId: 'attempt-1', recoveryEmailLookupHash: LOOKUP_HASH,
    });
    const token = generateMagicLinkToken();
    const magicHash = await hashMagicLinkToken(token, magicSecret, {
      attemptId: 'attempt-1', recoveryEmailLookupHash: LOOKUP_HASH,
    });
    expect(otpHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(magicHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(otpHash).not.toBe(magicHash);
    await expectCode(
      hashOtpCode('123456', magicSecret, {
        attemptId: 'attempt-1', recoveryEmailLookupHash: LOOKUP_HASH,
      }),
      EMAIL_VERIFICATION_ERROR_CODES.SECRET_INVALID,
    );
  });

  it('creates an OTP attempt with default TTL/attempt cap and stores no raw value', async () => {
    const repository = memoryRepository();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const created = await createOtpAttempt({
      ...baseAttempt(repository),
      secret: otpSecret,
    });
    expect(created.otpCode).toMatch(/^\d{6}$/u);
    expect(created.attempt).toMatchObject({
      verification_method: 'otp',
      status: 'pending',
      attempt_count: 0,
      maximum_attempts: 5,
      expires_at: '2036-08-06T12:10:00.000Z',
      recovery_email_lookup_hash: LOOKUP_HASH,
    });
    const stored = JSON.stringify(repository.records[0]);
    expect(stored).not.toContain(created.otpCode);
    expect(stored).not.toMatch(/@/u);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('verifies an OTP once and changes ownership status only on success', async () => {
    const repository = memoryRepository();
    const created = await createOtpAttempt({ ...baseAttempt(repository), secret: otpSecret });
    const verified = await verifyOtpAttempt({
      repository,
      attemptId: created.attempt.attempt_id,
      otpCode: created.otpCode,
      secret: otpSecret,
      now: new Date(NOW.getTime() + 1000),
    });
    expect(verified).toMatchObject({
      verified: true,
      verificationMethod: 'otp',
      recoveryEmailLookupHash: LOOKUP_HASH,
      recoveryEmailVerificationStatus: 'verified_otp',
    });
    expect(repository.records[0]).toMatchObject({
      status: 'consumed',
      attempt_count: 1,
      verified_at: '2036-08-06T12:00:01.000Z',
      consumed_at: '2036-08-06T12:00:01.000Z',
    });
    await expectCode(verifyOtpAttempt({
      repository,
      attemptId: created.attempt.attempt_id,
      otpCode: created.otpCode,
      secret: otpSecret,
      now: new Date(NOW.getTime() + 2000),
    }), EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_CONSUMED);
  });

  it('counts wrong OTPs and locks exactly at the configured maximum', async () => {
    const repository = memoryRepository();
    const created = await createOtpAttempt({
      ...baseAttempt(repository), secret: otpSecret, maximumAttempts: 2,
    });
    await expectCode(verifyOtpAttempt({
      repository, attemptId: created.attempt.attempt_id,
      otpCode: '000000', secret: otpSecret, now: NOW,
    }), EMAIL_VERIFICATION_ERROR_CODES.VALUE_INCORRECT);
    expect(repository.records[0]).toMatchObject({ status: 'pending', attempt_count: 1 });
    await expectCode(verifyOtpAttempt({
      repository, attemptId: created.attempt.attempt_id,
      otpCode: '111111', secret: otpSecret, now: NOW,
    }), EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_LOCKED);
    expect(repository.records[0]).toMatchObject({ status: 'locked', attempt_count: 2 });
  });

  it('expires OTP attempts before comparison and never marks ownership verified', async () => {
    const repository = memoryRepository();
    const created = await createOtpAttempt({
      ...baseAttempt(repository), secret: otpSecret, ttlSeconds: 1,
    });
    await expectCode(verifyOtpAttempt({
      repository, attemptId: created.attempt.attempt_id,
      otpCode: created.otpCode, secret: otpSecret,
      now: new Date(NOW.getTime() + 1000),
    }), EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_EXPIRED);
    expect(repository.records[0]).toMatchObject({ status: 'expired', attempt_count: 0 });
    expect(repository.records[0]).not.toHaveProperty('verified_at');
  });

  it('generates a 256-bit magic token and stores only its bound HMAC/path hash', async () => {
    const repository = memoryRepository();
    const created = await createMagicLinkAttempt({
      ...baseAttempt(repository),
      secret: magicSecret,
      redirectPath: '/',
    });
    expect(created.magicLinkToken).toMatch(/^pdeml_[A-Za-z0-9_-]{43}$/u);
    expect(created.attempt).toMatchObject({
      verification_method: 'magic_link',
      status: 'pending',
      expires_at: '2036-08-06T12:30:00.000Z',
    });
    const stored = JSON.stringify(repository.records[0]);
    expect(stored).not.toContain(created.magicLinkToken);
    expect(stored).not.toContain('"redirectPath":"/"');
  });

  it('consumes a magic link once and rejects replay', async () => {
    const repository = memoryRepository();
    const created = await createMagicLinkAttempt({
      ...baseAttempt(repository), secret: magicSecret, redirectPath: '/',
    });
    const verified = await consumeMagicLinkAttempt({
      repository,
      attemptId: created.attempt.attempt_id,
      magicLinkToken: created.magicLinkToken,
      secret: magicSecret,
      redirectPath: '/',
      now: new Date(NOW.getTime() + 5000),
    });
    expect(verified.recoveryEmailVerificationStatus).toBe('verified_magic_link');
    expect(repository.records[0].status).toBe('consumed');
    await expectCode(consumeMagicLinkAttempt({
      repository,
      attemptId: created.attempt.attempt_id,
      magicLinkToken: created.magicLinkToken,
      secret: magicSecret,
      redirectPath: '/',
      now: new Date(NOW.getTime() + 6000),
    }), EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_CONSUMED);
  });

  it('expires magic links and rejects wrong tokens', async () => {
    const wrongRepository = memoryRepository();
    const wrong = await createMagicLinkAttempt({
      ...baseAttempt(wrongRepository), secret: magicSecret, redirectPath: '/',
    });
    await expectCode(consumeMagicLinkAttempt({
      repository: wrongRepository,
      attemptId: wrong.attempt.attempt_id,
      magicLinkToken: generateMagicLinkToken(),
      secret: magicSecret,
      redirectPath: '/',
      now: NOW,
    }), EMAIL_VERIFICATION_ERROR_CODES.VALUE_INCORRECT);

    const expiredRepository = memoryRepository();
    const expired = await createMagicLinkAttempt({
      ...baseAttempt(expiredRepository), secret: magicSecret, redirectPath: '/',
    });
    await expectCode(consumeMagicLinkAttempt({
      repository: expiredRepository,
      attemptId: expired.attempt.attempt_id,
      magicLinkToken: expired.magicLinkToken,
      secret: magicSecret,
      redirectPath: '/',
      now: new Date(NOW.getTime() + 30 * 60 * 1000),
    }), EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_EXPIRED);
  });

  it('allows only exact relative redirect paths and rejects open redirects', () => {
    expect(validateEmailVerificationRedirectPath('/')).toBe('/');
    expect(validateEmailVerificationRedirectPath('/ProQuestionnaire')).toBe('/ProQuestionnaire');
    for (const unsafe of [
      'https://evil.example', '//evil.example', '/ProQuestionnaire?next=evil',
      '/ProQuestionnaire#token', '/../admin', '/unknown', '\\evil',
    ]) {
      expect(() => validateEmailVerificationRedirectPath(unsafe)).toThrowError(
        expect.objectContaining({ code: EMAIL_VERIFICATION_ERROR_CODES.REDIRECT_NOT_ALLOWED }),
      );
    }
  });

  it('issues the future exact-draft recovery-session contract after verification', async () => {
    const handoff = await issueVerifiedEmailRecoverySession({
      verified: true,
      verificationMethod: 'otp',
      recoveryEmailLookupHash: LOOKUP_HASH,
      recoveryEmailVerificationStatus: 'verified_otp',
      attemptId: 'attempt-1',
    }, {
      environment: 'test',
      draftId: 'draft-selected',
      sessionIdHash: SESSION_HASH,
      recoveryCodeVersion: 1,
      recoverySessionVersion: 1,
      grantVersion: 1,
      authorizedScopes: ['draft:read', 'draft:write'],
    }, {
      secret: {
        name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
        value: 'r'.repeat(32),
      },
      clock: () => 2_101_896_000,
      tokenIdGenerator: () => `pdti_${'A'.repeat(43)}`,
    });
    expect(handoff).toMatchObject({
      authorizationMethod: 'email_otp',
      recoveryEmailLookupHash: LOOKUP_HASH,
      draftId: 'draft-selected',
      recoveryEmailVerificationStatus: 'verified_otp',
    });
    const claims = await verifyRecoverySessionToken(handoff.recoverySessionToken, {
      secret: {
        name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
        value: 'r'.repeat(32),
      },
      expectedEnvironment: 'test',
      expectedDraftId: 'draft-selected',
      expectedAuthorizationMethod: 'email_otp',
      expectedRecoverySessionVersion: 1,
      expectedGrantVersion: 1,
      requiredScopes: ['draft:read'],
      clock: () => 2_101_896_001,
    });
    expect(claims.recoveryEmailLookupHash).toBe(LOOKUP_HASH);
    expect(claims.recoveryEmailVerificationStatus).toBe('verified_otp');
  });

  it('binds the parallel magic-link handoff to its method and verified status', async () => {
    const secret = {
      name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
      value: 'r'.repeat(32),
    };
    const handoff = await issueVerifiedEmailRecoverySession({
      verified: true,
      verificationMethod: 'magic_link',
      recoveryEmailLookupHash: LOOKUP_HASH,
      recoveryEmailVerificationStatus: 'verified_magic_link',
      attemptId: 'attempt-2',
    }, {
      environment: 'test',
      draftId: 'draft-selected-magic',
      sessionIdHash: SESSION_HASH,
      recoveryCodeVersion: 1,
      recoverySessionVersion: 1,
      grantVersion: 1,
      authorizedScopes: ['draft:read'],
    }, {
      secret,
      clock: () => 2_101_896_000,
      tokenIdGenerator: () => `pdti_${'B'.repeat(43)}`,
    });
    const claims = await verifyRecoverySessionToken(handoff.recoverySessionToken, {
      secret,
      expectedEnvironment: 'test',
      expectedDraftId: 'draft-selected-magic',
      expectedAuthorizationMethod: 'magic_link',
      expectedRecoverySessionVersion: 1,
      expectedGrantVersion: 1,
      requiredScopes: ['draft:read'],
      clock: () => 2_101_896_001,
    });
    expect(claims.authorizationMethod).toBe('magic_link');
    expect(claims.recoveryEmailVerificationStatus).toBe('verified_magic_link');
    expect(claims.recoveryEmailLookupHash).toBe(LOOKUP_HASH);
  });

  it('returns safe diagnostics with both production paths disabled', () => {
    const diagnostics = getSafeEmailVerificationDiagnostics();
    expect(diagnostics).toMatchObject({
      otpEnabled: false,
      magicLinkEnabled: false,
      separateSecrets: true,
      storesRawEmail: false,
      storesRawOtp: false,
      storesRawMagicLinkToken: false,
      publicUrlImplemented: false,
      productionActivationImplemented: false,
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/secret.?value|token.?value|email.?address/i);
  });
});
