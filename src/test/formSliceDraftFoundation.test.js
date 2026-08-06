import { describe, expect, it, vi } from 'vitest';
import reducer, {
  DRAFT_BOOTSTRAP_STATES,
  DRAFT_MUTATION_REASONS,
  DRAFT_RESTORED_FROM_VALUES,
  DRAFT_SYNC_STATES,
  LOAD_CANONICAL_DRAFT_STATE_ACTION_TYPE,
  applyFormMutation,
  clearDraftContext,
  clearUiDraftState,
  createInitialFormState,
  createLoadCanonicalDraftStateAction,
  deleteFieldChangeMetadata,
  deleteResponse,
  loadCanonicalDraftState,
  loadInitialState,
  patchDraftContext,
  patchUiDraftState,
  resetForm,
  resetQuestionState,
  resetQuestionnaireState,
  setAllExpanded,
  setCredentials,
  setDraftBootstrapError,
  setDraftBootstrapLoading,
  setDraftBootstrapReady,
  setDraftContext,
  setDraftLocalSaved,
  setDraftLocalSaving,
  setDraftServerSaved,
  setDraftStatus,
  setDraftSubmitted,
  setFieldChangeMetadata,
  setMultipleResponses,
  setMultipleValidationStatus,
  setResponse,
  setTextareaDirtyMeta,
  setTouchedQuestion,
  setUiDraftState,
  setValidationStatus,
} from '@/components/store/formSlice';
import {
  APPLY_FORM_MUTATION_ACTION_TYPE,
  prepareFormMutationPayload,
} from '@/components/store/formMutationFactory';
import {
  DraftStateValidationError,
  createEmptyCanonicalDraftState,
  normalizeCanonicalDraftState,
} from '@/lib/questionnaireDraftState';

const mutationMetadata = (overrides = {}) => ({
  mutationId: 'mutation-1',
  mutationType: 'answer_changed',
  reason: 'response_change',
  changedAtClient: '2026-08-05T12:00:00.000Z',
  sourceTabId: 'tab-1',
  baseServerRevision: 0,
  ...overrides,
});

const uiEntry = (overrides = {}) => ({
  kind: 'synthetic-editor',
  version: 1,
  data: { draftText: 'Synthetic unfinished value' },
  updatedAtClient: '2026-08-05T12:00:00.000Z',
  sourceTabId: 'tab-1',
  ...overrides,
});

const populatedState = () => reducer(createInitialFormState(), loadInitialState({
  responses: { '6': 'Synthetic response', '7_other': 'Synthetic other' },
  validationStatus: { '6': 'complete', '7': 'complete' },
  touchedQuestions: { '6': true, '7': true },
  expandedQuestions: { '6': true, '7': true },
  credentials: { businessName: 'Synthetic Business' },
  textValidationMeta: { '6': { lastValidatedValue: 'Synthetic response', isDirty: false } },
}));

