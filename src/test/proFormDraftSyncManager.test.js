import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import formReducer, {
  loadCanonicalDraftState,
  setResponse,
} from '@/components/store/formSlice';
import {
  createEmptyCanonicalDraftState,
  hashCanonicalDraftState,
} from '@/lib/questionnaireDraftState';
import {
  DEFAULT_DRAFT_SYNC_DEBOUNCE_MS,
  DEFAULT_DRAFT_SYNC_MAX_RETRIES,
  DEFAULT_DRAFT_SYNC_MAX_WAIT_MS,
  DEFAULT_DRAFT_SYNC_RETRY_BASE_MS,
  DEFAULT_DRAFT_SYNC_RETRY_MAX_MS,
  DRAFT_SYNC_ERROR_CODES,
  DRAFT_SYNC_MANAGER_STATES,
  createProFormDraftSyncManager,
  getSafeDraftSyncDiagnostics,
} from '@/lib/proFormDraftSyncManager';

const NOW = '2026-08-06T12:00:00.000Z';
const NAMESPACE = `ns_${'a'.repeat(32)}`;
const DRAFT_ID = 'draft-synthetic-1';
const SESSION_ID = 'session-synthetic-1';
const TOKEN = String.fromCharCode(82).repeat(43);

const managers = [];

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const canonicalState = (overrides = {}) => ({
  ...createEmptyCanonicalDraftState(),
  draftId: DRAFT_ID,
  sessionId: SESSION_ID,
  savedAtClient: NOW,
  ...overrides,
});

const createLifecycleHarness = () => {
  const windowListeners = new Map();
  const documentListeners = new Map();
  return {
    windowListeners,
    documentListeners,
    adapter: {
      addWindowListener: vi.fn((type, listener) => windowListeners.set(type, listener)),
      removeWindowListener: vi.fn((type) => windowListeners.delete(type)),
      addDocumentListener: vi.fn((type, listener) => documentListeners.set(type, listener)),
      removeDocumentListener: vi.fn((type) => documentListeners.delete(type)),
    },
  };
};

const acceptedResponse = async (request, overrides = {}) => ({
  success: true,
  idempotent: false,
  acceptedClientRevision: request.canonicalState.clientRevision,
  acceptedServerRevision: request.expectedServerRevision + 1,
  acceptedStatus: request.canonicalState.draftStatus,
  stateHash: await hashCanonicalDraftState(request.canonicalState),
  draft: {
    draftId: request.draftId,
    lastSavedAt: NOW,
  },
  ...overrides,
});

const createHarness = (options = {}) => {
  const store = configureStore({ reducer: { form: formReducer } });
  store.dispatch(loadCanonicalDraftState(
    canonicalState(options.canonicalState),
    {
      source: 'server',
      completedAt: NOW,
      namespace: NAMESPACE,
      storageMode: options.storageMode || 'indexeddb',
    },
  ));
  const saveProFormDraft = options.saveProFormDraft || vi.fn(acceptedResponse);
  const loadProFormDraft = options.loadProFormDraft;
  const appendProFormDraftEvents = options.appendProFormDraftEvents
    || vi.fn(async () => ({ success: true, acceptedCount: 1 }));
  const localStatus = {
    active: true,
    dirty: false,
    inFlight: false,
    lastSavedAt: NOW,
    lastErrorCode: null,
    storageMode: options.storageMode || 'indexeddb',
  };
  const localPersistence = {
    start: vi.fn(() => ({ ...localStatus })),
    stop: vi.fn(async () => ({ ...localStatus, active: false })),
    flush: vi.fn(async () => ({ ...localStatus, ...(options.localFlushResult || {}) })),
    getStatus: vi.fn(() => ({ ...localStatus })),
  };
  const bundle = {
    draftId: DRAFT_ID,
    sessionId: SESSION_ID,
    resumeToken: TOKEN,
    recoverySessionToken: options.recoverySessionToken || null,
  };
  const credentialVault = options.credentialVault || {
    loadDraftCredentialBundle: vi.fn(async () => ({
      ok: true,
      bundle,
      storageMode: options.storageMode || 'indexeddb',
    })),
  };
  const lifecycle = createLifecycleHarness();
  let id = 0;
  const logger = options.logger || {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const manager = createProFormDraftSyncManager({
    store,
    namespace: NAMESPACE,
    storage: { getMode: () => options.storageMode || 'indexeddb' },
    localPersistence,
    credentialVault,
    draftApiClient: {
      saveProFormDraft,
      ...(loadProFormDraft ? { loadProFormDraft } : {}),
    },
    eventApiClient: { appendProFormDraftEvents },
    bootstrapReadyProvider: () => options.bootstrapReady !== false,
    readOnlyProvider: () => options.readOnly === true,
    onlineStateProvider: () => options.online !== false,
    visibilityProvider: options.visibilityProvider || (() => 'visible'),
    lifecycleAdapter: lifecycle.adapter,
    idGenerator: (purpose) => `${purpose}.synthetic.${++id}`,
    clock: () => Date.now(),
    random: () => 0.5,
    retryJitterRatio: 0,
    logger,
    loadProFormDraft,
    ...(options.managerOptions || {}),
  });
  managers.push(manager);
  return {
    appendProFormDraftEvents,
    credentialVault,
    lifecycle,
    localPersistence,
    logger,
    manager,
    saveProFormDraft,
    store,
  };
};

const mutate = (harness, value, questionId = '1') => {
  harness.store.dispatch(setResponse({ questionId, value }));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()));
  vi.useRealTimers();
});

