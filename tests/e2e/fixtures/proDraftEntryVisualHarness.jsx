import React from 'react';
import ReactDOM from 'react-dom/client';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import ProDraftBootstrapGate from '../../../src/components/pro-form/ProDraftBootstrapGate';
import { QuestionnairePersistenceProvider } from '../../../src/components/store/QuestionnairePersistenceContext';
import '../../../src/index.css';

const CODE = '2345-6789-ABCD-EFGH-JKMN';
const scenario = new URL(window.location.href).searchParams.get('scenario') || 'new-email';
const runtimeConfig = Object.freeze({
  environment: 'staging',
  durableDraftV2Enabled: true,
  publicEmailRecoveryEnabled: true,
});

const initial = () => {
  if (scenario === 'stored') return {
    phase: 'ready', outcome: 'stored_draft_resumed', readOnly: false,
    draftSummary: { businessNameDisplay: 'Synthetic Business', lastSavedAt: '2033-05-18T12:00:00.000Z' },
  };
  if (scenario === 'submitted') return {
    phase: 'ready', outcome: 'submitted_draft_loaded', readOnly: true,
  };
  return { phase: 'awaiting_client_choice', outcome: null, readOnly: false };
};

const createFixtureCoordinator = () => {
  let current = { phase: 'idle', outcome: null, readOnly: false };
  let code = null;
  let captchaAttempted = false;
  const listeners = new Set();
  const publish = (patch) => {
    current = {
      clientChoiceRequired: false,
      hasRecoveryCode: Boolean(code),
      memoryOnly: false,
      storageMode: 'memory_only',
      captchaRequired: false,
      retryAfterSeconds: 0,
      draftSummary: null,
      ...patch,
    };
    for (const listener of listeners) listener(current);
    return current;
  };
  return {
    bootstrap: async () => publish(initial()),
    getState: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {},
    async createNewDraftAssociation() {
      code = CODE;
      return publish({
        phase: 'ready',
        outcome: scenario === 'anonymous' || scenario === 'storage-blocked'
          ? 'anonymous_draft_created'
          : 'new_draft_created',
        memoryOnly: scenario === 'storage-blocked',
        hasRecoveryCode: true,
      });
    },
    async recoverDraftByEmail(_email, options = {}) {
      if (scenario === 'captcha' && !captchaAttempted) {
        captchaAttempted = true;
        return publish({ phase: 'error', captchaRequired: true });
      }
      if (scenario === 'captcha' && !options.captchaToken) {
        return publish({ phase: 'error', captchaRequired: true });
      }
      return publish({ phase: 'ready', outcome: 'email_draft_recovered' });
    },
    async recoverDraftByCode() {
      return publish({ phase: 'ready', outcome: 'code_draft_recovered' });
    },
    getRecoveryCodeForDisplay: () => code,
    getRecoveryCodeHint: () => (code ? 'JKMN' : null),
    getCredentialStorageMode: () => current.storageMode || 'memory_only',
    clearCurrentDraftCredentials: async () => ({ ok: true }),
    replaceCurrentDraftCredentials: async () => ({ ok: true }),
  };
};

const store = configureStore({ reducer: () => ({ form: {} }) });
const persistence = {
  namespace: `ns_${'v'.repeat(32)}`,
  storage: {},
  storageMode: 'memory_only',
  durable: false,
  getStorageDiagnostics: () => ({ storageMode: 'memory_only', durable: false }),
  getLocalPersistenceStatus: () => ({ active: false }),
};
const coordinator = createFixtureCoordinator();
const signedHref = 'https://questionnaire.example.invalid/?signedInvitationEmail=signed.owner%40example.invalid';

ReactDOM.createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <QuestionnairePersistenceProvider value={persistence}>
      <ProDraftBootstrapGate
        enabled
        runtimeConfig={runtimeConfig}
        locationHref={signedHref}
        coordinator={coordinator}
        captchaSiteKey="synthetic-public-site-key"
      >
        <main data-testid="questionnaire-content" className="p-8">
          <h1>Interactive questionnaire fixture</h1>
          <button type="button">Synthetic questionnaire control</button>
        </main>
      </ProDraftBootstrapGate>
    </QuestionnairePersistenceProvider>
  </Provider>,
);
