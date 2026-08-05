import { IDBFactory } from 'fake-indexeddb';
import {
  STORAGE_ERROR_CODES,
  STORAGE_MODES,
  StorageAdapterError,
  createResilientStorage,
  defaultResilientStorage,
  getStorageDiagnostics,
  probeBrowserStorageCapabilities,
  resetStorageDiagnosticsForTests,
  safeSessionGetItem,
  safeSessionRemoveItem,
  safeSessionSetItem,
  tryGetLocalStorage,
  tryGetSessionStorage,
} from '@/lib/resilientStorage';
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  safeSessionStorageGet,
  safeSessionStorageRemove,
  safeSessionStorageSet,
} from '@/lib/browserSafety';
import {
  createMemoryStorage,
  installStorageGetterThrows,
} from '@/test/utils/storage';

let databaseSequence = 0;

const createAdapter = (overrides = {}) => {
  databaseSequence += 1;
  return createResilientStorage({
    databaseName: `resilient-storage-test-${databaseSequence}`,
    indexedDB: new IDBFactory(),
    localStorage: createMemoryStorage(),
    sessionStorage: createMemoryStorage(),
    timeoutMs: 50,
    ...overrides,
  });
};

const createThrowingStorage = ({ get, set, remove, errorName = 'SecurityError' }) => {
  const storage = createMemoryStorage();
  const createError = () => new DOMException('Synthetic storage failure', errorName);
  if (get) Object.defineProperty(storage, 'getItem', { value: () => { throw createError(); } });
  if (set) Object.defineProperty(storage, 'setItem', { value: () => { throw createError(); } });
  if (remove) {
    Object.defineProperty(storage, 'removeItem', { value: () => { throw createError(); } });
  }
  return storage;
};

const createAbortingIndexedDb = () => ({
  open() {
    const openRequest = {};
    queueMicrotask(() => {
      openRequest.result = {
        close() {},
        transaction() {
          const transaction = {
            error: new DOMException('Synthetic abort', 'AbortError'),
            objectStore: () => ({
              put: () => ({}),
            }),
            abort() {},
          };
          queueMicrotask(() => transaction.onabort?.());
          return transaction;
        },
      };
      openRequest.onsuccess?.();
    });
    return openRequest;
  },
});

const getAttempt = (adapter, layer) => adapter
  .getDiagnostics()
  .lastOperation
  .attempts
  .find((entry) => entry.layer === layer);

describe('resilientStorage IndexedDB behavior', () => {
  it('writes and reads strings through IndexedDB as the preferred durable layer', async () => {
    const localStorage = createMemoryStorage();
    const adapter = createAdapter({ localStorage });

    await expect(adapter.setItem('draft', 'indexed-value')).resolves.toBeUndefined();

    expect(adapter.getMode()).toBe(STORAGE_MODES.INDEXEDDB);
    expect(adapter.getDiagnostics().durable).toBe(true);
    expect(localStorage.getItem('draft')).toBeNull();
    await expect(adapter.getItem('draft')).resolves.toBe('indexed-value');
    expect(getAttempt(adapter, 'indexeddb')).toMatchObject({ status: 'success' });
  });

  it('distinguishes an IndexedDB missing key from an IndexedDB failure', async () => {
    const adapter = createAdapter();

    await expect(adapter.getItem('missing')).resolves.toBeNull();

    expect(adapter.getMode()).toBe(STORAGE_MODES.INDEXEDDB);
    expect(adapter.getDiagnostics().lastOperation.outcome).toBe('missing');
    expect(getAttempt(adapter, 'indexeddb')).toEqual({
      layer: 'indexeddb',
      status: 'missing',
      code: null,
    });
  });

  it('falls back when IndexedDB open throws', async () => {
    const localStorage = createMemoryStorage();
    const adapter = createAdapter({
      indexedDB: {
        open() {
          throw new DOMException('Synthetic open denial', 'SecurityError');
        },
      },
      localStorage,
    });

    await expect(adapter.setItem('draft', 'local-value')).resolves.toBeUndefined();

    expect(adapter.getMode()).toBe(STORAGE_MODES.LOCALSTORAGE);
    expect(getAttempt(adapter, 'indexeddb').code)
      .toBe(STORAGE_ERROR_CODES.INDEXEDDB_SECURITY_ERROR);
    await expect(adapter.getItem('draft')).resolves.toBe('local-value');
  });

  it('settles an IndexedDB open timeout without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    const adapter = createAdapter({
      indexedDB: { open: () => ({}) },
      localStorage: createMemoryStorage(),
      timeoutMs: 5,
    });

    await expect(adapter.setItem('draft', 'timeout-fallback')).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(getAttempt(adapter, 'indexeddb').code)
      .toBe(STORAGE_ERROR_CODES.INDEXEDDB_OPEN_TIMEOUT);
    expect(adapter.getMode()).toBe(STORAGE_MODES.LOCALSTORAGE);
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', unhandled);
  });

  it('falls through after an IndexedDB transaction abort', async () => {
    const adapter = createAdapter({
      indexedDB: createAbortingIndexedDb(),
      localStorage: createMemoryStorage(),
    });

    await expect(adapter.setItem('draft', 'abort-fallback')).resolves.toBeUndefined();

    expect(adapter.getMode()).toBe(STORAGE_MODES.LOCALSTORAGE);
    expect(getAttempt(adapter, 'indexeddb').code)
      .toBe(STORAGE_ERROR_CODES.INDEXEDDB_TRANSACTION_ABORTED);
  });

  it('protects access to an IndexedDB property getter', async () => {
    const globalObject = { localStorage: createMemoryStorage() };
    Object.defineProperty(globalObject, 'indexedDB', {
      get() {
        throw new DOMException('Synthetic IndexedDB getter denial', 'SecurityError');
      },
    });
    const adapter = createResilientStorage({ globalObject, timeoutMs: 10 });

    await expect(adapter.setItem('draft', 'safe')).resolves.toBeUndefined();

    expect(adapter.getMode()).toBe(STORAGE_MODES.LOCALSTORAGE);
    expect(getAttempt(adapter, 'indexeddb').code)
      .toBe(STORAGE_ERROR_CODES.INDEXEDDB_UNAVAILABLE);
  });
});

