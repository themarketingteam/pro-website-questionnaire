import React from 'react';
import ReactDOM from 'react-dom/client';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import ProDraftRecovery from '../../../src/pages/ProDraftRecovery';
import ProDraftRecoveryPanel from '../../../src/components/pro-form/ProDraftRecoveryPanel';
import { ProDraftCredentialProvider } from '../../../src/contexts/ProDraftCredentialContext';
import { QuestionnairePersistenceProvider } from '../../../src/components/store/QuestionnairePersistenceContext';
import '../../../src/index.css';

const fixtureUrl = new URL(window.location.href);
const scenario = fixtureUrl.searchParams.get('scenario') || 'direct';
const view = fixtureUrl.searchParams.get('view') || 'recovery';
window.history.replaceState({}, '', '/recover-draft');

const runtimeConfig = Object.freeze({
  environment: 'staging',
  durableDraftV2Enabled: true,
  publicEmailRecoveryEnabled: true,
});

const snapshot = (overrides = {}) => ({
  phase: 'idle', outcome: null, errorCode: null, clientChoiceRequired: false,
  readOnly: false, hasRecoveryCode: false,
  memoryOnly: scenario === 'storage-blocked',
  storageMode: scenario === 'storage-blocked' ? 'memory_only' : 'indexeddb',
  draftSummary: null, captchaRequired: false, retryAfterSeconds: 0,
  ...overrides,
});

const createFixtureCoordinator = () => {
  let current = snapshot();
  let emailAuthorized = false;
  let captchaAttempted = false;
  const listeners = new Set();
  const publish = (next) => {
    current = snapshot(next);
    listeners.forEach((listener) => listener(current));
    return current;
  };
  return {
    bootstrap: async () => publish({
      phase: 'awaiting_client_choice', clientChoiceRequired: true,
    }),
    getState: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    cancel() {},
    async recoverDraftByEmail(_email, options = {}) {
      if (scenario === 'captcha' && !captchaAttempted) {
        captchaAttempted = true;
        return publish({ phase: 'error', captchaRequired: true, retryAfterSeconds: 1 });
      }
      if (scenario === 'captcha' && !options.captchaToken) {
        return publish({ phase: 'error', captchaRequired: true });
      }
      emailAuthorized = true;
      return {
        ...publish({
          phase: 'ready',
          outcome: 'email_draft_recovered',
          draftSummary: {
            status: 'active',
            businessNameDisplay: 'Newest Synthetic Questionnaire',
            lastSavedAt: '2033-05-18T12:00:00.000Z',
          },
        }),
        otherEligibleDraftsAvailable: true,
      };
    },
    async recoverDraftByCode() {
      return publish({
        phase: 'ready',
        outcome: 'code_draft_recovered',
        draftSummary: {
          status: 'active',
          businessNameDisplay: 'Exact Synthetic Questionnaire',
          lastSavedAt: '2033-05-18T12:00:00.000Z',
        },
      });
    },
    canListRecoveryChoices: () => emailAuthorized,
    async listRecoveryChoices() {
      return { success: true, choices: [{
        draftId: 'draft-active-older',
        businessNameDisplay: 'Older Active Synthetic Questionnaire',
        status: 'active', readOnly: false, isCurrentSelection: false,
        createdAt: '2033-05-01T12:00:00.000Z',
        lastSavedAt: '2033-05-17T12:00:00.000Z',
      }, {
        draftId: 'draft-submitted-older',
        businessNameDisplay: 'Submitted Synthetic Questionnaire',
        status: 'submitted', readOnly: true, isCurrentSelection: false,
        createdAt: '2033-04-01T12:00:00.000Z',
        lastSavedAt: '2033-04-17T12:00:00.000Z',
      }] };
    },
    async selectRecoveryChoice(draftId) {
      const submitted = draftId === 'draft-submitted-older';
      return {
        ...publish({
          phase: 'ready',
          outcome: submitted ? 'submitted_draft_loaded' : 'email_draft_recovered',
          readOnly: submitted,
          draftSummary: {
            status: submitted ? 'submitted' : 'active',
            businessNameDisplay: submitted
              ? 'Submitted Synthetic Questionnaire'
              : 'Older Active Synthetic Questionnaire',
          },
        }),
        success: true,
      };
    },
    getRecoveryCodeForDisplay: () => null,
    getRecoveryCodeHint: () => 'JKMN',
    getCredentialStorageMode: () => current.storageMode,
    clearCurrentDraftCredentials: async () => ({ ok: true }),
    replaceCurrentDraftCredentials: async () => ({ ok: true }),
  };
};

const coordinator = createFixtureCoordinator();
const persistence = {
  namespace: `ns_${'r'.repeat(32)}`,
  storage: {},
  storageMode: scenario === 'storage-blocked' ? 'memory_only' : 'indexeddb',
  durable: scenario !== 'storage-blocked',
};

const panelForm = {
  credentials: { recoveryEmail: 'synthetic.owner@example.invalid' },
  draftContext: { draftStatus: scenario === 'panel-submitted' ? 'submitted' : 'active' },
  draftSyncStatus: {
    state: scenario === 'panel-submitted' ? 'submitted' : 'restored',
    lastLocalSavedAt: '2033-05-18T12:00:00.000Z',
    lastServerSavedAt: '2033-05-18T11:59:00.000Z',
  },
};

const store = configureStore({ reducer: () => ({ form: view === 'panel' ? panelForm : {} }) });
const panelCoordinator = {
  getRecoveryCodeForDisplay: () => (
    scenario === 'panel-full' ? '2345-6789-ABCD-EFGH-JKMN' : null
  ),
  getRecoveryCodeHint: () => 'JKMN',
  getCredentialStorageMode: () => persistence.storageMode,
};

const content = view === 'panel' ? (
  <ProDraftCredentialProvider coordinator={panelCoordinator}>
    <header data-testid="site-header">Synthetic site header</header>
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <ProDraftRecoveryPanel />
      <section id="question-1" data-testid="question-wrapper-1">
        <h1>Question 1</h1>
        <label htmlFor="synthetic-q1">Business name</label>
        <input id="synthetic-q1" />
      </section>
      <footer><ProDraftRecoveryPanel variant="footer" /></footer>
    </main>
  </ProDraftCredentialProvider>
) : (
  <ProDraftRecovery runtimeConfig={runtimeConfig} coordinator={coordinator} />
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <QuestionnairePersistenceProvider value={persistence}>
      <BrowserRouter>{content}</BrowserRouter>
    </QuestionnairePersistenceProvider>
  </Provider>,
);
