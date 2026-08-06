import React from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor } from '@testing-library/react';
import { useSelector } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReduxProvider, {
  resetQuestionnaireStoreRuntimeCacheForTests,
} from '@/components/ReduxProvider';
import {
  createQuestionnaireStore,
} from '@/components/store/store';
import {
  createEmptyPersistedQuestionnaireState,
  normalizePersistedQuestionnaireState,
} from '@/components/store/normalization';
import { setResponse } from '@/components/store/formSlice';
import { createResilientStorage, STORAGE_MODES } from '@/lib/resilientStorage';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import { useQuestionnairePersistence } from '@/components/store/QuestionnairePersistenceContext';
import { createMemoryStorage } from '@/test/utils/storage';

const activeRuntimes = [];
let databaseSequence = 0;

const namespaceFor = (client) => deriveQuestionnaireBrowserNamespace({ userId: client });

const createAdapter = (overrides = {}) => {
  databaseSequence += 1;
  return createResilientStorage({
    databaseName: `questionnaire-store-test-${databaseSequence}`,
    indexedDB: new IDBFactory(),
    localStorage: createMemoryStorage(),
    timeoutMs: 50,
    ...overrides,
  });
};

const trackRuntime = (runtime) => {
  activeRuntimes.push(runtime);
  return runtime;
};

afterEach(() => {
  activeRuntimes.splice(0).forEach((runtime) => runtime.persistor.pause());
  resetQuestionnaireStoreRuntimeCacheForTests();
});

