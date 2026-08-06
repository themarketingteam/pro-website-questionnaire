import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import formReducer, {
  loadCanonicalDraftState,
  patchDraftContext,
} from '@/components/store/formSlice';
import { QuestionnairePersistenceProvider } from '@/components/store/QuestionnairePersistenceContext';
import { ProDraftSyncProvider } from '@/contexts/ProDraftSyncContext';
import { useProDraftSync } from '@/hooks/useProDraftSync';
import { createEmptyCanonicalDraftState } from '@/lib/questionnaireDraftState';

const namespace = `ns_${'s'.repeat(32)}`;
const runtimeConfig = Object.freeze({
  environment: 'staging',
  durableDraftV2Enabled: true,
});

const createManager = () => {
  const status = Object.freeze({
    state: 'server_saved',
    active: true,
    online: true,
    lastServerSavedAt: '2026-08-06T12:00:00.000Z',
    isReadOnly: false,
    hasConflict: false,
  });
  return {
    start: vi.fn(() => status),
    dispose: vi.fn(async () => ({ ...status, disposed: true })),
    getStatus: vi.fn(() => ({ ...status, state: 'idle', active: false })),
    subscribeStatus: vi.fn(() => vi.fn()),
    scheduleSave: vi.fn(() => status),
    saveImmediately: vi.fn(async () => status),
    flush: vi.fn(async () => status),
    queueEvent: vi.fn(() => true),
    markSubmitAttempted: vi.fn(async () => status),
    markSubmitFailed: vi.fn(async () => status),
    markSubmitted: vi.fn(async () => status),
  };
};

const renderProvider = ({
  enabled = true,
  strict = true,
  managerFactoryOverride = null,
} = {}) => {
  const store = configureStore({ reducer: { form: formReducer } });
  store.dispatch(loadCanonicalDraftState({
    ...createEmptyCanonicalDraftState(),
    draftId: 'draft-context-synthetic-1',
    sessionId: 'session-context-synthetic-1',
  }, {
    source: 'server',
    completedAt: '2026-08-06T12:00:00.000Z',
    namespace,
    storageMode: 'indexeddb',
  }));
  const manager = createManager();
  const managerFactory = vi.fn((options) => (
    managerFactoryOverride?.(options) || manager
  ));
  const persistence = {
    namespace,
    storage: { getMode: () => 'indexeddb' },
    localPersistence: { flush: vi.fn() },
    canonicalCacheAdapter: { save: vi.fn() },
  };
  const Consumer = () => {
    const sync = useProDraftSync();
    return (
      <div>
        <output>{sync.syncStatus.state}</output>
        <button type="button" onClick={() => sync.scheduleSave('autosave')}>schedule</button>
        <button type="button" onClick={() => sync.queueEvent({ eventType: 'answer_changed' })}>event</button>
        <span data-testid="safe-surface">{Object.keys(sync).sort().join(',')}</span>
      </div>
    );
  };
  const content = (
    <Provider store={store}>
      <QuestionnairePersistenceProvider value={persistence}>
        <ProDraftSyncProvider
          enabled={enabled}
          runtimeConfig={runtimeConfig}
          managerFactory={managerFactory}
          credentialVault={{ loadDraftCredentialBundle: vi.fn() }}
        >
          <Consumer />
        </ProDraftSyncProvider>
      </QuestionnairePersistenceProvider>
    </Provider>
  );
  return {
    ...render(strict ? <StrictMode>{content}</StrictMode> : content),
    manager,
    managerFactory,
    store,
  };
};

afterEach(() => vi.useRealTimers());

describe('ProDraftSyncProvider', () => {
  it('owns one manager under Strict Mode and exposes only the safe sync facade', async () => {
    const view = renderProvider();

    await waitFor(() => expect(view.manager.start).toHaveBeenCalled());
    expect(view.managerFactory).toHaveBeenCalledOnce();
    expect(screen.getByText('server_saved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'event' }));
    expect(view.manager.scheduleSave).toHaveBeenCalledWith('autosave');
    expect(view.manager.queueEvent).toHaveBeenCalledWith({ eventType: 'answer_changed' });

    const surface = screen.getByTestId('safe-surface').textContent;
    expect(surface).not.toMatch(/token|credential|manager/iu);
    expect(surface).toContain('syncStatus');

    vi.useFakeTimers();
    view.unmount();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(view.manager.dispose).toHaveBeenCalledOnce();
  });

  it('does not construct or start the V2 writer while the gate is disabled', () => {
    const view = renderProvider({ enabled: false, strict: false });
    expect(view.managerFactory).not.toHaveBeenCalled();
    expect(view.manager.start).not.toHaveBeenCalled();
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('disposes the prior manager when the authoritative draft identity changes', async () => {
    const first = createManager();
    const second = createManager();
    const managers = [first, second];
    const view = renderProvider({
      strict: false,
      managerFactoryOverride: () => managers.shift(),
    });
    await waitFor(() => expect(first.start).toHaveBeenCalledOnce());

    act(() => {
      view.store.dispatch(patchDraftContext({ draftId: 'draft-context-synthetic-2' }));
    });

    await waitFor(() => expect(second.start).toHaveBeenCalledOnce());
    await waitFor(() => expect(first.dispose).toHaveBeenCalledOnce());
    expect(view.managerFactory).toHaveBeenCalledTimes(2);
  });
});
