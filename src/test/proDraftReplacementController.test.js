import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';
import formReducer, { loadCanonicalDraftState } from '@/components/store/formSlice';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import { createEmptyCanonicalDraftState } from '@/lib/questionnaireDraftState';
import {
  REPLACEMENT_CONTROLLER_ERROR_CODES,
  createProDraftReplacementController,
  getSafeReplacementControllerDiagnostics,
} from '@/lib/proDraftReplacementController';

const oldNamespace = 'ns_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const clientBNamespace = 'ns_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const recoveryCode = 'ABCD-EFGH-JKMP';
const resumeToken = 'N'.repeat(43);

const canonical = (status = 'active', draftId = 'draft-old-1', sessionId = 'session-old-1') => ({
  ...createEmptyCanonicalDraftState({
    draftId,
    sessionId,
    credentials: { recoveryEmail: 'owner@example.com', businessName: 'Synthetic Co' },
    identityContext: {
      identityContextVersion: 1,
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
      identityAssociationIntent: 'resume_current_draft',
      anonymousRecoveryAcknowledged: false,
      signedInvitationEmailChanged: false,
    },
  }),
  draftStatus: status,
  serverRevision: 4,
});

const harness = ({ status = 'active', partial = false, serverFailure = false } = {}) => {
  const store = configureStore({ reducer: { form: formReducer } });
  store.dispatch(loadCanonicalDraftState(canonical(status), {
    source: 'server', completedAt: '2026-08-06T12:00:00.000Z',
    namespace: oldNamespace, storageMode: 'indexeddb',
  }));
  const manager = {
    flush: vi.fn(async () => ({ state: 'local_saved', errorCode: null })),
    saveImmediately: vi.fn(async () => serverFailure
      ? { state: 'error', errorCode: 'SAVE_FAILED' }
      : { state: 'server_saved', confirmedServerRevision: 5, errorCode: null }),
    getStatus: vi.fn(() => ({
      state: status === 'submitted' ? 'submitted' : 'server_saved',
      confirmedServerRevision: 4,
    })),
    stop: vi.fn(async () => null),
    start: vi.fn(),
    invalidateAfterSupersession: vi.fn(),
    dispose: vi.fn(async () => null),
  };
  const replacement = {
    success: true,
    operation: status === 'submitted' ? 'start_new_after_submission' : 'clear_all',
    sourceDraft: { draftId: 'draft-old-1', status },
    replacementDraft: {
      draftId: 'draft-new-1', sessionId: 'session-new-1', status: 'active',
      recoveryCodeHint: 'JKMP',
    },
    recoveryCode,
    resumeToken,
    recoverySessionToken: null,
    emailDelivery: { attempted: true, delivered: true, redirected: false, failed: false },
  };
  const apiClient = {
    clearAndReplaceProFormDraft: vi.fn(),
    startNewProFormDraft: vi.fn(async () => replacement),
  };
  if (partial) {
    apiClient.clearAndReplaceProFormDraft
      .mockResolvedValueOnce({
        ...replacement, success: false, replacementRecoveryRequired: true,
      })
      .mockResolvedValueOnce({ ...replacement, recoveryCode: null, resumeToken: null });
  } else apiClient.clearAndReplaceProFormDraft.mockResolvedValue(replacement);
  const newCanonical = canonical('active', 'draft-new-1', 'session-new-1');
  const draftApiClient = {
    loadProFormDraft: vi.fn(async () => ({ canonicalState: newCanonical, stateHash: 'c'.repeat(64) })),
  };
  const values = new Map();
  for (const purpose of ['redux-state', 'draft-cache', 'draft-credentials', 'last-server-base', 'pending-events']) {
    values.set(buildQuestionnaireStorageKey({ namespace: oldNamespace, purpose }), `old-${purpose}`);
    values.set(buildQuestionnaireStorageKey({ namespace: clientBNamespace, purpose }), `client-b-${purpose}`);
  }
  const storage = {
    getMode: () => 'indexeddb',
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => values.set(key, value)),
    removeItem: vi.fn(async (key) => values.delete(key)),
  };
  const credentialVault = {
    saveDraftCredentialBundle: vi.fn(async (bundle) => ({ ok: true, bundle })),
    removeDraftCredentialBundle: vi.fn(async ({ namespace }) => {
      values.delete(buildQuestionnaireStorageKey({ namespace, purpose: 'draft-credentials' }));
      return { ok: true, removed: true };
    }),
  };
  const canonicalCache = {
    saveCanonicalDraftCache: vi.fn(async () => ({ ok: true })),
    removeCanonicalDraftCache: vi.fn(async ({ namespace }) => {
      values.delete(buildQuestionnaireStorageKey({ namespace, purpose: 'draft-cache' }));
      return { ok: true, removed: true };
    }),
  };
  const historyAdapter = { replaceState: vi.fn(), pushState: vi.fn() };
  const createSyncManager = vi.fn(() => ({ start: vi.fn() }));
  const controller = createProDraftReplacementController({
    syncManager: manager, store, storage, namespace: oldNamespace,
    credentialVault, canonicalCache, apiClient, draftApiClient,
    environment: 'test', clock: () => new Date('2026-08-06T12:00:00.000Z'),
    idempotencyGenerator: () => 'pdri_synthetic_fixed_key',
    tokenGenerator: () => 'T'.repeat(43), historyAdapter, createSyncManager,
  });
  return {
    controller, store, manager, apiClient, draftApiClient, storage, values,
    credentialVault, canonicalCache, historyAdapter, createSyncManager,
  };
};