describe('canonical Redux draft foundation', () => {
  it('creates all required fresh initial state fields and enum values', () => {
    const first = reducer(undefined, { type: '@@init' });
    const second = createInitialFormState();
    expect(first).toMatchObject({
      uiDraftState: {},
      fieldChangeMetadata: {},
      draftContext: {
        draftId: null,
        sessionId: null,
        draftStatus: 'active',
        schemaVersion: 4,
        clientRevision: 0,
        serverRevision: 0,
        sourceTabId: null,
        namespace: null,
        restoredFrom: null,
        lastStateHash: null,
      },
      draftBootstrapStatus: { state: 'idle' },
      draftSyncStatus: { state: 'idle', retryCount: 0 },
      currentQuestionId: null,
      lastChangedQuestionId: null,
      lastMutation: null,
      submittedReceipt: null,
    });
    expect(first.uiDraftState).not.toBe(second.uiDraftState);
    expect(DRAFT_BOOTSTRAP_STATES).toContain('ready');
    expect(DRAFT_SYNC_STATES).toContain('offline_local_only');
    expect(DRAFT_RESTORED_FROM_VALUES).toContain('submitted_receipt');
    expect(DRAFT_MUTATION_REASONS).toContain('conditional_cleanup');
  });

  it('preserves every legacy action signature and answer shape', () => {
    let state = reducer(undefined, setResponse({ questionId: '5', value: [{ label: 'Synthetic' }] }));
    state = reducer(state, setMultipleResponses({ '5_primary': 0, '6': 'Text' }));
    state = reducer(state, setValidationStatus({ questionId: '5', status: 'complete' }));
    state = reducer(state, setMultipleValidationStatus({ '6': 'needs_work' }));
    state = reducer(state, setTouchedQuestion({ questionId: '5', touched: true }));
    state = reducer(state, setAllExpanded({ '5': true, '6': false }));
    state = reducer(state, setCredentials({ businessName: 'Synthetic' }));
    state = reducer(state, setTextareaDirtyMeta({
      questionId: '6',
      lastValidatedValue: 'Text',
      isDirty: true,
    }));
    expect(state.responses['5']).toEqual([{ label: 'Synthetic' }]);
    expect(state.responses['5_primary']).toBe(0);
    expect(state.validationStatus).toMatchObject({ '5': 'complete', '6': 'needs_work' });
    expect(state.touchedQuestions['5']).toBe(true);
    expect(state.expandedQuestions).toEqual({ '5': true, '6': false });
    expect(state.textValidationMeta['6']).toEqual({ lastValidatedValue: 'Text', isDirty: true });
  });

  it('keeps legacy loadInitialState compatible while excluding unknown and token fields', () => {
    const action = loadInitialState({
      responses: { '6': 'Synthetic' },
      credentials: { businessName: 'Synthetic', harmlessUnknown: 'ignored' },
      arbitraryReduxField: 'ignored',
    });
    const state = reducer(undefined, action);
    expect(state.responses['6']).toBe('Synthetic');
    expect(state.credentials).toEqual({ businessName: 'Synthetic' });
    expect(state.arbitraryReduxField).toBeUndefined();
    expect(action.meta.safeDiagnostics).toEqual({
      acceptedFieldCount: 2,
      canonicalInput: false,
      rejectedFieldCount: 1,
      validInputShape: true,
    });
    expect(JSON.stringify(action.meta.safeDiagnostics)).not.toContain('arbitraryReduxField');
    expect(() => loadInitialState({
      responses: {},
      credentials: { resumeToken: 'blocked' },
    })).toThrowError(DraftStateValidationError);
  });

  it('sets, patches, and clears valid UI draft state', () => {
    let state = reducer(undefined, setUiDraftState({ scopeKey: 'question:6', entry: uiEntry() }));
    state = reducer(state, patchUiDraftState({
      scopeKey: 'question:6',
      patch: { data: { draftText: 'Updated synthetic value' } },
    }));
    expect(state.uiDraftState['question:6'].data.draftText).toBe('Updated synthetic value');
    state = reducer(state, clearUiDraftState({ scopeKey: 'question:6' }));
    expect(state.uiDraftState).toEqual({});
  });

  it('does not create or overwrite UI draft state from invalid patches', () => {
    const valid = reducer(undefined, setUiDraftState({ scopeKey: 'question:6', entry: uiEntry() }));
    const invalidRawAction = {
      type: patchUiDraftState.type,
      payload: { scopeKey: 'question:6', patch: { version: 0 } },
    };
    expect(reducer(valid, invalidRawAction)).toEqual(valid);
    expect(() => patchUiDraftState({ scopeKey: 'question:new', patch: { data: {} } }))
      .not.toThrow();
    const withoutRequired = reducer(valid, patchUiDraftState({
      scopeKey: 'question:new',
      patch: { data: {} },
    }));
    expect(withoutRequired.uiDraftState['question:new']).toBeUndefined();
  });

  it('rejects prototype-pollution scopes before reducer execution', () => {
    expect(() => setUiDraftState({ scopeKey: '__proto__', entry: uiEntry() }))
      .toThrowError(DraftStateValidationError);
    const state = reducer(undefined, {
      type: setUiDraftState.type,
      payload: { scopeKey: '__proto__', entry: uiEntry() },
    });
    expect(Object.getPrototypeOf(state.uiDraftState)).toBe(Object.prototype);
  });

  it('allowlists draft-context fields and protects submitted state', () => {
    let state = reducer(undefined, setDraftContext({
      draftId: 'draft-1',
      sessionId: 'session-1',
      draftStatus: 'submitted',
      schemaVersion: 4,
      clientRevision: 3,
      serverRevision: 2,
      sourceTabId: 'tab-1',
      namespace: 'namespace-1',
      restoredFrom: 'server',
      lastStateHash: 'a'.repeat(64),
    }));
    state = reducer(state, setDraftStatus('active'));
    state = reducer(state, patchDraftContext({ draftStatus: 'active', clientRevision: 4 }));
    expect(state.draftContext.draftStatus).toBe('submitted');
    expect(state.draftContext.clientRevision).toBe(4);
    expect(() => patchDraftContext({ resumeToken: 'blocked' }))
      .toThrowError(DraftStateValidationError);
  });

  it('clears draft context only through explicit preservation choices', () => {
    let state = reducer(undefined, setDraftContext({
      sessionId: 'session-1',
      namespace: 'namespace-1',
    }));
    state = reducer(state, setDraftSubmitted({
      finalSubmissionId: 'submission-1',
      submittedAt: '2026-08-05T13:00:00.000Z',
      pdfAvailable: true,
    }));
    state = reducer(state, clearDraftContext({
      clearSessionId: false,
      preserveNamespace: true,
      preserveSubmittedReceipt: true,
    }));
    expect(state.draftContext).toMatchObject({
      sessionId: 'session-1',
      namespace: 'namespace-1',
      draftStatus: 'active',
    });
    expect(state.submittedReceipt.finalSubmissionId).toBe('submission-1');
  });

  it('applies deterministic bootstrap transitions with explicit timestamps', () => {
    let state = reducer(undefined, setDraftBootstrapLoading({
      source: 'browser',
      startedAt: '2026-08-05T10:00:00.000Z',
    }));
    state = reducer(state, setDraftBootstrapReady({
      source: 'browser',
      completedAt: '2026-08-05T10:00:01.000Z',
    }));
    const ignored = reducer(state, setDraftBootstrapLoading({
      source: 'server',
      startedAt: '2026-08-05T10:00:02.000Z',
    }));
    expect(ignored.draftBootstrapStatus.state).toBe('ready');
    state = reducer(ignored, setDraftBootstrapLoading({
      source: 'server',
      startedAt: '2026-08-05T10:00:02.000Z',
      beginNew: true,
    }));
    state = reducer(state, setDraftBootstrapError({
      errorCode: 'SERVER_UNAVAILABLE',
      completedAt: '2026-08-05T10:00:03.000Z',
    }));
    expect(state.draftBootstrapStatus).toMatchObject({
      state: 'error',
      errorCode: 'SERVER_UNAVAILABLE',
      source: 'server',
    });
  });

  it('tracks local and server sync transitions with required safe fields', () => {
    let state = reducer(undefined, setDraftLocalSaving({
      storageMode: 'indexeddb',
      pendingClientRevision: 2,
    }));
    state = reducer(state, setDraftLocalSaved({
      storageMode: 'indexeddb',
      lastLocalSavedAt: '2026-08-05T10:00:00.000Z',
      confirmedClientRevision: 2,
    }));
    expect(state.draftSyncStatus.state).toBe('local_saved');
    state = reducer(state, setDraftServerSaved({
      confirmedClientRevision: 2,
      confirmedServerRevision: 8,
      lastServerSavedAt: '2026-08-05T10:00:01.000Z',
    }));
    expect(state.draftSyncStatus).toMatchObject({
      state: 'server_saved',
      confirmedServerRevision: 8,
    });
    expect(state.draftContext.serverRevision).toBe(8);
    expect(() => setDraftServerSaved({
      confirmedClientRevision: 2,
      lastServerSavedAt: '2026-08-05T10:00:01.000Z',
    })).toThrowError(DraftStateValidationError);
  });

  it('does not regress a newer local client revision when an older in-flight save is accepted', () => {
    let state = reducer(undefined, setDraftContext({
      clientRevision: 7,
      serverRevision: 2,
    }));
    state = reducer(state, setDraftServerSaved({
      confirmedClientRevision: 5,
      confirmedServerRevision: 3,
      lastServerSavedAt: '2026-08-06T10:00:01.000Z',
    }));
    expect(state.draftContext).toMatchObject({
      clientRevision: 7,
      serverRevision: 3,
    });
    expect(state.draftSyncStatus.confirmedClientRevision).toBe(5);
  });

  it('labels memory-only storage as offline local-only', () => {
    const state = reducer(undefined, setDraftLocalSaved({
      storageMode: 'memory_only',
      lastLocalSavedAt: '2026-08-05T10:00:00.000Z',
      confirmedClientRevision: 1,
    }));
    expect(state.draftSyncStatus.state).toBe('offline_local_only');
  });

  it('does not replace submitted sync state with an ordinary local-saving transition', () => {
    let state = reducer(undefined, setDraftSubmitted({
      finalSubmissionId: 'submission-1',
      submittedAt: '2026-08-05T13:00:00.000Z',
      pdfAvailable: true,
    }));
    state = reducer(state, setDraftLocalSaving({
      storageMode: 'indexeddb',
      pendingClientRevision: 1,
    }));
    expect(state.draftSyncStatus.state).toBe('submitted');
    expect(state.draftContext.draftStatus).toBe('submitted');
  });
});

