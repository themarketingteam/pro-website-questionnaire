import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ProDraftRecovery from '@/pages/ProDraftRecovery';
import { QuestionnairePersistenceProvider } from '@/components/store/QuestionnairePersistenceContext';

const runtimeConfig = Object.freeze({
  environment: 'staging',
  durableDraftV2Enabled: true,
  publicEmailRecoveryEnabled: true,
});

const snapshot = (overrides = {}) => ({
  phase: 'idle', outcome: null, errorCode: null, clientChoiceRequired: false,
  readOnly: false, hasRecoveryCode: false, memoryOnly: false,
  storageMode: 'memory_only', draftSummary: null, captchaRequired: false,
  retryAfterSeconds: 0, ...overrides,
});

const createCoordinator = ({ initial, emailFailure, canList = false } = {}) => {
  let current = snapshot();
  let emailAuthorized = canList;
  const listeners = new Set();
  const publish = (next) => {
    current = snapshot(next);
    for (const listener of listeners) listener(current);
    return current;
  };
  return {
    bootstrap: vi.fn(async () => publish(initial || snapshot({
      phase: 'awaiting_client_choice', clientChoiceRequired: true,
    }))),
    getState: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    cancel: vi.fn(),
    recoverDraftByEmail: vi.fn(async () => {
      if (emailFailure) return publish({ phase: 'error', ...emailFailure });
      emailAuthorized = true;
      return {
        ...publish({
          phase: 'ready', outcome: 'email_draft_recovered',
          draftSummary: { status: 'active', businessNameDisplay: 'Newest Synthetic Draft' },
        }),
        otherEligibleDraftsAvailable: true,
      };
    }),
    recoverDraftByCode: vi.fn(async () => publish({
      phase: 'ready', outcome: 'code_draft_recovered',
      draftSummary: { status: 'active', businessNameDisplay: 'Exact Synthetic Draft' },
    })),
    canListRecoveryChoices: vi.fn(() => emailAuthorized),
    listRecoveryChoices: vi.fn(async () => ({ success: true, choices: [{
      draftId: 'draft-active-older', status: 'active', readOnly: false,
      businessNameDisplay: 'Older Active Synthetic Draft', isCurrentSelection: false,
    }, {
      draftId: 'draft-submitted', status: 'submitted', readOnly: true,
      businessNameDisplay: 'Submitted Synthetic Draft', isCurrentSelection: false,
    }] })),
    selectRecoveryChoice: vi.fn(async (draftId) => ({
      ...publish({
        phase: 'ready', outcome: draftId === 'draft-submitted'
          ? 'submitted_draft_loaded' : 'email_draft_recovered',
        readOnly: draftId === 'draft-submitted',
        draftSummary: {
          status: draftId === 'draft-submitted' ? 'submitted' : 'active',
          businessNameDisplay: 'Selected Synthetic Draft',
        },
      }),
      success: true,
    })),
    getRecoveryCodeForDisplay: () => null,
    getRecoveryCodeHint: () => 'JKMN',
    getCredentialStorageMode: () => 'memory_only',
    clearCurrentDraftCredentials: vi.fn(),
    replaceCurrentDraftCredentials: vi.fn(),
  };
};

const persistence = {
  namespace: `ns_${'a'.repeat(32)}`,
  storage: {},
  storageMode: 'memory_only',
};

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-probe">{location.pathname}{location.search}</output>;
};

const renderPage = (subject = createCoordinator(), props = {}) => {
  const store = configureStore({ reducer: () => ({ form: {} }) });
  return {
    subject,
    ...render(
      <Provider store={store}>
        <QuestionnairePersistenceProvider value={persistence}>
          <MemoryRouter initialEntries={['/recover-draft']}>
            <Routes>
              <Route path="/recover-draft" element={(
                <>
                  <ProDraftRecovery
                    runtimeConfig={runtimeConfig}
                    coordinator={subject}
                    {...props}
                  />
                  <LocationProbe />
                </>
              )} />
              <Route path="/" element={<p>Questionnaire route</p>} />
            </Routes>
          </MemoryRouter>
        </QuestionnairePersistenceProvider>
      </Provider>,
    ),
  };
};

