import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ProDraftRecoveryPanel from '@/components/pro-form/ProDraftRecoveryPanel';
import { ProDraftCredentialProvider } from '@/contexts/ProDraftCredentialContext';
import { QuestionnairePersistenceProvider } from '@/components/store/QuestionnairePersistenceContext';

const form = {
  credentials: { recoveryEmail: 'isaac@example.com' },
  draftContext: { draftStatus: 'active' },
  draftSyncStatus: {
    state: 'restored',
    lastLocalSavedAt: '2026-08-06T12:00:00.000Z',
    lastServerSavedAt: '2026-08-06T11:59:00.000Z',
  },
};

const renderPanel = ({ code = null, hint = 'JKMN', variant = 'primary', state = form } = {}) => {
  const coordinator = {
    getRecoveryCodeForDisplay: () => code,
    getRecoveryCodeHint: () => hint,
    getCredentialStorageMode: () => 'indexeddb',
  };
  const store = configureStore({ reducer: () => ({ form: state }) });
  return render(
    <Provider store={store}>
      <QuestionnairePersistenceProvider value={{ storageMode: 'indexeddb' }}>
        <ProDraftCredentialProvider coordinator={coordinator}>
          <MemoryRouter>
            <header data-testid="site-header">Site header</header>
            <ProDraftRecoveryPanel variant={variant} />
          </MemoryRouter>
        </ProDraftCredentialProvider>
      </QuestionnairePersistenceProvider>
    </Provider>,
  );
};

describe('ProDraftRecoveryPanel', () => {
  it('shows a masked email, hint-only state, status, and save times', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Draft recovery' })).toBeVisible();
    expect(screen.getByText('i***@example.com')).toBeVisible();
    expect(screen.queryByText('isaac@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('JKMN')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Copy recovery code' })).not.toBeInTheDocument();
    expect(screen.getByText('Active — editable')).toBeVisible();
  });

  it('shows and copies the full code only when the credential vault has it', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderPanel({ code: '2345-6789-ABCD-EFGH-JKMN' });
    await userEvent.click(screen.getByRole('button', { name: 'Copy recovery code' }));
    expect(writeText).toHaveBeenCalledWith('2345-6789-ABCD-EFGH-JKMN');
    expect(screen.getByRole('status')).toHaveTextContent('Recovery code copied');
  });

  it('keeps recovery information outside the site header', () => {
    renderPanel();
    expect(screen.getByTestId('site-header')).not.toHaveTextContent('Draft recovery');
    expect(screen.getByTestId('pro-draft-recovery-panel')).toHaveTextContent('Draft recovery');
  });

  it('renders a compact mobile-accessible footer disclosure without duplicating the code', async () => {
    renderPanel({ code: '2345-6789-ABCD-EFGH-JKMN', variant: 'footer' });
    const disclosure = screen.getByText('Draft recovery information');
    expect(disclosure).toBeVisible();
    await userEvent.click(disclosure);
    expect(screen.getByRole('link', { name: 'Open draft recovery page' })).toHaveAttribute(
      'href', '/recover-draft',
    );
    expect(document.body).not.toHaveTextContent('2345-6789-ABCD-EFGH-JKMN');
  });

  it('shows submitted state as read-only', () => {
    renderPanel({ state: {
      ...form,
      draftContext: { draftStatus: 'submitted' },
      draftSyncStatus: { ...form.draftSyncStatus, state: 'submitted' },
    } });
    expect(screen.getByText('Submitted — read-only')).toBeVisible();
  });
});
