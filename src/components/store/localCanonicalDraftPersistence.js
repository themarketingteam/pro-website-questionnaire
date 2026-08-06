import { hashCanonicalDraftState } from '@/lib/questionnaireDraftState';
import {
  CANONICAL_DRAFT_CACHE_ERROR_CODES,
  saveCanonicalDraftCache,
} from '@/lib/questionnaireCanonicalDraftCache';
import { selectCanonicalDraftState } from './draftSelectors';
import {
  setDraftLocalSaved,
  setDraftLocalSaving,
  setDraftSyncError,
} from './formSlice';

export const DEFAULT_LOCAL_CANONICAL_DEBOUNCE_MS = 100;
export const DEFAULT_LOCAL_CANONICAL_MAX_WAIT_MS = 500;

const controllersByStore = new WeakMap();

const normalizeDelay = (value, fallback, { minimum = 0, maximum = 10_000 } = {}) => (
  Number.isFinite(value) && value >= minimum
    ? Math.min(maximum, Math.trunc(value))
    : fallback
);

const safeStorageMode = (storage) => {
  try { return storage?.getMode?.() || 'unknown'; } catch { return 'unknown'; }
};

const safeErrorCode = (value) => (
  typeof value === 'string' && /^[A-Z0-9_.:-]{1,160}$/.test(value)
    ? value
    : CANONICAL_DRAFT_CACHE_ERROR_CODES.WRITE_FAILED
);

const resolveCacheSave = (cacheAdapter) => {
  if (typeof cacheAdapter === 'function') return cacheAdapter;
  if (typeof cacheAdapter?.saveCanonicalDraftCache === 'function') {
    return cacheAdapter.saveCanonicalDraftCache.bind(cacheAdapter);
  }
  if (typeof cacheAdapter?.save === 'function') return cacheAdapter.save.bind(cacheAdapter);
  return saveCanonicalDraftCache;
};

const nowMilliseconds = (now) => {
  const value = now();
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
};

const safeStatus = (status) => Object.freeze({
  active: status.active,
  dirty: status.dirty,
  inFlight: status.inFlight,
  lastAttemptedHash: status.lastAttemptedHash,
  lastSavedHash: status.lastSavedHash,
  lastSavedAt: status.lastSavedAt,
  lastErrorCode: status.lastErrorCode,
  storageMode: status.storageMode,
  writes: status.writes,
  skippedUnchanged: status.skippedUnchanged,
});

/**
 * @param {{
 *   store?: any,
 *   namespace?: string,
 *   storage?: any,
 *   cacheAdapter?: any,
 *   selector?: (state: any) => any,
 *   debounceMs?: number,
 *   maxWaitMs?: number,
 *   now?: () => number | Date,
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout,
 *   crypto?: Crypto,
 *   TextEncoder?: typeof TextEncoder,
 * }} options
 */
