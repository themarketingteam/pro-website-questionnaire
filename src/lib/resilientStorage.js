const DEFAULT_DATABASE_NAME = 'pro_questionnaire_browser_cache';
const DEFAULT_OBJECT_STORE_NAME = 'key_value';
const DEFAULT_DATABASE_VERSION = 1;
const DEFAULT_SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 1500;
const LOCAL_RECORD_MARKER = 'pro_questionnaire_browser_cache_record_v1';
const PROBE_KEY = '__pro_questionnaire_storage_probe__';
const PROBE_VALUE = 'available';

export const STORAGE_MODES = Object.freeze({
  INDEXEDDB: 'indexeddb',
  LOCALSTORAGE: 'localstorage',
  MEMORY_ONLY: 'memory_only',
  UNKNOWN: 'unknown',
});

export const STORAGE_ERROR_CODES = Object.freeze({
  INVALID_KEY: 'invalid_key',
  INVALID_VALUE: 'invalid_value',
  INDEXEDDB_UNAVAILABLE: 'indexeddb_unavailable',
  INDEXEDDB_OPEN_FAILED: 'indexeddb_open_failed',
  INDEXEDDB_OPEN_BLOCKED: 'indexeddb_open_blocked',
  INDEXEDDB_OPEN_TIMEOUT: 'indexeddb_open_timeout',
  INDEXEDDB_OPERATION_TIMEOUT: 'indexeddb_operation_timeout',
  INDEXEDDB_TRANSACTION_ABORTED: 'indexeddb_transaction_aborted',
  INDEXEDDB_TRANSACTION_ERROR: 'indexeddb_transaction_error',
  INDEXEDDB_REQUEST_ERROR: 'indexeddb_request_error',
  INDEXEDDB_INVALID_STATE: 'indexeddb_invalid_state',
  INDEXEDDB_SECURITY_ERROR: 'indexeddb_security_error',
  INDEXEDDB_RECORD_INVALID: 'indexeddb_record_invalid',
  LOCALSTORAGE_UNAVAILABLE: 'localstorage_unavailable',
  LOCALSTORAGE_READ_FAILED: 'localstorage_read_failed',
  LOCALSTORAGE_WRITE_FAILED: 'localstorage_write_failed',
  LOCALSTORAGE_REMOVE_FAILED: 'localstorage_remove_failed',
  LOCALSTORAGE_QUOTA_EXCEEDED: 'localstorage_quota_exceeded',
  SESSIONSTORAGE_UNAVAILABLE: 'sessionstorage_unavailable',
  SESSIONSTORAGE_READ_FAILED: 'sessionstorage_read_failed',
  SESSIONSTORAGE_WRITE_FAILED: 'sessionstorage_write_failed',
  SESSIONSTORAGE_REMOVE_FAILED: 'sessionstorage_remove_failed',
  JSON_CIRCULAR_VALUE: 'json_circular_value',
  JSON_PARSE_FAILED: 'json_parse_failed',
  JSON_SERIALIZATION_FAILED: 'json_serialization_failed',
  JSON_UNSUPPORTED_VALUE: 'json_unsupported_value',
});

export class StorageAdapterError extends Error {
  constructor(code, layer = null) {
    super(code);
    this.name = 'StorageAdapterError';
    this.code = code;
    this.layer = layer;
  }
}

const adapterInternals = new WeakMap();
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const cloneDiagnostics = (diagnostics) => JSON.parse(JSON.stringify(diagnostics));

const initialDiagnostics = () => ({
  mode: STORAGE_MODES.UNKNOWN,
  durable: false,
  capabilities: {
    indexeddb: 'unknown',
    localstorage: 'unknown',
    sessionstorage: 'unknown',
    memory: 'available',
  },
  counters: {
    operations: 0,
    failedAttempts: 0,
    fallbacks: 0,
    memoryOnlyWrites: 0,
  },
  lastOperation: null,
});

