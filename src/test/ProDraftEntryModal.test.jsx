import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ProDraftEntryModal, {
  PRO_DRAFT_ENTRY_MODAL_STATES,
} from '@/components/pro-form/ProDraftEntryModal';

const CODE = '2345-6789-ABCD-EFGH-JKMN';
const TOKEN = `${'a'.repeat(43)}.${'b'.repeat(43)}`;
const GENERIC_RECOVERY_MESSAGE =
  'We could not recover a questionnaire with the information provided.';

const bootstrap = (overrides = {}) => ({
  phase: 'awaiting_client_choice',
  outcome: null,
  readOnly: false,
  memoryOnly: false,
  draftSummary: null,
  captchaRequired: false,
  retryAfterSeconds: 0,
  createNewDraftAssociation: vi.fn(async () => ({ phase: 'ready', outcome: 'new_draft_created' })),
  recoverDraftByEmail: vi.fn(async () => ({ phase: 'ready', outcome: 'email_draft_recovered' })),
  recoverDraftByCode: vi.fn(async () => ({ phase: 'ready', outcome: 'code_draft_recovered' })),
  getRecoveryCodeForDisplay: vi.fn(() => null),
  getRecoveryCodeHint: vi.fn(() => null),
  ...overrides,
});

const renderModal = (overrides = {}) => {
  const subject = bootstrap(overrides.bootstrap);
  const props = {
    bootstrap: subject,
    initialEmail: overrides.initialEmail || '',
    signedInvitationEmail: overrides.signedInvitationEmail || '',
    environment: overrides.environment || 'staging',
    createIdentityForEmail: overrides.createIdentityForEmail || vi.fn((email) => ({ email })),
    createAnonymousIdentity: overrides.createAnonymousIdentity || vi.fn(() => ({ anonymous: true })),
    captchaProvider: overrides.captchaProvider,
    captchaSiteKey: overrides.captchaSiteKey,
    onComplete: overrides.onComplete || vi.fn(),
  };
  return { ...render(<ProDraftEntryModal {...props} />), subject, props };
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe('ProDraftEntryModal contract', () => {
  it('declares every approved controlled state', () => {
    expect(PRO_DRAFT_ENTRY_MODAL_STATES).toEqual([
      'choose_recovery_method', 'email_entry', 'email_recovery_loading',
      'email_recovery_result', 'code_entry', 'code_recovery_loading',
      'code_recovery_result', 'creating_new_draft',
      'recovery_code_acknowledgement', 'welcome_back',
      'submitted_read_only_ready', 'error',
    ]);
  });

  it('shows the required opening title, explanation, and visible privacy warning', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Save and recover your questionnaire' })).toBeVisible();
    expect(screen.getByText(/Email recovery does not verify ownership/)).toBeVisible();
  });

  it('offers explicit email, code, and anonymous choices without an email-code button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Continue with an email' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recover with a recovery code' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue without an email' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /email me.*recovery code/i })).not.toBeInTheDocument();
  });

  it('uses exactly one prefilled email field and no confirmation field', async () => {
    renderModal({ initialEmail: 'signed.owner@example.invalid' });
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    const fields = screen.getAllByRole('textbox');
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveValue('signed.owner@example.invalid');
    expect(screen.queryByLabelText(/confirm email/i)).not.toBeInTheDocument();
  });

  it('does not warn when the signed email remains unchanged', async () => {
    renderModal({
      initialEmail: 'signed.owner@example.invalid',
      signedInvitationEmail: 'Signed.Owner@example.invalid',
    });
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    expect(screen.queryByText(/Changing this email will start/)).not.toBeInTheDocument();
  });

  it('shows the exact changed-signed-email warning', async () => {
    renderModal({
      initialEmail: 'signed.owner@example.invalid',
      signedInvitationEmail: 'signed.owner@example.invalid',
    });
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    await user().clear(screen.getByLabelText('Email address (optional)'));
    await user().type(screen.getByLabelText('Email address (optional)'), 'replacement@example.invalid');
    expect(screen.getByText(/It will not open drafts that already belong to the replacement email/)).toBeVisible();
  });

  it('validates an invalid email on blur', async () => {
    renderModal();
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    await user().type(screen.getByLabelText('Email address (optional)'), 'invalid');
    fireEvent.blur(screen.getByLabelText('Email address (optional)'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
  });

  it('continues with an email without invoking email recovery', async () => {
    const view = renderModal({ initialEmail: 'client@example.invalid' });
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    await user().click(screen.getByRole('button', { name: 'Continue with this email' }));
    expect(view.subject.createNewDraftAssociation).toHaveBeenCalledOnce();
    expect(view.subject.recoverDraftByEmail).not.toHaveBeenCalled();
  });

  it('runs email recovery only from its explicit action', async () => {
    const view = renderModal({ initialEmail: 'client@example.invalid' });
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    expect(view.subject.recoverDraftByEmail).not.toHaveBeenCalled();
    await user().click(screen.getByRole('button', { name: 'Recover saved answers using this email' }));
    await waitFor(() => expect(view.subject.recoverDraftByEmail).toHaveBeenCalledOnce());
  });

  it('requires the no-email acknowledgement before creation', async () => {
    const view = renderModal();
    await user().click(screen.getByRole('button', { name: 'Continue without an email' }));
    const button = screen.getByRole('button', { name: 'Continue without an email' });
    expect(button).toBeDisabled();
    await user().click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
    await user().click(button);
    expect(view.subject.createNewDraftAssociation).toHaveBeenCalledWith(expect.objectContaining({
      anonymousAcknowledged: true,
    }));
  });

  it('provides the required accessible no-email checkbox label', async () => {
    renderModal();
    await user().click(screen.getByRole('button', { name: 'Continue without an email' }));
    expect(screen.getByRole('checkbox', {
      name: 'I understand that without an email address or a saved recovery code, I may not be able to recover my answers after leaving this questionnaire.',
    })).toBeVisible();
  });

  it('shows a newly issued recovery code prominently', () => {
    renderModal({ bootstrap: {
      phase: 'ready', outcome: 'new_draft_created',
      getRecoveryCodeForDisplay: vi.fn(() => CODE),
    } });
    expect(screen.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
    expect(screen.getByLabelText('Recovery code')).toHaveTextContent(CODE);
  });

  it('shows the stronger memory-only warning', () => {
    renderModal({ bootstrap: {
      phase: 'ready', outcome: 'anonymous_draft_created', memoryOnly: true,
      getRecoveryCodeForDisplay: vi.fn(() => CODE),
    } });
    expect(screen.getByRole('alert')).toHaveTextContent('This browser is not allowing persistent storage');
  });

  it('copies the code, reports success, and marks it acknowledged', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderModal({ bootstrap: {
      phase: 'ready', outcome: 'new_draft_created',
      getRecoveryCodeForDisplay: vi.fn(() => CODE),
    } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy recovery code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE));
    expect(screen.getByRole('status')).toHaveTextContent('Recovery code copied');
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('falls back to selection and manual-copy instructions', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
    });
    renderModal({ bootstrap: {
      phase: 'ready', outcome: 'new_draft_created',
      getRecoveryCodeForDisplay: vi.fn(() => CODE),
    } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy recovery code' }));
    expect(await screen.findByText(/Command\+C/)).toBeVisible();
    expect(window.getSelection().toString()).toContain(CODE);
  });

  it('requires recovery-code acknowledgement before questionnaire entry', async () => {
    renderModal({ bootstrap: {
      phase: 'ready', outcome: 'new_draft_created',
      getRecoveryCodeForDisplay: vi.fn(() => CODE),
    } });
    const button = screen.getByRole('button', { name: 'Continue to questionnaire' });
    expect(button).toBeDisabled();
    await user().click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
  });

  it('shows only a hint and does not repeat acknowledgement when the full code is unavailable', () => {
    renderModal({ bootstrap: {
      phase: 'ready', outcome: 'new_draft_created',
      getRecoveryCodeForDisplay: vi.fn(() => null),
      getRecoveryCodeHint: vi.fn(() => 'JKMN'),
    } });
    expect(screen.getByText(/ending JKMN/)).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to questionnaire' })).toBeEnabled();
  });

  it('recovers by code from an explicit labeled field', async () => {
    const view = renderModal();
    await user().click(screen.getByRole('button', { name: 'Recover with a recovery code' }));
    const input = screen.getByLabelText('Recovery code');
    expect(input).toHaveAttribute('placeholder', 'XXXX-XXXX-XXXX-XXXX-XXXX');
    await user().type(input, CODE);
    await user().click(screen.getByRole('button', { name: 'Recover questionnaire' }));
    await waitFor(() => expect(view.subject.recoverDraftByCode).toHaveBeenCalledWith(
      CODE,
      { keepInBrowser: true },
    ));
  });

  it('uses a generic code-recovery failure and bounded retry timing', async () => {
    const view = renderModal({ bootstrap: {
      recoverDraftByCode: vi.fn(async () => ({
        phase: 'error', captchaRequired: false, retryAfterSeconds: 45,
      })),
    } });
    await user().click(screen.getByRole('button', { name: 'Recover with a recovery code' }));
    await user().type(screen.getByLabelText('Recovery code'), CODE);
    await user().click(screen.getByRole('button', { name: 'Recover questionnaire' }));
    expect(await screen.findByText(GENERIC_RECOVERY_MESSAGE)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Try again in 45 seconds.');
    expect(view.container.textContent).not.toContain('submitted/superseded');
  });

  it('uses the same generic failure for email recovery', async () => {
    renderModal({
      initialEmail: 'client@example.invalid',
      bootstrap: { recoverDraftByEmail: vi.fn(async () => ({ phase: 'error' })) },
    });
    await user().click(screen.getByRole('button', { name: 'Continue with an email' }));
    await user().click(screen.getByRole('button', { name: 'Recover saved answers using this email' }));
    expect(await screen.findByText(GENERIC_RECOVERY_MESSAGE)).toBeVisible();
  });

  it('passes a transient CAPTCHA token only on the retry that uses it', async () => {
    const provider = {
      render: vi.fn((_node, options) => {
        options.onToken('synthetic-captcha-token');
        return vi.fn();
      }),
    };
    const recover = vi
      .fn()
      .mockResolvedValueOnce({ phase: 'error', captchaRequired: true })
      .mockResolvedValueOnce({ phase: 'ready', outcome: 'code_draft_recovered' });
    renderModal({
      captchaProvider: provider,
      captchaSiteKey: 'synthetic-public-site-key',
      bootstrap: { recoverDraftByCode: recover },
    });
    await user().click(screen.getByRole('button', { name: 'Recover with a recovery code' }));
    await user().type(screen.getByLabelText('Recovery code'), CODE);
    await user().click(screen.getByRole('button', { name: 'Recover questionnaire' }));
    const retry = await screen.findByRole('button', { name: 'Try code recovery again' });
    await waitFor(() => expect(retry).toBeEnabled());
    await user().click(retry);
    expect(recover).toHaveBeenLastCalledWith(CODE, {
      keepInBrowser: true,
      captchaToken: 'synthetic-captcha-token',
    });
  });

  it('shows the active welcome-back state without answer previews', () => {
    const view = renderModal({ bootstrap: {
      phase: 'ready', outcome: 'stored_draft_resumed',
      draftSummary: {
        businessNameDisplay: 'Synthetic Business',
        lastSavedAt: '2033-05-18T12:00:00.000Z',
      },
    } });
    expect(screen.getByRole('heading', { name: 'Your saved questionnaire is ready' })).toBeVisible();
    expect(screen.getByText(/Synthetic Business/)).toBeVisible();
    expect(view.container).not.toHaveTextContent('answer preview');
  });

  it('shows the submitted read-only-ready state and exact action', () => {
    renderModal({ bootstrap: { phase: 'ready', readOnly: true, outcome: 'submitted_draft_loaded' } });
    expect(screen.getByRole('heading', { name: 'Your submitted questionnaire is ready' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'View submitted questionnaire' })).toBeVisible();
  });

  it('never renders authorization tokens', () => {
    const view = renderModal({ bootstrap: {
      phase: 'ready', outcome: 'stored_draft_resumed',
      recoverySessionToken: TOKEN,
      resumeToken: 'R'.repeat(43),
    } });
    expect(view.container.textContent).not.toContain(TOKEN);
    expect(view.container.textContent).not.toContain('R'.repeat(43));
  });

  it('does not place the displayed recovery code in the URL', () => {
    window.history.replaceState({}, '', '/?businessName=Synthetic');
    renderModal({ bootstrap: {
      phase: 'ready', outcome: 'new_draft_created',
      getRecoveryCodeForDisplay: vi.fn(() => CODE),
    } });
    expect(window.location.href).not.toContain(CODE);
  });

  it('prevents Escape from closing the required modal', async () => {
    renderModal();
    await user().keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('traps keyboard focus inside the modal', async () => {
    render(<><button type="button">Background action</button><ProDraftEntryModal
      bootstrap={bootstrap()}
      onComplete={vi.fn()}
    /></>);
    const dialog = screen.getByRole('dialog');
    await user().tab();
    expect(dialog).toContainElement(document.activeElement);
    for (let index = 0; index < 5; index += 1) await user().tab();
    expect(dialog).toContainElement(document.activeElement);
  });

  it('blocks pointer interaction with the background through the modal overlay', () => {
    const background = vi.fn();
    render(<><button type="button" onClick={background}>Background action</button><ProDraftEntryModal
      bootstrap={bootstrap()}
      onComplete={vi.fn()}
    /></>);
    expect(document.body).toHaveStyle({ pointerEvents: 'none' });
    expect(background).not.toHaveBeenCalled();
  });

  it('uses mobile-safe viewport sizing and scroll containment', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[calc(100dvh-1rem)]');
    expect(dialog.className).toContain('overflow-y-auto');
    expect(within(dialog).getByRole('heading')).toBeVisible();
  });
});