describe('resilientStorage Web Storage and memory fallbacks', () => {
  it('protects the localStorage property getter', async () => {
    const globalObject = {};
    Object.defineProperty(globalObject, 'localStorage', {
      get() {
        throw new DOMException('Synthetic localStorage getter denial', 'SecurityError');
      },
    });
    const adapter = createResilientStorage({
      globalObject,
      indexedDB: null,
      timeoutMs: 10,
    });

    expect(tryGetLocalStorage(globalObject)).toBeNull();
    await expect(adapter.setItem('draft', 'memory-value')).resolves.toBeUndefined();
    expect(adapter.getMode()).toBe(STORAGE_MODES.MEMORY_ONLY);
  });

  it('handles localStorage read failure without rejecting', async () => {
    const adapter = createAdapter({
      indexedDB: null,
      localStorage: createThrowingStorage({ get: true }),
    });

    await expect(adapter.getItem('draft')).resolves.toBeNull();

    expect(getAttempt(adapter, 'localstorage').code)
      .toBe(STORAGE_ERROR_CODES.LOCALSTORAGE_READ_FAILED);
  });

  it('handles localStorage write failure with memory fallback', async () => {
    const adapter = createAdapter({
      indexedDB: null,
      localStorage: createThrowingStorage({ set: true }),
    });

    await expect(adapter.setItem('draft', 'memory-value')).resolves.toBeUndefined();
    await expect(adapter.getItem('draft')).resolves.toBe('memory-value');
    expect(adapter.getMode()).toBe(STORAGE_MODES.MEMORY_ONLY);
  });

  it('reports localStorage quota failure truthfully', async () => {
    const adapter = createAdapter({
      indexedDB: null,
      localStorage: createThrowingStorage({ set: true, errorName: 'QuotaExceededError' }),
    });

    await adapter.setItem('draft', 'memory-value');

    expect(getAttempt(adapter, 'localstorage').code)
      .toBe(STORAGE_ERROR_CODES.LOCALSTORAGE_QUOTA_EXCEEDED);
    expect(adapter.getDiagnostics()).toMatchObject({
      mode: STORAGE_MODES.MEMORY_ONLY,
      durable: false,
    });
  });

  it('continues in memory when every persistent layer is unavailable', async () => {
    const adapter = createAdapter({ indexedDB: null, localStorage: null, sessionStorage: null });

    await expect(adapter.setItem('draft', 'page-lifetime')).resolves.toBeUndefined();
    await expect(adapter.getItem('draft')).resolves.toBe('page-lifetime');
    const diagnostics = await adapter.probe();

    expect(diagnostics).toMatchObject({
      mode: STORAGE_MODES.MEMORY_ONLY,
      durable: false,
      capabilities: {
        indexeddb: 'unavailable',
        localstorage: 'unavailable',
        sessionstorage: 'unavailable',
        memory: 'available',
      },
    });
  });

  it('removes a key from IndexedDB, mirrored localStorage, and memory', async () => {
    const localStorage = createMemoryStorage();
    const adapter = createAdapter({ localStorage, mirrorToLocalStorage: true });
    await adapter.setItem('draft', 'remove-me');
    expect(localStorage.getItem('draft')).not.toBeNull();

    await expect(adapter.removeItem('draft')).resolves.toBeUndefined();

    expect(localStorage.getItem('draft')).toBeNull();
    await expect(adapter.getItem('draft')).resolves.toBeNull();
  });

  it('continues best-effort removal after a persistent layer fails', async () => {
    const memoryStore = new Map();
    const localStorage = createThrowingStorage({ remove: true });
    const adapter = createAdapter({ indexedDB: null, localStorage, memoryStore });
    await adapter.setItem('draft', 'remove-from-memory');
    expect(memoryStore.has('draft')).toBe(true);

    await expect(adapter.removeItem('draft')).resolves.toBeUndefined();

    expect(memoryStore.has('draft')).toBe(false);
    expect(getAttempt(adapter, 'localstorage').code)
      .toBe(STORAGE_ERROR_CODES.LOCALSTORAGE_REMOVE_FAILED);
  });

  it('uses metadata to prefer a newer local fallback over a stale IndexedDB copy', async () => {
    const indexedDB = new IDBFactory();
    const localStorage = createMemoryStorage();
    const nowValues = [100, 200];
    const primary = createAdapter({
      indexedDB,
      localStorage,
      now: () => nowValues.shift() ?? 300,
    });
    await primary.setItem('draft', 'older-indexed-value');

    const fallbackWriter = createAdapter({ indexedDB: null, localStorage, now: () => 200 });
    await fallbackWriter.setItem('draft', 'newer-local-value');

    await expect(primary.getItem('draft')).resolves.toBe('newer-local-value');
    expect(primary.getMode()).toBe(STORAGE_MODES.LOCALSTORAGE);
  });

  it('keeps memory isolated between adapter instances by default', async () => {
    const first = createAdapter({ indexedDB: null, localStorage: null });
    const second = createAdapter({ indexedDB: null, localStorage: null });

    await first.setItem('draft', 'first-page');

    await expect(first.getItem('draft')).resolves.toBe('first-page');
    await expect(second.getItem('draft')).resolves.toBeNull();
  });

  it('supports concurrent writes to different keys', async () => {
    const adapter = createAdapter();

    await Promise.all([
      adapter.setItem('draft-a', 'alpha'),
      adapter.setItem('draft-b', 'bravo'),
    ]);

    await expect(Promise.all([
      adapter.getItem('draft-a'),
      adapter.getItem('draft-b'),
    ])).resolves.toEqual(['alpha', 'bravo']);
  });
});

