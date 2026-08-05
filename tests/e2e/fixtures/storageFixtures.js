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
