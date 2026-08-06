import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_DEVICE_ID_ENTROPY_BITS,
  clearProDraftDeviceId,
  generateProDraftDeviceId,
  getOrCreateProDraftDeviceId,
  getSafeProDraftDeviceDiagnostics,
  validateProDraftDeviceId,
} from '@/lib/proDraftDeviceId';

const cryptoProvider = {
  getRandomValues: vi.fn((bytes) => {
    bytes.fill(37);
    return bytes;
  }),
};

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async (key) => { values.delete(key); }),
    getMode: vi.fn(() => 'memory_only'),
  };
};

describe('random public-recovery device ID contract', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearProDraftDeviceId({ storage: memoryStorage() });
  });

  it('generates and validates an opaque 128-bit Web Crypto identifier', () => {
    const value = generateProDraftDeviceId(cryptoProvider);
    expect(PRO_DRAFT_DEVICE_ID_ENTROPY_BITS).toBe(128);
    expect(cryptoProvider.getRandomValues).toHaveBeenCalledOnce();
    expect(value).toMatch(/^pdd_[A-Za-z0-9_-]{22}$/u);
    expect(validateProDraftDeviceId(value)).toBe(true);
    expect(validateProDraftDeviceId('browser-model-user-agent')).toBe(false);
  });

  it('stores and reuses the identifier through resilient-storage shape', async () => {
    const storage = memoryStorage();
    const first = await getOrCreateProDraftDeviceId({ storage, cryptoProvider });
    const second = await getOrCreateProDraftDeviceId({ storage, cryptoProvider });
    expect(second).toBe(first);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.getItem).toHaveBeenCalledTimes(2);
  });

  it('falls back to page memory when every storage operation throws', async () => {
    const storage = {
      getItem: vi.fn(async () => { throw new Error('unavailable'); }),
      setItem: vi.fn(async () => { throw new Error('unavailable'); }),
      removeItem: vi.fn(async () => { throw new Error('unavailable'); }),
      getMode: vi.fn(() => 'unknown'),
    };
    const first = await getOrCreateProDraftDeviceId({ storage, cryptoProvider });
    const second = await getOrCreateProDraftDeviceId({ storage, cryptoProvider });
    expect(second).toBe(first);
    expect(getSafeProDraftDeviceDiagnostics()).toMatchObject({
      presentInPageMemory: true,
      storageMode: 'memory_only',
    });
  });

  it('clears both storage and page-memory state', async () => {
    const storage = memoryStorage();
    await getOrCreateProDraftDeviceId({ storage, cryptoProvider });
    await expect(clearProDraftDeviceId({ storage })).resolves.toBe(true);
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(getSafeProDraftDeviceDiagnostics().presentInPageMemory).toBe(false);
  });

  it('exposes safe diagnostics and contains no fingerprinting or Redux integration', () => {
    expect(getSafeProDraftDeviceDiagnostics()).toMatchObject({
      entropyBits: 128,
      randomIdentifier: true,
      browserFingerprinting: false,
      storesInRedux: false,
      authorizationCredential: false,
    });
    const source = readFileSync('src/lib/proDraftDeviceId.js', 'utf8');
    expect(source).not.toMatch(
      /navigator\.|userAgent|canvas|AudioContext|hardwareConcurrency|dispatch\s*\(|console\./gu,
    );
  });
});
