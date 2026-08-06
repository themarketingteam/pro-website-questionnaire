import {
  generateDraftApiIdempotencyKey,
  proDraftApiClient,
} from '@/lib/proDraftApiClient';
import {
  cloneCanonicalDraftState,
  hashCanonicalDraftState,
  normalizeCanonicalDraftState,
  serializeCanonicalDraftState,
} from '@/lib/questionnaireDraftState';
import {
  DRAFT_MERGE_RESULTS,
  applyConflictChoices as applyDraftConflictChoices,
  getSafeMergeDiagnostics,
  mergeCanonicalDraftStates,
} from '@/lib/proDraftConflictMerge';
import { saveCanonicalDraftCache } from '@/lib/questionnaireCanonicalDraftCache';
import {
  selectCanonicalDraftState,
  selectDraftBootstrapStatus,
  selectIsDraftReadOnly,
} from '@/components/store/draftSelectors';
import {
  patchDraftContext,
  loadCanonicalDraftState,
  setDraftLocalSaved,
  setDraftLocalSaving,
  setDraftOfflineLocalOnly,
  setDraftRetrying,
  setDraftRevisions,
  setDraftServerSaved,
  setDraftServerSaving,
  setDraftStateHash,
  setDraftStatus,
  setDraftSubmitted,
  setDraftSyncError,
} from '@/components/store/formSlice';
import {
  flushLocalCanonicalDraftPersistence,
  getLocalCanonicalPersistenceStatus,
  startLocalCanonicalDraftPersistence,
  stopLocalCanonicalDraftPersistence,
} from '@/components/store/localCanonicalDraftPersistence';

export const PRO_FORM_DRAFT_SYNC_VERSION = 1;

export const DRAFT_SYNC_MANAGER_STATES = Object.freeze({
  IDLE: 'idle',
  LOCAL_SAVING: 'local_saving',
  LOCAL_SAVED: 'local_saved',
  SERVER_SAVING: 'server_saving',
  SERVER_SAVED: 'server_saved',
  OFFLINE_LOCAL_ONLY: 'offline_local_only',
  RETRYING: 'retrying',
  CONFLICT: 'conflict',
  ERROR: 'error',
  SUBMITTED: 'submitted',
  SUPERSEDED: 'superseded',
  DISPOSED: 'disposed',
});

export const DRAFT_SYNC_ERROR_CODES = Object.freeze({
  AUTHORIZATION_REQUIRED: 'DRAFT_SYNC_AUTHORIZATION_REQUIRED',
  BOOTSTRAP_NOT_READY: 'DRAFT_SYNC_BOOTSTRAP_NOT_READY',
  CANONICAL_STATE_INVALID: 'DRAFT_SYNC_CANONICAL_STATE_INVALID',
  CONFLICT: 'DRAFT_SYNC_CONFLICT',
  CREDENTIALS_INVALID: 'DRAFT_SYNC_CREDENTIALS_INVALID',
  DISPOSED: 'DRAFT_SYNC_DISPOSED',
  EVENT_FAILED: 'DRAFT_SYNC_EVENT_FAILED',
  LOCAL_CACHE_FAILED: 'DRAFT_SYNC_LOCAL_CACHE_FAILED',
  MAX_RETRIES_EXCEEDED: 'DRAFT_SYNC_MAX_RETRIES_EXCEEDED',
  MAX_CONFLICT_ROUNDS_EXCEEDED: 'DRAFT_SYNC_MAX_CONFLICT_ROUNDS_EXCEEDED',
  PERMANENT_FAILURE: 'DRAFT_SYNC_PERMANENT_FAILURE',
  READ_ONLY: 'DRAFT_SYNC_READ_ONLY',
  RESPONSE_INVALID: 'DRAFT_SYNC_RESPONSE_INVALID',
  SERIALIZATION_FAILED: 'DRAFT_SYNC_SERIALIZATION_FAILED',
  SUBMITTED: 'DRAFT_SYNC_SUBMITTED',
  SUPERSEDED: 'DRAFT_SYNC_SUPERSEDED',
});

export const DEFAULT_DRAFT_SYNC_DEBOUNCE_MS = 650;
export const DEFAULT_DRAFT_SYNC_MAX_WAIT_MS = 2_000;
export const DEFAULT_DRAFT_SYNC_RETRY_BASE_MS = 1_000;
export const DEFAULT_DRAFT_SYNC_RETRY_MAX_MS = 30_000;
export const DEFAULT_DRAFT_SYNC_MAX_RETRIES = 8;
export const DEFAULT_DRAFT_SYNC_RECONNECT_DELAY_MS = 250;
export const DEFAULT_DRAFT_SYNC_EVENT_BATCH_SIZE = 50;
export const DEFAULT_DRAFT_SYNC_EVENT_QUEUE_LIMIT = 500;
export const DEFAULT_DRAFT_SYNC_MAX_CONFLICT_ROUNDS = 3;

const SAFE_CODE = /^[A-Z0-9_.:-]{1,160}$/u;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SECRET_KEY = /(?:authorization|recovery.?code|resume.?token|recovery.?session|password|secret|private.?key|access.?token)/iu;
const TERMINAL_CODES = new Set(['DRAFT_SUPERSEDED', 'DRAFT_EXPIRED', 'DRAFT_DELETED']);
const TERMINAL_SERVER_STATUSES = new Set([
  'submitted', 'cleared_superseded', 'expired', 'deleted',
]);
const CONFLICT_CODES = new Set([
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'STATUS_TRANSITION_INVALID',
  DRAFT_SYNC_ERROR_CODES.CONFLICT,
]);
const AUTHORIZATION_CODES = new Set([
  'INVALID_AUTHORIZATION',
  'WRITE_SCOPE_REQUIRED',
  'DRAFT_NOT_FOUND',
  'AUTHORIZATION_DENIED',
]);
const SUBMIT_REASONS = Object.freeze({
  active: 'autosave',
  submit_attempted: 'submit_attempt',
  submit_failed: 'submit_failed',
  submitted: 'submitted',
  cleared_superseded: 'clear_all',
});

const noOp = () => {};
const noopLogger = Object.freeze({ debug: noOp, info: noOp, warn: noOp, error: noOp });
const noopConflictAdapter = Object.freeze({
  handleConflict: noOp,
  broadcastAcceptedRevision: noOp,
  broadcastLocalRevision: noOp,
  broadcastSaveInProgress: noOp,
  broadcastTerminalStatus: noOp,
});

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const boundedInteger = (value, fallback, minimum, maximum) => (
  Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(value)))
    : fallback
);

const nowMilliseconds = (clock) => {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(milliseconds) ? milliseconds : Date.now();
};

const nowIso = (clock) => new Date(nowMilliseconds(clock)).toISOString();

const safeCode = (value, fallback) => (
  typeof value === 'string' && SAFE_CODE.test(value) ? value : fallback
);

const safeStorageMode = (storage, localPersistence) => {
  try {
    return storage?.getMode?.()
      || getLocalCanonicalPersistenceStatus(localPersistence).storageMode
      || 'unknown';
  } catch {
    return 'unknown';
  }
};

const authorizationFromBundle = (bundle, preferRecoverySession = false) => {
  if (preferRecoverySession && bundle?.recoverySessionToken) {
    return { recoverySessionToken: bundle.recoverySessionToken };
  }
  if (bundle?.resumeToken) return { resumeToken: bundle.resumeToken };
  if (bundle?.recoverySessionToken) {
    return { recoverySessionToken: bundle.recoverySessionToken };
  }
  return null;
};

const containsSecretKey = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.some((entry) => containsSecretKey(entry, seen));
    if (!isPlainObject(value)) return true;
    return Object.entries(value).some(([key, entry]) => (
      SECRET_KEY.test(key) || containsSecretKey(entry, seen)
    ));
  } finally {
    seen.delete(value);
  }
};

const safeEvent = (input, eventId, occurredAtClient) => {
  if (!isPlainObject(input) || containsSecretKey(input)) return null;
  const eventType = typeof input.eventType === 'string' && SAFE_ID.test(input.eventType)
    ? input.eventType
    : null;
  if (!eventType) return null;
  const output = {
    eventId,
    eventType,
    occurredAtClient,
  };
  const stringFields = ['questionId', 'questionType', 'mutationId', 'valueSummary'];
  for (const field of stringFields) {
    if (typeof input[field] === 'string' && input[field].length <= 512) output[field] = input[field];
  }
  const countFields = ['valueLength', 'selectedOptionCount'];
  for (const field of countFields) {
    if (Number.isSafeInteger(input[field]) && input[field] >= 0) output[field] = input[field];
  }
  if (Object.hasOwn(input, 'value')) output.value = input.value;
  if (isPlainObject(input.metadata)) output.metadata = input.metadata;
  try {
    JSON.stringify(output);
    return Object.freeze(output);
  } catch {
    return null;
  }
};

