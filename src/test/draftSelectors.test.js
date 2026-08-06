import { describe, expect, it } from 'vitest';
import reducer, {
  loadInitialState,
  setDraftContext,
  setDraftLocalSaved,
  setFieldChangeMetadata,
  setUiDraftState,
} from '@/components/store/formSlice';
import {
  selectCanonicalDraftState,
  selectCurrentQuestionId,
  selectDraftBootstrapStatus,
  selectDraftContext,
  selectDraftSyncStatus,
  selectFieldChangeMetadata,
  selectFormState,
  selectIsDraftReadOnly,
  selectLastChangedQuestionId,
  selectSafeDraftDiagnostics,
  selectSubmittedReceipt,
  selectUiDraftState,
  selectUiDraftStateScope,
} from '@/components/store/draftSelectors';

const uiEntry = {
  kind: 'synthetic-editor',
  version: 1,
  data: { draftText: 'Synthetic unfinished value' },
  updatedAtClient: '2026-08-05T12:00:00.000Z',
  sourceTabId: 'tab-1',
};

const buildRootState = () => {
  let form = reducer(undefined, loadInitialState({
    responses: { '6': 'Synthetic response' },
    validationStatus: { '6': 'complete' },
    touchedQuestions: { '6': true },
    expandedQuestions: { '6': true },
    credentials: {
      businessName: 'Synthetic Business',
      userEmail: 'synthetic@example.test',
    },
    textValidationMeta: { '6': { isDirty: false } },
  }));
  form = reducer(form, setDraftContext({
    draftId: 'draft-1',
    sessionId: 'session-1',
    draftStatus: 'active',
    schemaVersion: 4,
    clientRevision: 2,
    serverRevision: 1,
    sourceTabId: 'tab-1',
    namespace: 'namespace-1',
    restoredFrom: 'browser',
    lastStateHash: 'a'.repeat(64),
  }));
  form = reducer(form, setDraftLocalSaved({
    storageMode: 'indexeddb',
    lastLocalSavedAt: '2026-08-05T12:00:00.000Z',
    confirmedClientRevision: 2,
  }));
  form = reducer(form, setUiDraftState({ scopeKey: 'question:6', entry: uiEntry }));
  form = reducer(form, setFieldChangeMetadata({
    fieldPath: 'responses.6',
    metadata: {
      operation: 'set',
      clientRevision: 2,
      serverRevision: 1,
      changedAtClient: '2026-08-05T12:00:00.000Z',
      sourceTabId: 'tab-1',
      mutationId: 'mutation-1',
    },
  }));
  return { form };
};

describe('draft selectors', () => {
  it('selects every Redux draft foundation category', () => {
    const root = buildRootState();
    expect(selectFormState(root)).toBe(root.form);
    expect(selectUiDraftState(root)['question:6']).toEqual(uiEntry);
    expect(selectUiDraftStateScope(root, 'question:6')).toEqual(uiEntry);
    expect(selectFieldChangeMetadata(root)['responses.6'].operation).toBe('set');
    expect(selectDraftContext(root).draftId).toBe('draft-1');
    expect(selectDraftBootstrapStatus(root).state).toBe('idle');
    expect(selectDraftSyncStatus(root).state).toBe('local_saved');
    expect(selectCurrentQuestionId(root)).toBeNull();
    expect(selectLastChangedQuestionId(root)).toBeNull();
    expect(selectSubmittedReceipt(root)).toBeNull();
  });

  it('builds a valid canonical state without mutating Redux', () => {
    const root = buildRootState();
    const before = structuredClone(root);
    const result = selectCanonicalDraftState(root);
    expect(result.ok).toBe(true);
    expect(result.state).toMatchObject({
      schemaVersion: 4,
      draftId: 'draft-1',
      sessionId: 'session-1',
      responses: { '6': 'Synthetic response' },
      savedAtClient: '2026-08-05T12:00:00.000Z',
      uiDraftState: { 'question:6': uiEntry },
    });
    expect(root).toEqual(before);
  });

  it('returns a typed selector failure for invalid preloaded form state', () => {
    const result = selectCanonicalDraftState({
      form: {
        ...buildRootState().form,
        responses: { '6': new Map() },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      state: null,
      errorCode: 'UNSUPPORTED_VALUE',
    });
  });

  it('does not expose token-like fields injected into an untrusted preloaded root', () => {
    const existing = buildRootState();
    const root = {
      form: {
        ...existing.form,
        draftContext: { ...existing.form.draftContext },
        credentials: { ...existing.form.credentials },
      },
    };
    root.form.resumeToken = 'TOKEN-LIKE-SYNTHETIC-VALUE';
    root.form.draftContext.resumeToken = 'TOKEN-LIKE-SYNTHETIC-VALUE';
    root.form.credentials.unrecognizedIdentityField = 'TOKEN-LIKE-SYNTHETIC-VALUE';
    const result = selectCanonicalDraftState(root);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.state)).not.toContain('TOKEN-LIKE-SYNTHETIC-VALUE');
    expect(result.state.credentials.unrecognizedIdentityField).toBeUndefined();
  });

  it('returns safe diagnostics without response or credential values', () => {
    const diagnostics = selectSafeDraftDiagnostics(buildRootState());
    expect(diagnostics).toMatchObject({
      canonicalValid: true,
      responseCount: 1,
      validationCount: 1,
      uiDraftScopeCount: 1,
      metadataCount: 1,
      syncState: 'local_saved',
      storageMode: 'indexeddb',
    });
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain('Synthetic response');
    expect(serialized).not.toContain('synthetic@example.test');
    expect(serialized).not.toContain('Synthetic Business');
  });

  it('marks submitted, expired, and deleted drafts read-only', () => {
    for (const draftStatus of ['submitted', 'expired', 'deleted']) {
      const root = buildRootState();
      root.form = reducer(root.form, setDraftContext({
        ...root.form.draftContext,
        draftStatus,
      }));
      expect(selectIsDraftReadOnly(root)).toBe(true);
    }
    expect(selectIsDraftReadOnly(buildRootState())).toBe(false);
  });

  it('memoizes canonical results for an unchanged form reference', () => {
    const root = buildRootState();
    expect(selectCanonicalDraftState(root)).toBe(selectCanonicalDraftState(root));
  });

  it('refuses prototype keys in scoped UI selection', () => {
    expect(selectUiDraftStateScope(buildRootState(), '__proto__')).toBeUndefined();
  });
});
