import { describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES,
  PRO_DRAFT_REPLACEMENT_FUNCTION_NAMES,
  createProDraftReplacementApiClient,
  generateReplacementIdempotencyKey,
  getSafeReplacementClientDiagnostics,
  normalizeReplacementApiError,
} from '@/lib/proDraftReplacementApiClient';

const runtimeConfig = { environment: 'test', durableDraftV2Enabled: true };
const namespace = 'ns_1234567890abcdef1234567890abcdef';
const sourceDraftId = 'draft-source-1';
const bundle = {
  draftId: sourceDraftId,
  recoverySessionToken: null,
  resumeToken: 'R'.repeat(43),
};
const success = (operation = 'clear_all') => ({
  success: true,
  operation,
  sourceDraft: { draftId: sourceDraftId, status: operation === 'clear_all' ? 'cleared_superseded' : 'submitted' },
  replacementDraft: {
    draftId: 'draft-new-1', sessionId: 'session-new-1', status: 'active',
  },
  recoveryCode: 'ABCD-EFGH-JKMP',
  resumeToken: 'N'.repeat(43),
  recoverySessionToken: 'x'.repeat(43),
  emailDelivery: { delivered: true },
});
const request = { browserNamespace: namespace, sourceDraftId, expectedServerRevision: 4 };

const harness = (body = success()) => {
  const invoke = vi.fn(async () => ({ status: 200, data: body }));
  const credentialVault = {
    loadDraftCredentialBundle: vi.fn(async () => ({ ok: true, bundle })),
  };
  const client = createProDraftReplacementApiClient({
    client: { functions: { invoke } }, runtimeConfig, credentialVault,
    cryptoProvider: { getRandomValues: (bytes) => bytes.fill(7) },
  });
  return { client, invoke, credentialVault };
};

describe('pro draft replacement API client', () => {
  it('invokes Clear All with exact vault authorization and secure generated values', async () => {
    const { client, invoke, credentialVault } = harness();
    await client.clearAndReplaceProFormDraft(request);
    expect(credentialVault.loadDraftCredentialBundle).toHaveBeenCalledWith(expect.objectContaining({
      browserNamespace: namespace,
    }));
    expect(invoke).toHaveBeenCalledWith(
      PRO_DRAFT_REPLACEMENT_FUNCTION_NAMES.clearAll,
      expect.objectContaining({
        apiVersion: 1,
        authorization: { resumeToken: bundle.resumeToken },
        sourceDraftId,
        expectedServerRevision: 4,
        idempotencyKey: expect.stringMatching(/^pdri_[A-Za-z0-9_-]{32}$/u),
        clientReplacementResumeToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      }),
    );
  });

  it('invokes Start New through its distinct backend function', async () => {
    const { client, invoke } = harness(success('start_new_after_submission'));
    await client.startNewProFormDraft(request);
    expect(invoke.mock.calls[0][0]).toBe(PRO_DRAFT_REPLACEMENT_FUNCTION_NAMES.startNew);
  });

  it('prefers the current recovery-session authorization when present', async () => {
    const { client, invoke, credentialVault } = harness();
    credentialVault.loadDraftCredentialBundle.mockResolvedValue({
      ok: true,
      bundle: { ...bundle, recoverySessionToken: `${'A'.repeat(24)}.${'B'.repeat(24)}` },
    });
    await client.clearAndReplaceProFormDraft(request);
    expect(invoke.mock.calls[0][1].authorization).toHaveProperty('recoverySessionToken');
    expect(invoke.mock.calls[0][1].authorization).not.toHaveProperty('resumeToken');
  });

  it('rejects a bundle for another draft before invoking Base44', async () => {
    const { client, invoke, credentialVault } = harness();
    credentialVault.loadDraftCredentialBundle.mockResolvedValue({
      ok: true, bundle: { ...bundle, draftId: 'client-b-draft' },
    });
    await expect(client.clearAndReplaceProFormDraft(request)).rejects.toMatchObject({
      code: PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.AUTHORIZATION_REQUIRED,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fails closed when the feature flag is disabled', async () => {
    const client = createProDraftReplacementApiClient({
      client: { functions: { invoke: vi.fn() } },
      runtimeConfig: { ...runtimeConfig, durableDraftV2Enabled: false },
    });
    await expect(client.clearAndReplaceProFormDraft(request)).rejects.toMatchObject({
      code: PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.DISABLED,
    });
  });

  it('returns partial commit details for controller recovery without blind recreation', async () => {
    const partial = {
      success: false,
      replacementRecoveryRequired: true,
      errorCode: 'REPLACEMENT_COMMIT_FAILED',
      replacementDraft: { draftId: 'draft-new-1', sessionId: 'session-new-1' },
      recoveryCode: 'ABCD-EFGH-JKMP',
      resumeToken: 'N'.repeat(43),
    };
    const { client } = harness(partial);
    await expect(client.clearAndReplaceProFormDraft(request)).resolves.toMatchObject(partial);
  });

  it('normalizes response errors without reflecting server messages or secrets', () => {
    const normalized = normalizeReplacementApiError({
      response: { status: 409, data: {
        errorCode: 'REVISION_CONFLICT', message: 'secret server detail',
      } },
    });
    expect(normalized).toMatchObject({ code: 'REVISION_CONFLICT', status: 409 });
    expect(normalized.message).not.toContain('secret server detail');
  });

  it('generates opaque idempotency keys from the injected cryptographic provider', () => {
    const key = generateReplacementIdempotencyKey({
      getRandomValues: (bytes) => bytes.fill(11),
    });
    expect(key).toMatch(/^pdri_[A-Za-z0-9_-]{32}$/u);
  });

  it('publishes credential-safe diagnostics', () => {
    const diagnostics = getSafeReplacementClientDiagnostics(harness().client);
    expect(diagnostics).toMatchObject({
      enabled: true,
      readsAuthorizationFromCredentialVault: true,
      storesCredentials: false,
      dispatchesReduxActions: false,
      logsCredentials: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain(bundle.resumeToken);
  });
});
