import { createContext, useContext } from 'react';

const QuestionnairePersistenceContext = createContext(null);

export const QuestionnairePersistenceProvider = QuestionnairePersistenceContext.Provider;

export const useQuestionnairePersistence = () => {
  const context = useContext(QuestionnairePersistenceContext);
  if (!context) {
    return {
      namespace: null,
      storage: null,
      storageMode: 'unknown',
      durable: false,
      rehydrationStatus: 'unavailable',
      getStorageDiagnostics: () => ({ storageMode: 'unknown', durable: false }),
      getLocalPersistenceStatus: () => ({
        active: false,
        storageMode: 'unknown',
        lastErrorCode: 'LOCAL_CANONICAL_PERSISTENCE_UNAVAILABLE',
      }),
      localPersistence: null,
      canonicalCacheAdapter: null,
      draftListenerRuntime: null,
    };
  }
  return context;
};
