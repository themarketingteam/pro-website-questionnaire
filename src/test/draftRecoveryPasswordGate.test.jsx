import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { base44 } from '@/api/base44Client';
import DraftRecoveryPasswordGate, { useDraftRecoveryAccess } from '@/components/admin/DraftRecoveryPasswordGate';

const STORAGE_KEY = 'pro_draft_recovery_access_v1';

beforeEach(() => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage
  });
});

const renderGate = () => render(
  <DraftRecoveryPasswordGate>
    <div>Protected draft recovery</div>
  </DraftRecoveryPasswordGate>
);

const ProtectedGrant = () => {
  const { recoveryGrant } = useDraftRecoveryAccess();
  return <div>Recovery grant: {recoveryGrant}</div>;
};

describe('DraftRecoveryPasswordGate', () => {
  it('does not mount protected content before password verification', async () => {
    const { container } = renderGate();

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kaseya MSP Success' })).toHaveAttribute('width', '411');
    expect(container.querySelector('main')).toHaveClass('draft-recovery-brand', 'draft-recovery-gate');
    expect(screen.getByRole('button', { name: 'Unlock admin workspace' })).toHaveClass('brand-button-primary');
    expect(screen.queryByText('Protected draft recovery')).not.toBeInTheDocument();
  });

  it('stores a seven-day grant and unlocks after a valid password', async () => {
    const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000);
    base44.functions.invoke.mockResolvedValueOnce({
      data: { authorized: true, token: 'signed-grant', expiresAt }
    });

    renderGate();
    fireEvent.change(await screen.findByLabelText('Password'), {
      target: { value: 'correct horse battery staple' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock admin workspace' }));

    expect(await screen.findByText('Protected draft recovery')).toBeInTheDocument();
    expect(base44.functions.invoke).toHaveBeenCalledWith('verifyDraftRecoveryAccess', {
      password: 'correct horse battery staple'
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({
      token: 'signed-grant',
      expiresAt
    });
  });

  it('shows a generic error and remains locked after an invalid password', async () => {
    base44.functions.invoke.mockRejectedValueOnce({
      response: { data: { error: 'Incorrect password.' } }
    });

    renderGate();
    fireEvent.change(await screen.findByLabelText('Password'), {
      target: { value: 'wrong-password' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock admin workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.');
    expect(screen.queryByText('Protected draft recovery')).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('revalidates a saved grant before unlocking', async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: 'saved-grant', expiresAt }));
    base44.functions.invoke.mockResolvedValueOnce({
      data: { authorized: true, expiresAt }
    });

    renderGate();

    expect(await screen.findByText('Protected draft recovery')).toBeInTheDocument();
    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith('verifyDraftRecoveryAccess', {
        token: 'saved-grant'
      });
    });
  });

  it('provides the verified grant to public recovery actions', async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: 'saved-grant', expiresAt }));
    base44.functions.invoke.mockResolvedValueOnce({
      data: { authorized: true, expiresAt }
    });

    render(
      <DraftRecoveryPasswordGate>
        <ProtectedGrant />
      </DraftRecoveryPasswordGate>
    );

    expect(await screen.findByText('Recovery grant: saved-grant')).toBeInTheDocument();
  });

  it('reuses one verified grant across different admin pages', async () => {
    const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000);
    base44.functions.invoke.mockResolvedValueOnce({
      data: { authorized: true, token: 'shared-admin-grant', expiresAt }
    });

    const firstPage = render(
      <DraftRecoveryPasswordGate>
        <div>Submit Intake Admin Page</div>
      </DraftRecoveryPasswordGate>
    );

    fireEvent.change(await screen.findByLabelText('Password'), {
      target: { value: 'shared-admin-password' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock admin workspace' }));
    expect(await screen.findByText('Submit Intake Admin Page')).toBeInTheDocument();
    firstPage.unmount();

    base44.functions.invoke.mockResolvedValueOnce({
      data: { authorized: true, expiresAt }
    });

    render(
      <DraftRecoveryPasswordGate>
        <div>Draft Recovery Admin Page</div>
      </DraftRecoveryPasswordGate>
    );

    expect(await screen.findByText('Draft Recovery Admin Page')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(base44.functions.invoke).toHaveBeenLastCalledWith('verifyDraftRecoveryAccess', {
      token: 'shared-admin-grant'
    });
  });
});