export const createLocalCanonicalDraftPersistence = (options = {}) => {
  if (!options.store || typeof options.store.subscribe !== 'function') {
    throw new TypeError('LOCAL_CANONICAL_PERSISTENCE_STORE_REQUIRED');
  }
  const existing = controllersByStore.get(options.store);
  if (existing) return existing;

  const store = options.store;
  const selector = options.selector || selectCanonicalDraftState;
  const save = resolveCacheSave(options.cacheAdapter);
  const debounceMs = normalizeDelay(
    options.debounceMs,
    DEFAULT_LOCAL_CANONICAL_DEBOUNCE_MS,
    { minimum: 50, maximum: 150 },
  );
  const maxWaitMs = Math.max(
    debounceMs,
    normalizeDelay(
      options.maxWaitMs,
      DEFAULT_LOCAL_CANONICAL_MAX_WAIT_MS,
      { minimum: debounceMs, maximum: 500 },
    ),
  );
  const now = options.now || Date.now;
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const status = {
    active: false,
    dirty: false,
    inFlight: false,
    lastAttemptedHash: null,
    lastSavedHash: null,
    lastSavedAt: null,
    lastErrorCode: null,
    storageMode: safeStorageMode(options.storage),
    writes: 0,
    skippedUnchanged: 0,
  };
  let unsubscribe = null;
  let debounceTimer = null;
  let maxWaitTimer = null;
  let firstDirtyAt = null;
  let inFlightPromise = null;
  let dispatchingStatus = false;

  const clearScheduledTimers = () => {
    clearTimer(debounceTimer);
    clearTimer(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
    firstDirtyAt = null;
  };

  const dispatchStatus = (action) => {
    dispatchingStatus = true;
    try { store.dispatch(action); } finally { dispatchingStatus = false; }
  };

  const runPersistence = async () => {
    clearScheduledTimers();
    if (!status.dirty) return safeStatus(status);
    if (inFlightPromise) return inFlightPromise;
    status.dirty = false;
    status.inFlight = true;

    inFlightPromise = (async () => {
      const selected = selector(store.getState());
      if (!selected?.ok || !selected.state) {
        status.lastErrorCode = safeErrorCode(selected?.errorCode);
        dispatchStatus(setDraftSyncError({
          errorCode: status.lastErrorCode,
          retryCount: 0,
        }));
        return safeStatus(status);
      }

      let stateHash;
      try {
        stateHash = await hashCanonicalDraftState(selected.state, {
          ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
          ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
        });
      } catch (error) {
        status.lastErrorCode = safeErrorCode(error?.code);
        dispatchStatus(setDraftSyncError({
          errorCode: status.lastErrorCode,
          retryCount: 0,
        }));
        return safeStatus(status);
      }

      status.lastAttemptedHash = stateHash;
      if (stateHash === status.lastSavedHash) {
        status.skippedUnchanged += 1;
        return safeStatus(status);
      }

      const pendingRevision = Number.isSafeInteger(selected.state.clientRevision)
        ? selected.state.clientRevision
        : 0;
      status.storageMode = safeStorageMode(options.storage);
      dispatchStatus(setDraftLocalSaving({
        storageMode: status.storageMode,
        pendingClientRevision: pendingRevision,
      }));

      let result;
      try {
        result = await save({
          namespace: options.namespace,
          state: selected.state,
          storage: options.storage,
          now,
          ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
          ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
        });
      } catch (error) {
        result = { ok: false, errorCode: safeErrorCode(error?.code) };
      }

      const observedStorageMode = safeStorageMode(options.storage);
      status.storageMode = observedStorageMode === 'unknown'
        ? result?.envelope?.storageMode || 'unknown'
        : observedStorageMode;
      if (!result?.ok) {
        status.lastErrorCode = safeErrorCode(result?.errorCode);
        dispatchStatus(setDraftSyncError({
          errorCode: status.lastErrorCode,
          retryCount: 0,
        }));
        return safeStatus(status);
      }

      status.lastSavedHash = stateHash;
      status.lastSavedAt = result.envelope?.savedAtClient || new Date(nowMilliseconds(now)).toISOString();
      status.lastErrorCode = null;
      if (result.written !== false) status.writes += 1;
      dispatchStatus(setDraftLocalSaved({
        storageMode: status.storageMode,
        lastLocalSavedAt: status.lastSavedAt,
        confirmedClientRevision: pendingRevision,
      }));
      return safeStatus(status);
    })().finally(() => {
      status.inFlight = false;
      inFlightPromise = null;
    });

    const result = await inFlightPromise;
    if (status.dirty && status.active) schedule();
    return result;
  };

  const schedule = () => {
    if (!status.active) return;
    status.dirty = true;
    const currentTime = nowMilliseconds(now);
    if (firstDirtyAt === null) {
      firstDirtyAt = currentTime;
      maxWaitTimer = setTimer(() => { void runPersistence(); }, maxWaitMs);
    }
    clearTimer(debounceTimer);
    const elapsed = Math.max(0, currentTime - firstDirtyAt);
    const remainingMax = Math.max(0, maxWaitMs - elapsed);
    debounceTimer = setTimer(
      () => { void runPersistence(); },
      Math.min(debounceMs, remainingMax),
    );
  };

  const controller = Object.freeze({
    start(startOptions = {}) {
      if (typeof startOptions.initialHash === 'string') {
        status.lastSavedHash = startOptions.initialHash;
      }
      if (status.active) return safeStatus(status);
      status.active = true;
      unsubscribe = store.subscribe(() => {
        if (!dispatchingStatus) schedule();
      });
      if (startOptions.scheduleInitial !== false) schedule();
      return safeStatus(status);
    },
    async stop(stopOptions = {}) {
      if (stopOptions.flush === true) await runPersistence();
      status.active = false;
      clearScheduledTimers();
      unsubscribe?.();
      unsubscribe = null;
      if (inFlightPromise) await inFlightPromise;
      return safeStatus(status);
    },
    async flush() {
      if (inFlightPromise) await inFlightPromise;
      return runPersistence();
    },
    getStatus() {
      return safeStatus(status);
    },
  });

  controllersByStore.set(store, controller);
  return controller;
};

export const startLocalCanonicalDraftPersistence = (controller, options) => (
  controller?.start?.(options)
);

export const stopLocalCanonicalDraftPersistence = (controller, options) => (
  controller?.stop?.(options)
);

export const flushLocalCanonicalDraftPersistence = (controller) => (
  controller?.flush?.()
);

export const getLocalCanonicalPersistenceStatus = (controller) => (
  controller?.getStatus?.() || Object.freeze({
    active: false,
    dirty: false,
    inFlight: false,
    lastAttemptedHash: null,
    lastSavedHash: null,
    lastSavedAt: null,
    lastErrorCode: 'LOCAL_CANONICAL_PERSISTENCE_UNAVAILABLE',
    storageMode: 'unknown',
    writes: 0,
    skippedUnchanged: 0,
  })
);

// Compatibility alias for the Prompt 2 draft-foundation naming. New callers
// use the contract name above.
export const getLocalCanonicalDraftPersistenceStatus = getLocalCanonicalPersistenceStatus;
