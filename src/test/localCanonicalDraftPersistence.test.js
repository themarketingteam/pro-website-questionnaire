import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import reducer, {
  setDraftLocalSaved,
  setResponse,
} from '@/components/store/formSlice';
import {
  createLocalCanonicalDraftPersistence,
  flushLocalCanonicalDraftPersistence,
  getLocalCanonicalPersistenceStatus,
  startLocalCanonicalDraftPersistence,
  stopLocalCanonicalDraftPersistence,
} from '@/components/store/localCanonicalDraftPersistence';
import { deriveQuestionnaireBrowserNamespace } from '@/lib/questionnaireBrowserNamespace';
import { hashCanonicalDraftState } from '@/lib/questionnaireDraftState';
import { selectCanonicalDraftState } from '@/components/store/draftSelectors';

const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'local-persistence-test' });

const createStorage = (mode = 'localstorage') => ({
  getMode: vi.fn(() => mode),
});

const createCache = (mode = 'localstorage') => ({
  saveCanonicalDraftCache: vi.fn(async ({ state }) => ({
    ok: true,
    present: true,
    state,
    envelope: {
      canonicalStateHash: 'a'.repeat(64),
      savedAtClient: '2026-08-05T12:00:00.000Z',
      storageMode: mode,
    },
    written: true,
  })),
});

const createRuntime = (overrides = {}) => {
  const store = configureStore({ reducer: { form: reducer } });
  const storage = overrides.storage || createStorage();
  const cacheAdapter = overrides.cacheAdapter || createCache(storage.getMode());
  const controller = createLocalCanonicalDraftPersistence({
    store,
    namespace,
    storage,
    cacheAdapter,
    debounceMs: 100,
    maxWaitMs: 500,
    ...overrides,
  });
  return { store, storage, cacheAdapter, controller };
};

const activeControllers = [];
const track = (runtime) => {
  activeControllers.push(runtime.controller);
  return runtime;
};

