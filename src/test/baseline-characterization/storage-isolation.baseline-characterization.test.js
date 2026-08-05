import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REDUX_STORAGE_KEY = 'persist:pro-questionnaire-root';
const SESSION_STORAGE_KEY = 'pro_questionnaire_session_id';
const activePersistors = [];

const waitForBootstrap = (persistor) => {
  if (persistor.getState().bootstrapped) return Promise.resolve();

  return new Promise((resolve) => {
    const unsubscribe = persistor.subscribe(() => {
      if (persistor.getState().bootstrapped) {
        unsubscribe();
        resolve();
      }
    });
  });
};

const loadConfiguredStore = async () => {
  const [{ store, persistor }, actions] = await Promise.all([
    import('@/components/store/store'),
    import('@/components/store/formSlice'),
  ]);

  activePersistors.push(persistor);
  await waitForBootstrap(persistor);
  return { store, persistor, actions };
};

describe('baseline characterization: global browser-storage isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/?businessName=Synthetic%20Client%20A&domainName=client-a.invalid');
  });

  afterEach(() => {
    activePersistors.splice(0).forEach((persistor) => persistor.pause());
    vi.resetModules();
  });

  it('[BC-LOCAL-001][DR-LOCAL-002] uses one fixed Redux key for two synthetic client URLs', async () => {
    const { store, persistor, actions } = await loadConfiguredStore();

    store.dispatch(actions.setResponse({ questionId: '6', value: 'Synthetic Client A answer' }));
    await persistor.flush();

    expect(localStorage.getItem(REDUX_STORAGE_KEY)).toBeTruthy();
    expect(REDUX_STORAGE_KEY).not.toContain('client-a');

    window.history.replaceState({}, '', '/?businessName=Synthetic%20Client%20B&domainName=client-b.invalid');

    expect(localStorage.getItem(REDUX_STORAGE_KEY)).toBeTruthy();
    expect(Object.keys(localStorage).filter((key) => key.startsWith('persist:'))).toEqual([
      REDUX_STORAGE_KEY,
    ]);
  });

  it('[BC-LOCAL-002][DR-LOCAL-002] reuses one questionnaire session key and ID across synthetic clients', async () => {
    const { getOrCreateQuestionnaireSessionId } = await import('@/lib/sessionId');
    const clientASession = getOrCreateQuestionnaireSessionId();

    window.history.replaceState({}, '', '/?businessName=Synthetic%20Client%20B&domainName=client-b.invalid');
    const clientBSession = getOrCreateQuestionnaireSessionId();

    expect(clientBSession).toBe(clientASession);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(clientASession);
    expect(SESSION_STORAGE_KEY).not.toContain('client-a');
    expect(SESSION_STORAGE_KEY).not.toContain('client-b');
  });

  it('[BC-LOCAL-003][DR-LOCAL-001][DR-LOCAL-002] persists responses but omits credentials', async () => {
    const { store, persistor, actions } = await loadConfiguredStore();

    store.dispatch(actions.setCredentials({
      businessName: 'Synthetic Client A',
      domain: 'client-a.invalid',
      userEmail: 'client-a@example.invalid',
    }));
    store.dispatch(actions.setResponse({ questionId: '6', value: 'Synthetic persisted response' }));
    await persistor.flush();

    const persistedRoot = JSON.parse(localStorage.getItem(REDUX_STORAGE_KEY));
    const persistedResponses = JSON.parse(persistedRoot.responses);

    expect(persistedResponses['6']).toBe('Synthetic persisted response');
    expect(persistedRoot).not.toHaveProperty('credentials');
  });

  it('[BC-LOCAL-004][DR-LOCAL-002] hydrates Client A state under a different Client B URL', async () => {
    const first = await loadConfiguredStore();

    first.store.dispatch(first.actions.setResponse({
      questionId: '6',
      value: 'Synthetic Client A cross-client answer',
    }));
    await first.persistor.flush();
    first.persistor.pause();

    vi.resetModules();
    window.history.replaceState({}, '', '/?businessName=Synthetic%20Client%20B&domainName=client-b.invalid');

    const second = await loadConfiguredStore();

    expect(second.store.getState().form.responses['6']).toBe(
      'Synthetic Client A cross-client answer'
    );
  });
});
