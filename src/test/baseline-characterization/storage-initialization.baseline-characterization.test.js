import { afterEach, describe, expect, it, vi } from 'vitest';

const importCurrentBase44Initialization = async () => {
  const createClient = vi.fn((config) => ({ config, synthetic: true }));

  vi.resetModules();
  vi.stubEnv('VITE_BASE44_APP_ID', 'synthetic-baseline-app');
  vi.stubEnv('VITE_BASE44_BACKEND_URL', 'https://baseline.example.test');
  vi.doUnmock('@/api/base44Client');
  vi.doMock('@base44/sdk', () => ({ createClient }));

  const module = await import('@/api/base44Client');
  return { module, createClient };
};

const withGlobalProperty = async (name, descriptor, callback) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);

  Object.defineProperty(globalThis, name, {
    configurable: true,
    ...descriptor,
  });

  try {
    return await callback();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, name, originalDescriptor);
    } else {
      delete globalThis[name];
    }
  }
};

describe('baseline characterization: storage initialization', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('[BC-BOOT-001][DR-BOOT-001] imports the current Base44 path with normal localStorage', async () => {
    localStorage.setItem('baseline_probe', 'synthetic');
    expect(localStorage.getItem('baseline_probe')).toBe('synthetic');

    const { module, createClient } = await importCurrentBase44Initialization();

    expect(module.base44.synthetic).toBe(true);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('[BC-BOOT-002][DR-BOOT-001][DR-BOOT-002] imports safely when the localStorage property getter throws SecurityError', async () => {
    await withGlobalProperty(
      'localStorage',
      {
        get() {
          throw new DOMException('Synthetic storage access denied', 'SecurityError');
        },
      },
      async () => {
        const { module, createClient } = await importCurrentBase44Initialization();
        expect(module.base44.synthetic).toBe(true);
        expect(createClient).toHaveBeenCalledTimes(1);
      }
    );
  });

  it('[BC-BOOT-003][DR-BOOT-001][DR-BOOT-002] imports safely when localStorage.getItem throws', async () => {
    const throwingStorage = {
      getItem() {
        throw new DOMException('Synthetic get failure', 'SecurityError');
      },
      setItem() {},
      removeItem() {},
    };

    await withGlobalProperty(
      'localStorage',
      { value: throwingStorage },
      async () => {
        const { module, createClient } = await importCurrentBase44Initialization();
        expect(module.base44.synthetic).toBe(true);
        expect(createClient).toHaveBeenCalledTimes(1);
      }
    );
  });

  it('[BC-BOOT-004][DR-BOOT-001][DR-BOOT-002] imports safely when localStorage.setItem throws QuotaExceededError', async () => {
    const throwingStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError');
      },
      removeItem() {},
    };

    await withGlobalProperty(
      'localStorage',
      { value: throwingStorage },
      async () => {
        const { module, createClient } = await importCurrentBase44Initialization();
        expect(module.base44.synthetic).toBe(true);
        expect(createClient).toHaveBeenCalledTimes(1);
      }
    );
  });

  it('[BC-BOOT-005][DR-BOOT-001] imports when sessionStorage is unavailable because bootstrap does not access it', async () => {
    await withGlobalProperty(
      'sessionStorage',
      {
        get() {
          throw new DOMException('Synthetic session storage denial', 'SecurityError');
        },
      },
      async () => {
        const { module } = await importCurrentBase44Initialization();
        expect(module.base44.synthetic).toBe(true);
      }
    );
  });

  it('[BC-BOOT-006][DR-BOOT-001] imports when IndexedDB is unavailable because bootstrap does not access it', async () => {
    await withGlobalProperty(
      'indexedDB',
      { value: undefined },
      async () => {
        const { module } = await importCurrentBase44Initialization();
        expect(module.base44.synthetic).toBe(true);
      }
    );
  });
});