const layerToMode = (layer) => {
  if (layer === 'indexeddb') return STORAGE_MODES.INDEXEDDB;
  if (layer === 'localstorage') return STORAGE_MODES.LOCALSTORAGE;
  if (layer === 'memory') return STORAGE_MODES.MEMORY_ONLY;
  return STORAGE_MODES.UNKNOWN;
};

const isDurableMode = (mode) => (
  mode === STORAGE_MODES.INDEXEDDB || mode === STORAGE_MODES.LOCALSTORAGE
);

const attempt = (layer, status, code = null) => ({ layer, status, code });

const recordOperation = (state, operation, outcome, mode, attempts) => {
  state.diagnostics.mode = mode;
  state.diagnostics.durable = isDurableMode(mode);
  state.diagnostics.counters.operations += 1;
  state.diagnostics.counters.failedAttempts += attempts.filter(
    ({ status }) => status === 'failed',
  ).length;
  if (mode !== STORAGE_MODES.INDEXEDDB && outcome !== 'invalid') {
    state.diagnostics.counters.fallbacks += 1;
  }
  if (operation === 'setItem' && mode === STORAGE_MODES.MEMORY_ONLY) {
    state.diagnostics.counters.memoryOnlyWrites += 1;
  }
  state.diagnostics.lastOperation = {
    operation,
    outcome,
    mode,
    durable: isDurableMode(mode),
    attempts,
  };
};

const updateCapability = (state, layer, available) => {
  if (layer === 'memory') return;
  state.diagnostics.capabilities[layer] = available ? 'available' : 'unavailable';
};

const validateKey = (key) => {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StorageAdapterError(STORAGE_ERROR_CODES.INVALID_KEY);
  }
  return key;
};

const validateStringValue = (value) => {
  if (typeof value !== 'string') {
    throw new StorageAdapterError(STORAGE_ERROR_CODES.INVALID_VALUE);
  }
  return value;
};

const safeGlobalObject = () => {
  try {
    return globalThis;
  } catch {
    return null;
  }
};

export const tryGetLocalStorage = (globalObject = safeGlobalObject()) => {
  try {
    return globalObject?.localStorage || null;
  } catch {
    return null;
  }
};

export const tryGetSessionStorage = (globalObject = safeGlobalObject()) => {
  try {
    return globalObject?.sessionStorage || null;
  } catch {
    return null;
  }
};

const tryGetIndexedDB = (globalObject = safeGlobalObject()) => {
  try {
    return globalObject?.indexedDB || null;
  } catch {
    return null;
  }
};