describe('pro draft replacement controller', () => {
  it('flushes local then server state before pausing and replacing', async () => {
    const h = harness();
    await h.controller.executeClearAll();
    expect(h.manager.flush).toHaveBeenCalledWith({ localOnly: true, reason: 'replacement_prepare' });
    expect(h.manager.saveImmediately).toHaveBeenCalledWith('clear_all_prepare', { force: true });
    expect(h.manager.stop).toHaveBeenCalled();
    expect(h.apiClient.clearAndReplaceProFormDraft.mock.calls[0][0].expectedServerRevision).toBe(5);
  });

  it('blocks replacement when the forced server save fails', async () => {
    const h = harness({ serverFailure: true });
    await expect(h.controller.executeClearAll()).rejects.toMatchObject({
      code: REPLACEMENT_CONTROLLER_ERROR_CODES.SERVER_SAVE_FAILED,
    });
    expect(h.apiClient.clearAndReplaceProFormDraft).not.toHaveBeenCalled();
  });

  it('disposes and invalidates the old Clear All manager before hydration', async () => {
    const h = harness();
    await h.controller.executeClearAll();
    expect(h.manager.invalidateAfterSupersession).toHaveBeenCalledOnce();
    expect(h.manager.dispose).toHaveBeenCalledOnce();
    expect(h.createSyncManager).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'draft-new-1' }));
  });

  it('derives a distinct draft-specific namespace and hydrates a blank draft', async () => {
    const h = harness();
    const result = await h.controller.executeClearAll();
    expect(result.newNamespace).toBe(deriveQuestionnaireBrowserNamespace({ currentAuthorizedDraftId: 'draft-new-1' }));
    expect(h.store.getState().form.responses).toEqual({});
    expect(h.store.getState().form.draftContext.draftId).toBe('draft-new-1');
  });

  it('saves the new credential bundle without placing raw credentials in Redux', async () => {
    const h = harness();
    const result = await h.controller.executeClearAll();
    expect(h.credentialVault.saveDraftCredentialBundle).toHaveBeenCalledWith(
      expect.objectContaining({ resumeToken, recoveryCode: null, browserNamespace: result.newNamespace }),
      expect.objectContaining({ allowRecoveryCode: false }),
    );
    const serializedRedux = JSON.stringify(h.store.getState());
    expect(serializedRedux).not.toContain(recoveryCode);
    expect(serializedRedux).not.toContain(resumeToken);
  });

  it('removes only the old namespace while retaining Client B', async () => {
    const h = harness();
    await h.controller.executeClearAll();
    for (const purpose of ['redux-state', 'draft-cache', 'draft-credentials', 'last-server-base', 'pending-events']) {
      expect(h.values.has(buildQuestionnaireStorageKey({ namespace: oldNamespace, purpose }))).toBe(false);
      expect(h.values.get(buildQuestionnaireStorageKey({ namespace: clientBNamespace, purpose }))).toBe(`client-b-${purpose}`);
    }
  });

  it('recovers a partial commit with the same request and retained one-time credentials', async () => {
    const h = harness({ partial: true });
    const result = await h.controller.executeClearAll();
    expect(h.apiClient.clearAndReplaceProFormDraft).toHaveBeenCalledTimes(2);
    expect(h.apiClient.clearAndReplaceProFormDraft.mock.calls[1][0]).toEqual(
      h.apiClient.clearAndReplaceProFormDraft.mock.calls[0][0],
    );
    expect(result.recoveryCode).toBe(recoveryCode);
  });

  it('deduplicates double confirmation clicks into one transaction', async () => {
    const h = harness();
    const first = h.controller.executeClearAll();
    const second = h.controller.executeClearAll();
    expect(second).toBe(first);
    await first;
    expect(h.apiClient.clearAndReplaceProFormDraft).toHaveBeenCalledOnce();
  });

  it('reports truthful email delivery and masks the recovery email', async () => {
    const result = await harness().controller.executeClearAll();
    expect(result).toMatchObject({
      emailDeliveryState: 'success', maskedRecoveryEmail: 'o****@example.com',
    });
  });

  it('Start New preserves submitted namespace data and does not supersede its manager', async () => {
    const h = harness({ status: 'submitted' });
    const result = await h.controller.executeStartNew();
    expect(result.submittedSourcePreserved).toBe(true);
    expect(h.manager.invalidateAfterSupersession).not.toHaveBeenCalled();
    expect(h.credentialVault.removeDraftCredentialBundle).not.toHaveBeenCalled();
    expect(h.values.get(buildQuestionnaireStorageKey({ namespace: oldNamespace, purpose: 'draft-cache' }))).toBe('old-draft-cache');
  });

  it('records browser history without code or token values', async () => {
    const h = harness({ status: 'submitted' });
    await h.controller.executeStartNew();
    const serialized = JSON.stringify(h.historyAdapter.pushState.mock.calls);
    expect(serialized).not.toContain(recoveryCode);
    expect(serialized).not.toContain(resumeToken);
    expect(serialized).toContain('draft-new-1');
  });

  it('clears raw one-time credential memory after acknowledgement', async () => {
    const h = harness();
    await h.controller.executeClearAll();
    expect(getSafeReplacementControllerDiagnostics(h.controller).rawCredentialsInMemory).toBe(true);
    h.controller.acknowledgeRecoveryCode();
    expect(getSafeReplacementControllerDiagnostics(h.controller)).toMatchObject({
      rawCredentialsInMemory: false, rawCredentialsInRedux: false, usesHardReload: false,
    });
  });
});
