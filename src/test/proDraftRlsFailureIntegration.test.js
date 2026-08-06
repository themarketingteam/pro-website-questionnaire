import { describe, expect, it, vi } from 'vitest';
import { createProDraftApiClient } from '@/lib/proDraftApiClient';
import { createProDraftRecoveryApiClient } from '@/lib/proDraftRecoveryApiClient';
import { createProDraftRecoveryEmailClient } from '@/lib/proDraftRecoveryEmailClient';
import { createProDraftReplacementApiClient } from '@/lib/proDraftReplacementApiClient';
import { createProDraftAdminApiClient } from '@/lib/proDraftAdminApiClient';
import { serializeSubmitError } from '@/lib/proSubmissionResilience';

const runtime = Object.freeze({
  environment: 'staging',
  configurationValid: true,
  durableDraftV2Enabled: true,
  publicEmailRecoveryEnabled: true,
  killSwitchEnabled: false,
});

const rlsError = () => Object.assign(new Error('raw Base44 RLS detail'), {
  response: {
    status: 500,
    data: { errorCode: 'RLS_POLICY_DENIED', message: 'raw SDK entity response' },
  },
});

describe('RLS denial client integration', () => {
  it('draft API emits one safe configuration failure and never uses entities', async () => {
    const invoke = vi.fn(async () => { throw rlsError(); });
    const metric = vi.fn();
    const client = createProDraftApiClient({
      client: { functions: { invoke }, entities: new Proxy({}, { get: () => { throw new Error('DIRECT_ENTITY_FALLBACK'); } }) },
      runtimeConfig: runtime,
      onSafeMetric: metric,
    });
    await expect(client.loadProFormDraft({})).rejects.toMatchObject({
      code: 'DRAFT_SERVICE_CONFIGURATION_ERROR',
      kind: 'service_configuration',
      retryable: false,
      preserveLocalState: true,
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(metric).toHaveBeenCalledWith(expect.objectContaining({ kind: 'service_configuration' }));
  });

  it('public recovery stays generic with no retry storm', async () => {
    const invoke = vi.fn(async () => { throw rlsError(); });
    const result = await createProDraftRecoveryApiClient({
      client: { functions: { invoke } }, runtimeConfig: runtime,
    }).recoverProFormDraftByCode({ recoveryCode: 'synthetic' });
    expect(result).toMatchObject({
      success: false,
      message: 'We could not recover a questionnaire with the information provided.',
      configurationError: true,
      retryable: false,
      preserveLocalState: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/RLS|SDK|entity response/iu);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('replacement and recovery-email clients make one function call and expose no provider detail', async () => {
    const replacementInvoke = vi.fn(async () => { throw rlsError(); });
    const replacement = createProDraftReplacementApiClient({
      client: { functions: { invoke: replacementInvoke } },
      runtimeConfig: runtime,
      credentialVault: {
        loadDraftCredentialBundle: vi.fn(async () => ({
          ok: true,
          bundle: { draftId: 'draft-1', recoverySessionToken: 'token' },
        })),
      },
      cryptoProvider: { getRandomValues: (bytes) => bytes.fill(7) },
    });
    await expect(replacement.clearAndReplaceProFormDraft({
      browserNamespace: 'namespace', sourceDraftId: 'draft-1', expectedServerRevision: 1,
    })).rejects.toMatchObject({ configurationError: true, retryable: false });
    expect(replacementInvoke).toHaveBeenCalledOnce();

    const emailInvoke = vi.fn(async () => { throw rlsError(); });
    const emailResult = await createProDraftRecoveryEmailClient({
      client: { functions: { invoke: emailInvoke } }, runtimeConfig: runtime,
    }).sendRecoveryCodeEmail({ draftId: 'draft-1' });
    expect(emailResult).toMatchObject({ configurationError: true, preserveLocalState: true });
    expect(JSON.stringify(emailResult)).not.toMatch(/RLS|SDK/iu);
    expect(emailInvoke).toHaveBeenCalledOnce();
  });

  it('admin configuration errors stay safe without clearing a valid grant', async () => {
    const invoke = vi.fn(async () => { throw rlsError(); });
    const vault = {
      loadAdminRecoveryGrant: vi.fn(async () => ({
        status: 'available', bundle: { grant: 'payload.signature', deviceId: 'device-1' },
      })),
      removeAdminRecoveryGrant: vi.fn(async () => {}),
    };
    await expect(createProDraftAdminApiClient({ invoke, vault }).listDrafts({}))
      .rejects.toMatchObject({
        configurationError: true,
        authorizationRequired: false,
        retryable: false,
      });
    expect(vault.removeAdminRecoveryGrant).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('submission error serialization removes RLS internals and forbids retries', () => {
    expect(serializeSubmitError(rlsError())).toMatchObject({
      failureKind: 'permission',
      draftFailureKind: 'service_configuration',
      code: 'DRAFT_SERVICE_CONFIGURATION_ERROR',
      preserveLocalState: true,
      stackSnippet: '',
      rawString: '',
    });
  });
});
