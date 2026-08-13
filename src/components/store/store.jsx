import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer, createMigrate, createTransform, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import storage from 'redux-persist/lib/storage'; // defaults to localStorage
import formReducer from './formSlice';

import { normalizePersistedState, normalizePersistedStateV3 } from './normalization';

const migrations = {
  2: (state) => normalizePersistedState(state),
  3: (state) => normalizePersistedStateV3(state),
  4: (state) => normalizePersistedStateV3(state),
};

// This transform runs on EVERY rehydrate (not just migrations), ensuring
// corrupted or stale states are always sanitized before entering Redux.
const normalizationTransform = createTransform(
  // outbound (before persist) — no-op
  (inboundState) => inboundState,
  // inbound (after rehydrate from storage) — always normalize
  (outboundState, key) => {
    if (key === 'form') {
      try {
        return normalizePersistedStateV3(outboundState);
      } catch (e) {
        console.error('[store] normalizationTransform failed, using raw state:', e);
        return outboundState;
      }
    }
    return outboundState;
  }
);

const persistConfig = {
  key: 'pro-questionnaire-root',
  version: 4,
  storage,
  whitelist: ['responses', 'validationStatus', 'touchedQuestions', 'expandedQuestions', 'textValidationMeta'],
  migrate: createMigrate(migrations, { debug: false }),
  transforms: [normalizationTransform],
  serialize: true,
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
