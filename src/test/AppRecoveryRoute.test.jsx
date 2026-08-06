import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const navigateToLogin = vi.fn();

vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    isLoadingAuth: false,
    isLoadingPublicSettings: false,
    authError: { type: 'auth_required' },
    navigateToLogin,
  }),
}));

vi.mock('@/pages/ProDraftRecovery', () => ({
  default: () => <main>Public recovery route fixture</main>,
}));

vi.mock('@/pages.config', () => ({
  pagesConfig: {
    Pages: { Home: () => <main>Home fixture</main> },
    Layout: ({ children }) => <>{children}</>,
    mainPage: 'Home',
  },
}));

vi.mock('@/api/base44Client', () => ({
  base44ClientInitialization: { success: true },
}));

import { AuthenticatedApp } from '@/App';

describe('public recovery route', () => {
  it('loads /recover-draft directly even when client authentication is required', () => {
    render(
      <MemoryRouter initialEntries={['/recover-draft']}>
        <AuthenticatedApp />
      </MemoryRouter>,
    );
    expect(screen.getByText('Public recovery route fixture')).toBeVisible();
    expect(navigateToLogin).not.toHaveBeenCalled();
  });
});
