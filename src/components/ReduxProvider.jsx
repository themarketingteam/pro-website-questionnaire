import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from './store/store';
import { resetForm } from './store/formSlice';

export default function ReduxProvider({ children }) {
  // Secondary safeguard after mount (in case pre-lift path didn't run)
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const shouldReset = url.searchParams.get('resetFormState') === '1';
      if (shouldReset) {
        (async () => {
          console.warn('[ReduxProvider] Post-mount purge path triggered');
          await persistor.purge();
          store.dispatch(resetForm());
          url.searchParams.delete('resetFormState');
          window.history.replaceState({}, '', url.toString());
          window.location.reload();
        })();
      }
    } catch {}
  }, []);

  return (
    <Provider store={store}>
      <PersistGate 
        loading={null}
        persistor={persistor}
        onBeforeLift={async () => {
          // Programmatic reset before app renders (on boot)
          try {
            const url = new URL(window.location.href);
            const shouldReset = url.searchParams.get('resetFormState') === '1';
            if (shouldReset) {
              console.warn('[ReduxProvider] Purging persisted questionnaire state (pre-lift)');
              await persistor.purge();
              store.dispatch(resetForm());
              url.searchParams.delete('resetFormState');
              window.history.replaceState({}, '', url.toString());
              // Hard reload to ensure a clean mount without stale memory
              window.location.reload();
              return;
            }
          } catch {}
          // Log when rehydration completes
          console.log('✅ Redux state rehydrated from localStorage');
        }}
      >
        {children}
      </PersistGate>
    </Provider>
  );
}