describe('resilientStorage JSON safety', () => {
  it('returns the fallback and diagnostics for malformed JSON without deleting it', async () => {
    const adapter = createAdapter({ indexedDB: null, localStorage: null });
    await adapter.setItem('draft', '{malformed');

    await expect(adapter.getJson('draft', { safe: true })).resolves.toEqual({ safe: true });

    expect(adapter.getDiagnostics().lastOperation).toMatchObject({
      operation: 'getJson',
      outcome: 'malformed',
    });
    expect(getAttempt(adapter, 'json').code).toBe(STORAGE_ERROR_CODES.JSON_PARSE_FAILED);
    await expect(adapter.getItem('draft')).resolves.toBe('{malformed');
  });

  it('rejects a circular object before overwriting the last known good value', async () => {
    const adapter = createAdapter({ indexedDB: null, localStorage: createMemoryStorage() });
    await adapter.setJson('draft', { answer: 'known-good' });
    const circular = {};
    circular.self = circular;

    await expect(adapter.setJson('draft', circular)).rejects.toMatchObject({
      name: 'StorageAdapterError',
      code: STORAGE_ERROR_CODES.JSON_CIRCULAR_VALUE,
    });

    await expect(adapter.getJson('draft')).resolves.toEqual({ answer: 'known-good' });
  });

  it.each([
    ['function', { value: () => 'unsafe' }],
    ['symbol', { value: Symbol('unsafe') }],
    ['Blob', { value: new Blob(['unsafe']) }],
    ['File', { value: new File(['unsafe'], 'unsafe.txt') }],
    ['DOM node', { value: document.createElement('div') }],
  ])('rejects unsupported %s values', async (_label, value) => {
    const adapter = createAdapter({ indexedDB: null, localStorage: null });

    await expect(adapter.setJson('draft', value)).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.JSON_UNSUPPORTED_VALUE,
    });
  });

  it('rejects invalid base keys and non-string base values explicitly', async () => {
    const adapter = createAdapter({ indexedDB: null, localStorage: null });

    await expect(adapter.setItem('', 'value')).rejects.toBeInstanceOf(StorageAdapterError);
    await expect(adapter.setItem('draft', { value: true })).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.INVALID_VALUE,
    });
  });
});

