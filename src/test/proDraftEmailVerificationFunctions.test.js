import { describe, expect, it, vi } from 'vitest';
import {
  createEmailVerificationFunctionHandler,
} from '../../base44/functions/_shared/proDraftEmailVerification/entry.ts';

const operations = [
  'request_otp',
  'verify_otp',
  'request_magic_link',
  'consume_magic_link',
];

function environment(operation, overrides = {}) {
  const values = {
    PRO_DRAFT_ENVIRONMENT: 'staging',
    PRO_DRAFT_V2_SERVER_ENABLED: 'true',
    PRO_DRAFT_V2_KILL_SWITCH: 'false',
    PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'disabled',
    PRO_DRAFT_EMAIL_OTP_ENABLED: 'false',
    PRO_DRAFT_MAGIC_LINK_ENABLED: 'false',
    ...overrides,
  };
  return {
    operation,
    getEnvironmentValue: (name) => values[name],
    createRequestId: () => `pdrq_${'A'.repeat(43)}`,
  };
}

const request = (body = '{sensitive workflow data that is not json') => new Request(
  'https://example.test/functions/future-email-verification',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  },
);

describe('feature-disabled email verification functions', () => {
  it.each(operations)('%s returns FEATURE_DISABLED before any executor side effect', async (operation) => {
    const entityCreate = vi.fn();
    const sendEmail = vi.fn();
    const generateValue = vi.fn();
    const testExecutor = vi.fn(async () => {
      entityCreate();
      sendEmail();
      generateValue();
      return Response.json({ success: true });
    });
    const handler = createEmailVerificationFunctionHandler({
      ...environment(operation),
      allowEnabledTestMode: true,
      testExecutor,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      enabled: false,
      errorCode: 'FEATURE_DISABLED',
    });
    expect(testExecutor).not.toHaveBeenCalled();
    expect(entityCreate).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(generateValue).not.toHaveBeenCalled();
  });

  it.each(operations)('%s remains disabled outside injected test mode even if its flag is true', async (operation) => {
    const isOtp = operation.includes('otp');
    const testExecutor = vi.fn(async () => Response.json({ success: true }));
    const handler = createEmailVerificationFunctionHandler({
      ...environment(operation, {
        [isOtp ? 'PRO_DRAFT_EMAIL_OTP_ENABLED' : 'PRO_DRAFT_MAGIC_LINK_ENABLED']: 'true',
      }),
      allowEnabledTestMode: true,
      testExecutor,
    });
    const response = await handler(request('{}'));
    expect(response.status).toBe(503);
    expect(testExecutor).not.toHaveBeenCalled();
  });

  it('allows internal logic only with test environment, enabled flag, and explicit injection', async () => {
    const testExecutor = vi.fn(async (_request, requestId) => Response.json({
      success: true,
      requestId,
      synthetic: true,
    }));
    const handler = createEmailVerificationFunctionHandler({
      ...environment('request_otp', {
        PRO_DRAFT_ENVIRONMENT: 'test',
        PRO_DRAFT_EMAIL_OTP_ENABLED: 'true',
      }),
      allowEnabledTestMode: true,
      testExecutor,
    });
    const response = await handler(request('{}'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, synthetic: true });
    expect(testExecutor).toHaveBeenCalledOnce();
  });

  it('bounds a disabled request without parsing its workflow fields', async () => {
    const testExecutor = vi.fn();
    const handler = createEmailVerificationFunctionHandler({
      ...environment('request_magic_link'),
      testExecutor,
    });
    const response = await handler(request('x'.repeat(32 * 1024 + 1)));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      enabled: false,
      errorCode: 'EMAIL_VERIFICATION_REQUEST_TOO_LARGE',
    });
    expect(testExecutor).not.toHaveBeenCalled();
  });

  it('keeps the shipped entries free of entity, transport, template, and client imports', async () => {
    const files = [
      'requestProDraftEmailOtp', 'verifyProDraftEmailOtp',
      'requestProDraftMagicLink', 'consumeProDraftMagicLink',
    ];
    const { readFile } = await import('node:fs/promises');
    for (const name of files) {
      const source = await readFile(`base44/functions/${name}/entry.ts`, 'utf8');
      expect(source).toMatch(/createEmailVerificationFunctionHandler/u);
      expect(source).not.toMatch(/entities\.|sendTransactionalEmail|renderFuture|createClientFromRequest/u);
    }
  });
});