const createDefaultLifecycleAdapter = () => ({
  addWindowListener(type, listener) {
    try { globalThis.window?.addEventListener?.(type, listener); } catch {}
  },
  removeWindowListener(type, listener) {
    try { globalThis.window?.removeEventListener?.(type, listener); } catch {}
  },
  addDocumentListener(type, listener) {
    try { globalThis.document?.addEventListener?.(type, listener); } catch {}
  },
  removeDocumentListener(type, listener) {
    try { globalThis.document?.removeEventListener?.(type, listener); } catch {}
  },
});

const defaultOnlineStateProvider = () => {
  try { return globalThis.navigator?.onLine !== false; } catch { return true; }
};

const defaultVisibilityProvider = () => {
  try { return globalThis.document?.visibilityState || 'visible'; } catch { return 'visible'; }
};

const contentSignature = (canonicalState) => serializeCanonicalDraftState({
  ...canonicalState,
  clientRevision: 0,
  serverRevision: 0,
  savedAtClient: null,
  savedAtServer: null,
});

const publicStatus = (status) => Object.freeze({
  version: PRO_FORM_DRAFT_SYNC_VERSION,
  state: status.state,
  active: status.active,
  online: status.online,
  storageMode: status.storageMode,
  pending: status.pending,
  inFlight: status.inFlight,
  retryCount: status.retryCount,
  errorCode: status.errorCode,
  lastLocalSavedAt: status.lastLocalSavedAt,
  lastServerSavedAt: status.lastServerSavedAt,
  confirmedClientRevision: status.confirmedClientRevision,
  confirmedServerRevision: status.confirmedServerRevision,
  isReadOnly: status.isReadOnly,
  hasConflict: status.hasConflict,
  conflictCount: status.conflictCount,
  conflictRoundCount: status.conflictRoundCount,
  locked: status.locked,
  disposed: status.disposed,
  eventQueueSize: status.eventQueueSize,
  eventRetryCount: status.eventRetryCount,
  eventErrorCode: status.eventErrorCode,
  pagehideStrategy: status.pagehideStrategy,
});

export const getSafeDraftSyncDiagnostics = (managerOrStatus) => {
  const status = typeof managerOrStatus?.getStatus === 'function'
    ? managerOrStatus.getStatus()
    : managerOrStatus || {};
  return Object.freeze({
    version: PRO_FORM_DRAFT_SYNC_VERSION,
    state: typeof status.state === 'string' ? status.state : DRAFT_SYNC_MANAGER_STATES.IDLE,
    active: status.active === true,
    online: status.online !== false,
    storageMode: typeof status.storageMode === 'string' ? status.storageMode : 'unknown',
    pending: status.pending === true,
    inFlight: status.inFlight === true,
    retryCount: Number.isSafeInteger(status.retryCount) ? status.retryCount : 0,
    errorCode: typeof status.errorCode === 'string' ? status.errorCode : null,
    confirmedClientRevision: Number.isSafeInteger(status.confirmedClientRevision)
      ? status.confirmedClientRevision : null,
    confirmedServerRevision: Number.isSafeInteger(status.confirmedServerRevision)
      ? status.confirmedServerRevision : null,
    isReadOnly: status.isReadOnly === true,
    hasConflict: status.hasConflict === true,
    locked: status.locked === true,
    disposed: status.disposed === true,
    eventQueueSize: Number.isSafeInteger(status.eventQueueSize) ? status.eventQueueSize : 0,
    eventErrorCode: typeof status.eventErrorCode === 'string' ? status.eventErrorCode : null,
    pagehideStrategy: typeof status.pagehideStrategy === 'string'
      ? status.pagehideStrategy : 'not_attempted',
    exposesCredentials: false,
    logsCanonicalState: false,
  });
};

/**
 * Creates the React-independent V2 draft synchronization engine. The existing
 * local canonical persistence controller remains the only cache writer; this
 * manager owns V2 server scheduling, retries, lifecycle coordination, and the
 * event queue.
 */
