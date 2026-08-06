import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CAPTCHA_ERROR_CODES,
  getSafeCaptchaDiagnostics,
  isCaptchaConfigured,
  verifyRecoveryCaptcha,
} from '../../base44/functions/_shared/proDraftCaptcha/entry.ts';

const turnstileEnv = Object.freeze({
  PRO_DRAFT_ENVIRONMENT: 'staging',
  PRO_DRAFT_CAPTCHA_PROVIDER: 'turnstile',
  PRO_DRAFT_CAPTCHA_SECRET_KEY: 'synthetic-secret-key-for-tests',
  PRO_DRAFT_CAPTCHA_EXPECTED_HOSTNAME: 'staging.example.test',
});

const response = (body, ok = true) => ({
  ok,
  json: vi.fn(async () => body),
});

describe('recovery CAPTCHA provider abstraction', () => {
  it('treats disabled as unavailable and fails closed when required', async () => {
    expect(isCaptchaConfigured({
      PRO_DRAFT_ENVIRONMENT: 'production',
      PRO_DRAFT_CAPTCHA_PROVIDER: 'disabled',
    })).toBe(false);
    await expect(verifyRecoveryCaptcha({
      required: true,
      token: 'synthetic-token',
      environment: 'production',
      envSource: { PRO_DRAFT_CAPTCHA_PROVIDER: 'disabled' },
    })).resolves.toMatchObject({
      success: false,
      captchaVerified: false,
      errorCode: CAPTCHA_ERROR_CODES.UNAVAILABLE,
    });
  });

  it('allows staging_test only in staging/test with explicit enablement', async () => {
    const envSource = {
      PRO_DRAFT_CAPTCHA_PROVIDER: 'staging_test',
      PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED: 'true',
    };
    await expect(verifyRecoveryCaptcha({
      required: true, token: 'staging-test-valid', environment: 'staging', envSource,
    })).resolves.toMatchObject({ success: true, captchaVerified: true });
    await expect(verifyRecoveryCaptcha({
      required: true, token: 'staging-test-valid', environment: 'production', envSource,
    })).resolves.toMatchObject({
      success: false,
      errorCode: CAPTCHA_ERROR_CODES.STAGING_TEST_FORBIDDEN,
    });
  });

  it('verifies Turnstile server-side with bounded form input', async () => {
    const fetchImpl = vi.fn(async () => response({
      success: true,
      hostname: 'staging.example.test',
      action: 'recover_draft',
    }));
    await expect(verifyRecoveryCaptcha({
      required: true,
      token: 'synthetic-turnstile-token',
      remoteIp: '192.0.2.8',
      action: 'recover_draft',
      envSource: turnstileEnv,
      fetchImpl,
    })).resolves.toEqual({
      success: true,
      captchaRequired: true,
      captchaVerified: true,
      provider: 'turnstile',
      errorCode: null,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init).toMatchObject({ method: 'POST' });
    expect(init.body.get('response')).toBe('synthetic-turnstile-token');
    expect(init.body.get('remoteip')).toBe('192.0.2.8');
  });

  it('maps provider rejection and non-2xx responses to safe failures', async () => {
    await expect(verifyRecoveryCaptcha({
      required: true,
      token: 'synthetic-token',
      envSource: turnstileEnv,
      fetchImpl: vi.fn(async () => response({ success: false })),
    })).resolves.toMatchObject({ errorCode: CAPTCHA_ERROR_CODES.PROVIDER_REJECTED });
    await expect(verifyRecoveryCaptcha({
      required: true,
      token: 'synthetic-token',
      envSource: turnstileEnv,
      fetchImpl: vi.fn(async () => response({}, false)),
    })).resolves.toMatchObject({ errorCode: CAPTCHA_ERROR_CODES.PROVIDER_ERROR });
  });

  it('fails safely on timeout, hostname mismatch, and action mismatch', async () => {
    await expect(verifyRecoveryCaptcha({
      required: true,
      token: 'synthetic-token',
      envSource: turnstileEnv,
      fetchImpl: vi.fn(async () => {
        throw new DOMException('synthetic timeout', 'AbortError');
      }),
    })).resolves.toMatchObject({ errorCode: CAPTCHA_ERROR_CODES.PROVIDER_TIMEOUT });
    await expect(verifyRecoveryCaptcha({
      required: true,
      token: 'synthetic-token',
      envSource: turnstileEnv,
      fetchImpl: vi.fn(async () => response({ success: true, hostname: 'wrong.test' })),
    })).resolves.toMatchObject({ errorCode: CAPTCHA_ERROR_CODES.HOSTNAME_MISMATCH });
    await expect(verifyRecoveryCaptcha({
      required: true,
      token: 'synthetic-token',
      action: 'recover_draft',
      envSource: turnstileEnv,
      fetchImpl: vi.fn(async () => response({
        success: true, hostname: 'staging.example.test', action: 'other_action',
      })),
    })).resolves.toMatchObject({ errorCode: CAPTCHA_ERROR_CODES.ACTION_MISMATCH });
  });

  it('exposes only configuration booleans and never secret/token values', () => {
    const diagnostics = getSafeCaptchaDiagnostics(turnstileEnv);
    expect(diagnostics).toMatchObject({
      provider: 'turnstile', configured: true, secretKeyPresent: true, storesToken: false,
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/synthetic-secret|synthetic-token/iu);
    const source = readFileSync(
      'base44/functions/_shared/proDraftCaptcha/entry.ts',
      'utf8',
    );
    expect(source).not.toMatch(/console\.|VITE_PRO_DRAFT_CAPTCHA_SITE_KEY/gu);
  });
});
