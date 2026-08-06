import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createQuestionnaireStoreRuntime,
  selectLocalQuestionnaireBootstrapSource,
} from '@/components/ReduxProvider';
import { setResponse } from '@/components/store/formSlice';
import {
  QUESTIONNAIRE_PERSIST_VERSION,
  PERSISTED_FORM_FIELDS,
} from '@/components/store/store';
import { createEmptyCanonicalDraftState } from '@/lib/questionnaireDraftState';
import {
  createCanonicalDraftCacheKey,
  loadCanonicalDraftCache,
  saveCanonicalDraftCache,
} from '@/lib/questionnaireCanonicalDraftCache';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';

const activeRuntimes = [];

const createStorage = (mode = 'localstorage') => {
  const values = new Map();
  return {
    values,
    probe: vi.fn(async () => ({ mode, durable: mode !== 'memory_only' })),
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async (key) => { values.delete(key); }),
    getMode: vi.fn(() => mode),
    getDiagnostics: vi.fn(() => ({ mode, durable: mode !== 'memory_only' })),
  };
};

const canonical = (overrides = {}) => ({
  ...createEmptyCanonicalDraftState(),
  responses: { '6': 'Synthetic bootstrap answer' },
  ...overrides,
});

const seedReduxPersist = async (storage, namespace, form = {}) => {
  const value = {};
  for (const field of PERSISTED_FORM_FIELDS) {
    if (Object.hasOwn(form, field)) value[field] = JSON.stringify(form[field]);
  }
  value._persist = JSON.stringify({ version: QUESTIONNAIRE_PERSIST_VERSION, rehydrated: true });
  await storage.setItem(buildQuestionnaireStorageKey({
    namespace,
    purpose: 'redux-state',
  }), JSON.stringify(value));
};

const createRuntime = async (storage, namespace) => {
  const runtime = await createQuestionnaireStoreRuntime({
    namespace,
    storageFactory: () => storage,
  });
  activeRuntimes.push(runtime);
  return runtime;
};

afterEach(async () => {
  await Promise.all(activeRuntimes.splice(0).map((runtime) => runtime.dispose()));
});

