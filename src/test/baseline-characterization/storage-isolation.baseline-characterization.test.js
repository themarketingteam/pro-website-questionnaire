import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQuestionnaireStore } from '@/components/store/store';
import * as actions from '@/components/store/formSlice';
import { createResilientStorage } from '@/lib/resilientStorage';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import {
  getOrCreateQuestionnaireSessionId,
  resetQuestionnaireSessionCacheForTests,
} from '@/lib/sessionId';
import { createMemoryStorage } from '@/test/utils/storage';

const activePersistors = [];
let storage;

const namespaceFor = (client) => deriveQuestionnaireBrowserNamespace({ userId: client });

const loadConfiguredStore = async (namespace) => {
  const runtime = createQuestionnaireStore({ namespace, storage });
  activePersistors.push(runtime.persistor);
  await runtime.ready;
  return { ...runtime, actions };
};

describe('baseline characterization: scoped browser-storage isolation', () => {
  beforeEach(() => {
    storage = createResilientStorage({
      indexedDB: null,
      localStorage: createMemoryStorage(),
      sessionStorage: createMemoryStorage(),
    });
    resetQuestionnaireSessionCacheForTests();
  });

  afterEach(() => {
    activePersistors.splice(0).forEach((persistor) => persistor.pause());
    resetQuestionnaireSessionCacheForTests();
  });

  it('[BC-LOCAL-001][DR-LOCAL-002] uses separate hashed Redux keys for two clients', async () => {
    const namespaceA = namespaceFor('synthetic-client-a');
    const namespaceB = namespaceFor('synthetic-client-b');
    const clientA = await loadConfiguredStore(namespaceA);
    const clientB = await loadConfiguredStore(namespaceB);

    clientA.store.dispatch(actions.setResponse({ questionId: '6', value: 'Client A answer' }));
    await clientA.persistor.flush();

    expect(clientA.persistenceKey).not.toBe(clientB.persistenceKey);
    expect(clientA.persistenceKey).toBe(buildQuestionnaireStorageKey({
      namespace: namespaceA,
      purpose: 'redux-state',
    }));
    expect(clientA.persistenceKey).not.toContain('synthetic-client-a');
    expect(await storage.getItem(clientB.persistenceKey)).toBeNull();
  });

  it('[BC-LOCAL-002][DR-LOCAL-002] uses stable but distinct namespaced sessions', async () => {
    const namespaceA = namespaceFor('synthetic-client-a');
    const namespaceB = namespaceFor('synthetic-client-b');
    const clientASession = await getOrCreateQuestionnaireSessionId({ namespace: namespaceA, storage });
    const clientARepeat = await getOrCreateQuestionnaireSessionId({ namespace: namespaceA, storage });
    const clientBSession = await getOrCreateQuestionnaireSessionId({ namespace: namespaceB, storage });

    expect(clientARepeat).toBe(clientASession);
    expect(clientBSession).not.toBe(clientASession);
  });

  it('[BC-LOCAL-003][DR-LOCAL-001][DR-LOCAL-002] persists responses but omits credentials', async () => {
    const runtime = await loadConfiguredStore(namespaceFor('synthetic-client-a'));

    runtime.store.dispatch(actions.setCredentials({
      businessName: 'Synthetic Client A',
      domain: 'client-a.invalid',
      userEmail: 'client-a@example.invalid',
    }));
    runtime.store.dispatch(actions.setResponse({
      questionId: '6',
      value: 'Synthetic persisted response',
    }));
    await runtime.persistor.flush();

    const persistedRoot = JSON.parse(await storage.getItem(runtime.persistenceKey));
    const persistedResponses = JSON.parse(persistedRoot.responses);

    expect(persistedResponses['6']).toBe('Synthetic persisted response');
    expect(persistedRoot).not.toHaveProperty('credentials');
  });

  it('[BC-LOCAL-004][DR-LOCAL-002] does not hydrate Client A state into Client B', async () => {
    const namespaceA = namespaceFor('synthetic-client-a');
    const namespaceB = namespaceFor('synthetic-client-b');
    const first = await loadConfiguredStore(namespaceA);

    first.store.dispatch(actions.setResponse({
      questionId: '6',
      value: 'Synthetic Client A isolated answer',
    }));
    await first.persistor.flush();
    first.persistor.pause();

    const second = await loadConfiguredStore(namespaceB);
    expect(second.store.getState().form.responses['6']).toBeUndefined();

    const reloadedA = await loadConfiguredStore(namespaceA);
    expect(reloadedA.store.getState().form.responses['6'])
      .toBe('Synthetic Client A isolated answer');
  });
});
