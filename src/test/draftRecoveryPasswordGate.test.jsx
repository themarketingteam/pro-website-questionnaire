import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DraftRecoveryPasswordGate, { MEMORY_NOTICE, PERSISTENT_NOTICE } from '@/components/admin/DraftRecoveryPasswordGate';

const hookValue = vi.hoisted(() => ({ current: null }));
vi.mock('@/hooks/useProDraftAdminAuthorization', () => ({
  useProDraftAdminAuthorization: () => hookValue.current,
}));

const state = (status, overrides = {}) => ({
  status, authorized: status === 'authorized', locked: status === 'locked',
  retryAfterSeconds: 0, storageMode: 'persistent', ...overrides,
});

function renderGate(authorizationState, authorizeWithPassword = vi.fn()) {
  hookValue.current = { authorizationState, authorizeWithPassword };
  return { authorizeWithPassword, ...render(<DraftRecoveryPasswordGate><div>Protected draft recovery</div></DraftRecoveryPasswordGate>) };
}

describe('DraftRecoveryPasswordGate', () => {
  it('waits for stored-grant validation before mounting protected content', () => {
    renderGate(state('loading'));
    expect(screen.getByText(/Loading stored Draft Recovery access/)).toBeInTheDocument();
    expect(screen.queryByText('Protected draft recovery')).not.toBeInTheDocument();
  });

  it('bypasses password entry for a stored authorized grant without rendering it', () => {
    const view = renderGate(state('authorized'));
    expect(screen.getByText('Protected draft recovery')).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent('synthetic-grant');
  });

  it('submits the password once, clears the input, and uses the required copy', async () => {
    const authorizeWithPassword = vi.fn(async () => state('authorized'));
    renderGate(state('password_required'), authorizeWithPassword);
    expect(screen.getByText(PERSISTENT_NOTICE)).toBeInTheDocument();
    const input = screen.getByLabelText('Recovery access password');
    fireEvent.change(input, { target: { value: 'synthetic-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Draft Recovery' }));
    await waitFor(() => expect(authorizeWithPassword).toHaveBeenCalledOnce());
    expect(authorizeWithPassword).toHaveBeenCalledWith('synthetic-password');
    expect(input).toHaveValue('');
  });

  it('uses generic wrong-password wording', async () => {
    renderGate(state('password_required'), vi.fn(async () => state('password_required')));
    fireEvent.change(screen.getByLabelText('Recovery access password'), { target: { value: 'wrong' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Unlock Draft Recovery' }).closest('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Draft Recovery access could not be verified');
    expect(screen.getByRole('alert')).not.toHaveTextContent('wrong');
  });

  it.each(['locked', 'rate_limited'])('shows retry-after and disables repeat submit for %s', (status) => {
    renderGate(state(status, { retryAfterSeconds: 42 }));
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 42 seconds');
    expect(screen.getByRole('button', { name: 'Unlock Draft Recovery' })).toBeDisabled();
  });

  it('truthfully identifies memory-only authorization', () => {
    renderGate(state('password_required', { storageMode: 'memory_only' }));
    expect(screen.getByText(MEMORY_NOTICE)).toBeInTheDocument();
  });
});
