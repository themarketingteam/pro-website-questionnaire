import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  FUTURE_EMAIL_VERIFICATION_FUNCTIONS,
  createProDraftFutureEmailVerificationClient,
} from '@/lib/proDraftFutureEmailVerificationClient';

const disabledRuntime = Object.freeze({
  durableDraftV2Enabled: true,
  emailOtpEnabled: false,
  magicLinkEnabled: false,
});

describe('future email verification client placeholder', () => {
  it('returns typed disabled OTP results without invoking Base44', async () => {
    const invoke = vi.fn();
    const client = createProDraftFutureEmailVerificationClient({
      client: { functions: { invoke } },
      runtimeConfig: disabledRuntime,
    });
    await expect(client.requestEmailOtp({ email: 'synthetic@example.test' }))
      .resolves.toEqual({
        success: false,
        enabled: false,
        method: 'otp',
        errorCode: 'FEATURE_DISABLED',
        message: 'Email verification is unavailable.',
      });
    await expect(client.verifyEmailOtp({ otp: '123456' }))
      .resolves.toMatchObject({ enabled: false, method: 'otp' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns typed disabled magic-link results without invoking Base44', async () => {
    const invoke = vi.fn();
    const client = createProDraftFutureEmailVerificationClient({
      client: { functions: { invoke } },
      runtimeConfig: disabledRuntime,
    });
    await expect(client.requestMagicLink({ email: 'synthetic@example.test' }))
      .resolves.toMatchObject({ enabled: false, method: 'magic_link' });
    await expect(client.consumeMagicLink({ token: 'synthetic-token' }))
      .resolves.toMatchObject({ enabled: false, method: 'magic_link' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('maps enabled synthetic calls to the four reserved function names', async () => {
    const invoke = vi.fn(async () => ({ data: { success: true, synthetic: true } }));
    const client = createProDraftFutureEmailVerificationClient({
      client: { functions: { invoke } },
      runtimeConfig: {
        durableDraftV2Enabled: true,
        emailOtpEnabled: true,
        magicLinkEnabled: true,
      },
    });
    await client.requestEmailOtp({ marker: 'a' });
    await client.verifyEmailOtp({ marker: 'b' });
    await client.requestMagicLink({ marker: 'c' });
    await client.consumeMagicLink({ marker: 'd' });
    expect(invoke.mock.calls.map(([name]) => name)).toEqual([
      FUTURE_EMAIL_VERIFICATION_FUNCTIONS.requestEmailOtp,
      FUTURE_EMAIL_VERIFICATION_FUNCTIONS.verifyEmailOtp,
      FUTURE_EMAIL_VERIFICATION_FUNCTIONS.requestMagicLink,
      FUTURE_EMAIL_VERIFICATION_FUNCTIONS.consumeMagicLink,
    ]);
    for (const [, payload] of invoke.mock.calls) expect(payload.apiVersion).toBe(1);
  });

  it('does not read or write browser storage or expose a route/UI contract', async () => {
    const source = readFileSync(
      'src/lib/proDraftFutureEmailVerificationClient.js',
      'utf8',
    );
    const client = createProDraftFutureEmailVerificationClient({
      client: { functions: { invoke: vi.fn() } },
      runtimeConfig: disabledRuntime,
    });
    await client.verifyEmailOtp({ otp: '123456' });
    await client.consumeMagicLink({ token: 'synthetic-token' });
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/u);
    expect(client.getDiagnostics()).toMatchObject({
      otpEnabled: false,
      magicLinkEnabled: false,
      rendersUi: false,
      addsRoutes: false,
      persistsOtp: false,
      persistsMagicLinkToken: false,
    });
  });
});
