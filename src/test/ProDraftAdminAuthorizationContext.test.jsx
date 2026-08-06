import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProDraftAdminAuthorizationProvider } from '@/contexts/ProDraftAdminAuthorizationContext';
import { useProDraftAdminAuthorization } from '@/hooks/useProDraftAdminAuthorization';

const state = (status) => ({
  status, authorized: status === 'authorized', locked: status === 'locked',
  requestId: null, retryAfterSeconds: 0, storageMode: 'memory_only', storageNotice: 'session',
});

function Probe({ capture }) {
  const value = useProDraftAdminAuthorization();
  capture.current = value;
  return <div data-testid="state">{JSON.stringify(value.authorizationState)}</div>;
}

const client = (overrides = {}) => ({
  validateStoredAdminRecoveryGrant: vi.fn(async () => state('password_required')),
  authorizeWithRecoveryPassword: vi.fn(async () => state('authorized')),
  forgetAdminRecoveryDevice: vi.fn(async () => state('password_required')),
  getGrantForAuthorizedRequest: vi.fn(async () => 'synthetic.raw-grant'),
  ...overrides,
});

describe('ProDraftAdminAuthorizationContext', () => {
  it('restores a stored grant on mount without exposing it in state', async () => {
    const subject = client({ validateStoredAdminRecoveryGrant: vi.fn(async () => state('authorized')) });
    const capture = { current: null };
    render(<ProDraftAdminAuthorizationProvider client={subject}>
      <Probe capture={capture} />
    </ProDraftAdminAuthorizationProvider>);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('authorized'));
    expect(subject.validateStoredAdminRecoveryGrant).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('state').textContent).not.toContain('raw-grant');
  });

  it('is Strict Mode safe while restore validation is in flight', async () => {
    let resolveValidation;
    const pending = new Promise((resolve) => { resolveValidation = resolve; });
    const subject = client({ validateStoredAdminRecoveryGrant: vi.fn(() => pending) });
    const capture = { current: null };
    render(<StrictMode><ProDraftAdminAuthorizationProvider client={subject}>
      <Probe capture={capture} />
    </ProDraftAdminAuthorizationProvider></StrictMode>);
    expect(subject.validateStoredAdminRecoveryGrant).toHaveBeenCalledTimes(1);
    await act(async () => resolveValidation(state('password_required')));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('password_required'));
  });

  it('deduplicates concurrent password attempts', async () => {
    let resolveAttempt;
    const pending = new Promise((resolve) => { resolveAttempt = resolve; });
    const subject = client({ authorizeWithRecoveryPassword: vi.fn(() => pending) });
    const capture = { current: null };
    render(<ProDraftAdminAuthorizationProvider client={subject}>
      <Probe capture={capture} />
    </ProDraftAdminAuthorizationProvider>);
    await waitFor(() => expect(capture.current.authorizationState.status).toBe('password_required'));
    let first;
    let second;
    act(() => {
      first = capture.current.authorizeWithPassword('synthetic');
      second = capture.current.authorizeWithPassword('synthetic');
    });
    expect(subject.authorizeWithRecoveryPassword).toHaveBeenCalledTimes(1);
    await act(async () => resolveAttempt(state('authorized')));
    await expect(Promise.all([first, second])).resolves.toEqual([
      state('authorized'), state('authorized'),
    ]);
  });

  it('guards the narrow raw grant accessor by authorized state', async () => {
    const subject = client();
    const capture = { current: null };
    render(<ProDraftAdminAuthorizationProvider client={subject}>
      <Probe capture={capture} />
    </ProDraftAdminAuthorizationProvider>);
    await waitFor(() => expect(capture.current.authorizationState.status).toBe('password_required'));
    await expect(capture.current.getAdminGrantForAuthorizedRequest()).resolves.toBeNull();
    await act(async () => capture.current.authorizeWithPassword('synthetic'));
    await expect(capture.current.getAdminGrantForAuthorizedRequest())
      .resolves.toBe('synthetic.raw-grant');
  });

  it('forgets the device and returns to password-required state', async () => {
    const subject = client({ validateStoredAdminRecoveryGrant: vi.fn(async () => state('authorized')) });
    const capture = { current: null };
    render(<ProDraftAdminAuthorizationProvider client={subject}>
      <Probe capture={capture} />
    </ProDraftAdminAuthorizationProvider>);
    await waitFor(() => expect(capture.current.authorizationState.status).toBe('authorized'));
    await act(async () => capture.current.forgetThisDevice());
    expect(subject.forgetAdminRecoveryDevice).toHaveBeenCalledTimes(1);
    expect(capture.current.authorizationState.status).toBe('password_required');
  });

  it('warns through the registered shell handler and returns to the gate after grant rejection', async () => {
    const subject = client({ validateStoredAdminRecoveryGrant: vi.fn(async () => state('authorized')) });
    const capture = { current: null };
    const invalidation = vi.fn(async () => {});
    render(<ProDraftAdminAuthorizationProvider client={subject}><Probe capture={capture} /></ProDraftAdminAuthorizationProvider>);
    await waitFor(() => expect(capture.current.authorizationState.status).toBe('authorized'));
    act(() => capture.current.registerAuthorizationInvalidationHandler(invalidation));
    await act(async () => capture.current.handleAdminGrantRejected());
    expect(invalidation).toHaveBeenCalledOnce();
    expect(capture.current.authorizationState.status).toBe('password_required');
    expect(capture.current.authorizationState.authorized).toBe(false);
  });
});