export const safeSessionGetItem = (
  key,
  fallback = null,
  globalObject = safeGlobalObject(),
) => {
  if (typeof key !== 'string' || key.length === 0) return fallback;
  const storage = tryGetSessionStorage(globalObject);
  if (!storage) return fallback;
  try {
    return storage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

export const safeSessionSetItem = (
  key,
  value,
  globalObject = safeGlobalObject(),
) => {
  if (typeof key !== 'string' || key.length === 0) return false;
  const storage = tryGetSessionStorage(globalObject);
  if (!storage) return false;
  try {
    storage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
};

export const safeSessionRemoveItem = (
  key,
  globalObject = safeGlobalObject(),
) => {
  if (typeof key !== 'string' || key.length === 0) return false;
  const storage = tryGetSessionStorage(globalObject);
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

const errorName = (error) => {
  try {
    return typeof error?.name === 'string' ? error.name : '';
  } catch {
    return '';
  }
};

const indexedDbErrorCode = (error, fallback) => {
  const name = errorName(error);
  if (name === 'SecurityError') return STORAGE_ERROR_CODES.INDEXEDDB_SECURITY_ERROR;
  if (name === 'InvalidStateError') return STORAGE_ERROR_CODES.INDEXEDDB_INVALID_STATE;
  return fallback;
};

const localStorageErrorCode = (error, fallback) => (
  errorName(error) === 'QuotaExceededError'
    ? STORAGE_ERROR_CODES.LOCALSTORAGE_QUOTA_EXCEEDED
    : fallback
);

const storageError = (code, layer) => new StorageAdapterError(code, layer);

const getLayer = (options, optionName, propertyName) => {
  try {
    if (hasOwn(options, optionName)) return options[optionName] || null;
    const globalObject = hasOwn(options, 'globalObject')
      ? options.globalObject
      : safeGlobalObject();
    if (propertyName === 'localStorage') return tryGetLocalStorage(globalObject);
    if (propertyName === 'sessionStorage') return tryGetSessionStorage(globalObject);
    return tryGetIndexedDB(globalObject);
  } catch {
    return null;
  }
};

const safeCloseDatabase = (database) => {
  try {
    database?.close?.();
  } catch {
    // A stale or already-closed handle is safe to ignore.
  }
};

const createTimer = (state, callback) => state.setTimeout(callback, state.timeoutMs);

const openDatabase = (state) => new Promise((resolve, reject) => {
  const indexedDB = getLayer(state.options, 'indexedDB', 'indexedDB');
  if (!indexedDB) {
    reject(storageError(STORAGE_ERROR_CODES.INDEXEDDB_UNAVAILABLE, 'indexeddb'));
    return;
  }

  let request;
  let settled = false;
  let abandoned = false;
  let timer;
  const settle = (callback, value) => {
    if (settled) return;
    settled = true;
    if (timer) state.clearTimeout(timer);
    callback(value);
  };

  try {
    if (typeof indexedDB.open !== 'function') {
      throw storageError(STORAGE_ERROR_CODES.INDEXEDDB_UNAVAILABLE, 'indexeddb');
    }
    request = indexedDB.open(state.databaseName, state.databaseVersion);
  } catch (error) {
    if (error instanceof StorageAdapterError) {
      reject(error);
      return;
    }
    reject(storageError(
      indexedDbErrorCode(error, STORAGE_ERROR_CODES.INDEXEDDB_OPEN_FAILED),
      'indexeddb',
    ));
    return;
  }

  timer = createTimer(state, () => {
    abandoned = true;
    settle(
      reject,
      storageError(STORAGE_ERROR_CODES.INDEXEDDB_OPEN_TIMEOUT, 'indexeddb'),
    );
  });

  request.onupgradeneeded = () => {
    try {
      const database = request.result;
      if (!database.objectStoreNames.contains(state.objectStoreName)) {
        database.createObjectStore(state.objectStoreName, { keyPath: 'key' });
      }
    } catch (error) {
      try {
        request.transaction?.abort();
      } catch {
        // The open error below remains the authoritative failure.
      }
      abandoned = true;
      settle(
        reject,
        storageError(
          indexedDbErrorCode(error, STORAGE_ERROR_CODES.INDEXEDDB_OPEN_FAILED),
          'indexeddb',
        ),
      );
    }
  };

  request.onblocked = () => {
    abandoned = true;
    settle(
      reject,
      storageError(STORAGE_ERROR_CODES.INDEXEDDB_OPEN_BLOCKED, 'indexeddb'),
    );
  };

  request.onerror = () => {
    settle(
      reject,
      storageError(
        indexedDbErrorCode(request.error, STORAGE_ERROR_CODES.INDEXEDDB_OPEN_FAILED),
        'indexeddb',
      ),
    );
  };

  request.onsuccess = () => {
    if (abandoned || settled) {
      safeCloseDatabase(request.result);
      return;
    }
    settle(resolve, request.result);
  };
});

const runIndexedDbTransaction = (state, mode, operation) => openDatabase(state)
  .then((database) => new Promise((resolve, reject) => {
    let transaction;
    let request;
    let requestResult;
    let settled = false;
    let timer;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) state.clearTimeout(timer);
      safeCloseDatabase(database);
      callback(value);
    };

    try {
      transaction = database.transaction(state.objectStoreName, mode);
      const objectStore = transaction.objectStore(state.objectStoreName);
      request = operation(objectStore);
    } catch (error) {
      settle(
        reject,
        storageError(
          indexedDbErrorCode(error, STORAGE_ERROR_CODES.INDEXEDDB_TRANSACTION_ERROR),
          'indexeddb',
        ),
      );
      return;
    }

    timer = createTimer(state, () => {
      settle(
        reject,
        storageError(STORAGE_ERROR_CODES.INDEXEDDB_OPERATION_TIMEOUT, 'indexeddb'),
      );
      try {
        transaction.abort();
      } catch {
        // The timeout has already settled the operation.
      }
    });

    request.onsuccess = () => {
      requestResult = request.result;
    };
    request.onerror = () => {
      settle(
        reject,
        storageError(
          indexedDbErrorCode(request.error, STORAGE_ERROR_CODES.INDEXEDDB_REQUEST_ERROR),
          'indexeddb',
        ),
      );
    };
    transaction.onabort = () => {
      settle(
        reject,
        storageError(
          indexedDbErrorCode(
            transaction.error,
            STORAGE_ERROR_CODES.INDEXEDDB_TRANSACTION_ABORTED,
          ),
          'indexeddb',
        ),
      );
    };
    transaction.onerror = () => {
      settle(
        reject,
        storageError(
          indexedDbErrorCode(
            transaction.error,
            STORAGE_ERROR_CODES.INDEXEDDB_TRANSACTION_ERROR,
          ),
          'indexeddb',
        ),
      );
    };
    transaction.oncomplete = () => settle(resolve, requestResult);
  }));

const normalizeIndexedDbRecord = (record) => {
  if (typeof record === 'undefined') return null;
  if (
    !record
    || typeof record !== 'object'
    || typeof record.value !== 'string'
    || !Number.isFinite(record.updatedAt)
  ) {
    throw storageError(STORAGE_ERROR_CODES.INDEXEDDB_RECORD_INVALID, 'indexeddb');
  }
  return {
    value: record.value,
    updatedAt: record.updatedAt,
    schemaVersion: Number.isInteger(record.schemaVersion) ? record.schemaVersion : 0,
  };
};

const readIndexedDb = async (state, key) => normalizeIndexedDbRecord(
  await runIndexedDbTransaction(state, 'readonly', (store) => store.get(key)),
);

const writeIndexedDb = (state, key, record) => runIndexedDbTransaction(
  state,
  'readwrite',
  (store) => store.put({ key, ...record }),
);

const removeIndexedDb = (state, key) => runIndexedDbTransaction(
  state,
  'readwrite',
  (store) => store.delete(key),
);

const serializeLocalRecord = (record) => JSON.stringify({
  marker: LOCAL_RECORD_MARKER,
  schemaVersion: record.schemaVersion,
  updatedAt: record.updatedAt,
  value: record.value,
});

const parseLocalRecord = (storedValue) => {
  if (storedValue === null) return null;
  try {
    const parsed = JSON.parse(storedValue);
    if (
      parsed?.marker === LOCAL_RECORD_MARKER
      && typeof parsed.value === 'string'
      && Number.isFinite(parsed.updatedAt)
    ) {
      return {
        value: parsed.value,
        updatedAt: parsed.updatedAt,
        schemaVersion: Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : 0,
      };
    }
  } catch {
    // Existing raw Web Storage values remain readable as legacy values.
  }
  return { value: storedValue, updatedAt: 0, schemaVersion: 0 };
};

const readLocalStorage = (state, key) => {
  const storage = getLayer(state.options, 'localStorage', 'localStorage');
  if (!storage) {
    throw storageError(STORAGE_ERROR_CODES.LOCALSTORAGE_UNAVAILABLE, 'localstorage');
  }
  try {
    if (typeof storage.getItem !== 'function') {
      throw storageError(STORAGE_ERROR_CODES.LOCALSTORAGE_UNAVAILABLE, 'localstorage');
    }
    return parseLocalRecord(storage.getItem(key));
  } catch (error) {
    if (error instanceof StorageAdapterError) throw error;
    throw storageError(
      localStorageErrorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_READ_FAILED),
      'localstorage',
    );
  }
};

const writeLocalStorage = (state, key, record) => {
  const storage = getLayer(state.options, 'localStorage', 'localStorage');
  if (!storage) {
    throw storageError(STORAGE_ERROR_CODES.LOCALSTORAGE_UNAVAILABLE, 'localstorage');
  }
  try {
    if (typeof storage.setItem !== 'function') {
      throw storageError(STORAGE_ERROR_CODES.LOCALSTORAGE_UNAVAILABLE, 'localstorage');
    }
    storage.setItem(key, serializeLocalRecord(record));
  } catch (error) {
    if (error instanceof StorageAdapterError) throw error;
    throw storageError(
      localStorageErrorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_WRITE_FAILED),
      'localstorage',
    );
  }
};

