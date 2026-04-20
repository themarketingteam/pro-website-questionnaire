import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer, createMigrate, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import storage from 'redux-persist/lib/storage'; // defaults to localStorage
import formReducer from './formSlice';

import { normalizePersistedState } from './normalization';

const migrations = {
  2: (state) => normalizePersistedState(state),
};

const persistConfig = {
  key: 'pro-questionnaire-root',
  version: 2,
  storage,
  whitelist: ['responses', 'validationStatus', 'touchedQuestions', 'expandedQuestions', 'credentials'],
  migrate: createMigrate(migrations, { debug: false }),
  // Ensure nested objects are properly serialized
  serialize: true,
  // Add debug logging
  debug: false
};

const persistedReducer = persistReducer(persistConfig, formReducer);

export const store = configureStore({
  reducer: {
    form: persistedReducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    })
});

export const persistor = persistStore(store);