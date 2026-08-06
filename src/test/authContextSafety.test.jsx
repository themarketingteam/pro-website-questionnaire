import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

const AuthState = () => {
  const state = useAuth();
  return <output data-testid="auth-state">{JSON.stringify({
    authError: state.authError,
    isAuthenticated: state.isAuthenticated,
    isLoadingAuth: state.isLoadingAuth,
    isLoadingPublicSettings: state.isLoadingPublicSettings,
  })}</output>;
};

const renderProvider = ({
  appParamsValue = {
    appId: 'synthetic-app',
    serverUrl: 'https://backend.example.test',
    token: null,
  },
  base44Client = { auth: { me: vi.fn() } },
  get = vi.fn(async () => ({ id: 'synthetic-app', public_settings: {} })),
  requestTimeoutMs = 20,
} = {}) => render(
  <AuthProvider
    appParamsValue={appParamsValue}
    base44Client={base44Client}
    publicSettingsClientFactory={() => ({ get })}
    requestTimeoutMs={requestTimeoutMs}
  >
    <AuthState />
  </AuthProvider>,
);

const readState = () => JSON.parse(screen.getByTestId('auth-state').textContent);

describe('bounded authentication bootstrap', () => {
  it('sanitizes public-settings failures and exits both loading states', async () => {
    renderProvider({
      get: vi.fn(async () => {
        throw new Error('raw synthetic-secret-token backend failure');
      }),
    });

    await waitFor(() => expect(readState().isLoadingPublicSettings).toBe(false));
    const state = readState();
    expect(state.isLoadingAuth).toBe(false);
    expect(state.authError).toEqual({
      type: 'public_settings_unavailable',
      message: 'Public questionnaire settings are temporarily unavailable',
    });
    expect(JSON.stringify(state)).not.toContain('synthetic-secret-token');
  });

  it('bounds a public-settings request that never settles', async () => {
    renderProvider({ get: vi.fn(() => new Promise(() => {})) });

    await waitFor(() => expect(readState().authError?.type).toBe('public_settings_timeout'));
    expect(readState()).toMatchObject({
      isAuthenticated: false,
      isLoadingAuth: false,
      isLoadingPublicSettings: false,
    });
  });

  it('does not turn an unknown public 403 into a login requirement', async () => {
    renderProvider({
      get: vi.fn(async () => {
        throw Object.assign(new Error('Synthetic public denial'), {
          status: 403,
          data: { extra_data: { reason: 'synthetic_unknown_reason' } },
        });
      }),
    });

    await waitFor(() => expect(readState().isLoadingPublicSettings).toBe(false));
    expect(readState().authError?.type).toBe('public_settings_unavailable');
  });

  it('bounds the user request and keeps the public questionnaire available', async () => {
    renderProvider({
      appParamsValue: {
        appId: 'synthetic-app',
        serverUrl: 'https://backend.example.test',
        token: 'synthetic-token',
      },
      base44Client: { auth: { me: vi.fn(() => new Promise(() => {})) } },
    });

    await waitFor(() => expect(readState().authError?.type).toBe('auth_timeout'));
    expect(readState()).toMatchObject({
      isAuthenticated: false,
      isLoadingAuth: false,
      isLoadingPublicSettings: false,
    });
  });

  it('preserves login-required behavior for an authenticated-user 401', async () => {
    renderProvider({
      appParamsValue: {
        appId: 'synthetic-app',
        serverUrl: 'https://backend.example.test',
        token: 'synthetic-token',
      },
      base44Client: {
        auth: {
          me: vi.fn(async () => {
            throw Object.assign(new Error('Synthetic auth denial'), { status: 401 });
          }),
        },
      },
    });

    await waitFor(() => expect(readState().isLoadingAuth).toBe(false));
    expect(readState().authError).toEqual({
      type: 'auth_required',
      message: 'Authentication required',
    });
  });

  it('leaves unauthenticated public access open after settings load', async () => {
    const base44Client = { auth: { me: vi.fn() } };
    renderProvider({ base44Client });

    await waitFor(() => expect(readState().isLoadingPublicSettings).toBe(false));
    expect(readState()).toMatchObject({
      authError: null,
      isAuthenticated: false,
      isLoadingAuth: false,
      isLoadingPublicSettings: false,
    });
    expect(base44Client.auth.me).not.toHaveBeenCalled();
  });
});