describe('public ProDraftRecovery page', () => {
  it('renders direct navigation with the exact public warning and both methods', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Recover your questionnaire' })).toBeVisible();
    expect(screen.getByText('Email recovery does not verify ownership of the email address.')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Recover with email' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Recover with code' })).toBeVisible();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/recover-draft');
  });

  it('recovers by email explicitly, clears raw input, and lists authorized choices', async () => {
    const { subject } = renderPage();
    await screen.findByTestId('email-recovery-form');
    await userEvent.type(screen.getByLabelText('Email address'), 'synthetic.owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Recover questionnaire' }));
    expect(await screen.findByText(/Newest Synthetic Draft/)).toBeVisible();
    expect(subject.recoverDraftByEmail).toHaveBeenCalledWith(
      'synthetic.owner@example.test', {},
    );
    expect(document.body).not.toHaveTextContent('synthetic.owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Recover a different questionnaire' }));
    expect(await screen.findByText('Older Active Synthetic Draft')).toBeVisible();
    expect(subject.listRecoveryChoices).toHaveBeenCalledOnce();
  });

  it('recovers by code without making associated email choices available', async () => {
    const { subject } = renderPage(createCoordinator({ canList: false }));
    await screen.findByTestId('email-recovery-form');
    await userEvent.click(screen.getByRole('tab', { name: 'Recover with code' }));
    await userEvent.type(screen.getByLabelText('Recovery code'), '2345 6789 abcd efgh jkmn');
    await userEvent.click(screen.getByRole('button', { name: 'Recover questionnaire' }));
    expect(await screen.findByText(/Exact Synthetic Draft/)).toBeVisible();
    expect(subject.recoverDraftByCode).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Recover a different questionnaire' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).not.toHaveTextContent('2345');
  });

  it('shows generic failure, retry timing, and CAPTCHA only when required', async () => {
    const provider = {
      render: vi.fn((_node, options) => { options.onToken('synthetic-captcha-token'); return vi.fn(); }),
    };
    renderPage(createCoordinator({
      emailFailure: { captchaRequired: true, retryAfterSeconds: 30 },
    }), { captchaProvider: provider, captchaSiteKey: 'synthetic-site-key' });
    await screen.findByTestId('email-recovery-form');
    await userEvent.type(screen.getByLabelText('Email address'), 'synthetic.owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Recover questionnaire' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not recover');
    expect(screen.getByText('Security check ready.')).toBeVisible();
    expect(screen.getByText('Try again in 30 seconds.')).toBeVisible();
    await waitFor(() => expect(provider.render).toHaveBeenCalled());
  });

  it('selects active and submitted older drafts with truthful access state', async () => {
    const { subject } = renderPage(createCoordinator({
      initial: snapshot({
        phase: 'ready', outcome: 'email_draft_recovered',
        draftSummary: { status: 'active', businessNameDisplay: 'Current Synthetic Draft' },
      }),
      canList: true,
    }));
    await userEvent.click(await screen.findByRole('button', { name: 'Recover a different questionnaire' }));
    const openButtons = await screen.findAllByRole('button', { name: 'Open this questionnaire' });
    await userEvent.click(openButtons[0]);
    expect(subject.selectRecoveryChoice).toHaveBeenCalledWith('draft-active-older');
    expect((await screen.findAllByText('Active — editable'))[0]).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Open this questionnaire' }));
    expect(subject.selectRecoveryChoice).toHaveBeenCalledWith('draft-submitted');
    expect((await screen.findAllByText('Submitted — read-only'))[0]).toBeVisible();
    expect(screen.getByRole('button', { name: 'View submitted questionnaire' })).toBeVisible();
  });

  it('does not resubmit input during bootstrap or page rerender', async () => {
    const { subject, rerender } = renderPage();
    await screen.findByTestId('email-recovery-form');
    rerender(
      <Provider store={configureStore({ reducer: () => ({ form: {} }) })}>
        <QuestionnairePersistenceProvider value={persistence}>
          <MemoryRouter initialEntries={['/recover-draft']}>
            <ProDraftRecovery runtimeConfig={runtimeConfig} coordinator={subject} />
          </MemoryRouter>
        </QuestionnairePersistenceProvider>
      </Provider>,
    );
    expect(subject.recoverDraftByEmail).not.toHaveBeenCalled();
    expect(subject.recoverDraftByCode).not.toHaveBeenCalled();
  });

  it('supports keyboard navigation between recovery method tabs', async () => {
    renderPage();
    const emailTab = await screen.findByRole('tab', { name: 'Recover with email' });
    emailTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    const codeTab = screen.getByRole('tab', { name: 'Recover with code' });
    expect(codeTab).toHaveFocus();
    expect(codeTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Recover with code');
  });

  it('fails closed without changing the legacy questionnaire when V2 is disabled', () => {
    renderPage(createCoordinator(), {
      runtimeConfig: { ...runtimeConfig, durableDraftV2Enabled: false },
    });
    expect(screen.getByTestId('pro-draft-recovery-disabled')).toBeVisible();
    expect(screen.queryByTestId('email-recovery-form')).not.toBeInTheDocument();
  });
});