describe('atomic form mutations', () => {
  it('applies deletes before sets and increments client revision exactly once', () => {
    const initial = reducer(undefined, loadInitialState({
      responses: { '1.1': 'Old child', '6': 'Old response' },
      validationStatus: { '1.1': 'complete' },
      touchedQuestions: { '1.1': true },
      expandedQuestions: { '1.1': true },
      textValidationMeta: { '1.1': { isDirty: true } },
    }));
    const state = reducer(initial, applyFormMutation({
      deleteResponseKeys: ['1.1', '6'],
      setResponses: { '1': 'no', '6': 'Replacement response' },
      deleteValidationKeys: ['1.1'],
      deleteTouchedKeys: ['1.1'],
      deleteExpandedKeys: ['1.1'],
      deleteTextValidationMetaKeys: ['1.1'],
      mutationMetadata: mutationMetadata({ reason: 'conditional_cleanup' }),
    }));
    expect(state.responses).toEqual({ '1': 'no', '6': 'Replacement response' });
    expect(state.validationStatus['1.1']).toBeUndefined();
    expect(state.draftContext.clientRevision).toBe(1);
    expect(state.draftContext.serverRevision).toBe(0);
    expect(state.lastMutation.reason).toBe('conditional_cleanup');
  });

  it('atomically repairs a synthetic location list and primary index', () => {
    const initial = reducer(undefined, loadInitialState({
      responses: {
        '5': [{ label: 'Synthetic A' }, { label: 'Synthetic B' }],
        '5_primary': 1,
      },
    }));
    const state = reducer(initial, applyFormMutation({
      setResponses: {
        '5': [{ label: 'Synthetic B' }],
        '5_primary': 0,
      },
      mutationMetadata: mutationMetadata(),
    }));
    expect(state.responses['5']).toEqual([{ label: 'Synthetic B' }]);
    expect(state.responses['5_primary']).toBe(0);
    expect(state.draftContext.clientRevision).toBe(1);
  });

  it('atomically updates validation, touched, expanded, UI draft, credentials, and questions', () => {
    const state = reducer(undefined, applyFormMutation({
      setValidationStatus: { '6': 'complete' },
      setTouchedQuestions: { '6': true },
      setExpandedQuestions: { '6': true },
      setTextValidationMeta: { '6': { isDirty: false } },
      setUiDraftState: { 'question:6': uiEntry() },
      setCredentials: { businessName: 'Synthetic Business' },
      currentQuestionId: '6',
      lastChangedQuestionId: '6',
      mutationMetadata: mutationMetadata(),
    }));
    expect(state).toMatchObject({
      validationStatus: { '6': 'complete' },
      touchedQuestions: { '6': true },
      expandedQuestions: { '6': true },
      currentQuestionId: '6',
      lastChangedQuestionId: '6',
    });
    expect(state.uiDraftState['question:6']).toEqual(uiEntry());
    expect(state.fieldChangeMetadata['responses.6']).toBeUndefined();
    expect(state.fieldChangeMetadata['uiDraftState.question:6'].operation).toBe('set');
  });

  it('records field metadata without response values', () => {
    const state = reducer(undefined, applyFormMutation({
      setResponses: { '6': 'PII-LIKE-SYNTHETIC-VALUE' },
      mutationMetadata: mutationMetadata(),
    }));
    expect(state.fieldChangeMetadata['responses.6']).toEqual({
      operation: 'set',
      clientRevision: 1,
      serverRevision: 0,
      changedAtClient: '2026-08-05T12:00:00.000Z',
      sourceTabId: 'tab-1',
      mutationId: 'mutation-1',
    });
    expect(JSON.stringify(state.fieldChangeMetadata)).not.toContain('PII-LIKE-SYNTHETIC-VALUE');
  });

  it('applies nothing when a raw atomic payload is invalid', () => {
    const before = populatedState();
    const after = reducer(before, {
      type: APPLY_FORM_MUTATION_ACTION_TYPE,
      payload: {
        setResponses: { '6': 'Must not apply' },
        setTouchedQuestions: { '6': 'invalid' },
        mutationMetadata: mutationMetadata(),
      },
    });
    expect(after).toEqual(before);
    expect(() => prepareFormMutationPayload({
      setResponses: { '6': 'Must not apply' },
      setTouchedQuestions: { '6': 'invalid' },
      mutationMetadata: mutationMetadata(),
    })).toThrowError(DraftStateValidationError);
  });

  it('ignores ordinary atomic mutations after submission', () => {
    const submitted = reducer(undefined, setDraftSubmitted({
      finalSubmissionId: 'submission-1',
      submittedAt: '2026-08-05T13:00:00.000Z',
      pdfAvailable: false,
    }));
    const state = reducer(submitted, applyFormMutation({
      setResponses: { '6': 'Must not apply' },
      mutationMetadata: mutationMetadata(),
    }));
    expect(state.responses).toEqual({});
    expect(state.draftContext.clientRevision).toBe(0);
  });

  it('sets and deletes normalized field metadata directly', () => {
    const metadata = {
      operation: 'set',
      clientRevision: 1,
      serverRevision: 0,
      changedAtClient: '2026-08-05T12:00:00.000Z',
      sourceTabId: 'tab-1',
      mutationId: 'mutation-1',
    };
    let state = reducer(undefined, setFieldChangeMetadata({
      fieldPath: 'responses.6',
      metadata,
    }));
    expect(state.fieldChangeMetadata['responses.6']).toEqual(metadata);
    state = reducer(state, deleteFieldChangeMetadata({ fieldPath: 'responses.6' }));
    expect(state.fieldChangeMetadata).toEqual({});
  });

  it('replays identical prepared actions deterministically without time or randomness in reducers', () => {
    const action = applyFormMutation({
      setResponses: { '6': 'Synthetic deterministic response' },
      mutationMetadata: mutationMetadata(),
    });
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not run in reducer');
    });
    const first = [action, setValidationStatus({ questionId: '6', status: 'complete' })]
      .reduce(reducer, undefined);
    const second = [action, setValidationStatus({ questionId: '6', status: 'complete' })]
      .reduce(reducer, undefined);
    nowSpy.mockRestore();
    expect(first).toEqual(second);
  });
});