export const createProFormDraftSyncManager = (options = {}) => {
  const store = options.store;
  if (!store || typeof store.getState !== 'function'
    || typeof store.dispatch !== 'function' || typeof store.subscribe !== 'function') {
    throw new TypeError('PRO_FORM_DRAFT_SYNC_STORE_REQUIRED');
  }
  const selector = options.canonicalStateSelector || selectCanonicalDraftState;
  const localPersistence = options.localPersistence || null;
  const canonicalCache = options.canonicalCache || { saveCanonicalDraftCache };
  const credentialVault = options.credentialVault;
  const draftApiClient = options.draftApiClient || proDraftApiClient;
  const eventApiClient = options.eventApiClient || draftApiClient;
  const conflictAdapter = options.conflictAdapter || noopConflictAdapter;
  const logger = options.logger || noopLogger;
  const clock = options.clock || Date.now;
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const onlineStateProvider = options.onlineStateProvider || defaultOnlineStateProvider;
  const visibilityProvider = options.visibilityProvider || defaultVisibilityProvider;
  const lifecycle = options.lifecycleAdapter || createDefaultLifecycleAdapter();
  const idGenerator = options.idGenerator || (() => generateDraftApiIdempotencyKey());
  const bootstrapReady = options.bootstrapReadyProvider || (() => (
    selectDraftBootstrapStatus(store.getState()).state === 'ready'
  ));
  const readOnlyProvider = options.readOnlyProvider || (() => (
    selectIsDraftReadOnly(store.getState())
  ));
  const debounceMs = boundedInteger(
    options.debounceMs,
    DEFAULT_DRAFT_SYNC_DEBOUNCE_MS,
    0,
    60_000,
  );
  const maxWaitMs = boundedInteger(
    options.maxWaitMs,
    DEFAULT_DRAFT_SYNC_MAX_WAIT_MS,
    debounceMs,
    120_000,
  );
  const retryBaseMs = boundedInteger(
    options.retryBaseMs,
    DEFAULT_DRAFT_SYNC_RETRY_BASE_MS,
    1,
    60_000,
  );
  const retryMaxMs = boundedInteger(
    options.retryMaxMs,
    DEFAULT_DRAFT_SYNC_RETRY_MAX_MS,
    retryBaseMs,
    300_000,
  );
  const maxRetries = boundedInteger(
    options.maxRetries,
    DEFAULT_DRAFT_SYNC_MAX_RETRIES,
    0,
    32,
  );
  const maxConflictRounds = boundedInteger(
    options.maxConflictRounds,
    DEFAULT_DRAFT_SYNC_MAX_CONFLICT_ROUNDS,
    1,
    10,
  );
  const retryJitterRatio = Number.isFinite(options.retryJitterRatio)
    ? Math.min(0.5, Math.max(0, options.retryJitterRatio)) : 0.2;
  const reconnectDelayMs = boundedInteger(
    options.reconnectDelayMs,
    DEFAULT_DRAFT_SYNC_RECONNECT_DELAY_MS,
    0,
    5_000,
  );
  const eventBatchSize = boundedInteger(
    options.eventBatchSize,
    DEFAULT_DRAFT_SYNC_EVENT_BATCH_SIZE,
    1,
    50,
  );
  const eventQueueLimit = boundedInteger(
    options.eventQueueLimit,
    DEFAULT_DRAFT_SYNC_EVENT_QUEUE_LIMIT,
    eventBatchSize,
    5_000,
  );

  const listeners = new Set();
  const eventQueue = [];
  const eventIds = new Set();
  let unsubscribeStore = null;
  let debounceTimer = null;
  let maxWaitTimer = null;
  let retryTimer = null;
  let reconnectTimer = null;
  let eventTimer = null;
  let eventRetryTimer = null;
  let savePromise = null;
  let eventPromise = null;
  let pendingReason = 'autosave';
  let pendingMetadata = null;
  let attempt = null;
  let eventAttempt = null;
  let eventAutoFlushBlocked = false;
  let firstPendingAt = null;
  let lastObservedSignature = null;
  let lastObservedRevision = 0;
  let lastAcceptedSignature = null;
  let lastSubmissionErrorCode = null;
  let authorizationFallbackAttempted = false;
  let preferRecoverySessionNext = false;
  let internalDispatch = false;
  let sourceTabId = typeof options.sourceTabId === 'string' && SAFE_ID.test(options.sourceTabId)
    ? options.sourceTabId : null;
  let networkBlockState = null;
  let lastAcceptedBaseState = null;
  let pendingConflict = null;
  let supportRecoveryCopy = null;
  let conflictRoundCount = 0;
  const status = /** @type {any} */ ({
    state: DRAFT_SYNC_MANAGER_STATES.IDLE,
    active: false,
    online: onlineStateProvider() !== false,
    storageMode: safeStorageMode(options.storage, localPersistence),
    pending: false,
    inFlight: false,
    retryCount: 0,
    errorCode: null,
    lastLocalSavedAt: null,
    lastServerSavedAt: null,
    confirmedClientRevision: null,
    confirmedServerRevision: null,
    isReadOnly: false,
    hasConflict: false,
    conflictCount: 0,
    conflictRoundCount: 0,
    locked: false,
    disposed: false,
    eventQueueSize: 0,
    eventRetryCount: 0,
    eventErrorCode: null,
    pagehideStrategy: 'not_attempted',
  });

  const notify = () => {
    const snapshot = publicStatus(status);
    for (const listener of listeners) {
      try { listener(snapshot); } catch {}
    }
  };

  const updateStatus = (patch) => {
    Object.assign(status, patch);
    notify();
    return publicStatus(status);
  };

  const log = (level, event, details = {}) => {
    const safeDetails = Object.freeze({
      event,
      state: status.state,
      retryCount: status.retryCount,
      errorCode: status.errorCode,
      ...Object.fromEntries(Object.entries(details).filter(([, value]) => (
        value === null || ['string', 'number', 'boolean'].includes(typeof value)
      ))),
    });
    try { logger[level]?.('pro_form_draft_sync', safeDetails); } catch {}
  };

  const dispatch = (action) => {
    internalDispatch = true;
    try { return store.dispatch(action); } finally { internalDispatch = false; }
  };

  const selection = () => selector(store.getState());

  const clearSaveTimers = () => {
    clearTimer(debounceTimer);
    clearTimer(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
    firstPendingAt = null;
  };

  const clearNetworkTimers = () => {
    clearSaveTimers();
    clearTimer(retryTimer);
    clearTimer(reconnectTimer);
    clearTimer(eventTimer);
    clearTimer(eventRetryTimer);
    retryTimer = null;
    reconnectTimer = null;
    eventTimer = null;
    eventRetryTimer = null;
  };

  const canonicalOrNull = () => {
    const selected = selection();
    if (!selected?.ok || !selected.state) return null;
    try { return normalizeCanonicalDraftState(selected.state); } catch { return null; }
  };

  const ensureSourceTab = () => {
    if (!sourceTabId) {
      sourceTabId = `tab_${idGenerator('source_tab')}`
        .replace(/[^A-Za-z0-9_-]/gu, '_')
        .slice(0, 128);
    }
    const selected = canonicalOrNull();
    if (selected && selected.sourceTabId !== sourceTabId) {
      dispatch(patchDraftContext({ sourceTabId }));
    }
  };

  const syncLocalStatus = (localStatus) => {
    const storageMode = localStatus?.storageMode
      || safeStorageMode(options.storage, localPersistence);
    if (localStatus?.lastErrorCode) {
      networkBlockState = DRAFT_SYNC_MANAGER_STATES.ERROR;
      dispatch(setDraftSyncError({
        errorCode: safeCode(localStatus.lastErrorCode, DRAFT_SYNC_ERROR_CODES.LOCAL_CACHE_FAILED),
        retryCount: 0,
      }));
      return updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.ERROR,
        storageMode,
        errorCode: DRAFT_SYNC_ERROR_CODES.LOCAL_CACHE_FAILED,
      });
    }
    const savedAt = localStatus?.lastSavedAt || nowIso(clock);
    const current = canonicalOrNull();
    const preservedNetworkState = networkBlockState;
    dispatch(setDraftLocalSaved({
      storageMode,
      lastLocalSavedAt: savedAt,
      confirmedClientRevision: current?.clientRevision ?? null,
    }));
    if (!status.online) {
      dispatch(setDraftOfflineLocalOnly({ storageMode, errorCode: null }));
    } else if (preservedNetworkState === DRAFT_SYNC_MANAGER_STATES.RETRYING) {
      dispatch(setDraftRetrying({
        errorCode: safeCode(status.errorCode, DRAFT_SYNC_ERROR_CODES.PERMANENT_FAILURE),
        retryCount: status.retryCount,
      }));
    } else if (preservedNetworkState === DRAFT_SYNC_MANAGER_STATES.CONFLICT) {
      dispatch(setDraftRetrying({
        errorCode: DRAFT_SYNC_ERROR_CODES.CONFLICT,
        retryCount: status.retryCount,
      }));
    } else if (preservedNetworkState === DRAFT_SYNC_MANAGER_STATES.ERROR) {
      dispatch(setDraftSyncError({
        errorCode: safeCode(status.errorCode, DRAFT_SYNC_ERROR_CODES.PERMANENT_FAILURE),
        retryCount: status.retryCount,
      }));
    }
    return updateStatus({
      state: preservedNetworkState || (!status.online || storageMode === 'memory_only'
        ? DRAFT_SYNC_MANAGER_STATES.OFFLINE_LOCAL_ONLY
        : DRAFT_SYNC_MANAGER_STATES.LOCAL_SAVED),
      storageMode,
      lastLocalSavedAt: savedAt,
      errorCode: preservedNetworkState ? status.errorCode : null,
    });
  };

  const flushLocal = async () => {
    const current = canonicalOrNull();
    const storageMode = safeStorageMode(options.storage, localPersistence);
    if (current) {
      dispatch(setDraftLocalSaving({
        storageMode,
        pendingClientRevision: current.clientRevision,
      }));
      updateStatus({ state: DRAFT_SYNC_MANAGER_STATES.LOCAL_SAVING, storageMode });
    }
    if (localPersistence) {
      const result = await flushLocalCanonicalDraftPersistence(localPersistence);
      return syncLocalStatus(result);
    }
    const save = canonicalCache?.saveCanonicalDraftCache || canonicalCache?.save;
    if (typeof save !== 'function' || !current) {
      networkBlockState = DRAFT_SYNC_MANAGER_STATES.ERROR;
      return updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.ERROR,
        errorCode: DRAFT_SYNC_ERROR_CODES.LOCAL_CACHE_FAILED,
      });
    }
    const result = await save({
      namespace: options.namespace,
      storage: options.storage,
      state: current,
      now: clock,
      ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
      ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
    });
    return syncLocalStatus({
      lastErrorCode: result?.ok ? null : result?.errorCode,
      lastSavedAt: result?.envelope?.savedAtClient,
      storageMode: result?.envelope?.storageMode || storageMode,
    });
  };

  const loadCredentials = async (preferRecoverySession = false) => {
    const operation = credentialVault?.loadDraftCredentialBundle || credentialVault?.load;
    if (typeof operation !== 'function') return null;
    const loaded = await operation.call(credentialVault, {
      namespace: options.namespace,
      browserNamespace: options.namespace,
      environment: options.environment,
    });
    if (!loaded?.ok || !loaded.bundle) return null;
    const authorization = authorizationFromBundle(loaded.bundle, preferRecoverySession);
    if (!authorization) return null;
    return { bundle: loaded.bundle, authorization };
  };

  const hydrateMergedCanonicalState = async (candidate, restoredFrom = 'merged') => {
    const normalized = normalizeCanonicalDraftState({
      ...candidate,
      clientRevision: Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max(
          candidate.clientRevision,
          canonicalOrNull()?.clientRevision || 0,
        ) + 1,
      ),
      sourceTabId,
      savedAtClient: null,
      savedAtServer: candidate.savedAtServer || null,
    });
    const stateHash = await hashCanonicalDraftState(normalized, {
      ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
      ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
    });
    dispatch(loadCanonicalDraftState(normalized, {
      source: restoredFrom,
      completedAt: nowIso(clock),
      namespace: options.namespace,
      lastStateHash: stateHash,
      storageMode: safeStorageMode(options.storage, localPersistence),
    }));
    lastObservedRevision = normalized.clientRevision;
    lastObservedSignature = contentSignature(normalized);
    return normalized;
  };

  const exposePendingConflict = (errorCode, mergeResult) => {
    pendingConflict = { errorCode, mergeResult };
    networkBlockState = DRAFT_SYNC_MANAGER_STATES.CONFLICT;
    updateStatus({
      state: DRAFT_SYNC_MANAGER_STATES.CONFLICT,
      hasConflict: true,
      conflictCount: mergeResult.conflicts.length,
      conflictRoundCount,
      pending: false,
      errorCode: DRAFT_SYNC_ERROR_CODES.CONFLICT,
    });
    try {
      conflictAdapter.handleConflict?.(Object.freeze({
        errorCode,
        conflicts: mergeResult.conflicts,
        diagnostics: getSafeMergeDiagnostics(mergeResult),
      }));
    } catch {}
    return publicStatus(status);
  };

  const processRevisionConflict = async (error, runOptions = {}) => {
    clearNetworkTimers();
    conflictRoundCount += 1;
    if (conflictRoundCount > maxConflictRounds) {
      networkBlockState = DRAFT_SYNC_MANAGER_STATES.CONFLICT;
      pendingConflict = null;
      return updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.CONFLICT,
        hasConflict: true,
        conflictCount: 0,
        conflictRoundCount,
        pending: false,
        errorCode: DRAFT_SYNC_ERROR_CODES.MAX_CONFLICT_ROUNDS_EXCEEDED,
      });
    }
    const local = runOptions.preparedCanonical || canonicalOrNull();
    if (!local) return exposePendingConflict(error.code, {
      conflicts: [], adoptedLocalPaths: [], adoptedServerPaths: [], warnings: [],
      result: DRAFT_MERGE_RESULTS.INVALID,
    });
    supportRecoveryCopy = cloneCanonicalDraftState(local);
    const terminalStatus = error?.conflict?.status;
    if (TERMINAL_SERVER_STATUSES.has(terminalStatus)) {
      networkBlockState = terminalStatus === 'submitted'
        ? DRAFT_SYNC_MANAGER_STATES.SUBMITTED
        : DRAFT_SYNC_MANAGER_STATES.SUPERSEDED;
      try {
        conflictAdapter.broadcastTerminalStatus?.(Object.freeze({
          status: terminalStatus,
          clientRevision: local.clientRevision,
          serverRevision: error?.conflict?.serverRevision,
        }));
      } catch {}
      return updateStatus({
        state: networkBlockState,
        locked: true,
        isReadOnly: terminalStatus === 'submitted',
        pending: false,
        errorCode: terminalStatus === 'submitted'
          ? DRAFT_SYNC_ERROR_CODES.SUBMITTED : DRAFT_SYNC_ERROR_CODES.SUPERSEDED,
      });
    }
    if (typeof draftApiClient.loadProFormDraft !== 'function') {
      return exposePendingConflict(error.code, {
        conflicts: [], adoptedLocalPaths: [], adoptedServerPaths: [], warnings: [],
        result: DRAFT_MERGE_RESULTS.USER_CHOICE_REQUIRED,
      });
    }
    let credentials;
    let loaded;
    try {
      credentials = await loadCredentials(runOptions.preferRecoverySession === true);
      if (!credentials) throw new Error('AUTHORIZATION_REQUIRED');
      loaded = await draftApiClient.loadProFormDraft({
        apiVersion: 1,
        authorization: credentials.authorization,
        requestedDraftId: local.draftId,
        includeCanonicalState: true,
        upgradeLegacyOnLoad: false,
        clientContext: { environment: options.environment || 'unknown' },
      });
    } catch {
      return exposePendingConflict(error.code, {
        conflicts: [], adoptedLocalPaths: [], adoptedServerPaths: [], warnings: [],
        result: DRAFT_MERGE_RESULTS.USER_CHOICE_REQUIRED,
      });
    }
    const server = loaded?.draft?.canonicalState;
    const mergeResult = await mergeCanonicalDraftStates({
      localState: local,
      serverState: server,
      baseState: lastAcceptedBaseState,
    });
    if (mergeResult.result === DRAFT_MERGE_RESULTS.USER_CHOICE_REQUIRED) {
      return exposePendingConflict(error.code, mergeResult);
    }
    if ([DRAFT_MERGE_RESULTS.INVALID, DRAFT_MERGE_RESULTS.INCOMPATIBLE]
      .includes(mergeResult.result) || !mergeResult.mergedState) {
      return exposePendingConflict(error.code, mergeResult);
    }
    if (TERMINAL_SERVER_STATUSES.has(mergeResult.mergedState.draftStatus)) {
      await hydrateMergedCanonicalState(mergeResult.mergedState, 'server');
      networkBlockState = mergeResult.mergedState.draftStatus === 'submitted'
        ? DRAFT_SYNC_MANAGER_STATES.SUBMITTED : DRAFT_SYNC_MANAGER_STATES.SUPERSEDED;
      return updateStatus({
        state: networkBlockState,
        locked: true,
        isReadOnly: mergeResult.mergedState.draftStatus === 'submitted',
        pending: false,
      });
    }
    await hydrateMergedCanonicalState(mergeResult.mergedState);
    pendingConflict = null;
    attempt = null;
    networkBlockState = null;
    updateStatus({
      state: DRAFT_SYNC_MANAGER_STATES.RETRYING,
      hasConflict: false,
      conflictCount: 0,
      conflictRoundCount,
      pending: true,
      errorCode: null,
    });
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      void runSave({ reason: 'conflict_merge', force: true, conflictMerge: true });
    }, 0);
    return publicStatus(status);
  };

  const retryDelay = (retryCount, retryAfterSeconds = 0) => {
    const exponential = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, retryCount - 1)));
    const jitter = exponential * retryJitterRatio * ((Math.min(1, Math.max(0, random()))) * 2 - 1);
    return Math.max(
      Math.min(retryMaxMs, Math.round(exponential + jitter)),
      boundedInteger(retryAfterSeconds, 0, 0, 86_400) * 1_000,
    );
  };

  const scheduleRetry = (error) => {
    const nextRetry = status.retryCount + 1;
    if (nextRetry > maxRetries) {
      attempt = null;
      networkBlockState = DRAFT_SYNC_MANAGER_STATES.ERROR;
      dispatch(setDraftSyncError({
        errorCode: DRAFT_SYNC_ERROR_CODES.MAX_RETRIES_EXCEEDED,
        retryCount: maxRetries,
      }));
      return updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.ERROR,
        retryCount: maxRetries,
        errorCode: DRAFT_SYNC_ERROR_CODES.MAX_RETRIES_EXCEEDED,
      });
    }
    const errorCode = safeCode(error?.code, DRAFT_SYNC_ERROR_CODES.PERMANENT_FAILURE);
    networkBlockState = DRAFT_SYNC_MANAGER_STATES.RETRYING;
    dispatch(setDraftRetrying({ errorCode, retryCount: nextRetry }));
    const delay = retryDelay(nextRetry, error?.retryAfterSeconds);
    updateStatus({
      state: DRAFT_SYNC_MANAGER_STATES.RETRYING,
      retryCount: nextRetry,
      errorCode,
      pending: true,
    });
    clearTimer(retryTimer);
    retryTimer = setTimer(() => {
      retryTimer = null;
      void runSave({ reason: pendingReason, retry: true });
    }, delay);
    log('warn', 'save_retry_scheduled', { delay, errorCode });
    return publicStatus(status);
  };

  const validateAcceptedResponse = (response, canonicalState, stateHash) => {
    if (!isPlainObject(response) || response.success !== true
      || response.draft?.draftId !== canonicalState.draftId
      || response.stateHash !== stateHash
      || !Number.isSafeInteger(response.acceptedClientRevision)
      || response.acceptedClientRevision !== canonicalState.clientRevision
      || !Number.isSafeInteger(response.acceptedServerRevision)
      || response.acceptedServerRevision < canonicalState.serverRevision
      || response.acceptedStatus !== canonicalState.draftStatus) {
      throw Object.assign(new Error('Invalid draft save response.'), {
        code: DRAFT_SYNC_ERROR_CODES.RESPONSE_INVALID,
        status: 502,
        retryable: true,
      });
    }
    return response;
  };

  const prepareSave = async (reason, runOptions = {}) => {
    if (status.disposed) throw Object.assign(new Error('Disposed.'), {
      code: DRAFT_SYNC_ERROR_CODES.DISPOSED,
    });
    if (!bootstrapReady()) throw Object.assign(new Error('Bootstrap not ready.'), {
      code: DRAFT_SYNC_ERROR_CODES.BOOTSTRAP_NOT_READY,
    });
    const canonical = canonicalOrNull();
    if (!canonical) throw Object.assign(new Error('Canonical state invalid.'), {
      code: DRAFT_SYNC_ERROR_CODES.CANONICAL_STATE_INVALID,
    });
    const submittedSave = runOptions.allowSubmitted === true
      && canonical.draftStatus === 'submitted';
    if ((readOnlyProvider() || status.isReadOnly) && !submittedSave) {
      throw Object.assign(new Error('Read only.'), { code: DRAFT_SYNC_ERROR_CODES.READ_ONLY });
    }
    if ((status.locked || status.hasConflict) && !submittedSave) {
      throw Object.assign(new Error('Draft locked.'), {
        code: status.hasConflict
          ? DRAFT_SYNC_ERROR_CODES.CONFLICT
          : DRAFT_SYNC_ERROR_CODES.SUPERSEDED,
      });
    }
    if (!canonical.draftId || !canonical.sessionId) {
      throw Object.assign(new Error('Draft identity missing.'), {
        code: DRAFT_SYNC_ERROR_CODES.CREDENTIALS_INVALID,
      });
    }
    let normalized = normalizeCanonicalDraftState(canonical);
    if (normalized.draftStatus === 'submit_failed' && lastSubmissionErrorCode) {
      normalized = normalizeCanonicalDraftState({
        ...normalized,
        submission: {
          ...normalized.submission,
          lastSubmissionErrorCode,
        },
      });
    }
    let serialized;
    let stateHash;
    try {
      serialized = serializeCanonicalDraftState(normalized);
      stateHash = await hashCanonicalDraftState(normalized, {
        ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
        ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
      });
      if (normalized.draftStatus === 'submitted') {
        normalized = normalizeCanonicalDraftState({
          ...normalized,
          submission: {
            ...normalized.submission,
            submittedStateHash: stateHash,
            pdfSourceStateHash: stateHash,
          },
        });
        serialized = serializeCanonicalDraftState(normalized);
      }
    } catch (error) {
      throw Object.assign(new Error('Canonical serialization failed.'), {
        code: safeCode(error?.code, DRAFT_SYNC_ERROR_CODES.SERIALIZATION_FAILED),
      });
    }
    const signature = contentSignature(normalized);
    if (!runOptions.force && lastAcceptedSignature === signature
      && status.confirmedClientRevision !== null
      && normalized.clientRevision <= status.confirmedClientRevision) {
      return { skipped: true, canonical: normalized, signature, stateHash, serialized };
    }
    const credentials = await loadCredentials(runOptions.preferRecoverySession === true);
    if (!credentials || credentials.bundle.draftId !== normalized.draftId
      || credentials.bundle.sessionId !== normalized.sessionId) {
      throw Object.assign(new Error('Credential binding missing.'), {
        code: DRAFT_SYNC_ERROR_CODES.CREDENTIALS_INVALID,
        status: 401,
      });
    }
    if (!attempt || attempt.stateHash !== stateHash) {
      attempt = {
        stateHash,
        idempotencyKey: idGenerator('snapshot'),
      };
    }
    return {
      skipped: false,
      canonical: normalized,
      signature,
      stateHash,
      serialized,
      authorization: credentials.authorization,
      idempotencyKey: attempt.idempotencyKey,
      reason,
    };
  };

  const handleSaveError = async (error, runOptions) => {
    const code = safeCode(error?.code, DRAFT_SYNC_ERROR_CODES.PERMANENT_FAILURE);
    if (TERMINAL_CODES.has(code)) {
      clearNetworkTimers();
      const local = runOptions.preparedCanonical || canonicalOrNull();
      supportRecoveryCopy = local ? cloneCanonicalDraftState(local) : supportRecoveryCopy;
      attempt = null;
      networkBlockState = DRAFT_SYNC_MANAGER_STATES.SUPERSEDED;
      try {
        conflictAdapter.broadcastTerminalStatus?.(Object.freeze({
          status: 'cleared_superseded',
          clientRevision: local?.clientRevision,
          serverRevision: error?.conflict?.serverRevision,
        }));
      } catch {}
      return updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.SUPERSEDED,
        locked: true,
        pending: false,
        errorCode: DRAFT_SYNC_ERROR_CODES.SUPERSEDED,
      });
    }
    if (CONFLICT_CODES.has(code) || error?.mergeRequired === true) {
      return processRevisionConflict(error, runOptions);
    }
    if ((AUTHORIZATION_CODES.has(code) || error?.status === 401 || error?.status === 403)
      && !authorizationFallbackAttempted && runOptions.preferRecoverySession !== true) {
      const fallback = await loadCredentials(true);
      if (fallback?.bundle?.recoverySessionToken) {
        authorizationFallbackAttempted = true;
        preferRecoverySessionNext = true;
        status.pending = true;
        debounceTimer = setTimer(() => {
          debounceTimer = null;
          void runSave({ ...runOptions, retry: true, preferRecoverySession: true });
        }, 0);
        return publicStatus(status);
      }
      if (typeof options.refreshAuthorization === 'function') {
        try {
          const refreshed = await options.refreshAuthorization();
          if (refreshed === true) {
            authorizationFallbackAttempted = true;
            status.pending = true;
            debounceTimer = setTimer(() => {
              debounceTimer = null;
              void runSave({ ...runOptions, retry: true });
            }, 0);
            return publicStatus(status);
          }
        } catch {}
      }
      attempt = null;
      networkBlockState = DRAFT_SYNC_MANAGER_STATES.ERROR;
      dispatch(setDraftSyncError({
        errorCode: DRAFT_SYNC_ERROR_CODES.AUTHORIZATION_REQUIRED,
        retryCount: status.retryCount,
      }));
      return updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.ERROR,
        pending: false,
        errorCode: DRAFT_SYNC_ERROR_CODES.AUTHORIZATION_REQUIRED,
      });
    }
    if (error?.retryable === true || Number(error?.status) >= 500 || Number(error?.status) === 0) {
      return scheduleRetry(error);
    }
    attempt = null;
    networkBlockState = DRAFT_SYNC_MANAGER_STATES.ERROR;
    dispatch(setDraftSyncError({ errorCode: code, retryCount: status.retryCount }));
    return updateStatus({
      state: DRAFT_SYNC_MANAGER_STATES.ERROR,
      pending: false,
      errorCode: code,
    });
  };

  async function runSave(runOptions = {}) {
    if (preferRecoverySessionNext && runOptions.preferRecoverySession !== true) {
      runOptions = { ...runOptions, preferRecoverySession: true };
    }
    if (savePromise) {
      status.pending = true;
      return savePromise;
    }
    clearSaveTimers();
    if (!status.online) {
      dispatch(setDraftOfflineLocalOnly({
        storageMode: safeStorageMode(options.storage, localPersistence),
        errorCode: null,
      }));
      return updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.OFFLINE_LOCAL_ONLY,
        pending: true,
      });
    }
    const reason = runOptions.reason || pendingReason || 'autosave';
    savePromise = (async () => {
      status.inFlight = true;
      const local = await flushLocal();
      if (local.errorCode === DRAFT_SYNC_ERROR_CODES.LOCAL_CACHE_FAILED) {
        status.pending = false;
        return publicStatus(status);
      }
      let prepared;
      try {
        prepared = await prepareSave(reason, runOptions);
        if (prepared.skipped) {
          status.pending = false;
          return updateStatus({
            state: DRAFT_SYNC_MANAGER_STATES.SERVER_SAVED,
            errorCode: null,
          });
        }
        dispatch(setDraftServerSaving({
          pendingClientRevision: prepared.canonical.clientRevision,
        }));
        updateStatus({
          state: DRAFT_SYNC_MANAGER_STATES.SERVER_SAVING,
          pending: false,
          errorCode: null,
        });
        try {
          conflictAdapter.broadcastSaveInProgress?.(Object.freeze({
            clientRevision: prepared.canonical.clientRevision,
            serverRevision: prepared.canonical.serverRevision,
            stateHash: prepared.stateHash,
          }));
        } catch {}
        const syncReason = SUBMIT_REASONS[prepared.canonical.draftStatus]
          || (reason === 'manual_save' ? 'manual_save' : 'autosave');
        const response = await draftApiClient.saveProFormDraft({
          authorization: prepared.authorization,
          draftId: prepared.canonical.draftId,
          expectedServerRevision: prepared.canonical.serverRevision,
          idempotencyKey: prepared.idempotencyKey,
          canonicalState: prepared.canonical,
          syncReason,
          requestedStatus: prepared.canonical.draftStatus,
        });
        validateAcceptedResponse(response, prepared.canonical, prepared.stateHash);
        const savedAt = typeof response.draft?.lastSavedAt === 'string'
          && Number.isFinite(Date.parse(response.draft.lastSavedAt))
          ? new Date(response.draft.lastSavedAt).toISOString()
          : nowIso(clock);
        dispatch(setDraftServerSaved({
          confirmedClientRevision: response.acceptedClientRevision,
          confirmedServerRevision: response.acceptedServerRevision,
          lastServerSavedAt: savedAt,
        }));
        dispatch(setDraftStateHash(response.stateHash));
        lastAcceptedSignature = prepared.signature;
        lastAcceptedBaseState = normalizeCanonicalDraftState({
          ...prepared.canonical,
          serverRevision: response.acceptedServerRevision,
          savedAtServer: savedAt,
        });
        pendingConflict = null;
        conflictRoundCount = 0;
        attempt = null;
        networkBlockState = prepared.canonical.draftStatus === 'submitted'
          ? DRAFT_SYNC_MANAGER_STATES.SUBMITTED
          : null;
        authorizationFallbackAttempted = false;
        preferRecoverySessionNext = false;
        updateStatus({
          state: prepared.canonical.draftStatus === 'submitted'
            ? DRAFT_SYNC_MANAGER_STATES.SUBMITTED
            : DRAFT_SYNC_MANAGER_STATES.SERVER_SAVED,
          retryCount: 0,
          errorCode: null,
          lastServerSavedAt: savedAt,
          confirmedClientRevision: response.acceptedClientRevision,
          confirmedServerRevision: response.acceptedServerRevision,
          hasConflict: false,
          conflictCount: 0,
          conflictRoundCount: 0,
        });
        try {
          conflictAdapter.broadcastAcceptedRevision?.(Object.freeze({
            draftId: prepared.canonical.draftId,
            clientRevision: response.acceptedClientRevision,
            serverRevision: response.acceptedServerRevision,
            stateHash: response.stateHash,
            sourceTabId,
          }));
        } catch {}
        void flushEvents({ afterSnapshot: true });
        const latest = canonicalOrNull();
        const latestSignature = latest ? contentSignature(latest) : null;
        status.pending = latestSignature !== null && latestSignature !== prepared.signature
          && !status.locked && !status.hasConflict;
        log('info', 'save_accepted', {
          clientRevision: response.acceptedClientRevision,
          serverRevision: response.acceptedServerRevision,
          idempotent: response.idempotent === true,
        });
        return publicStatus(status);
      } catch (error) {
        log('warn', 'save_failed', {
          errorCode: safeCode(error?.code, DRAFT_SYNC_ERROR_CODES.PERMANENT_FAILURE),
          retryable: error?.retryable === true,
          status: Number.isFinite(error?.status) ? error.status : null,
        });
        return handleSaveError(error, {
          ...runOptions,
          ...(prepared?.canonical ? { preparedCanonical: prepared.canonical } : {}),
        });
      }
    })().finally(() => {
      status.inFlight = false;
      savePromise = null;
      notify();
      if (status.pending && status.online && !retryTimer
        && !debounceTimer && !status.locked && !status.hasConflict && status.active) {
        debounceTimer = setTimer(() => {
          debounceTimer = null;
          void runSave({ reason: pendingReason });
        }, 0);
      }
    });
    return savePromise;
  }

  const scheduleSave = (reason = 'autosave', metadata = null) => {
    if (!status.active || status.disposed || status.locked || status.hasConflict
      || status.isReadOnly) return publicStatus(status);
    pendingReason = typeof reason === 'string' ? reason : 'autosave';
    if (retryTimer) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    if (networkBlockState === DRAFT_SYNC_MANAGER_STATES.RETRYING
      || networkBlockState === DRAFT_SYNC_MANAGER_STATES.ERROR) {
      networkBlockState = null;
    }
    pendingMetadata = isPlainObject(metadata) ? Object.freeze({ ...metadata }) : null;
    status.pending = true;
    const current = canonicalOrNull();
    if (current) {
      dispatch(setDraftLocalSaving({
        storageMode: safeStorageMode(options.storage, localPersistence),
        pendingClientRevision: current.clientRevision,
      }));
    }
    updateStatus({ state: DRAFT_SYNC_MANAGER_STATES.LOCAL_SAVING, errorCode: null });
    if (!status.online) {
      dispatch(setDraftOfflineLocalOnly({
        storageMode: safeStorageMode(options.storage, localPersistence),
        errorCode: null,
      }));
      void flushLocal();
      return updateStatus({ state: DRAFT_SYNC_MANAGER_STATES.OFFLINE_LOCAL_ONLY });
    }
    const currentTime = nowMilliseconds(clock);
    if (firstPendingAt === null) {
      firstPendingAt = currentTime;
      maxWaitTimer = setTimer(() => {
        maxWaitTimer = null;
        void runSave({ reason: pendingReason, metadata: pendingMetadata });
      }, maxWaitMs);
    }
    clearTimer(debounceTimer);
    const elapsed = Math.max(0, currentTime - firstPendingAt);
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      void runSave({ reason: pendingReason, metadata: pendingMetadata });
    }, Math.min(debounceMs, Math.max(0, maxWaitMs - elapsed)));
    return publicStatus(status);
  };

  const observeStore = (captureMetadata = null) => {
    if (internalDispatch || !status.active || status.disposed) return;
    const canonical = canonicalOrNull();
    if (!canonical) {
      updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.ERROR,
        errorCode: DRAFT_SYNC_ERROR_CODES.CANONICAL_STATE_INVALID,
      });
      return;
    }
    let signature;
    try { signature = contentSignature(canonical); } catch {
      updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.ERROR,
        errorCode: DRAFT_SYNC_ERROR_CODES.SERIALIZATION_FAILED,
      });
      return;
    }
    if (signature === lastObservedSignature) return;
    lastObservedSignature = signature;
    if (status.locked || status.hasConflict || status.isReadOnly) return;
    let clientRevision = canonical.clientRevision;
    if (clientRevision <= lastObservedRevision && clientRevision < Number.MAX_SAFE_INTEGER) {
      clientRevision += 1;
      dispatch(setDraftRevisions({
        clientRevision,
        serverRevision: canonical.serverRevision,
      }));
    }
    lastObservedRevision = Math.max(lastObservedRevision, clientRevision);
    try {
      conflictAdapter.broadcastLocalRevision?.(Object.freeze({
        clientRevision,
        serverRevision: canonical.serverRevision,
        mutationId: canonical.lastMutation?.mutationId || undefined,
      }));
    } catch {}
    const reason = typeof captureMetadata?.reason === 'string'
      ? captureMetadata.reason
      : canonical.lastMutation?.reason === 'restore'
        ? 'restore'
        : canonical.lastMutation?.reason === 'clear_all'
          ? 'clear_all'
          : 'autosave';
    scheduleSave(reason, {
      clientRevision,
      ...(canonical.lastMutation?.mutationId
        ? { mutationId: canonical.lastMutation.mutationId }
        : {}),
      ...(captureMetadata?.questionId ? { questionId: captureMetadata.questionId } : {}),
    });
  };

  const capturePostReducerMutation = (mutation) => {
    if (!mutation || mutation.hydration === true) return publicStatus(status);
    observeStore(mutation);
    return publicStatus(status);
  };

  const scheduleEventFlush = () => {
    if (!status.active || !status.online || eventPromise || eventRetryTimer || eventTimer
      || eventAutoFlushBlocked) return;
    eventTimer = setTimer(() => {
      eventTimer = null;
      void flushEvents();
    }, debounceMs);
  };

  const queueEvent = (eventInput) => {
    if (status.disposed || status.locked) return false;
    let eventId;
    try {
      eventId = typeof eventInput?.eventId === 'string' && SAFE_ID.test(eventInput.eventId)
        ? eventInput.eventId
        : `evt_${idGenerator('event')}`.slice(0, 128);
    } catch {
      return false;
    }
    if (eventIds.has(eventId)) return false;
    const event = safeEvent(eventInput, eventId, nowIso(clock));
    if (!event) return false;
    while (eventQueue.length >= eventQueueLimit) {
      const removed = eventQueue.shift();
      if (removed) eventIds.delete(removed.eventId);
    }
    eventQueue.push(event);
    eventIds.add(eventId);
    updateStatus({ eventQueueSize: eventQueue.length });
    scheduleEventFlush();
    return true;
  };

  async function flushEvents(eventOptions = {}) {
    if (eventPromise) return eventPromise;
    if (eventAutoFlushBlocked && eventOptions.force !== true && eventOptions.retry !== true) {
      return publicStatus(status);
    }
    if (eventOptions.force === true || eventOptions.retry === true) {
      eventAutoFlushBlocked = false;
    }
    if (!status.online || eventQueue.length === 0 || status.disposed) return publicStatus(status);
    eventPromise = (async () => {
      const canonical = canonicalOrNull();
      if (!canonical?.draftId) {
        eventAutoFlushBlocked = true;
        return publicStatus(status);
      }
      const credentials = await loadCredentials();
      if (!credentials || credentials.bundle.draftId !== canonical.draftId) {
        eventAutoFlushBlocked = true;
        updateStatus({ eventErrorCode: DRAFT_SYNC_ERROR_CODES.AUTHORIZATION_REQUIRED });
        return publicStatus(status);
      }
      if (!eventAttempt) {
        const events = eventQueue.slice(0, eventBatchSize);
        eventAttempt = {
          eventIds: events.map((event) => event.eventId),
          events,
          idempotencyKey: idGenerator('event_batch'),
        };
      }
      try {
        await eventApiClient.appendProFormDraftEvents({
          authorization: credentials.authorization,
          draftId: canonical.draftId,
          idempotencyKey: eventAttempt.idempotencyKey,
          clientRevision: canonical.clientRevision,
          sourceTabId: canonical.sourceTabId || sourceTabId,
          events: eventAttempt.events,
        });
        const accepted = new Set(eventAttempt.eventIds);
        for (let index = eventQueue.length - 1; index >= 0; index -= 1) {
          if (accepted.has(eventQueue[index].eventId)) {
            eventIds.delete(eventQueue[index].eventId);
            eventQueue.splice(index, 1);
          }
        }
        eventAttempt = null;
        eventAutoFlushBlocked = false;
        updateStatus({
          eventQueueSize: eventQueue.length,
          eventRetryCount: 0,
          eventErrorCode: null,
        });
        if (eventQueue.length > 0) scheduleEventFlush();
      } catch (error) {
        const nextRetry = status.eventRetryCount + 1;
        updateStatus({
          eventRetryCount: Math.min(nextRetry, maxRetries),
          eventErrorCode: safeCode(error?.code, DRAFT_SYNC_ERROR_CODES.EVENT_FAILED),
        });
        if ((error?.retryable === true || Number(error?.status) >= 500)
          && nextRetry <= maxRetries && status.online) {
          eventRetryTimer = setTimer(() => {
            eventRetryTimer = null;
            void flushEvents({ retry: true });
          }, retryDelay(nextRetry, error?.retryAfterSeconds));
        } else {
          eventAttempt = null;
          eventAutoFlushBlocked = true;
        }
      }
      return publicStatus(status);
    })().finally(() => {
      eventPromise = null;
      if (eventQueue.length > 0 && !eventRetryTimer && status.online && status.active
        && !eventAutoFlushBlocked) {
        scheduleEventFlush();
      }
    });
    return eventPromise;
  }

  const getPendingConflict = () => {
    if (!pendingConflict?.mergeResult) return null;
    return Object.freeze({
      errorCode: pendingConflict.errorCode,
      conflicts: pendingConflict.mergeResult.conflicts,
      diagnostics: getSafeMergeDiagnostics(pendingConflict.mergeResult),
    });
  };

  const resolveConflictChoices = async (choices) => {
    if (!pendingConflict?.mergeResult) return publicStatus(status);
    const applied = await applyDraftConflictChoices(pendingConflict.mergeResult, choices);
    if (applied.result !== DRAFT_MERGE_RESULTS.MERGED || !applied.mergedState) {
      return updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.CONFLICT,
        hasConflict: true,
        errorCode: DRAFT_SYNC_ERROR_CODES.CONFLICT,
      });
    }
    await hydrateMergedCanonicalState(applied.mergedState);
    pendingConflict = null;
    attempt = null;
    networkBlockState = null;
    updateStatus({
      state: DRAFT_SYNC_MANAGER_STATES.RETRYING,
      hasConflict: false,
      conflictCount: 0,
      pending: true,
      errorCode: null,
    });
    return saveImmediately('conflict_choice', { force: true, conflictMerge: true });
  };

  const handleTabMessage = (message) => {
    if (!message || message.sourceTabId === sourceTabId) return publicStatus(status);
    if (message.type === 'server_revision_accepted'
      && Number.isSafeInteger(message.serverRevision)
      && message.serverRevision > (canonicalOrNull()?.serverRevision || 0)
      && !status.locked && !status.hasConflict) {
      status.pending = true;
      clearTimer(debounceTimer);
      debounceTimer = setTimer(() => {
        debounceTimer = null;
        void runSave({ reason: 'tab_revision_accepted', force: true });
      }, 0);
    }
    if (message.type === 'draft_submitted') {
      supportRecoveryCopy = canonicalOrNull();
      networkBlockState = DRAFT_SYNC_MANAGER_STATES.SUBMITTED;
      updateStatus({ state: DRAFT_SYNC_MANAGER_STATES.SUBMITTED, locked: true, isReadOnly: true });
    }
    if (message.type === 'draft_superseded') invalidateAfterSupersession();
    return publicStatus(status);
  };

  const saveImmediately = (reason = 'manual_save', saveOptions = {}) => {
    if ((status.hasConflict || status.locked
      || networkBlockState === DRAFT_SYNC_MANAGER_STATES.ERROR
      || networkBlockState === DRAFT_SYNC_MANAGER_STATES.RETRYING
      || networkBlockState === DRAFT_SYNC_MANAGER_STATES.CONFLICT
      || networkBlockState === DRAFT_SYNC_MANAGER_STATES.SUPERSEDED)
      && saveOptions.force !== true && saveOptions.allowSubmitted !== true) {
      return Promise.resolve(publicStatus(status));
    }
    status.pending = true;
    pendingReason = reason;
    clearSaveTimers();
    return runSave({ ...saveOptions, reason });
  };

  const flush = async (flushOptions = {}) => {
    await flushLocal();
    if (flushOptions.localOnly === true) return publicStatus(status);
    await saveImmediately(flushOptions.reason || pendingReason || 'manual_save', flushOptions);
    if (savePromise) await savePromise;
    return publicStatus(status);
  };

  const setOnlineState = (isOnline) => {
    const online = isOnline !== false;
    status.online = online;
    if (!online) {
      clearTimer(debounceTimer);
      clearTimer(maxWaitTimer);
      clearTimer(retryTimer);
      clearTimer(eventRetryTimer);
      debounceTimer = null;
      maxWaitTimer = null;
      retryTimer = null;
      eventRetryTimer = null;
      dispatch(setDraftOfflineLocalOnly({
        storageMode: safeStorageMode(options.storage, localPersistence),
        errorCode: null,
      }));
      updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.OFFLINE_LOCAL_ONLY,
        pending: status.pending || lastObservedSignature !== lastAcceptedSignature,
      });
      void flushLocal();
      return publicStatus(status);
    }
    updateStatus({ online: true });
    clearTimer(reconnectTimer);
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      if (status.pending || lastObservedSignature !== lastAcceptedSignature) {
        void saveImmediately('autosave', { force: true });
      }
      if (eventQueue.length > 0) void flushEvents();
    }, reconnectDelayMs);
    return publicStatus(status);
  };

  const handleVisibilityChange = () => {
    if (visibilityProvider() !== 'hidden') return publicStatus(status);
    void flushLocal();
    if (status.online && !status.locked && !status.isReadOnly) {
      void saveImmediately('autosave', { force: true, lifecycle: true });
    }
    return publicStatus(status);
  };

  const handlePageHide = (_event) => {
    void flushLocal();
    const keepalive = draftApiClient?.saveProFormDraftKeepalive;
    if (typeof keepalive !== 'function') {
      return updateStatus({ pagehideStrategy: 'local_cache_only' });
    }
    // Base44 functions.fetch accepts native RequestInit, but the current API
    // client does not expose a bounded authenticated keepalive save. Only an
    // explicitly injected adapter may opt into that browser-specific path.
    updateStatus({ pagehideStrategy: 'bounded_keepalive_adapter' });
    try { void keepalive({ reason: 'pagehide', maxBytes: 60 * 1024 }); } catch {}
    return publicStatus(status);
  };

  const handleBeforeUnload = (_event) => {
    // Browser-local persistence is the durability guarantee. No confirmation
    // prompt and no assumption that an asynchronous network request completes.
    try { void flushLocalCanonicalDraftPersistence(localPersistence); } catch {}
    return undefined;
  };

  const setLifecycleStatus = async (draftStatus, reason, errorCode = null) => {
    const canonical = canonicalOrNull();
    if (!canonical) return publicStatus(status);
    dispatch(setDraftStatus(draftStatus));
    dispatch(setDraftRevisions({
      clientRevision: Math.min(Number.MAX_SAFE_INTEGER, canonical.clientRevision + 1),
      serverRevision: canonical.serverRevision,
    }));
    lastSubmissionErrorCode = errorCode;
    const current = canonicalOrNull();
    if (current) {
      lastObservedRevision = current.clientRevision;
      lastObservedSignature = contentSignature(current);
    }
    return saveImmediately(reason, { force: true, allowSubmitted: draftStatus === 'submitted' });
  };

  const markSubmitAttempted = () => setLifecycleStatus(
    'submit_attempted',
    'submit_attempt',
  );

  const markSubmitFailed = (errorCode) => setLifecycleStatus(
    'submit_failed',
    'submit_failed',
    safeCode(errorCode, 'SUBMISSION_FAILED'),
  );

  const markSubmitted = async (finalSubmissionId) => {
    if (typeof finalSubmissionId !== 'string' || !SAFE_ID.test(finalSubmissionId)) {
      updateStatus({
        state: DRAFT_SYNC_MANAGER_STATES.ERROR,
        errorCode: DRAFT_SYNC_ERROR_CODES.PERMANENT_FAILURE,
      });
      return publicStatus(status);
    }
    clearNetworkTimers();
    const canonical = canonicalOrNull();
    if (!canonical) return publicStatus(status);
    const submittedAt = nowIso(clock);
    dispatch(setDraftSubmitted({
      finalSubmissionId,
      submittedAt,
      pdfAvailable: true,
    }));
    dispatch(setDraftRevisions({
      clientRevision: Math.min(Number.MAX_SAFE_INTEGER, canonical.clientRevision + 1),
      serverRevision: canonical.serverRevision,
    }));
    status.locked = true;
    status.isReadOnly = true;
    networkBlockState = DRAFT_SYNC_MANAGER_STATES.SUBMITTED;
    const current = canonicalOrNull();
    if (current) {
      lastObservedRevision = current.clientRevision;
      lastObservedSignature = contentSignature(current);
    }
    await saveImmediately('submitted', { force: true, allowSubmitted: true });
    try {
      conflictAdapter.broadcastTerminalStatus?.(Object.freeze({
        status: 'submitted',
        clientRevision: current?.clientRevision,
        serverRevision: current?.serverRevision,
      }));
    } catch {}
    return updateStatus({
      state: DRAFT_SYNC_MANAGER_STATES.SUBMITTED,
      locked: true,
      isReadOnly: true,
      pending: false,
      errorCode: status.errorCode,
    });
  };

  const invalidateAfterSupersession = () => {
    clearNetworkTimers();
    attempt = null;
    networkBlockState = DRAFT_SYNC_MANAGER_STATES.SUPERSEDED;
    try {
      conflictAdapter.broadcastTerminalStatus?.(Object.freeze({ status: 'cleared_superseded' }));
    } catch {}
    return updateStatus({
      state: DRAFT_SYNC_MANAGER_STATES.SUPERSEDED,
      locked: true,
      pending: false,
      errorCode: DRAFT_SYNC_ERROR_CODES.SUPERSEDED,
    });
  };

  const onOnline = () => setOnlineState(true);
  const onOffline = () => setOnlineState(false);

  const registerLifecycle = () => {
    lifecycle.addDocumentListener?.('visibilitychange', handleVisibilityChange);
    lifecycle.addWindowListener?.('pagehide', handlePageHide);
    lifecycle.addWindowListener?.('beforeunload', handleBeforeUnload);
    lifecycle.addWindowListener?.('online', onOnline);
    lifecycle.addWindowListener?.('offline', onOffline);
  };

  const unregisterLifecycle = () => {
    lifecycle.removeDocumentListener?.('visibilitychange', handleVisibilityChange);
    lifecycle.removeWindowListener?.('pagehide', handlePageHide);
    lifecycle.removeWindowListener?.('beforeunload', handleBeforeUnload);
    lifecycle.removeWindowListener?.('online', onOnline);
    lifecycle.removeWindowListener?.('offline', onOffline);
  };

  const start = () => {
    if (status.disposed) return publicStatus(status);
    if (status.active) return publicStatus(status);
    ensureSourceTab();
    const initial = canonicalOrNull();
    status.isReadOnly = readOnlyProvider() || initial?.draftStatus === 'submitted';
    status.locked = status.isReadOnly;
    status.state = status.isReadOnly && initial?.draftStatus === 'submitted'
      ? DRAFT_SYNC_MANAGER_STATES.SUBMITTED
      : DRAFT_SYNC_MANAGER_STATES.IDLE;
    networkBlockState = status.state === DRAFT_SYNC_MANAGER_STATES.SUBMITTED
      ? DRAFT_SYNC_MANAGER_STATES.SUBMITTED
      : null;
    status.active = true;
    status.online = onlineStateProvider() !== false;
    if (initial) {
      lastObservedSignature = contentSignature(initial);
      lastObservedRevision = initial.clientRevision;
      const bootstrapSource = selectDraftBootstrapStatus(store.getState()).source;
      if (bootstrapSource === 'server') lastAcceptedBaseState = cloneCanonicalDraftState(initial);
    }
    if (localPersistence) {
      startLocalCanonicalDraftPersistence(localPersistence, {
        scheduleInitial: options.scheduleInitialLocalSave !== false,
      });
    }
    if (options.observeStoreChanges !== false) unsubscribeStore = store.subscribe(observeStore);
    registerLifecycle();
    notify();
    if (options.scheduleInitialSave === true && !status.isReadOnly) {
      scheduleSave('bootstrap_upload');
    }
    log('info', 'manager_started', { online: status.online });
    return publicStatus(status);
  };

  const stop = async () => {
    if (!status.active) return publicStatus(status);
    status.active = false;
    clearNetworkTimers();
    unsubscribeStore?.();
    unsubscribeStore = null;
    unregisterLifecycle();
    if (localPersistence) await stopLocalCanonicalDraftPersistence(localPersistence);
    updateStatus({ state: DRAFT_SYNC_MANAGER_STATES.IDLE, pending: false, inFlight: false });
    return publicStatus(status);
  };

  const dispose = async () => {
    if (status.disposed) return publicStatus(status);
    await stop();
    listeners.clear();
    eventQueue.length = 0;
    eventIds.clear();
    return updateStatus({
      state: DRAFT_SYNC_MANAGER_STATES.DISPOSED,
      disposed: true,
      active: false,
      pending: false,
      eventQueueSize: 0,
    });
  };

  return Object.freeze({
    start,
    stop,
    scheduleSave,
    capturePostReducerMutation,
    saveImmediately,
    flush,
    queueEvent,
    flushEvents,
    setOnlineState,
    handleVisibilityChange,
    handlePageHide,
    handleBeforeUnload,
    markSubmitAttempted,
    markSubmitFailed,
    markSubmitted,
    invalidateAfterSupersession,
    getPendingConflict,
    resolveConflictChoices,
    handleTabMessage,
    getSupportRecoveryDiagnostics: () => Object.freeze({
      present: Boolean(supportRecoveryCopy),
      status: supportRecoveryCopy?.draftStatus || null,
      clientRevision: supportRecoveryCopy?.clientRevision ?? null,
      containsTokens: false,
      authoritative: false,
    }),
    getStatus: () => publicStatus(status),
    subscribeStatus(listener) {
      if (typeof listener !== 'function') return noOp;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose,
  });
};

export default createProFormDraftSyncManager;
