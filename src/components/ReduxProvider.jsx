import React from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from './store/store';

export default function ReduxProvider({ children }) {
  return (
    <Provider store={store}>
      <PersistGate 
        loading={
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-gray-600">Loading saved data...</div>
          </div>
        } 
        persistor={persistor}
        onBeforeLift={() => {
          // Log when rehydration completes
          console.log('✅ Redux state rehydrated from localStorage');
        }}
      >
        {children}
      </PersistGate>
    </Provider>
  );
}