describe('session and browserSafety protected access', () => {
  it('protects sessionStorage property access and compatibility helpers', () => {
    const globalObject = {};
    Object.defineProperty(globalObject, 'sessionStorage', {
      get() {
        throw new DOMException('Synthetic session getter denial', 'SecurityError');
      },
    });

    expect(tryGetSessionStorage(globalObject)).toBeNull();
    expect(safeSessionGetItem('draft', 'fallback', globalObject)).toBe('fallback');
    expect(safeSessionSetItem('draft', 'value', globalObject)).toBe(false);
    expect(safeSessionRemoveItem('draft', globalObject)).toBe(false);
  });

  it('gets, sets, and removes session values without enumerating or clearing storage', () => {
    const globalObject = { sessionStorage: createMemoryStorage() };

    expect(safeSessionSetItem('draft', 'session-value', globalObject)).toBe(true);
    expect(safeSessionGetItem('draft', null, globalObject)).toBe('session-value');
    expect(safeSessionRemoveItem('draft', globalObject)).toBe(true);
    expect(safeSessionGetItem('draft', 'missing', globalObject)).toBe('missing');
  });

  it('hardens existing local and session browserSafety helpers and adds removal', () => {
    const restoreLocal = installStorageGetterThrows('localStorage');
    expect(safeLocalStorageGet('draft')).toBeNull();
    expect(safeLocalStorageSet('draft', 'value')).toBe(false);
    expect(safeLocalStorageRemove('draft')).toBe(false);
    restoreLocal();

    const restoreSession = installStorageGetterThrows('sessionStorage');
    expect(safeSessionStorageGet('draft')).toBeNull();
    expect(safeSessionStorageSet('draft', 'value')).toBe(false);
    expect(safeSessionStorageRemove('draft')).toBe(false);
    restoreSession();
  });
});

describe('adapter contract and diagnostics', () => {
  it('exposes safe default diagnostics and an injectable capability probe', async () => {
    resetStorageDiagnosticsForTests(defaultResilientStorage);

    expect(getStorageDiagnostics()).toMatchObject({
      mode: STORAGE_MODES.UNKNOWN,
      durable: false,
    });
    await expect(probeBrowserStorageCapabilities({
      indexedDB: null,
      localStorage: null,
      sessionStorage: null,
      timeoutMs: 5,
    })).resolves.toMatchObject({
      mode: STORAGE_MODES.MEMORY_ONLY,
      durable: false,
    });
  });

  it('returns Redux Persist-compatible Promises', async () => {
    const adapter = createAdapter({ indexedDB: null, localStorage: null });

    const write = adapter.setItem('draft', 'value');
    expect(write).toBeInstanceOf(Promise);
    await write;
    const read = adapter.getItem('draft');
    expect(read).toBeInstanceOf(Promise);
    await expect(read).resolves.toBe('value');
    const removal = adapter.removeItem('draft');
    expect(removal).toBeInstanceOf(Promise);
    await expect(removal).resolves.toBeUndefined();
  });

  it('reports IndexedDB, localStorage, and memory-only modes truthfully', async () => {
    const indexed = createAdapter();
    const local = createAdapter({ indexedDB: null });
    const memory = createAdapter({ indexedDB: null, localStorage: null });

    await indexed.setItem('draft', 'value');
    await local.setItem('draft', 'value');
    await memory.setItem('draft', 'value');

    expect(indexed.getDiagnostics()).toMatchObject({ mode: 'indexeddb', durable: true });
    expect(local.getDiagnostics()).toMatchObject({ mode: 'localstorage', durable: true });
    expect(memory.getDiagnostics()).toMatchObject({ mode: 'memory_only', durable: false });
  });

  it('resets only the selected adapter diagnostics and memory for tests', async () => {
    const adapter = createAdapter({ indexedDB: null, localStorage: null });
    await adapter.setItem('draft', 'value');

    resetStorageDiagnosticsForTests(adapter);

    expect(adapter.getMode()).toBe(STORAGE_MODES.UNKNOWN);
    await expect(adapter.getItem('draft')).resolves.toBeNull();
  });

  it('never prints storage keys or values', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const adapter = createAdapter({ indexedDB: null, localStorage: null });

    await adapter.setItem('client-identity-secret-key', 'stored-private-value');
    await adapter.getItem('client-identity-secret-key');
    await adapter.removeItem('client-identity-secret-key');

    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});