const removeLocalStorage = (state, key) => {
  const storage = getLayer(state.options, 'localStorage', 'localStorage');
  if (!storage) {
    throw storageError(STORAGE_ERROR_CODES.LOCALSTORAGE_UNAVAILABLE, 'localstorage');
  }
  try {
    if (typeof storage.removeItem !== 'function') {
      throw storageError(STORAGE_ERROR_CODES.LOCALSTORAGE_UNAVAILABLE, 'localstorage');
    }
    storage.removeItem(key);
  } catch (error) {
    if (error instanceof StorageAdapterError) throw error;
    throw storageError(
      localStorageErrorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_REMOVE_FAILED),
      'localstorage',
    );
  }
};

const nextTimestamp = (state) => {
  let candidate;
  try {
    const value = state.now();
    candidate = value instanceof Date ? value.getTime() : Number(value);
  } catch {
    candidate = Date.now();
  }
  if (!Number.isFinite(candidate)) candidate = Date.now();
  state.lastTimestamp = Math.max(Math.trunc(candidate), state.lastTimestamp + 1);
  return state.lastTimestamp;
};

const errorCode = (error, fallback) => (
  error instanceof StorageAdapterError ? error.code : fallback
);

const bestAvailableMode = (attempts) => {
  if (attempts.some(({ layer, status }) => (
    layer === 'indexeddb' && status !== 'failed'
  ))) return STORAGE_MODES.INDEXEDDB;
  if (attempts.some(({ layer, status }) => (
    layer === 'localstorage' && status !== 'failed'
  ))) return STORAGE_MODES.LOCALSTORAGE;
  return STORAGE_MODES.MEMORY_ONLY;
};