describe('authoritative Pro form draft sync manager', () => {
  it('exports the production debounce and retry defaults', () => {
    expect(DEFAULT_DRAFT_SYNC_DEBOUNCE_MS).toBe(650);
    expect(DEFAULT_DRAFT_SYNC_MAX_WAIT_MS).toBe(2_000);
    expect(DEFAULT_DRAFT_SYNC_RETRY_BASE_MS).toBe(1_000);
    expect(DEFAULT_DRAFT_SYNC_RETRY_MAX_MS).toBe(30_000);
    expect(DEFAULT_DRAFT_SYNC_MAX_RETRIES).toBe(8);
  });

  it('starts once, registers all lifecycle listeners, and stops cleanly', async () => {
    const harness = createHarness();
    expect(harness.manager.start()).toMatchObject({ active: true });
    expect(harness.manager.start()).toMatchObject({ active: true });
    expect(harness.localPersistence.start).toHaveBeenCalledOnce();
    expect([...harness.lifecycle.windowListeners.keys()].sort()).toEqual([
      'beforeunload', 'offline', 'online', 'pagehide',
    ]);
    expect([...harness.lifecycle.documentListeners.keys()]).toEqual(['visibilitychange']);

    await harness.manager.stop();
    expect(harness.localPersistence.stop).toHaveBeenCalledOnce();
    expect(harness.lifecycle.windowListeners.size).toBe(0);
    expect(harness.lifecycle.documentListeners.size).toBe(0);
  });

  it('debounces ordinary saves, reads Redux after reducers, and increments legacy mutations', async () => {
    const harness = createHarness();
    harness.manager.start();
    mutate(harness, 'newest complete answer');

    await vi.advanceTimersByTimeAsync(649);
    expect(harness.saveProFormDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await harness.manager.flush({ reason: 'autosave' });

    expect(harness.saveProFormDraft).toHaveBeenCalledOnce();
    const request = harness.saveProFormDraft.mock.calls[0][0];
    expect(request.canonicalState.responses).toEqual({ '1': 'newest complete answer' });
    expect(request.canonicalState.clientRevision).toBe(1);
    expect(request.canonicalState.sourceTabId).toMatch(/^tab_/u);
    expect(request.syncReason).toBe('autosave');
  });

  it('takes a maximum-wait snapshot during continuous typing', async () => {
    const harness = createHarness();
    harness.manager.start();
    mutate(harness, 'a');
    for (const value of ['ab', 'abc', 'abcd']) {
      await vi.advanceTimersByTimeAsync(500);
      mutate(harness, value);
    }
    expect(harness.saveProFormDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await harness.manager.flush({ reason: 'autosave' });
    expect(harness.saveProFormDraft).toHaveBeenCalledOnce();
    expect(harness.saveProFormDraft.mock.calls[0][0].canonicalState.responses['1'])
      .toBe('abcd');
  });

  it('serializes one request at a time and coalesces an in-flight mutation to the newest state', async () => {
    const first = deferred();
    const requests = [];
    const saveProFormDraft = vi.fn(async (request) => {
      requests.push(request);
      if (requests.length === 1) return first.promise;
      return acceptedResponse(request);
    });
    const harness = createHarness({ saveProFormDraft });
    harness.manager.start();
    mutate(harness, 'first');
    await vi.advanceTimersByTimeAsync(650);
    await vi.waitFor(() => expect(saveProFormDraft).toHaveBeenCalledOnce());
    expect(saveProFormDraft).toHaveBeenCalledOnce();

    mutate(harness, 'newest');
    await vi.advanceTimersByTimeAsync(650);
    expect(saveProFormDraft).toHaveBeenCalledOnce();
    first.resolve(await acceptedResponse(requests[0]));
    await vi.runAllTimersAsync();

    await vi.waitFor(() => expect(saveProFormDraft).toHaveBeenCalledTimes(2));
    expect(requests[1].canonicalState.responses['1']).toBe('newest');
    expect(requests[1].expectedServerRevision).toBe(1);
    expect(requests[1].canonicalState.clientRevision).toBeGreaterThan(
      requests[0].canonicalState.clientRevision,
    );
  });

  it('does not send an unchanged canonical state twice', async () => {
    const harness = createHarness();
    harness.manager.start();
    mutate(harness, 'same');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });
    mutate(harness, 'same');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.saveProFormDraft).toHaveBeenCalledOnce();
  });

  it('reuses an idempotency key for the same-state retry', async () => {
    const saveProFormDraft = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('synthetic outage'), {
        code: 'DRAFT_SAVE_FAILED', status: 503, retryable: true,
      }))
      .mockImplementation(acceptedResponse);
    const harness = createHarness({ saveProFormDraft });
    harness.manager.start();
    mutate(harness, 'retry me');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });
    await vi.advanceTimersByTimeAsync(1_000);
    await harness.manager.flush({ reason: 'autosave' });

    expect(saveProFormDraft).toHaveBeenCalledTimes(2);
    expect(saveProFormDraft.mock.calls[1][0].idempotencyKey)
      .toBe(saveProFormDraft.mock.calls[0][0].idempotencyKey);
    expect(harness.manager.getStatus()).toMatchObject({
      state: DRAFT_SYNC_MANAGER_STATES.SERVER_SAVED,
      retryCount: 0,
    });
  });

  it('uses a new idempotency key when state changes before retry', async () => {
    const saveProFormDraft = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('synthetic outage'), {
        code: 'DRAFT_SAVE_FAILED', status: 503, retryable: true,
      }))
      .mockImplementation(acceptedResponse);
    const harness = createHarness({ saveProFormDraft });
    harness.manager.start();
    mutate(harness, 'old');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });
    mutate(harness, 'new');
    await vi.advanceTimersByTimeAsync(1_000);
    await harness.manager.flush({ reason: 'autosave' });

    expect(saveProFormDraft).toHaveBeenCalledTimes(2);
    expect(saveProFormDraft.mock.calls[1][0].idempotencyKey)
      .not.toBe(saveProFormDraft.mock.calls[0][0].idempotencyKey);
    expect(saveProFormDraft.mock.calls[1][0].canonicalState.responses['1']).toBe('new');
  });

  it('accepts idempotent success and records backend revisions truthfully', async () => {
    const saveProFormDraft = vi.fn(async (request) => acceptedResponse(request, {
      idempotent: true,
    }));
    const harness = createHarness({ saveProFormDraft });
    harness.manager.start();
    mutate(harness, 'accepted');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });

    expect(harness.manager.getStatus()).toMatchObject({
      state: DRAFT_SYNC_MANAGER_STATES.SERVER_SAVED,
      confirmedClientRevision: 1,
      confirmedServerRevision: 1,
      lastServerSavedAt: NOW,
    });
  });

  it('pauses on conflict without overwriting local Redux state or looping', async () => {
    const conflictAdapter = { handleConflict: vi.fn(), broadcastAcceptedRevision: vi.fn() };
    const saveProFormDraft = vi.fn(async () => {
      throw Object.assign(new Error('synthetic conflict'), {
        code: 'REVISION_CONFLICT', status: 409, mergeRequired: true,
        conflict: { draftId: DRAFT_ID, clientRevision: 2, serverRevision: 4 },
      });
    });
    const harness = createHarness({
      saveProFormDraft,
      managerOptions: { conflictAdapter },
    });
    harness.manager.start();
    mutate(harness, 'local winner candidate');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });

    expect(harness.manager.getStatus()).toMatchObject({
      state: DRAFT_SYNC_MANAGER_STATES.CONFLICT,
      hasConflict: true,
    });
    expect(harness.store.getState().form.responses['1']).toBe('local winner candidate');
    expect(conflictAdapter.handleConflict).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(saveProFormDraft).toHaveBeenCalledOnce();
  });

  it('loads server state and auto-merges nonoverlapping edits after a 409', async () => {
    const saveProFormDraft = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('stale'), {
        code: 'REVISION_CONFLICT', status: 409, mergeRequired: true,
        conflict: { draftId: DRAFT_ID, serverRevision: 1, status: 'active' },
      }))
      .mockImplementation(acceptedResponse);
    const loadProFormDraft = vi.fn(async () => ({
      success: true,
      draft: { canonicalState: canonicalState({
        serverRevision: 1, clientRevision: 1, responses: { q2: 'server answer' },
      }) },
    }));
    const harness = createHarness({ saveProFormDraft, loadProFormDraft });
    harness.manager.start();
    mutate(harness, 'local answer', 'q1');
    await vi.advanceTimersByTimeAsync(650);
    await vi.waitFor(() => expect(saveProFormDraft).toHaveBeenCalledTimes(2));
    expect(loadProFormDraft).toHaveBeenCalledOnce();
    expect(saveProFormDraft).toHaveBeenCalledTimes(2);
    expect(saveProFormDraft.mock.calls[1][0].canonicalState.responses).toEqual({
      q1: 'local answer', q2: 'server answer',
    });
    expect(saveProFormDraft.mock.calls[1][0].canonicalState.clientRevision).toBe(2);
  });

  it('pauses autosave for same-field conflicts and resumes after a user choice', async () => {
    const saveProFormDraft = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('stale'), {
        code: 'REVISION_CONFLICT', status: 409, mergeRequired: true,
        conflict: { draftId: DRAFT_ID, serverRevision: 1, status: 'active' },
      }))
      .mockImplementation(acceptedResponse);
    const loadProFormDraft = vi.fn(async () => ({
      success: true,
      draft: { canonicalState: canonicalState({
        serverRevision: 1, clientRevision: 1, responses: { q1: 'server answer' },
      }) },
    }));
    const harness = createHarness({ saveProFormDraft, loadProFormDraft });
    harness.manager.start();
    mutate(harness, 'local answer', 'q1');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });
    expect(harness.manager.getStatus()).toMatchObject({ hasConflict: true, conflictCount: 1 });
    const conflict = harness.manager.getPendingConflict().conflicts[0];
    harness.manager.scheduleSave('autosave');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saveProFormDraft).toHaveBeenCalledOnce();
    await harness.manager.resolveConflictChoices({ [conflict.conflictId]: 'keep_local' });
    expect(saveProFormDraft).toHaveBeenCalledTimes(2);
    expect(saveProFormDraft.mock.calls[1][0].canonicalState.responses.q1).toBe('local answer');
    expect(harness.manager.getStatus().hasConflict).toBe(false);
  });

  it('stops automatic conflict merging after three rounds', async () => {
    let loadCount = 0;
    const saveProFormDraft = vi.fn(async () => {
      throw Object.assign(new Error('stale'), {
        code: 'REVISION_CONFLICT', status: 409, mergeRequired: true,
        conflict: { draftId: DRAFT_ID, serverRevision: loadCount + 1, status: 'active' },
      });
    });
    const loadProFormDraft = vi.fn(async () => {
      loadCount += 1;
      return {
        success: true,
        draft: { canonicalState: canonicalState({
          serverRevision: loadCount,
          clientRevision: loadCount,
          responses: Object.fromEntries(
            Array.from({ length: loadCount }, (_, index) => [`server${index}`, `v${index}`]),
          ),
        }) },
      };
    });
    const harness = createHarness({ saveProFormDraft, loadProFormDraft });
    harness.manager.start();
    mutate(harness, 'local answer', 'local');
    await vi.advanceTimersByTimeAsync(650);
    await vi.waitFor(() => expect(saveProFormDraft).toHaveBeenCalledTimes(4));
    expect(harness.manager.getStatus()).toMatchObject({
      hasConflict: true,
      errorCode: DRAFT_SYNC_ERROR_CODES.MAX_CONFLICT_ROUNDS_EXCEEDED,
    });
  });

  it('locks submitted and superseded drafts against stale ordinary saves', async () => {
    const harness = createHarness();
    harness.manager.start();
    await harness.manager.markSubmitAttempted();
    await harness.manager.markSubmitted('submission-synthetic-1');
    const callsAfterSubmit = harness.saveProFormDraft.mock.calls.length;
    mutate(harness, 'must not overwrite submitted');
    harness.manager.scheduleSave('autosave');
    await vi.runAllTimersAsync();
    expect(harness.saveProFormDraft).toHaveBeenCalledTimes(callsAfterSubmit);
    expect(harness.manager.getStatus()).toMatchObject({
      state: DRAFT_SYNC_MANAGER_STATES.SUBMITTED,
      locked: true,
      isReadOnly: true,
    });

    const second = createHarness();
    second.manager.start();
    second.manager.invalidateAfterSupersession();
    mutate(second, 'must remain local only');
    await vi.runAllTimersAsync();
    expect(second.saveProFormDraft).not.toHaveBeenCalled();
    expect(second.manager.getStatus().state).toBe(DRAFT_SYNC_MANAGER_STATES.SUPERSEDED);
  });

  it('rejects a late save callback after supersession and tags the manager draft', async () => {
    const pending = deferred();
    let request;
    const saveProFormDraft = vi.fn((input) => {
      request = input;
      return pending.promise;
    });
    const harness = createHarness({ saveProFormDraft });
    harness.manager.start();
    expect(harness.manager.getDraftIdentity()).toMatchObject({ draftId: DRAFT_ID });
    mutate(harness, 'in flight before clear');
    const savePromise = harness.manager.flush({ reason: 'manual_save' });
    await vi.waitFor(() => expect(saveProFormDraft).toHaveBeenCalledOnce());
    const dispatchSpy = vi.spyOn(harness.store, 'dispatch');
    harness.manager.invalidateAfterSupersession();
    pending.resolve(await acceptedResponse(request));
    await savePromise;
    expect(harness.manager.getStatus().state).toBe(DRAFT_SYNC_MANAGER_STATES.SUPERSEDED);
    expect(dispatchSpy.mock.calls.map(([action]) => action.type)).not.toContain('form/setDraftServerSaved');
  });

  it('keeps offline changes local and saves the newest state after reconnect stabilization', async () => {
    const harness = createHarness({ online: false });
    harness.manager.start();
    mutate(harness, 'offline newest');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.saveProFormDraft).not.toHaveBeenCalled();
    expect(harness.localPersistence.flush).toHaveBeenCalled();
    expect(harness.manager.getStatus().state).toBe(
      DRAFT_SYNC_MANAGER_STATES.OFFLINE_LOCAL_ONLY,
    );

    harness.manager.setOnlineState(true);
    await vi.advanceTimersByTimeAsync(249);
    expect(harness.saveProFormDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await harness.manager.flush({ reason: 'autosave' });
    expect(harness.saveProFormDraft).toHaveBeenCalledOnce();
    expect(harness.saveProFormDraft.mock.calls[0][0].canonicalState.responses['1'])
      .toBe('offline newest');
  });

  it('does not retry permanent errors and stops at the configured retry ceiling', async () => {
    const permanent = createHarness({
      saveProFormDraft: vi.fn(async () => {
        throw Object.assign(new Error('invalid'), {
          code: 'INVALID_REQUEST', status: 400, retryable: false,
        });
      }),
    });
    permanent.manager.start();
    mutate(permanent, 'invalid');
    await vi.advanceTimersByTimeAsync(650);
    await permanent.manager.flush({ reason: 'autosave' });
    expect(permanent.saveProFormDraft).toHaveBeenCalledOnce();
    expect(permanent.manager.getStatus().state).toBe(DRAFT_SYNC_MANAGER_STATES.ERROR);

    const transient = createHarness({
      saveProFormDraft: vi.fn(async () => {
        throw Object.assign(new Error('outage'), {
          code: 'DRAFT_SAVE_FAILED', status: 503, retryable: true,
        });
      }),
      managerOptions: { maxRetries: 1 },
    });
    transient.manager.start();
    mutate(transient, 'retry ceiling');
    await vi.advanceTimersByTimeAsync(650);
    await transient.manager.flush({ reason: 'autosave' });
    await vi.advanceTimersByTimeAsync(1_000);
    await transient.manager.flush({ reason: 'autosave' });
    expect(transient.saveProFormDraft).toHaveBeenCalledTimes(2);
    expect(transient.manager.getStatus()).toMatchObject({
      state: DRAFT_SYNC_MANAGER_STATES.ERROR,
      errorCode: DRAFT_SYNC_ERROR_CODES.MAX_RETRIES_EXCEEDED,
    });
  });

  it('honors retry-after when it exceeds exponential backoff', async () => {
    const saveProFormDraft = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), {
        code: 'DRAFT_SAVE_FAILED', status: 503, retryable: true, retryAfterSeconds: 2,
      }))
      .mockImplementation(acceptedResponse);
    const harness = createHarness({ saveProFormDraft });
    harness.manager.start();
    mutate(harness, 'wait');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(saveProFormDraft).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await harness.manager.flush({ reason: 'autosave' });
    expect(saveProFormDraft).toHaveBeenCalledTimes(2);
  });

  it('flushes on hidden visibility, uses local-only pagehide fallback, and keeps beforeunload safe', async () => {
    let visibility = 'visible';
    const harness = createHarness({ visibilityProvider: () => visibility });
    harness.manager.start();
    mutate(harness, 'lifecycle');
    visibility = 'hidden';
    harness.manager.handleVisibilityChange();
    await harness.manager.flush({ reason: 'autosave' });
    expect(harness.saveProFormDraft).toHaveBeenCalledOnce();

    const pagehideEvent = { persisted: false };
    expect(harness.manager.handlePageHide(pagehideEvent).pagehideStrategy)
      .toBe('local_cache_only');
    const unloadEvent = { preventDefault: vi.fn() };
    expect(harness.manager.handleBeforeUnload(unloadEvent)).toBeUndefined();
    expect(unloadEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('batches at most 50 deduplicated events and retries event failure independently', async () => {
    const appendProFormDraftEvents = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('event outage'), {
        code: 'EVENT_BATCH_FAILED', status: 503, retryable: true,
      }))
      .mockResolvedValue({ success: true, acceptedCount: 50 });
    const harness = createHarness({ appendProFormDraftEvents });
    harness.manager.start();
    for (let index = 0; index < 55; index += 1) {
      expect(harness.manager.queueEvent({
        eventId: `event.synthetic.${index}`,
        eventType: 'answer_changed',
        questionId: String(index),
        value: `synthetic-${index}`,
      })).toBe(true);
    }
    expect(harness.manager.queueEvent({
      eventId: 'event.synthetic.0', eventType: 'answer_changed',
    })).toBe(false);
    await vi.advanceTimersByTimeAsync(650);
    expect(appendProFormDraftEvents.mock.calls[0][0].events).toHaveLength(50);
    expect(harness.manager.getStatus()).toMatchObject({
      eventQueueSize: 55,
      eventRetryCount: 1,
      eventErrorCode: 'EVENT_BATCH_FAILED',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(650);
    expect(appendProFormDraftEvents).toHaveBeenCalledTimes(3);
    expect(appendProFormDraftEvents.mock.calls[2][0].events).toHaveLength(5);
    expect(harness.manager.getStatus()).toMatchObject({
      eventQueueSize: 0,
      eventErrorCode: null,
    });
    expect(harness.manager.getStatus().state).not.toBe(DRAFT_SYNC_MANAGER_STATES.ERROR);
  });

  it('pauses automatic event delivery after a permanent failure without affecting snapshots', async () => {
    const appendProFormDraftEvents = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid event'), {
        code: 'INVALID_EVENT', status: 400, retryable: false,
      }))
      .mockResolvedValue({ success: true, acceptedCount: 1 });
    const harness = createHarness({ appendProFormDraftEvents });
    harness.manager.start();
    expect(harness.manager.queueEvent({ eventType: 'answer_changed' })).toBe(true);

    await vi.advanceTimersByTimeAsync(650);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(appendProFormDraftEvents).toHaveBeenCalledOnce();
    expect(harness.manager.getStatus()).toMatchObject({
      eventQueueSize: 1,
      eventErrorCode: 'INVALID_EVENT',
    });

    mutate(harness, 'snapshot remains independent');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });
    expect(harness.saveProFormDraft).toHaveBeenCalledOnce();
    expect(appendProFormDraftEvents).toHaveBeenCalledOnce();

    await harness.manager.flushEvents({ force: true });
    expect(appendProFormDraftEvents).toHaveBeenCalledTimes(2);
    expect(harness.manager.getStatus().eventQueueSize).toBe(0);
  });

  it('falls back from an expired resume authorization to the stored recovery session', async () => {
    const recoverySessionToken = `${'a'.repeat(20)}.${'b'.repeat(20)}`;
    const saveProFormDraft = vi.fn(async (request) => {
      if (request.authorization.resumeToken) {
        throw Object.assign(new Error('expired'), {
          code: 'INVALID_AUTHORIZATION', status: 401, retryable: false,
        });
      }
      return acceptedResponse(request);
    });
    const harness = createHarness({ saveProFormDraft, recoverySessionToken });
    harness.manager.start();
    mutate(harness, 'authorized fallback');
    await vi.advanceTimersByTimeAsync(650);
    await vi.advanceTimersByTimeAsync(0);
    await harness.manager.flush({ reason: 'autosave' });
    expect(saveProFormDraft).toHaveBeenCalledTimes(2);
    expect(saveProFormDraft.mock.calls[1][0].authorization)
      .toEqual({ recoverySessionToken });
  });

  it('preserves the last valid cache and skips network after local serialization failure', async () => {
    const harness = createHarness({
      localFlushResult: { lastErrorCode: 'CANONICAL_CACHE_WRITE_FAILED' },
    });
    harness.manager.start();
    mutate(harness, 'cannot serialize locally');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });
    expect(harness.saveProFormDraft).not.toHaveBeenCalled();
    expect(harness.manager.getStatus()).toMatchObject({
      state: DRAFT_SYNC_MANAGER_STATES.ERROR,
      errorCode: DRAFT_SYNC_ERROR_CODES.LOCAL_CACHE_FAILED,
    });
  });

  it('keeps tokens outside Redux and never logs raw canonical values', async () => {
    const harness = createHarness();
    harness.manager.start();
    mutate(harness, 'answer-that-must-not-be-logged');
    await vi.advanceTimersByTimeAsync(650);
    await harness.manager.flush({ reason: 'autosave' });
    const reduxJson = JSON.stringify(harness.store.getState());
    const logJson = JSON.stringify(harness.logger.info.mock.calls)
      + JSON.stringify(harness.logger.warn.mock.calls);
    expect(reduxJson).not.toContain(TOKEN);
    expect(logJson).not.toContain('answer-that-must-not-be-logged');
    expect(getSafeDraftSyncDiagnostics(harness.manager)).toMatchObject({
      exposesCredentials: false,
      logsCanonicalState: false,
    });
  });
});
