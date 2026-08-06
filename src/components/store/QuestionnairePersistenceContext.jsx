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
    };
  }
  return context;
};