describe('controlled canonical hydration and explicit reset', () => {
  const canonical = (overrides = {}) => normalizeCanonicalDraftState({
    ...createEmptyCanonicalDraftState({
      draftId: 'draft-2',
      sessionId: 'session-2',
      sourceTabId: 'tab-2',
      credentials: { businessName: 'Hydrated Synthetic Business' },
    }),
    responses: { '6': 'Hydrated synthetic response' },
    validationStatus: { '6': 'complete' },
    touchedQuestions: { '6': true },
    expandedQuestions: { '6': true },
    textValidationMeta: { '6': { isDirty: false } },
    uiDraftState: { 'question:6': uiEntry({ sourceTabId: 'tab-2' }) },
    currentQuestionId: '6',
    lastChangedQuestionId: '6',
    clientRevision: 5,
    serverRevision: 3,
    ...overrides,
  });

  it('returns a typed hydration failure without an action', () => {
    const result = createLoadCanonicalDraftStateAction({ schemaVersion: 999 }, {
      source: 'server',
      completedAt: '2026-08-05T14:00:00.000Z',
    });
    expect(result).toMatchObject({
      ok: false,
      action: null,
      errorCode: 'UNSUPPORTED_FUTURE_VERSION',
    });
  });

  it('fully replaces stale recoverable state without incrementing revision', () => {
    const stale = reducer(undefined, loadInitialState({
      responses: { stale: 'Must disappear' },
      validationStatus: { stale: 'complete' },
      touchedQuestions: { stale: true },
      expandedQuestions: { stale: true },
      credentials: { businessName: 'Old Synthetic Business' },
      textValidationMeta: { stale: { isDirty: true } },
    }));
    const action = loadCanonicalDraftState(canonical(), {
      source: 'server',
      completedAt: '2026-08-05T14:00:00.000Z',
      namespace: 'namespace-2',
      lastStateHash: 'b'.repeat(64),
      storageMode: 'indexeddb',
    });
    expect(action.type).toBe(LOAD_CANONICAL_DRAFT_STATE_ACTION_TYPE);
    const state = reducer(stale, action);
    expect(state.responses).toEqual({ '6': 'Hydrated synthetic response' });
    expect(state.validationStatus.stale).toBeUndefined();
    expect(state.draftContext).toMatchObject({
      draftId: 'draft-2',
      clientRevision: 5,
      serverRevision: 3,
      restoredFrom: 'server',
      namespace: 'namespace-2',
    });
    expect(state.draftBootstrapStatus).toMatchObject({ state: 'ready', source: 'server' });
    expect(state.draftSyncStatus.state).toBe('restored');
  });

  it('hydrates submitted state, creates a safe receipt, and locks edits', () => {
    const submittedCanonical = canonical({
      draftStatus: 'submitted',
      submission: {
        finalSubmissionId: 'submission-2',
        submittedAt: '2026-08-05T13:00:00.000Z',
        submittedStateHash: 'c'.repeat(64),
        pdfSourceStateHash: 'd'.repeat(64),
        lastSubmissionErrorCode: null,
      },
    });
    let state = reducer(undefined, loadCanonicalDraftState(submittedCanonical, {
      source: 'submitted_receipt',
      completedAt: '2026-08-05T14:00:00.000Z',
    }));
    expect(state.submittedReceipt).toEqual({
      finalSubmissionId: 'submission-2',
      submittedAt: '2026-08-05T13:00:00.000Z',
      pdfAvailable: true,
    });
    state = reducer(state, applyFormMutation({
      setResponses: { '6': 'Blocked edit' },
      mutationMetadata: mutationMetadata(),
    }));
    state = reducer(state, setResponse({ questionId: '6', value: 'Blocked legacy edit' }));
    state = reducer(state, setUiDraftState({
      scopeKey: 'question:blocked',
      entry: uiEntry(),
    }));
    expect(state.responses['6']).toBe('Hydrated synthetic response');
    expect(state.uiDraftState['question:blocked']).toBeUndefined();
  });

  it('resetForm preserves legacy credentials while clearing every answer-bearing category', () => {
    let state = populatedState();
    state = reducer(state, setUiDraftState({ scopeKey: 'question:6', entry: uiEntry() }));
    state = reducer(state, setFieldChangeMetadata({
      fieldPath: 'responses.6',
      metadata: {
        operation: 'set',
        clientRevision: 1,
        serverRevision: 0,
        changedAtClient: '2026-08-05T12:00:00.000Z',
        sourceTabId: 'tab-1',
        mutationId: 'mutation-1',
      },
    }));
    state = reducer(state, resetForm());
    expect(state.responses).toEqual({});
    expect(state.validationStatus).toEqual({});
    expect(state.textValidationMeta).toEqual({});
    expect(state.uiDraftState).toEqual({});
    expect(state.fieldChangeMetadata).toEqual({});
    expect(state.credentials).toEqual({ businessName: 'Synthetic Business' });
  });

  it('supports every explicit reset preservation option used by the contract', () => {
    let state = populatedState();
    state = reducer(state, setDraftContext({
      draftId: 'draft-1',
      sessionId: 'session-1',
      namespace: 'namespace-1',
    }));
    state = reducer(state, setDraftSubmitted({
      finalSubmissionId: 'submission-1',
      submittedAt: '2026-08-05T13:00:00.000Z',
      pdfAvailable: true,
    }));
    const preserved = reducer(state, resetQuestionnaireState({
      preserveCredentials: true,
      preserveDraftContext: true,
      preserveSubmittedReceipt: true,
      preserveNamespace: true,
      resetReason: 'clear_all',
    }));
    expect(preserved.credentials.businessName).toBe('Synthetic Business');
    expect(preserved.draftContext.draftId).toBe('draft-1');
    expect(preserved.submittedReceipt.finalSubmissionId).toBe('submission-1');
    const contextWithoutNamespace = reducer(state, resetQuestionnaireState({
      preserveCredentials: true,
      preserveDraftContext: true,
      preserveSubmittedReceipt: true,
      preserveNamespace: false,
      resetReason: 'clear_all',
    }));
    expect(contextWithoutNamespace.draftContext.draftId).toBe('draft-1');
    expect(contextWithoutNamespace.draftContext.namespace).toBeNull();
    const cleared = reducer(state, resetQuestionnaireState({
      preserveCredentials: false,
      preserveDraftContext: false,
      preserveSubmittedReceipt: false,
      preserveNamespace: false,
      resetReason: 'system',
    }));
    expect(cleared.credentials).toEqual({});
    expect(cleared.draftContext.draftStatus).toBe('active');
    expect(cleared.draftContext.namespace).toBeNull();
    expect(cleared.submittedReceipt).toBeNull();
  });

  it('resets a question with explicit auxiliary keys and UI draft scopes', () => {
    let state = populatedState();
    state = reducer(state, setUiDraftState({ scopeKey: 'question:7', entry: uiEntry() }));
    state = reducer(state, resetQuestionState({
      responseKey: '7',
      auxiliaryResponseKeys: ['7_other', '7_primary'],
      validationKeys: ['7'],
      touchedKeys: ['7'],
      expandedKeys: ['7'],
      textValidationMetaKeys: ['7'],
      uiDraftScopeKeys: ['question:7'],
    }));
    expect(state.responses['7_other']).toBeUndefined();
    expect(state.validationStatus['7']).toBeUndefined();
    expect(state.touchedQuestions['7']).toBeUndefined();
    expect(state.expandedQuestions['7']).toBeUndefined();
    expect(state.uiDraftState['question:7']).toBeUndefined();
  });

  it('keeps legacy deleteResponse auxiliary cleanup behavior', () => {
    const initial = reducer(undefined, loadInitialState({
      responses: { '7': 'Other', '7_other': 'Synthetic', '7_primary': 0 },
      validationStatus: { '7': 'complete' },
      touchedQuestions: { '7': true },
      expandedQuestions: { '7': true },
      textValidationMeta: { '7': { isDirty: true } },
    }));
    const state = reducer(initial, deleteResponse('7'));
    expect(state.responses).toEqual({});
    expect(state.validationStatus['7']).toBeUndefined();
    expect(state.textValidationMeta['7']).toBeUndefined();
  });
});
