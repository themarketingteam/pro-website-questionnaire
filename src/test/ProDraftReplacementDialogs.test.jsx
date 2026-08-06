import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ClearQuestionnaireDialog from '@/components/pro-form/ClearQuestionnaireDialog';
import NewDraftRecoveryCodeDialog, {
  NEW_DRAFT_EMAIL_MESSAGES,
} from '@/components/pro-form/NewDraftRecoveryCodeDialog';

describe('Clear and Start New dialogs', () => {
  it('renders exact Clear All wording without claiming browser-history deletion', () => {
    render(<ClearQuestionnaireDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Start over with a new questionnaire?' })).toBeVisible();
    expect(screen.getByText('Your current draft will be archived for support and will no longer be the draft automatically opened with your email. A brand-new blank draft and recovery code will be created.')).toBeVisible();
    expect(screen.getByText('This clears questionnaire information stored by this website for the current draft. It does not erase your browser history.')).toBeVisible();
    expect(screen.queryByText(/Clear browser history/iu)).not.toBeInTheDocument();
  });

  it('cancels without confirming and initially focuses the safe action', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ClearQuestionnaireDialog open onCancel={onCancel} onConfirm={onConfirm} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(cancel, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('requires an explicit click on the destructive confirmation', () => {
    const onConfirm = vi.fn();
    render(<ClearQuestionnaireDialog open onCancel={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a new blank draft' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('uses submitted-safe Start New wording', () => {
    render(<ClearQuestionnaireDialog open mode="start_new" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Create a new questionnaire?' })).toBeVisible();
    expect(screen.getByText('Your submitted questionnaire will remain unchanged. A separate blank questionnaire and new recovery code will be created.')).toBeVisible();
  });

  it('uses responsive mobile-first dialog classes and modal semantics', () => {
    render(<ClearQuestionnaireDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toContain('w-full');
    expect(dialog.className).toContain('sm:rounded-2xl');
  });
});

describe('new draft recovery-code acknowledgement', () => {
  const renderCode = (props = {}) => render(
    <NewDraftRecoveryCodeDialog
      open
      recoveryCode="ABCD-EFGH-JKMP"
      onAcknowledge={vi.fn()}
      {...props}
    />,
  );

  it.each(Object.entries(NEW_DRAFT_EMAIL_MESSAGES))(
    'shows the exact %s delivery message',
    (state, message) => {
      renderCode({ emailDeliveryState: state });
      expect(screen.getByText(message)).toBeVisible();
    },
  );

  it('displays and copies the new code', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true, value: { writeText },
    });
    renderCode();
    expect(screen.getByTestId('new-draft-recovery-code')).toHaveTextContent('ABCD-EFGH-JKMP');
    fireEvent.click(screen.getByRole('button', { name: 'Copy recovery code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCD-EFGH-JKMP'));
  });

  it('requires acknowledgement before closing when a full code is issued', () => {
    const onAcknowledge = vi.fn();
    renderCode({ onAcknowledge });
    const continueButton = screen.getByRole('button', { name: 'Continue to the new questionnaire' });
    expect(continueButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it('masks the email and never requires a full address', () => {
    renderCode({ maskedRecoveryEmail: 'o****@example.com', emailDeliveryState: 'success' });
    expect(screen.getByText(/o\*\*\*\*@example\.com/u)).toBeVisible();
    expect(screen.queryByText('owner@example.com')).not.toBeInTheDocument();
  });

  it('offers one purpose-bound retry only while raw code is in memory', async () => {
    const onRetryEmail = vi.fn(async () => undefined);
    renderCode({ emailDeliveryState: 'failure', onRetryEmail, retryBackoffMs: 0 });
    const retry = screen.getByRole('button', { name: 'Retry email' });
    fireEvent.click(retry);
    await waitFor(() => expect(onRetryEmail).toHaveBeenCalledWith({
      purpose: 'draft_replacement', recoveryCode: 'ABCD-EFGH-JKMP',
    }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry email' })).not.toBeInTheDocument());
  });

  it('does not render retry when raw code is unavailable', () => {
    renderCode({ emailDeliveryState: 'failure', rawCodeAvailable: false, onRetryEmail: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Retry email' })).not.toBeInTheDocument();
  });
});
