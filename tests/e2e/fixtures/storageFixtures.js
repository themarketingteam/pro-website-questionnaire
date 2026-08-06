export const STORAGE_MODES = Object.freeze([
  'normal',
  'localstorage_getter_throws',
  'localstorage_read_throws',
  'localstorage_write_throws',
  'localstorage_quota_exceeded',
  'sessionstorage_getter_throws',
  'sessionstorage_unavailable',
  'indexeddb_unavailable',
  'indexeddb_open_throws',
  'indexeddb_transaction_fails',
  'all_persistent_storage_unavailable',
]);

const STORAGE_MODE_SET = new Set(STORAGE_MODES);

export const isStorageMode = (mode) => STORAGE_MODE_SET.has(mode);

export const installStorageFailureMode = async (context, mode = 'normal') => {
  if (!isStorageMode(mode)) throw new Error(`INVALID_E2E_STORAGE_MODE:${mode}`);

  await context.addInitScript(({ selectedMode }) => {
    const createException = (name, message) => new DOMException(message, name);
    const defineWindowValue = (property, getter) => {
      Object.defineProperty(window, property, {
        configurable: true,
        enumerable: true,
        get: getter,
      });
    };
    const storageProxy = (storage, behavior) => new Proxy(storage, {
      get(target, property) {
        if (behavior.readThrows && ['getItem', 'key', 'length'].includes(property)) {
          if (property === 'length') {
            throw createException('SecurityError', 'Synthetic storage read denial');
          }
          return () => {
            throw createException('SecurityError', 'Synthetic storage read denial');
          };
        }
        if (behavior.writeThrows && ['setItem', 'removeItem', 'clear'].includes(property)) {
          return () => {
            throw createException(
              behavior.writeExceptionName,
              'Synthetic storage write denial',
            );
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const replaceStorage = (property, behavior) => {
      const original = window[property];
      const proxy = storageProxy(original, behavior);
      defineWindowValue(property, () => proxy);
    };
    const removeIndexedDb = () => defineWindowValue('indexedDB', () => undefined);

    if (selectedMode === 'localstorage_getter_throws') {
      defineWindowValue('localStorage', () => {
        throw createException('SecurityError', 'Synthetic localStorage getter denial');
      });
    } else if (selectedMode === 'localstorage_read_throws') {
      replaceStorage('localStorage', { readThrows: true });
    } else if (selectedMode === 'localstorage_write_throws') {
      replaceStorage('localStorage', {
        writeExceptionName: 'SecurityError',
        writeThrows: true,
      });
    } else if (selectedMode === 'localstorage_quota_exceeded') {
      replaceStorage('localStorage', {
        writeExceptionName: 'QuotaExceededError',
        writeThrows: true,
      });
    } else if (selectedMode === 'sessionstorage_getter_throws') {
      defineWindowValue('sessionStorage', () => {
        throw createException('SecurityError', 'Synthetic sessionStorage getter denial');
      });
    } else if (selectedMode === 'sessionstorage_unavailable') {
      defineWindowValue('sessionStorage', () => undefined);
    } else if (selectedMode === 'indexeddb_unavailable') {
      removeIndexedDb();
    } else if (selectedMode === 'indexeddb_open_throws') {
      const original = window.indexedDB;
      const proxy = new Proxy(original, {
        get(target, property) {
          if (property === 'open') {
            return () => {
              throw createException('InvalidStateError', 'Synthetic IndexedDB open denial');
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      defineWindowValue('indexedDB', () => proxy);
    } else if (selectedMode === 'indexeddb_transaction_fails') {
      Object.defineProperty(IDBDatabase.prototype, 'transaction', {
        configurable: true,
        value() {
          throw createException(
            'InvalidStateError',
            'Synthetic IndexedDB transaction denial',
          );
        },
      });
    } else if (selectedMode === 'all_persistent_storage_unavailable') {
      defineWindowValue('localStorage', () => {
        throw createException('SecurityError', 'Synthetic localStorage denial');
      });
      defineWindowValue('sessionStorage', () => undefined);
      removeIndexedDb();
    }

    Object.defineProperty(window, '__E2E_STORAGE_MODE__', {
      configurable: false,
      enumerable: false,
      value: selectedMode,
      writable: false,
    });
  }, { selectedMode: mode });

  return Object.freeze({ mode });
};

export const getStorageCapabilityDiagnostics = async (page) => page.evaluate(() => {
  const diagnosticKey = '__e2e_storage_capability_probe__';
  const errorName = (error) => error?.name || 'Error';
  const probeStorage = (property) => {
    let storage;
    try {
      storage = window[property];
    } catch (error) {
      return {
        available: false,
        getterError: errorName(error),
        readable: false,
        writable: false,
      };
    }

    if (!storage) {
      return {
        available: false,
        getterError: null,
        readable: false,
        writable: false,
      };
    }

    let readError = null;
    let readable = true;
    try {
      storage.getItem(diagnosticKey);
    } catch (error) {
      readable = false;
      readError = errorName(error);
    }

    let writable = true;
    let writeError = null;
    try {
      storage.setItem(diagnosticKey, 'synthetic-probe');
      storage.removeItem(diagnosticKey);
    } catch (error) {
      writable = false;
      writeError = errorName(error);
    }

    return {
      available: true,
      getterError: null,
      readError,
      readable,
      writable,
      writeError,
    };
  };

  let indexedDbAvailable = false;
  let indexedDbGetterError = null;
  let indexedDbOpenFunction = false;
  try {
    indexedDbAvailable = Boolean(window.indexedDB);
    indexedDbOpenFunction = typeof window.indexedDB?.open === 'function';
  } catch (error) {
    indexedDbGetterError = errorName(error);
  }

  return {
    indexedDB: {
      available: indexedDbAvailable,
      getterError: indexedDbGetterError,
      openFunction: indexedDbOpenFunction,
    },
    localStorage: probeStorage('localStorage'),
    mode: window.__E2E_STORAGE_MODE__ || 'normal',
    sessionStorage: probeStorage('sessionStorage'),
  };
});

const CACHE_DATABASE_NAME = 'pro_questionnaire_browser_cache';
const CACHE_OBJECT_STORE_NAME = 'key_value';

const evaluateCanonicalCache = async (page, operation) => page.evaluate(async ({
  databaseName,
  objectStoreName,
  selectedOperation,
}) => {
  const parseLocalRecord = (raw) => {
    if (typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.value === 'string' && Number.isFinite(parsed.updatedAt)) {
        return parsed;
      }
    } catch {}
    return { value: raw, updatedAt: 0, schemaVersion: 0 };
  };
  const openDatabase = () => new Promise((resolve) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    let request;
    try { request = window.indexedDB.open(databaseName); } catch {
      resolve(null);
      return;
    }
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
  const readIndexedRecords = async () => {
    const database = await openDatabase();
    if (!database || !database.objectStoreNames.contains(objectStoreName)) {
      database?.close();
      return [];
    }
    return new Promise((resolve) => {
      let transaction;
      try { transaction = database.transaction(objectStoreName, 'readonly'); } catch {
        database.close();
        resolve([]);
        return;
      }
      const request = transaction.objectStore(objectStoreName).getAll();
      request.onerror = () => resolve([]);
      request.onsuccess = () => resolve(request.result || []);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => {
        database.close();
        resolve([]);
      };
    });
  };
  const localRecords = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.endsWith(':draft-cache')) continue;
      const record = parseLocalRecord(window.localStorage.getItem(key));
      if (record) localRecords.push({ key, ...record, layer: 'localstorage' });
    }
  } catch {}
  const indexedRecords = (await readIndexedRecords())
    .filter((record) => record?.key?.endsWith(':draft-cache'))
    .map((record) => ({ ...record, layer: 'indexeddb' }));
  const records = [...localRecords, ...indexedRecords]
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));

  if (selectedOperation === 'read') {
    const selected = records[0] || null;
    if (!selected) return null;
    try {
      const envelope = JSON.parse(selected.value);
      return {
        envelope,
        key: selected.key,
        layer: selected.layer,
        state: JSON.parse(envelope.canonicalStateJson),
      };
    } catch {
      return { envelope: null, key: selected.key, layer: selected.layer, state: null };
    }
  }

  if (selectedOperation === 'malform') {
    const timestamp = Date.now() + 10_000;
    let changed = false;
    try {
      for (const record of localRecords) {
        const raw = window.localStorage.getItem(record.key);
        const parsed = parseLocalRecord(raw);
        window.localStorage.setItem(record.key, JSON.stringify({
          ...parsed,
          updatedAt: timestamp,
          value: '{malformed-canonical-cache',
        }));
        changed = true;
      }
    } catch {}
    const database = await openDatabase();
    if (database?.objectStoreNames.contains(objectStoreName)) {
      await new Promise((resolve) => {
        let transaction;
        try { transaction = database.transaction(objectStoreName, 'readwrite'); } catch {
          database.close();
          resolve();
          return;
        }
        const store = transaction.objectStore(objectStoreName);
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (cursor.value?.key?.endsWith(':draft-cache')) {
            cursor.update({
              ...cursor.value,
              updatedAt: timestamp,
              value: '{malformed-canonical-cache',
            });
            changed = true;
          }
          cursor.continue();
        };
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onabort = () => {
          database.close();
          resolve();
        };
      });
    } else {
      database?.close();
    }
    return changed;
  }
  return null;
}, {
  databaseName: CACHE_DATABASE_NAME,
  objectStoreName: CACHE_OBJECT_STORE_NAME,
  selectedOperation: operation,
});

export const readCanonicalDraftCache = (page) => evaluateCanonicalCache(page, 'read');

export const replaceCanonicalDraftCacheWithMalformed = (page) => (
  evaluateCanonicalCache(page, 'malform')
);

export const installRuntimePersistentWriteFailure = async (page) => page.evaluate(() => {
  if (window.IDBDatabase?.prototype) {
    Object.defineProperty(window.IDBDatabase.prototype, 'transaction', {
      configurable: true,
      value() {
        throw new DOMException('Synthetic runtime IndexedDB write failure', 'InvalidStateError');
      },
    });
  }
  if (window.Storage?.prototype) {
    Object.defineProperty(window.Storage.prototype, 'setItem', {
      configurable: true,
      value() {
        throw new DOMException('Synthetic runtime storage quota', 'QuotaExceededError');
      },
    });
    Object.defineProperty(window.Storage.prototype, 'removeItem', {
      configurable: true,
      value() {
        throw new DOMException('Synthetic runtime storage denial', 'SecurityError');
      },
    });
  }
  return true;
});
