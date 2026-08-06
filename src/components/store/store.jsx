import { configureStore } from '@reduxjs/toolkit';
import {
  FLUSH,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  REHYDRATE,
  persistReducer,
  persistStore,
} from 'redux-persist';
import formReducer from './formSlice';
import { normalizePersistedQuestionnaireState } from './normalization';
import {
  createLocalCanonicalDraftPersistence,
  startLocalCanonicalDraftPersistence,
  stopLocalCanonicalDraftPersistence,
} from './localCanonicalDraftPersistence';
import {
  createResilientStorage,
  defaultResilientStorage,
} from '@/lib/resilientStorage';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import {
  inspectCanonicalDraftCache,
  loadCanonicalDraftCache,
  removeCanonicalDraftCache,
  saveCanonicalDraftCache,
} from '@/lib/questionnaireCanonicalDraftCache';

export const QUESTIONNAIRE_PERSIST_VERSION = 4;
export const DEFAULT_REHYDRATION_TIMEOUT_MS = 2_000;
export const PERSISTED_FORM_FIELDS = Object.freeze([
  'responses',
  'validationStatus',
  'touchedQuestions',
  'expandedQuestions',
  'textValidationMeta',
  'credentials',
  'uiDraftState',
  'fieldChangeMetadata',
  'draftContext',
  'currentQuestionId',
  'lastChangedQuestionId',
  'lastMutation',
  'submittedReceipt',
]);

export const defaultCanonicalDraftCacheAdapter = Object.freeze({
  inspectCanonicalDraftCache,
  loadCanonicalDraftCache,
  removeCanonicalDraftCache,
  saveCanonicalDraftCache,
});

const normalizeTimeout = (value) => (
  Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : DEFAULT_REHYDRATION_TIMEOUT_MS
);

const createBoundedRehydrationStorage = ({ storage, timeoutMs, state }) => ({
  async getItem(key) {
    let timeoutId;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => storage.getItem(key)),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => {
            state.status = 'timed_out';
            state.timedOut = true;
            resolve(null);
          }, timeoutMs);
        }),
      ]);
      if (!state.timedOut) state.status = 'storage_settled';
      return result;
    } catch {
      state.status = 'storage_failed';
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  async setItem(key, value) {
    try { return await storage.setItem(key, value); } catch { return undefined; }
  },
  async removeItem(key) {
    try { return await storage.removeItem(key); } catch { return undefined; }
  },
});

/** @param {{
 *   namespace?: string,
 *   storage?: any,
 *   rehydrationTimeoutMs?: number,
 *   canonicalCacheAdapter?: any,
 *   enableLocalPersistence?: boolean,
 *   startLocalPersistence?: boolean,
 *   localPersistenceOptions?: any,
 * }} [options] */
export const createQuestionnaireStore = ({
  namespace,
  storage = defaultResilientStorage,
  rehydrationTimeoutMs = DEFAULT_REHYDRATION_TIMEOUT_MS,
  canonicalCacheAdapter = defaultCanonicalDraftCacheAdapter,
  enableLocalPersistence = true,
  startLocalPersistence = true,
  localPersistenceOptions = {},
} = {}) => {
  const persistenceKey = buildQuestionnaireStorageKey({
    namespace,
    purpose: 'redux-state',
  });
  const rehydration = {
    status: 'pending',
    timedOut: false,
  };
  const boundedStorage = createBoundedRehydrationStorage({
    storage,
    timeoutMs: normalizeTimeout(rehydrationTimeoutMs),
    state: rehydration,
  });
  const persistConfig = {
    key: persistenceKey,
    keyPrefix: '',
    version: QUESTIONNAIRE_PERSIST_VERSION,
    storage: boundedStorage,
    whitelist: [...PERSISTED_FORM_FIELDS],
    migrate: async (persistedState) => ({
      ...normalizePersistedQuestionnaireState(persistedState),
      _persist: persistedState?._persist || {
        version: QUESTIONNAIRE_PERSIST_VERSION,
        rehydrated: false,
      },
    }),
    debug: false,
  };
  const persistedFormReducer = persistReducer(persistConfig, formReducer);
  const questionnaireStore = configureStore({
    reducer: { form: persistedFormReducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
  });

  const localPersistence = enableLocalPersistence
    ? createLocalCanonicalDraftPersistence({
      store: questionnaireStore,
      namespace,
      storage,
      cacheAdapter: canonicalCacheAdapter,
      ...localPersistenceOptions,
    })
    : null;

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const questionnairePersistor = persistStore(questionnaireStore, null, () => {
    if (!rehydration.timedOut && rehydration.status !== 'storage_failed') {
      rehydration.status = 'rehydrated';
    }
    if (startLocalPersistence && localPersistence) {
      startLocalCanonicalDraftPersistence(localPersistence);
    }
    resolveReady();
  });

  return Object.freeze({
    namespace,
    persistenceKey,
    store: questionnaireStore,
    persistor: questionnairePersistor,
    storage,
    canonicalCacheAdapter,
    localPersistence,
    ready,
    dispose: async ({ flush = false } = {}) => {
      if (localPersistence) {
        await stopLocalCanonicalDraftPersistence(localPersistence, { flush });
      }
      questionnairePersistor.pause();
    },
    getDiagnostics: () => Object.freeze({
      namespace,
      rehydrationStatus: rehydration.status,
      rehydrationTimedOut: rehydration.timedOut,
      storageMode: storage.getMode?.() || 'unknown',
      durable: Boolean(storage.getDiagnostics?.().durable),
    }),
  });
};

/** @param {{ namespace?: string, storage?: any, canonicalCacheAdapter?: any }} [options] */
export const clearQuestionnairePersistedState = async ({
  namespace,
  storage = defaultResilientStorage,
  canonicalCacheAdapter = defaultCanonicalDraftCacheAdapter,
} = {}) => {
  const persistenceKey = buildQuestionnaireStorageKey({
    namespace,
    purpose: 'redux-state',
  });
  try {
    await Promise.all([
      storage.removeItem(persistenceKey),
      (canonicalCacheAdapter.removeCanonicalDraftCache
        || canonicalCacheAdapter.remove
        || removeCanonicalDraftCache)({ namespace, storage }),
    ]);
    return true;
  } catch {
    return false;
  }
};

// Compatibility-only exports for legacy imports and non-questionnaire tools.
// They are isolated in page-lifetime memory and are never used by ReduxProvider.
const compatibilityNamespace = deriveQuestionnaireBrowserNamespace({
  userId: 'compatibility-non-questionnaire-route',
});
const compatibilityRuntime = createQuestionnaireStore({
  namespace: compatibilityNamespace,
  storage: createResilientStorage({ indexedDB: null, localStorage: null, sessionStorage: null }),
  enableLocalPersistence: false,
});

export const store = compatibilityRuntime.store;
export const persistor = compatibilityRuntime.persistor;
