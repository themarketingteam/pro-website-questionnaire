
import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import storage from 'redux-persist/lib/storage'; // defaults to localStorage
import formReducer from './formSlice';

const persistConfig = {
  key: 'pro-questionnaire-root',
  version: 1,
  storage,
  whitelist: ['responses', 'validationStatus', 'touchedQuestions', 'expandedQuestions', 'credentials'],
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
