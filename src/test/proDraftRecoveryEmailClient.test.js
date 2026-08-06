import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_RECOVERY_EMAIL_FUNCTION_NAME,
  createProDraftRecoveryEmailClient,
  normalizeRecoveryEmailDeliveryError,
} from '@/lib/proDraftRecoveryEmailClient';

const runtime = (overrides = {}) => ({
  environment: 'staging',
  environmentRecognized: true,
  configurationValid: true,
  killSwitchEnabled: false,
  durableDraftV2Enabled: true,
  ...overrides,
});
const request = Object.freeze({
  authorization: { recoverySessionToken: 't'.repeat(43) },
  draftId: 'draft-synthetic-new',
  recoveryCode: '2345-6789-ABCD-EFGH-JKMN',
  purpose: 'clear_all_replacement',
  idempotencyKey: 'recovery-email.synthetic.0001',
});
const success = Object.freeze({
  success: true,
  requestId: `pdrq_${'Q'.repeat(43)}`,
  delivered: true,
  redirected: true,
  suppressed: false,
  idempotent: false,
  deliveryUncertain: false,
  status: 'sent',
  canRetry: false,
  retryAfterSeconds: 0,
  providerMessageId: 'must-not-escape',
  email: 'must-not-escape@example.test',
});

describe('proDraftRecoveryEmailClient', () => {
  it('invokes only the authorized function and returns a strict success allowlist', async () => {
    const invoke = vi.fn(async () => ({ data: success }));
    const client = createProDraftRecoveryEmailClient({
      client: { functions: { invoke } },
      runtimeConfig: runtime(),
    });
    const result = await client.sendRecoveryCodeEmail(request);
    expect(invoke).toHaveBeenCalledWith(PRO_DRAFT_RECOVERY_EMAIL_FUNCTION_NAME, {
      ...request,
      apiVersion: 1,
    });
    expect(result).not.toHaveProperty('providerMessageId');
    expect(result).not.toHaveProperty('email');
    expect(request.recoveryCode).toBe('2345-6789-ABCD-EFGH-JKMN');
  });

  it('retries only by explicit caller invocation with the supplied in-memory request', async () => {
    const invoke = vi.fn(async () => ({ data: success }));
    const client = createProDraftRecoveryEmailClient({
      client: { functions: { invoke } },
      runtimeConfig: runtime(),
    });
    await client.retryRecoveryCodeEmail(request);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0][1].recoveryCode).toBe(request.recoveryCode);
  });

  it('normalizes server and thrown failures without provider details', async () => {
    expect(normalizeRecoveryEmailDeliveryError({
      errorCode: 'RETRY_BACKOFF',
      canRetry: true,
      retryAfterSeconds: 30,
      providerDetail: 'private',
    })).toMatchObject({
      success: false,
      errorCode: 'RETRY_BACKOFF',
      canRetry: true,
      retryAfterSeconds: 30,
    });
    const invoke = vi.fn(async () => {
      throw {
        response: { data: {
          errorCode: 'RECOVERY_EMAIL_DELIVERY_FAILED',
          providerDetail: 'private',
        } },
      };
    });
    const client = createProDraftRecoveryEmailClient({
      client: { functions: { invoke } },
      runtimeConfig: runtime(),
    });
    expect(JSON.stringify(await client.sendRecoveryCodeEmail(request)))
      .not.toContain('private');
  });

  it('does not invoke when the durable client runtime is disabled', async () => {
    const invoke = vi.fn(async () => ({ data: success }));
    const client = createProDraftRecoveryEmailClient({
      client: { functions: { invoke } },
      runtimeConfig: runtime({ durableDraftV2Enabled: false }),
    });
    expect((await client.sendRecoveryCodeEmail(request)).success).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects arbitrary recipient and content overrides before invocation', async () => {
    const invoke = vi.fn(async () => ({ data: success }));
    const client = createProDraftRecoveryEmailClient({
      client: { functions: { invoke } },
      runtimeConfig: runtime(),
    });
    for (const override of [
      { recipient: 'override@example.test' },
      { sender: 'override@example.test' },
      { subject: 'override' },
      { html: '<p>override</p>' },
      { sesRegion: 'us-west-2' },
    ]) {
      expect((await client.sendRecoveryCodeEmail({ ...request, ...override })).success)
        .toBe(false);
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('contains no browser storage, Redux dispatch, or general-send UI behavior', () => {
    const source = readFileSync('src/lib/proDraftRecoveryEmailClient.js', 'utf8');
    expect(source).not.toMatch(
      /localStorage|sessionStorage|indexedDB|dispatch\(|useDispatch|from ['"][^'"]*redux/iu,
    );
    const diagnostics = createProDraftRecoveryEmailClient({
      client: { functions: { invoke: vi.fn() } },
      runtimeConfig: runtime(),
    }).getDiagnostics();
    expect(diagnostics).toMatchObject({
      exposesGeneralSendControl: false,
      storesRecoveryCode: false,
      persistsRequest: false,
      dispatchesReduxActions: false,
      acceptsRecipientOverride: false,
    });
  });
});
