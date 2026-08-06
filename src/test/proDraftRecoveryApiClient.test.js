import { describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_RECOVERY_FUNCTION_NAME,
  createProDraftRecoveryApiClient,
} from '@/lib/proDraftRecoveryApiClient';

const runtime = (overrides = {}) => ({
  environment: 'staging',
  environmentRecognized: true,
  configurationValid: true,
  killSwitchEnabled: false,
  durableDraftV2Enabled: true,
  publicEmailRecoveryEnabled: true,
  ...overrides,
});

const request = Object.freeze({
  recoveryCode: '2345-6789-ABCD-EFGH-JKMN',
  deviceId: `pdd_${'D'.repeat(22)}`,
  clientContext: { environment: 'staging' },
});

const serverSuccess = Object.freeze({
  success: true,
  recoveryCompleted: true,
  requestId: `pdrq_${'Q'.repeat(43)}`,
  recoverySessionToken: `${'a'.repeat(43)}.${'b'.repeat(43)}`,
  recoverySessionExpiresAt: '2033-05-18T04:33:20.000Z',
  draft: {
    draftId: 'draft-synthetic-code-1',
    status: 'active',
    readOnly: false,
    businessNameDisplay: 'Synthetic Business',
    createdAt: '2033-05-01T00:00:00.000Z',
    lastSavedAt: '2033-05-17T00:00:00.000Z',
    draftGeneration: 2,
    recoveryCodeHint: 'JKMN',
  },
});

function harness(response = { data: serverSuccess }, runtimeOverrides = {}) {
  const invoke = vi.fn(async () => response);
  const client = createProDraftRecoveryApiClient({
    client: { functions: { invoke } },
    runtimeConfig: runtime(runtimeOverrides),
  });
  return { client, invoke };
}

describe('proDraftRecoveryApiClient', () => {
  it('invokes the exact Base44 function and does not mutate or store the request', async () => {
    const { client, invoke } = harness();
    const input = { ...request };
    const result = await client.recoverProFormDraftByCode(input);
    expect(invoke).toHaveBeenCalledWith(PRO_DRAFT_RECOVERY_FUNCTION_NAME, {
      ...request,
      apiVersion: 1,
    });
    expect(input).toEqual(request);
    expect(result).toEqual(serverSuccess);
    expect(client.getDiagnostics()).toMatchObject({
      storesRecoveryCode: false,
      storesRecoverySessionToken: false,
      dispatchesReduxActions: false,
    });
  });

  it('returns CAPTCHA-required and retry state from generic server failures', async () => {
    const { client } = harness({ data: {
      success: false,
      recoveryCompleted: false,
      errorCode: 'RECOVERY_NOT_COMPLETED',
      message: 'untrusted server wording',
      captchaRequired: true,
      retryAfterSeconds: 45,
      requestId: `pdrq_${'R'.repeat(43)}`,
    } });
    await expect(client.recoverProFormDraftByCode(request)).resolves.toEqual({
      success: false,
      recoveryCompleted: false,
      errorCode: 'RECOVERY_NOT_COMPLETED',
      message: 'We could not recover a questionnaire with the information provided.',
      captchaRequired: true,
      retryAfterSeconds: 45,
      requestId: `pdrq_${'R'.repeat(43)}`,
    });
  });

  it('sanitizes thrown provider errors without exposing their message or payload', async () => {
    const invoke = vi.fn(async () => {
      throw {
        message: 'raw provider secret and code',
        response: { status: 429, data: {
          captchaRequired: true,
          retryAfterSeconds: 30,
          requestId: `pdrq_${'E'.repeat(43)}`,
          internal: 'must not escape',
        } },
      };
    });
    const client = createProDraftRecoveryApiClient({
      client: { functions: { invoke } },
      runtimeConfig: runtime(),
    });
    const result = await client.recoverProFormDraftByCode(request);
    expect(result).toMatchObject({
      success: false,
      captchaRequired: true,
      retryAfterSeconds: 30,
    });
    expect(JSON.stringify(result)).not.toMatch(/provider secret|must not escape/iu);
  });

  it.each([
    ['durable runtime disabled', { durableDraftV2Enabled: false }],
    ['public recovery disabled', { publicEmailRecoveryEnabled: false }],
  ])('fails locally and does not invoke when %s', async (_label, flags) => {
    const { client, invoke } = harness({ data: serverSuccess }, flags);
    const result = await client.recoverProFormDraftByCode(request);
    expect(result.success).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects invalid requests and malformed success responses generically', async () => {
    const { client, invoke } = harness({ data: {
      ...serverSuccess,
      draft: { ...serverSuccess.draft, recovery_code_hash: 'f'.repeat(64) },
      recoverySessionToken: '',
    } });
    expect((await client.recoverProFormDraftByCode(null)).success).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    const malformed = await client.recoverProFormDraftByCode(request);
    expect(malformed.success).toBe(false);
    expect(malformed).not.toHaveProperty('draft');
  });
});