describe('post-reducer local canonical persistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(async () => {
    await Promise.all(activeControllers.splice(0).map((controller) => (
      stopLocalCanonicalDraftPersistence(controller)
    )));
    vi.useRealTimers();
  });

  it('creates one controller and one subscription per store', () => {
    const runtime = track(createRuntime());
    const subscribe = vi.spyOn(runtime.store, 'subscribe');
    const duplicate = createLocalCanonicalDraftPersistence({
      store: runtime.store,
      namespace,
      storage: runtime.storage,
    });
    expect(duplicate).toBe(runtime.controller);
    startLocalCanonicalDraftPersistence(runtime.controller, { scheduleInitial: false });
    startLocalCanonicalDraftPersistence(duplicate, { scheduleInitial: false });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes after reducer changes and saves the complete selected form', async () => {
    const runtime = track(createRuntime());
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Post reducer value' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).toHaveBeenCalledTimes(1);
    expect(runtime.cacheAdapter.saveCanonicalDraftCache.mock.calls[0][0].state.responses['6'])
      .toBe('Post reducer value');
  });

  it('coalesces synchronous reducer changes into one write', async () => {
    const runtime = track(createRuntime());
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'One' }));
    runtime.store.dispatch(setResponse({ questionId: '7', value: 'Two' }));
    runtime.store.dispatch(setResponse({ questionId: '8', value: 'Three' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).toHaveBeenCalledTimes(1);
  });

  it('enforces a 500 ms maximum wait during continuous changes', async () => {
    const runtime = track(createRuntime());
    runtime.controller.start({ scheduleInitial: false });
    for (let index = 0; index < 6; index += 1) {
      runtime.store.dispatch(setResponse({ questionId: '6', value: `Value ${index}` }));
      await vi.advanceTimersByTimeAsync(80);
    }
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(20);
    await runtime.controller.flush();
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).toHaveBeenCalledTimes(1);
  });

  it('flushes pending state immediately', async () => {
    const runtime = track(createRuntime());
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Flush me' }));
    await flushLocalCanonicalDraftPersistence(runtime.controller);
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly and cancels a pending debounce', async () => {
    const runtime = track(createRuntime());
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Do not save' }));
    await runtime.controller.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).not.toHaveBeenCalled();
    expect(runtime.controller.getStatus().active).toBe(false);
  });

  it('skips a state whose hash was supplied by bootstrap', async () => {
    const runtime = track(createRuntime());
    const selected = selectCanonicalDraftState(runtime.store.getState());
    const initialHash = await hashCanonicalDraftState(selected.state);
    runtime.controller.start({ initialHash });
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).not.toHaveBeenCalled();
    expect(runtime.controller.getStatus().skippedUnchanged).toBe(1);
  });

  it('does not save again for local sync-status actions', async () => {
    const runtime = track(createRuntime());
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Stable hash' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    runtime.store.dispatch(setDraftLocalSaved({
      storageMode: 'localstorage',
      lastLocalSavedAt: '2026-08-05T13:00:00.000Z',
      confirmedClientRevision: 0,
    }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).toHaveBeenCalledTimes(1);
  });

  it('reports local_saved only after a successful durable write', async () => {
    const runtime = track(createRuntime());
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Durable' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.store.getState().form.draftSyncStatus).toMatchObject({
      state: 'local_saved',
      storageMode: 'localstorage',
      lastLocalSavedAt: '2026-08-05T12:00:00.000Z',
    });
  });

  it('labels a successful memory-only write as page-lifetime state', async () => {
    const storage = createStorage('memory_only');
    const runtime = track(createRuntime({ storage, cacheAdapter: createCache('memory_only') }));
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Memory only' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.store.getState().form.draftSyncStatus.state).toBe('offline_local_only');
    expect(runtime.controller.getStatus().storageMode).toBe('memory_only');
  });

  it('preserves the prior saved hash and reports a typed cache error', async () => {
    const cacheAdapter = createCache();
    cacheAdapter.saveCanonicalDraftCache.mockResolvedValue({
      ok: false,
      errorCode: 'CANONICAL_CACHE_WRITE_FAILED',
    });
    const runtime = track(createRuntime({ cacheAdapter }));
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Failed write' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.controller.getStatus()).toMatchObject({
      lastSavedHash: null,
      lastErrorCode: 'CANONICAL_CACHE_WRITE_FAILED',
      writes: 0,
    });
    expect(runtime.store.getState().form.draftSyncStatus.state).toBe('error');
  });

  it('does not call the cache when the complete selector is invalid', async () => {
    const runtime = track(createRuntime({
      selector: () => ({ ok: false, state: null, errorCode: 'INVALID_FIELD' }),
    }));
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Invalid projection' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.cacheAdapter.saveCanonicalDraftCache).not.toHaveBeenCalled();
    expect(runtime.store.getState().form.draftSyncStatus.errorCode).toBe('INVALID_FIELD');
  });

  it('never increments client or server revisions for local persistence status', async () => {
    const runtime = track(createRuntime());
    const before = runtime.store.getState().form.draftContext;
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'No revision side effect' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    expect(runtime.store.getState().form.draftContext).toMatchObject({
      clientRevision: before.clientRevision,
      serverRevision: before.serverRevision,
    });
  });

  it('exposes only safe operational status', async () => {
    const runtime = track(createRuntime());
    runtime.controller.start({ scheduleInitial: false });
    runtime.store.dispatch(setResponse({ questionId: '6', value: 'Private answer' }));
    await vi.advanceTimersByTimeAsync(100);
    await runtime.controller.flush();
    const status = getLocalCanonicalPersistenceStatus(runtime.controller);
    expect(status).toMatchObject({ active: true, writes: 1, storageMode: 'localstorage' });
    expect(JSON.stringify(status)).not.toContain('Private answer');
  });
});
