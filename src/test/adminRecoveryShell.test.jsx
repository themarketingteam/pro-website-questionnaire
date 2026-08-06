import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import ProDraftAdminRecoveryShell from '@/components/admin/ProDraftAdminRecoveryShell';

const authorization = vi.hoisted(() => ({
  authorizationState: { authorized: true, status: 'authorized', storageMode: 'persistent' },
  getAdminGrantForAuthorizedRequest: vi.fn(async () => 'not-rendered-grant'),
  handleAdminGrantRejected: vi.fn(), registerAuthorizationInvalidationHandler: vi.fn(() => vi.fn()),
  forgetThisDevice: vi.fn(async () => {}),
}));
vi.mock('@/hooks/useProDraftAdminAuthorization', () => ({ useProDraftAdminAuthorization: () => authorization }));

const renderShell = () => render(<QueryClientProvider client={new QueryClient()}><ProDraftAdminRecoveryShell><div>Authorized recovery content</div></ProDraftAdminRecoveryShell></QueryClientProvider>);

describe('ProDraftAdminRecoveryShell', () => {
  it('shows authorization and environment without exposing the grant', () => {
    const view = renderShell();
    expect(screen.getByText('Draft Recovery authorized')).toBeInTheDocument();
    expect(screen.getByTestId('admin-environment')).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent('not-rendered-grant');
    expect(authorization.registerAuthorizationInvalidationHandler).toHaveBeenCalled();
  });

  it('confirms Forget this device and invokes the authorization lifecycle', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Forget this device' }));
    expect(await screen.findByText('Remove Draft Recovery Access from This Device?')).toBeInTheDocument();
    expect(screen.getByText('You will need to enter the recovery access password the next time you open Draft Recovery on this browser.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Forget this device' }).at(-1));
    await waitFor(() => expect(authorization.forgetThisDevice).toHaveBeenCalled());
  });
});