describe('questionnaire local bootstrap source selection', () => {
  it('restores a valid canonical cache when Redux rehydrates empty', async () => {
    const storage = createStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'cache-wins-empty-redux' });
    await saveCanonicalDraftCache({ namespace, storage, state: canonical() });
    const runtime = await createRuntime(storage, namespace);
    expect(runtime.store.getState().form.responses['6']).toBe('Synthetic bootstrap answer');
    expect(runtime.bootstrapDiagnostics).toMatchObject({
      source: 'cache',
      reason: 'redux_empty',
      cacheValid: true,
    });
    expect(runtime.store.getState().form.draftBootstrapStatus).toMatchObject({
      state: 'ready',
      source: 'browser',
    });
  });

  it('keeps valid Redux and writes a missing canonical cache after bootstrap', async () => {
    const storage = createStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'redux-wins-missing-cache' });
    await seedReduxPersist(storage, namespace, {
      responses: { '6': 'Redux-only answer' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      textValidationMeta: {},
    });
    const runtime = await createRuntime(storage, namespace);
    expect(runtime.store.getState().form.responses['6']).toBe('Redux-only answer');
    expect(runtime.bootstrapDiagnostics.reason).toBe('cache_missing');
    await runtime.localPersistence.flush();
    expect((await loadCanonicalDraftCache({ namespace, storage })).state.responses['6'])
      .toBe('Redux-only answer');
  });

  it('does not let a malformed cache overwrite valid Redux or auto-delete it', async () => {
    const storage = createStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'malformed-cache-client' });
    await seedReduxPersist(storage, namespace, {
      responses: { '6': 'Last valid Redux answer' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      textValidationMeta: {},
    });
    const key = createCanonicalDraftCacheKey(namespace);
    storage.values.set(key, '{malformed');
    const runtime = await createRuntime(storage, namespace);
    expect(runtime.store.getState().form.responses['6']).toBe('Last valid Redux answer');
    await runtime.localPersistence.flush();
    expect(storage.values.get(key)).toBe('{malformed');
    expect(runtime.bootstrapDiagnostics).toMatchObject({
      source: 'redux',
      reason: 'cache_invalid',
      cacheValid: false,
    });
  });

  it('replaces a malformed cache only after a real post-bootstrap form change', async () => {
    const storage = createStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'malformed-edit-client' });
    await seedReduxPersist(storage, namespace, {
      responses: { '6': 'Valid before edit' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      textValidationMeta: {},
    });
    storage.values.set(createCanonicalDraftCacheKey(namespace), '{malformed');
    const runtime = await createRuntime(storage, namespace);
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Valid after edit' }));
    await runtime.localPersistence.flush();
    const loaded = await loadCanonicalDraftCache({ namespace, storage });
    expect(loaded).toMatchObject({ ok: true, present: true });
    expect(loaded.state.responses['6']).toBe('Valid after edit');
  });

  it('chooses the higher compatible client revision', async () => {
    const storage = createStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'newer-cache-client' });
    await seedReduxPersist(storage, namespace, {
      responses: { '6': 'Older Redux answer' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      textValidationMeta: {},
      draftContext: {
        draftId: 'draft-compatible',
        sessionId: 'session-compatible',
        draftStatus: 'active',
        schemaVersion: 4,
        clientRevision: 1,
        serverRevision: 0,
        sourceTabId: 'tab-redux',
        namespace,
        restoredFrom: 'browser',
        lastStateHash: null,
      },
    });
    await saveCanonicalDraftCache({
      namespace,
      storage,
      state: canonical({
        draftId: 'draft-compatible',
        sessionId: 'session-compatible',
        clientRevision: 2,
        responses: { '6': 'Newer cache answer' },
      }),
    });
    const runtime = await createRuntime(storage, namespace);
    expect(runtime.store.getState().form.responses['6']).toBe('Newer cache answer');
    expect(runtime.bootstrapDiagnostics).toMatchObject({
      source: 'cache',
      reason: 'client_revision',
    });
  });

  it('preserves Redux when local identities are incompatible', async () => {
    const storage = createStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'incompatible-client' });
    await seedReduxPersist(storage, namespace, {
      responses: { '6': 'Redux identity answer' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      textValidationMeta: {},
      draftContext: {
        draftId: 'redux-draft',
        sessionId: null,
        draftStatus: 'active',
        schemaVersion: 4,
        clientRevision: 1,
        serverRevision: 0,
        sourceTabId: null,
        namespace,
        restoredFrom: 'browser',
        lastStateHash: null,
      },
    });
    await saveCanonicalDraftCache({
      namespace,
      storage,
      state: canonical({ draftId: 'other-draft', clientRevision: 5 }),
    });
    const runtime = await createRuntime(storage, namespace);
    expect(runtime.store.getState().form.responses['6']).toBe('Redux identity answer');
    expect(runtime.bootstrapDiagnostics).toMatchObject({
      source: 'redux',
      reason: 'identity_mismatch',
    });
  });

  it('treats equivalent hashes as the same source without rewriting', async () => {
    const state = canonical({ draftId: 'equivalent-draft', clientRevision: 3 });
    const decision = await selectLocalQuestionnaireBootstrapSource({
      reduxState: state,
      cacheState: structuredClone(state),
      cachePresent: true,
      cacheValid: true,
    });
    expect(decision).toMatchObject({
      source: 'redux',
      reason: 'equivalent_hash',
      suppressInitialWrite: true,
      initialHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('keeps credentials isolated by the browser namespace', async () => {
    const storage = createStorage();
    const namespaceA = deriveQuestionnaireBrowserNamespace({ userId: 'credential-client-a' });
    const namespaceB = deriveQuestionnaireBrowserNamespace({ userId: 'credential-client-b' });
    await saveCanonicalDraftCache({
      namespace: namespaceA,
      storage,
      state: canonical({ credentials: { userEmail: 'client-a@example.test' } }),
    });
    await saveCanonicalDraftCache({
      namespace: namespaceB,
      storage,
      state: canonical({ credentials: { userEmail: 'client-b@example.test' } }),
    });
    const [runtimeA, runtimeB] = await Promise.all([
      createRuntime(storage, namespaceA),
      createRuntime(storage, namespaceB),
    ]);
    expect(runtimeA.store.getState().form.credentials.userEmail).toBe('client-a@example.test');
    expect(runtimeB.store.getState().form.credentials.userEmail).toBe('client-b@example.test');
  });

  it('degrades to valid Redux when an injected cache inspection throws', async () => {
    const storage = createStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'inspection-failure-client' });
    await seedReduxPersist(storage, namespace, {
      responses: { '6': 'Redux survives inspection failure' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      textValidationMeta: {},
    });
    const runtime = await createQuestionnaireStoreRuntime({
      namespace,
      storageFactory: () => storage,
      canonicalCacheAdapter: {
        inspectCanonicalDraftCache: vi.fn(async () => {
          throw new Error('synthetic inspection failure');
        }),
      },
    });
    activeRuntimes.push(runtime);
    expect(runtime.store.getState().form.responses['6'])
      .toBe('Redux survives inspection failure');
    expect(runtime.bootstrapDiagnostics).toMatchObject({
      source: 'redux',
      reason: 'cache_invalid',
      cachePresent: true,
      cacheValid: false,
    });
  });
});