const selectNewestRecord = (records) => [...records].sort((left, right) => {
  if (left.record.updatedAt !== right.record.updatedAt) {
    return right.record.updatedAt - left.record.updatedAt;
  }
  const priority = { indexeddb: 3, localstorage: 2, memory: 1 };
  return priority[right.layer] - priority[left.layer];
})[0] || null;

const assertJsonSerializable = (value) => {
  const active = new WeakSet();
  const visit = (candidate) => {
    if (candidate === null) return;
    const type = typeof candidate;
    if (type === 'string' || type === 'boolean') return;
    if (type === 'number' && Number.isFinite(candidate)) return;
    if (type !== 'object') {
      throw storageError(STORAGE_ERROR_CODES.JSON_UNSUPPORTED_VALUE, 'json');
    }
    if (active.has(candidate)) {
      throw storageError(STORAGE_ERROR_CODES.JSON_CIRCULAR_VALUE, 'json');
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) {
      throw storageError(STORAGE_ERROR_CODES.JSON_UNSUPPORTED_VALUE, 'json');
    }
    if (Object.getOwnPropertySymbols(candidate).length > 0) {
      throw storageError(STORAGE_ERROR_CODES.JSON_UNSUPPORTED_VALUE, 'json');
    }
    active.add(candidate);
    try {
      for (const key of Object.keys(candidate)) visit(candidate[key]);
    } finally {
      active.delete(candidate);
    }
  };
  visit(value);
};

