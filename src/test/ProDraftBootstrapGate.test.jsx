import React, { StrictMode, useEffect } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ProDraftBootstrapGate from '@/components/pro-form/ProDraftBootstrapGate';
import { QuestionnairePersistenceProvider } from '@/components/store/QuestionnairePersistenceContext';

const runtimeConfig = Object.freeze({
  environment: 'staging',
  durableDraftV2Enabled: true,
  publicEmailRecoveryEnabled: true,
});

const state = (overrides = {}) => ({
  phase: 'idle', outcome: null, errorCode: null, clientChoiceRequired: false,
  readOnly: false, hasRecoveryCode: false, memoryOnly: false,
  storageMode: 'memory_only', draftSummary: null, captchaRequired: false,
  retryAfterSeconds: 0, ...overrides,
});

const coordinator = (initialResult = state({
  phase: 'awaiting_client_choice', clientChoiceRequired: true,
})) => {
  let current = state();
  let code = null;
  const listeners = new Set();
  const publish = (next) => {
    current = state(next);
    for (const listener of listeners) listener(current);
    return current;
  };
  const subject = {
    bootstrap: vi.fn(async () => publish(initialResult)),
    getState: vi.fn(() => current),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    cancel: vi.fn(),
    createNewDraftAssociation: vi.fn(async () => {
      code = '2345-6789-ABCD-EFGH-JKMN';
      return publish({
        phase: 'ready', outcome: 'new_draft_created', hasRecoveryCode: true,
        memoryOnly: true,
      });
    }),
    recoverDraftByEmail: vi.fn(async () => publish({
      phase: 'ready', outcome: 'email_draft_recovered',
    })),
    recoverDraftByCode: vi.fn(async () => publish({
      phase: 'ready', outcome: 'code_draft_recovered',
    })),
    getRecoveryCodeForDisplay: vi.fn(() => code),
    getRecoveryCodeHint: vi.fn(() => (code ? 'JKMN' : null)),
    getCredentialStorageMode: vi.fn(() => 'memory_only'),
    clearCurrentDraftCredentials: vi.fn(),
    replaceCurrentDraftCredentials: vi.fn(),
  };
  return subject;
};

const persistence = Object.freeze({
  namespace: `ns_${'g'.repeat(32)}`,
  storage: {},
  storageMode: 'memory_only',
  durable: false,
  getStorageDiagnostics: () => ({ storageMode: 'memory_only', durable: false }),
  getLocalPersistenceStatus: () => ({ active: false }),
});

const renderGate = ({
  enabled = true,
  subject = coordinator(),
  href = 'https://questionnaire.example.invalid/?signedInvitationEmail=signed.owner%40example.invalid',
  children = <button type="button">Questionnaire child</button>,
  strict = false,
} = {}) => {
  const store = configureStore({ reducer: () => ({ form: {} }) });
  const content = (
    <Provider store={store}>
      <QuestionnairePersistenceProvider value={persistence}>
        <ProDraftBootstrapGate
          enabled={enabled}
          runtimeConfig={runtimeConfig}
          locationHref={href}
          coordinator={subject}
        >
          {children}
        </ProDraftBootstrapGate>
      </QuestionnairePersistenceProvider>
    </Provider>
  );
  return { ...render(strict ? <StrictMode>{content}</StrictMode> : content), subject };
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe('ProDraftBootstrapGate', () => {
  it('always presents the modal in V2 and blocks ordinary questionnaire mounting', async () => {
    const mounted = vi.fn();
    const Child = () => {
      useEffect(() => { mounted(); }, []);
      return <button type="button">Questionnaire child</button>;
    };
    renderGate({ children: <Child /> });
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.getByTestId('pro-draft-bootstrap-gate')).toHaveAttribute('aria-busy', 'true');
    expect(mounted).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Questionnaire child' })).not.toBeInTheDocument();
  });

  it('fails closed with controlled recovery UX when V2 is disabled', () => {
    const subject = coordinator();
    renderGate({ enabled: false, subject });
    expect(screen.getByRole('heading', {
      name: 'Questionnaire Saving Is Temporarily Unavailable',
    })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Questionnaire child' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Draft Recovery' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(subject.bootstrap).not.toHaveBeenCalled();
  });

  it('shows a welcome-back modal even after exact stored-draft resume', async () => {
    renderGate({ subject: coordinator(state({
      phase: 'ready', outcome: 'stored_draft_resumed',
      draftSummary: { businessNameDisplay: 'Synthetic Business' },
    })) });
    expect(await screen.findByRole('heading', { name: 'Your saved questionnaire is ready' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Questionnaire child' })).not.toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Continue to questionnaire' }));
    expect(screen.getByRole('button', { name: 'Questionnaire child' })).toBeVisible();
    expect(screen.getByTestId('pro-draft-bootstrap-gate')).toHaveAttribute('aria-busy', 'false');
  });

  it('prefills the signed-invitation email inside the gate', async () => {
    renderGate();
    await screen.findByRole('dialog');
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    expect(screen.getByLabelText('Email address (optional)')).toHaveValue(
      'signed.owner@example.invalid',
    );
  });

  it('creates only once in Strict Mode and requires code acknowledgement', async () => {
    const subject = coordinator();
    renderGate({ subject, strict: true });
    await screen.findByRole('dialog');
    expect(subject.bootstrap).toHaveBeenCalledOnce();
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    await user().click(screen.getByRole('button', { name: 'Continue with this email' }));
    expect(await screen.findByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
    expect(subject.createNewDraftAssociation).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Continue to questionnaire' })).toBeDisabled();
    await user().click(screen.getByRole('checkbox'));
    await user().click(screen.getByRole('button', { name: 'Continue to questionnaire' }));
    expect(screen.getByRole('button', { name: 'Questionnaire child' })).toBeVisible();
  });

  it('opens submitted recovery in a disabled read-only fieldset', async () => {
    renderGate({ subject: coordinator(state({
      phase: 'ready', outcome: 'submitted_draft_loaded', readOnly: true,
    })) });
    await user().click(await screen.findByRole('button', { name: 'View submitted questionnaire' }));
    const child = screen.getByRole('button', { name: 'Questionnaire child' });
    expect(child).toBeDisabled();
    expect(child.closest('fieldset')).toHaveAttribute('aria-disabled', 'true');
  });

  it('exposes accessible loading and readiness status without mounting children early', async () => {
    const subject = coordinator();
    subject.bootstrap = vi.fn(() => new Promise(() => {}));
    renderGate({ subject });
    expect(screen.getByText('Preparing draft recovery options…')).toBeVisible();
    expect(screen.getByText(/interaction is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Questionnaire child' })).not.toBeInTheDocument();
    await waitFor(() => expect(subject.bootstrap).toHaveBeenCalledOnce());
  });
});
