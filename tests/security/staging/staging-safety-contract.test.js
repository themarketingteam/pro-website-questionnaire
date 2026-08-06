import { describe, expect, it } from 'vitest';
import {
  assertIsolatedRateLimitSubject,
  assertSecurityTarget,
} from '../helpers/targetSafety.js';

describe('staging-only adversarial execution contract', () => {
  it('requires an explicitly verified non-production staging target', () => {
    const target = assertSecurityTarget({
      environment: process.env.SECURITY_TARGET_ENVIRONMENT,
      baseURL: process.env.SECURITY_BASE_URL,
    });
    expect(target).toMatchObject({ environment: 'staging', production: false });
  });

  it('requires a unique isolated example.test rate-limit subject', () => {
    expect(assertIsolatedRateLimitSubject({
      testRunId: process.env.SECURITY_TEST_RUN_ID,
      subject: process.env.SECURITY_RATE_LIMIT_SUBJECT,
      attempts: Number(process.env.SECURITY_RATE_LIMIT_ATTEMPTS || 12),
    })).toMatchObject({ isolated: true });
  });

  it('keeps email sending and uncontrolled brute force disabled', () => {
    expect(process.env.SECURITY_ALLOW_EMAIL_SENDS).not.toBe('true');
    expect(process.env.SECURITY_ALLOW_PRODUCTION).not.toBe('true');
    expect(Number(process.env.SECURITY_RATE_LIMIT_ATTEMPTS || 12)).toBeLessThanOrEqual(20);
  });
});