const serializeJson = (value) => {
  try {
    assertJsonSerializable(value);
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') {
      throw storageError(STORAGE_ERROR_CODES.JSON_UNSUPPORTED_VALUE, 'json');
    }
    return serialized;
  } catch (error) {
    if (error instanceof StorageAdapterError) throw error;
    throw storageError(STORAGE_ERROR_CODES.JSON_SERIALIZATION_FAILED, 'json');
  }
};

const probeWebStorage = (storage, unavailableCode, failedCode) => {
  if (!storage) {
    throw storageError(unavailableCode, 'probe');
  }
  try {
    if (
      typeof storage.setItem !== 'function'
      || typeof storage.getItem !== 'function'
      || typeof storage.removeItem !== 'function'
    ) {
      throw storageError(unavailableCode, 'probe');
    }
    storage.setItem(PROBE_KEY, PROBE_VALUE);
    const available = storage.getItem(PROBE_KEY) === PROBE_VALUE;
    storage.removeItem(PROBE_KEY);
    if (!available) throw storageError(failedCode, 'probe');
  } catch (error) {
    try {
      storage.removeItem(PROBE_KEY);
    } catch {
      // Best-effort cleanup must not hide the original probe failure.
    }
    if (error instanceof StorageAdapterError) throw error;
    throw storageError(localStorageErrorCode(error, failedCode), 'probe');
  }
};

