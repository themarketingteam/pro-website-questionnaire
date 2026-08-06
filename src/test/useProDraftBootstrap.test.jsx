import React, { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProDraftBootstrap } from '@/hooks/useProDraftBootstrap';
import {
  ProDraftCredentialProvider,
  useProDraftCredentials,
} from '@/contexts/ProDraftCredentialContext';

const state = (overrides = {}) => ({
  phase: 'idle',
  outcome: null,
  errorCode: null,
  clientChoiceRequired: false,
  readOnly: false,
  hasRecoveryCode: false,
  memoryOnly: false,
  storageMode: 'unknown',
  ...overrides,
});

const mockCoordinator = (overrides = {}) => {
  let current = state();
  const listeners = new Set();
  const coordinator = {
    bootstrap: vi.fn(async () => {
      current = state({ phase: 'awaiting_client_choice', clientChoiceRequired: true });
      for (const listener of listeners) listener(current);
      return current;
    }),
    getState: vi.fn(() => current),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    cancel: vi.fn(),
    createNewDraftAssociation: vi.fn(),
    recoverDraftByEmail: vi.fn(),
    recoverDraftByCode: vi.fn(),
    getRecoveryCodeForDisplay: vi.fn(() => '2345-6789-ABCD-EFGH-JKMN'),
    getRecoveryCodeHint: vi.fn(() => 'JKMN'),
    getCredentialStorageMode: vi.fn(() => 'memory_only'),
    clearCurrentDraftCredentials: vi.fn(async () => ({ ok: true })),
    replaceCurrentDraftCredentials: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  return coordinator;
};

const HookConsumer = ({ options, onValue }) => {
  const value = useProDraftBootstrap(options);
  onValue?.(value);
  return <div data-testid="phase">{value.phase}</div>;
};

describe('useProDraftBootstrap', () => {
  it('deduplicates Strict Mode bootstrap for one questionnaire store', async () => {
    const coordinator = mockCoordinator();
    const store = { dispatch: vi.fn() };
    render(
      <StrictMode>
        <HookConsumer options={{ coordinator, store }} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent(
      'awaiting_client_choice',
    ));
    expect(coordinator.bootstrap).toHaveBeenCalledOnce();
  });

  it('exposes only safe state plus narrow recovery-code getters', async () => {
    const coordinator = mockCoordinator();
    let hookValue;
    render(<HookConsumer
      options={{ coordinator, store: { dispatch: vi.fn() } }}
      onValue={(value) => { hookValue = value; }}
    />);
    await waitFor(() => expect(hookValue.phase).toBe('awaiting_client_choice'));
    expect(hookValue.getRecoveryCodeForDisplay()).toBe('2345-6789-ABCD-EFGH-JKMN');
    expect(hookValue).not.toHaveProperty('resumeToken');
    expect(hookValue).not.toHaveProperty('recoverySessionToken');
    expect(hookValue).not.toHaveProperty('credentialBundle');
  });

  it('cancels after final unmount and does not update the component afterward', async () => {
    vi.useFakeTimers();
    let release;
    const coordinator = mockCoordinator({
      bootstrap: vi.fn(() => new Promise((resolve) => { release = resolve; })),
    });
    const rendered = render(<HookConsumer
      options={{ coordinator, store: { dispatch: vi.fn() } }}
    />);
    rendered.unmount();
    act(() => { vi.runAllTimers(); });
    expect(coordinator.cancel).toHaveBeenCalledOnce();
    await act(async () => {
      release(state({ phase: 'ready', outcome: 'empty_usable_fallback' }));
      await Promise.resolve();
    });
  });
});

const CredentialConsumer = ({ onValue }) => {
  const value = useProDraftCredentials();
  onValue(value);
  return <div>{value.hasFullRecoveryCode() ? 'available' : 'missing'}</div>;
};

describe('ProDraftCredentialContext', () => {
  it('exposes only the approved narrow capability surface', () => {
    const coordinator = mockCoordinator();
    let value;
    render(
      <ProDraftCredentialProvider coordinator={coordinator}>
        <CredentialConsumer onValue={(next) => { value = next; }} />
      </ProDraftCredentialProvider>,
    );
    expect(screen.getByText('available')).toBeInTheDocument();
    expect(Object.keys(value).sort()).toEqual([
      'clearCurrentDraftCredentials',
      'getCredentialStorageMode',
      'getRecoveryCodeForDisplay',
      'getRecoveryCodeHint',
      'hasFullRecoveryCode',
      'replaceCurrentDraftCredentials',
    ]);
    expect(value).not.toHaveProperty('resumeToken');
    expect(value).not.toHaveProperty('recoverySessionToken');
    expect(value).not.toHaveProperty('bundle');
  });

  it('delegates clear and replacement without serializing credentials', async () => {
    const coordinator = mockCoordinator();
    let value;
    render(
      <ProDraftCredentialProvider coordinator={coordinator}>
        <CredentialConsumer onValue={(next) => { value = next; }} />
      </ProDraftCredentialProvider>,
    );
    await value.clearCurrentDraftCredentials();
    await value.replaceCurrentDraftCredentials({ synthetic: true });
    expect(coordinator.clearCurrentDraftCredentials).toHaveBeenCalledOnce();
    expect(coordinator.replaceCurrentDraftCredentials).toHaveBeenCalledWith(
      { synthetic: true },
      undefined,
    );
  });
});