describe('scoped resilient questionnaire store', () => {
  it.each([
    ['indexeddb', () => createAdapter(), STORAGE_MODES.INDEXEDDB],
    ['localStorage fallback', () => createAdapter({ indexedDB: null }), STORAGE_MODES.LOCALSTORAGE],
    ['memory fallback', () => createAdapter({ indexedDB: null, localStorage: null }), STORAGE_MODES.MEMORY_ONLY],
  ])('persists current-page state through %s', async (_label, adapterFactory, expectedMode) => {
    const storage = adapterFactory();
    const namespace = namespaceFor(`client-${expectedMode}`);
    const first = trackRuntime(createQuestionnaireStore({ namespace, storage }));
    await first.ready;
    first.store.dispatch(setResponse({ questionId: '6', value: 'Synthetic scoped answer' }));
    await first.persistor.flush();
    first.persistor.pause();

    const second = trackRuntime(createQuestionnaireStore({ namespace, storage }));
    await second.ready;

    expect(second.store.getState().form.responses['6']).toBe('Synthetic scoped answer');
    expect(storage.getMode()).toBe(expectedMode);
    expect(storage.getDiagnostics().durable).toBe(expectedMode !== STORAGE_MODES.MEMORY_ONLY);
  });

  it('does not share state or purge another client namespace', async () => {
    const storage = createAdapter({ indexedDB: null });
    const namespaceA = namespaceFor('client-a');
    const namespaceB = namespaceFor('client-b');
    const clientA = trackRuntime(createQuestionnaireStore({ namespace: namespaceA, storage }));
    const clientB = trackRuntime(createQuestionnaireStore({ namespace: namespaceB, storage }));
    await Promise.all([clientA.ready, clientB.ready]);

    clientA.store.dispatch(setResponse({ questionId: '6', value: 'Client A answer' }));
    clientB.store.dispatch(setResponse({ questionId: '6', value: 'Client B answer' }));
    await Promise.all([clientA.persistor.flush(), clientB.persistor.flush()]);
    clientA.persistor.pause();
    clientB.persistor.pause();
    await clientA.persistor.purge();

    const reloadedA = trackRuntime(createQuestionnaireStore({ namespace: namespaceA, storage }));
    const reloadedB = trackRuntime(createQuestionnaireStore({ namespace: namespaceB, storage }));
    await Promise.all([reloadedA.ready, reloadedB.ready]);

    expect(reloadedA.store.getState().form.responses['6']).toBeUndefined();
    expect(reloadedB.store.getState().form.responses['6']).toBe('Client B answer');
  });

  it('bounds a storage read that never settles and continues empty', async () => {
    const storage = {
      getItem: vi.fn(() => new Promise(() => {})),
      setItem: vi.fn(async () => undefined),
      removeItem: vi.fn(async () => undefined),
      getMode: () => STORAGE_MODES.MEMORY_ONLY,
      getDiagnostics: () => ({ durable: false }),
    };
    const runtime = trackRuntime(createQuestionnaireStore({
      namespace: namespaceFor('timeout-client'),
      storage,
      rehydrationTimeoutMs: 10,
    }));

    await runtime.ready;

    expect(runtime.store.getState().form.responses).toEqual({});
    expect(runtime.getDiagnostics()).toMatchObject({
      rehydrationStatus: 'timed_out',
      rehydrationTimedOut: true,
      durable: false,
    });
  });

  it('normalizes the complete form during ordinary v3 rehydration', async () => {
    const storage = createAdapter({ indexedDB: null });
    const namespace = namespaceFor('normalization-client');
    const persistenceKey = buildQuestionnaireStorageKey({
      namespace,
      purpose: 'redux-state',
    });
    await storage.setItem(persistenceKey, JSON.stringify({
      responses: JSON.stringify({
        '1': 'no',
        '1.1': 'Hidden child answer',
        '1.1_other': 'Hidden auxiliary answer',
      }),
      validationStatus: JSON.stringify({ '1.1': 'complete' }),
      touchedQuestions: JSON.stringify({ '1.1': true }),
      expandedQuestions: JSON.stringify({ '1.1': true }),
      textValidationMeta: JSON.stringify({
        '1.1': { lastValidatedValue: 'Hidden child answer', isDirty: false },
      }),
      credentials: JSON.stringify({ userEmail: 'must-not-persist@example.test' }),
      _persist: JSON.stringify({ version: 3, rehydrated: true }),
    }));
    const runtime = trackRuntime(createQuestionnaireStore({ namespace, storage }));
    await runtime.ready;
    const normalized = runtime.store.getState().form;

    expect(normalized.responses['1']).toBe('no');
    expect(Object.hasOwn(normalized.responses, '1.1')).toBe(false);
    expect(Object.hasOwn(normalized.responses, '1.1_other')).toBe(false);
    expect(Object.hasOwn(normalized.validationStatus, '1.1')).toBe(false);
    expect(Object.hasOwn(normalized.touchedQuestions, '1.1')).toBe(false);
    expect(Object.hasOwn(normalized.expandedQuestions, '1.1')).toBe(false);
    expect(Object.hasOwn(normalized.textValidationMeta, '1.1')).toBe(false);
    expect(normalized.credentials).toEqual({});
    expect(normalizePersistedQuestionnaireState({ responses: Symbol('bad') }))
      .toEqual(createEmptyPersistedQuestionnaireState());
  });
});

const ProviderProbe = () => {
  const response = useSelector((state) => state.form.responses['6'] || 'empty');
  const persistence = useQuestionnairePersistence();
  return (
    <output data-testid="provider-probe">
      {`${response}:${persistence.storageMode}:${persistence.durable}`}
    </output>
  );
};

describe('ReduxProvider storage-denial behavior', () => {
  it('renders children with an accessible bootstrap and memory-only runtime', async () => {
    const storage = createAdapter({
      indexedDB: null,
      localStorage: null,
      sessionStorage: null,
    });
    render(
      <ReduxProvider
        locationHref="https://questionnaire.example.test/?userId=denied-client"
        storageFactory={() => storage}
        useRuntimeCache={false}
      >
        <ProviderProbe />
      </ReduxProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Preparing your questionnaire');
    await waitFor(() => expect(screen.getByTestId('provider-probe'))
      .toHaveTextContent('empty:memory_only:false'));
  });
});