export const createResilientStorage = (options = {}) => {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Math.trunc(options.timeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const state = {
    options,
    databaseName: options.databaseName || DEFAULT_DATABASE_NAME,
    objectStoreName: options.objectStoreName || DEFAULT_OBJECT_STORE_NAME,
    databaseVersion: options.databaseVersion || DEFAULT_DATABASE_VERSION,
    schemaVersion: options.schemaVersion || DEFAULT_SCHEMA_VERSION,
    timeoutMs,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    now: options.now || Date.now,
    memory: options.memoryStore instanceof Map ? options.memoryStore : new Map(),
    diagnostics: initialDiagnostics(),
    lastTimestamp: 0,
  };

  const adapter = {
    async getItem(rawKey) {
      const key = validateKey(rawKey);
      const attempts = [];
      const records = [];

      try {
        const record = await readIndexedDb(state, key);
        updateCapability(state, 'indexeddb', true);
        attempts.push(attempt('indexeddb', record ? 'success' : 'missing'));
        if (record) records.push({ layer: 'indexeddb', record });
      } catch (error) {
        updateCapability(state, 'indexeddb', false);
        attempts.push(attempt(
          'indexeddb',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.INDEXEDDB_OPEN_FAILED),
        ));
      }

      try {
        const record = readLocalStorage(state, key);
        updateCapability(state, 'localstorage', true);
        attempts.push(attempt('localstorage', record ? 'success' : 'missing'));
        if (record) records.push({ layer: 'localstorage', record });
      } catch (error) {
        updateCapability(state, 'localstorage', false);
        attempts.push(attempt(
          'localstorage',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_READ_FAILED),
        ));
      }

      const memoryRecord = state.memory.get(key) || null;
      attempts.push(attempt('memory', memoryRecord ? 'success' : 'missing'));
      if (memoryRecord) records.push({ layer: 'memory', record: memoryRecord });

      const selected = selectNewestRecord(records);
      if (!selected) {
        const mode = bestAvailableMode(attempts);
        recordOperation(state, 'getItem', 'missing', mode, attempts);
        return null;
      }

      state.memory.set(key, selected.record);
      const mode = layerToMode(selected.layer);
      recordOperation(state, 'getItem', 'success', mode, attempts);
      return selected.record.value;
    },

    async setItem(rawKey, rawValue) {
      const key = validateKey(rawKey);
      const value = validateStringValue(rawValue);
      const record = {
        value,
        updatedAt: nextTimestamp(state),
        schemaVersion: state.schemaVersion,
      };
      const attempts = [];

      try {
        await writeIndexedDb(state, key, record);
        updateCapability(state, 'indexeddb', true);
        attempts.push(attempt('indexeddb', 'success'));
        state.memory.set(key, record);

        if (options.mirrorToLocalStorage) {
          try {
            writeLocalStorage(state, key, record);
            updateCapability(state, 'localstorage', true);
            attempts.push(attempt('localstorage', 'mirrored'));
          } catch (error) {
            updateCapability(state, 'localstorage', false);
            attempts.push(attempt(
              'localstorage',
              'failed',
              errorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_WRITE_FAILED),
            ));
          }
        } else {
          try {
            removeLocalStorage(state, key);
            updateCapability(state, 'localstorage', true);
            attempts.push(attempt('localstorage', 'stale_copy_removed'));
          } catch (error) {
            attempts.push(attempt(
              'localstorage',
              'cleanup_failed',
              errorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_REMOVE_FAILED),
            ));
          }
        }

        attempts.push(attempt('memory', 'updated'));
        recordOperation(
          state,
          'setItem',
          'success',
          STORAGE_MODES.INDEXEDDB,
          attempts,
        );
        return undefined;
      } catch (error) {
        updateCapability(state, 'indexeddb', false);
        attempts.push(attempt(
          'indexeddb',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.INDEXEDDB_OPEN_FAILED),
        ));
      }

      try {
        writeLocalStorage(state, key, record);
        updateCapability(state, 'localstorage', true);
        attempts.push(attempt('localstorage', 'success'));
        state.memory.set(key, record);
        attempts.push(attempt('memory', 'updated'));
        recordOperation(
          state,
          'setItem',
          'success',
          STORAGE_MODES.LOCALSTORAGE,
          attempts,
        );
        return undefined;
      } catch (error) {
        updateCapability(state, 'localstorage', false);
        attempts.push(attempt(
          'localstorage',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_WRITE_FAILED),
        ));
      }

      state.memory.set(key, record);
      attempts.push(attempt('memory', 'success'));
      recordOperation(
        state,
        'setItem',
        'success',
        STORAGE_MODES.MEMORY_ONLY,
        attempts,
      );
      return undefined;
    },

    async removeItem(rawKey) {
      const key = validateKey(rawKey);
      const attempts = [];
      let indexedDbRemoved = false;
      let localStorageRemoved = false;

      try {
        await removeIndexedDb(state, key);
        indexedDbRemoved = true;
        updateCapability(state, 'indexeddb', true);
        attempts.push(attempt('indexeddb', 'success'));
      } catch (error) {
        updateCapability(state, 'indexeddb', false);
        attempts.push(attempt(
          'indexeddb',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.INDEXEDDB_OPEN_FAILED),
        ));
      }

      try {
        removeLocalStorage(state, key);
        localStorageRemoved = true;
        updateCapability(state, 'localstorage', true);
        attempts.push(attempt('localstorage', 'success'));
      } catch (error) {
        updateCapability(state, 'localstorage', false);
        attempts.push(attempt(
          'localstorage',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_REMOVE_FAILED),
        ));
      }

      state.memory.delete(key);
      attempts.push(attempt('memory', 'success'));
      const mode = indexedDbRemoved
        ? STORAGE_MODES.INDEXEDDB
        : localStorageRemoved
          ? STORAGE_MODES.LOCALSTORAGE
          : STORAGE_MODES.MEMORY_ONLY;
      const outcome = indexedDbRemoved && localStorageRemoved ? 'success' : 'best_effort';
      recordOperation(state, 'removeItem', outcome, mode, attempts);
      return undefined;
    },

    async getJson(key, fallback = null) {
      const value = await adapter.getItem(key);
      if (value === null) return fallback;
      try {
        return JSON.parse(value);
      } catch {
        const previousAttempts = state.diagnostics.lastOperation?.attempts || [];
        recordOperation(
          state,
          'getJson',
          'malformed',
          state.diagnostics.mode,
          [...previousAttempts, attempt('json', 'failed', STORAGE_ERROR_CODES.JSON_PARSE_FAILED)],
        );
        return fallback;
      }
    },

    async setJson(key, value) {
      let serialized;
      try {
        serialized = serializeJson(value);
      } catch (error) {
        const code = errorCode(error, STORAGE_ERROR_CODES.JSON_SERIALIZATION_FAILED);
        recordOperation(
          state,
          'setJson',
          'invalid',
          state.diagnostics.mode,
          [attempt('json', 'failed', code)],
        );
        throw error;
      }
      await adapter.setItem(key, serialized);
      state.diagnostics.lastOperation.operation = 'setJson';
      return undefined;
    },

    async removeJson(key) {
      await adapter.removeItem(key);
      state.diagnostics.lastOperation.operation = 'removeJson';
      return undefined;
    },

    async probe() {
      const attempts = [];
      try {
        const database = await openDatabase(state);
        safeCloseDatabase(database);
        updateCapability(state, 'indexeddb', true);
        attempts.push(attempt('indexeddb', 'available'));
      } catch (error) {
        updateCapability(state, 'indexeddb', false);
        attempts.push(attempt(
          'indexeddb',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.INDEXEDDB_OPEN_FAILED),
        ));
      }

      try {
        probeWebStorage(
          getLayer(state.options, 'localStorage', 'localStorage'),
          STORAGE_ERROR_CODES.LOCALSTORAGE_UNAVAILABLE,
          STORAGE_ERROR_CODES.LOCALSTORAGE_WRITE_FAILED,
        );
        updateCapability(state, 'localstorage', true);
        attempts.push(attempt('localstorage', 'available'));
      } catch (error) {
        updateCapability(state, 'localstorage', false);
        attempts.push(attempt(
          'localstorage',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.LOCALSTORAGE_WRITE_FAILED),
        ));
      }

      try {
        probeWebStorage(
          getLayer(state.options, 'sessionStorage', 'sessionStorage'),
          STORAGE_ERROR_CODES.SESSIONSTORAGE_UNAVAILABLE,
          STORAGE_ERROR_CODES.SESSIONSTORAGE_WRITE_FAILED,
        );
        updateCapability(state, 'sessionstorage', true);
        attempts.push(attempt('sessionstorage', 'available'));
      } catch (error) {
        updateCapability(state, 'sessionstorage', false);
        attempts.push(attempt(
          'sessionstorage',
          'failed',
          errorCode(error, STORAGE_ERROR_CODES.SESSIONSTORAGE_WRITE_FAILED),
        ));
      }

      const mode = bestAvailableMode(attempts);
      recordOperation(state, 'probe', 'complete', mode, attempts);
      return adapter.getDiagnostics();
    },

    getMode() {
      return state.diagnostics.mode;
    },

    getDiagnostics() {
      return cloneDiagnostics(state.diagnostics);
    },
  };

  adapterInternals.set(adapter, state);
  return adapter;
};

export const defaultResilientStorage = createResilientStorage();

export const probeBrowserStorageCapabilities = (options) => (
  typeof options === 'undefined'
    ? defaultResilientStorage.probe()
    : createResilientStorage(options).probe()
);

export const getStorageDiagnostics = () => defaultResilientStorage.getDiagnostics();

// Test-only reset: clears diagnostics and this adapter instance's page-lifetime memory.
export const resetStorageDiagnosticsForTests = (adapter = defaultResilientStorage) => {
  const state = adapterInternals.get(adapter);
  if (!state) throw new TypeError('UNKNOWN_RESILIENT_STORAGE_ADAPTER');
  state.memory.clear();
  state.diagnostics = initialDiagnostics();
  state.lastTimestamp = 0;
};
