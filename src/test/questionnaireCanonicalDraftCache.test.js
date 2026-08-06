import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_DRAFT_CACHE_ERROR_CODES,
  CANONICAL_DRAFT_CACHE_VERSION,
  createCanonicalDraftCacheKey,
  getSafeCanonicalDraftCacheDiagnostics,
  inspectCanonicalDraftCache,
  loadCanonicalDraftCache,
  migrateLegacyCanonicalDraftCache,
  removeCanonicalDraftCache,
  saveCanonicalDraftCache,
} from '@/lib/questionnaireCanonicalDraftCache';
import {
  PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES,
  createEmptyCanonicalDraftState,
} from '@/lib/questionnaireDraftState';
import {
  QUESTIONNAIRE_STORAGE_KEY_VERSIONS,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';

const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'cache-test-client' });
const cacheKey = createCanonicalDraftCacheKey(namespace);

const createStorage = () => {
  const values = new Map();
  return {
    values,
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async (key) => { values.delete(key); }),
    getMode: vi.fn(() => 'localstorage'),
  };
};

const draft = (overrides = {}) => ({
  ...createEmptyCanonicalDraftState(),
  responses: { '6': 'Synthetic canonical cache answer' },
  credentials: { userEmail: 'synthetic-cache@example.test' },
  ...overrides,
});

describe('questionnaire canonical draft cache', () => {
  let storage;

  beforeEach(() => { storage = createStorage(); });

  it('builds only the current namespaced draft-cache key', () => {
    expect(cacheKey).toBe(
      `pro-questionnaire:${QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT}:${namespace}:draft-cache`,
    );
    expect(() => createCanonicalDraftCacheKey('global')).toThrow(
      'INVALID_QUESTIONNAIRE_BROWSER_NAMESPACE',
    );
    expect(cacheKey).not.toContain('cache-test-client');
    expect(cacheKey).not.toMatch(/@|example\.test/);
  });

  it('writes the complete validated cache envelope', async () => {
    const result = await saveCanonicalDraftCache({
      namespace,
      state: draft(),
      storage,
      now: () => Date.parse('2026-08-05T12:00:00.000Z'),
    });
    expect(result).toMatchObject({ ok: true, written: true, unchanged: false });
    const envelope = JSON.parse(storage.values.get(cacheKey));
    expect(envelope).toMatchObject({
      cacheVersion: CANONICAL_DRAFT_CACHE_VERSION,
      namespaceVersion: QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT,
      canonicalStateSchemaVersion: 4,
      savedAtClient: '2026-08-05T12:00:00.000Z',
      storageMode: 'localstorage',
    });
    expect(envelope.canonicalStateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.byteSize).toBe(new TextEncoder().encode(envelope.canonicalStateJson).byteLength);
  });

  it('loads and validates the canonical state and hash', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const loaded = await loadCanonicalDraftCache({ namespace, storage });
    expect(loaded).toMatchObject({ ok: true, present: true, errorCode: null });
    expect(loaded.state.responses['6']).toBe('Synthetic canonical cache answer');
  });

  it('returns a safe missing result without writing', async () => {
    await expect(loadCanonicalDraftCache({ namespace, storage })).resolves.toMatchObject({
      ok: true,
      present: false,
      state: null,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('inspection never exposes answer or credential values', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const inspected = await inspectCanonicalDraftCache({ namespace, storage });
    expect(inspected).toMatchObject({ present: true, valid: true, byteSize: expect.any(Number) });
    expect(JSON.stringify(inspected)).not.toContain('Synthetic canonical cache answer');
    expect(JSON.stringify(inspected)).not.toContain('synthetic-cache@example.test');
  });

  it('skips an unchanged canonical hash', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    storage.setItem.mockClear();
    const result = await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    expect(result).toMatchObject({ ok: true, written: false, unchanged: true });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('replaces a valid older cache only after a changed envelope validates', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const before = storage.values.get(cacheKey);
    const result = await saveCanonicalDraftCache({
      namespace,
      state: draft({ responses: { '6': 'Synthetic changed answer' } }),
      storage,
    });
    expect(result.written).toBe(true);
    expect(storage.values.get(cacheKey)).not.toBe(before);
  });

  it('preserves the last good envelope after serialization failure', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const before = storage.values.get(cacheKey);
    const circular = draft();
    circular.responses.circular = circular;
    const result = await saveCanonicalDraftCache({ namespace, state: circular, storage });
    expect(result.ok).toBe(false);
    expect(storage.values.get(cacheKey)).toBe(before);
  });

  it('preserves the last good envelope after crypto failure', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const before = storage.values.get(cacheKey);
    const result = await saveCanonicalDraftCache({
      namespace,
      state: draft({ responses: { '6': 'Changed but unhashable' } }),
      storage,
      crypto: null,
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'CRYPTO_UNAVAILABLE' });
    expect(storage.values.get(cacheKey)).toBe(before);
  });

  it('reports a write failure without removing the prior value', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const before = storage.values.get(cacheKey);
    storage.setItem.mockRejectedValueOnce(Object.assign(new Error('synthetic'), {
      code: 'QUOTA_EXCEEDED',
    }));
    const result = await saveCanonicalDraftCache({
      namespace,
      state: draft({ responses: { '6': 'Synthetic quota answer' } }),
      storage,
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'QUOTA_EXCEEDED' });
    expect(storage.values.get(cacheKey)).toBe(before);
  });

  it('returns a typed malformed-json error and does not delete it', async () => {
    storage.values.set(cacheKey, '{malformed');
    const loaded = await loadCanonicalDraftCache({ namespace, storage });
    expect(loaded).toMatchObject({
      ok: false,
      errorCode: CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_JSON,
    });
    expect(storage.values.get(cacheKey)).toBe('{malformed');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('rejects malformed canonical JSON inside an otherwise complete envelope', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const envelope = JSON.parse(storage.values.get(cacheKey));
    envelope.canonicalStateJson = '{';
    envelope.byteSize = new TextEncoder().encode(envelope.canonicalStateJson).byteLength;
    storage.values.set(cacheKey, JSON.stringify(envelope));
    const loaded = await loadCanonicalDraftCache({ namespace, storage });
    expect(loaded).toMatchObject({
      ok: false,
      errorCode: CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE,
      causeCode: expect.any(String),
    });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('rejects an unsupported cache version without deletion', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const envelope = JSON.parse(storage.values.get(cacheKey));
    envelope.cacheVersion += 1;
    storage.values.set(cacheKey, JSON.stringify(envelope));
    const loaded = await loadCanonicalDraftCache({ namespace, storage });
    expect(loaded.errorCode).toBe(CANONICAL_DRAFT_CACHE_ERROR_CODES.UNSUPPORTED_VERSION);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('rejects a namespace-version mismatch', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const envelope = JSON.parse(storage.values.get(cacheKey));
    envelope.namespaceVersion = 'v999';
    storage.values.set(cacheKey, JSON.stringify(envelope));
    expect((await loadCanonicalDraftCache({ namespace, storage })).errorCode)
      .toBe(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_NAMESPACE_VERSION);
  });

  it('rejects a canonical schema-version mismatch with a typed error', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const envelope = JSON.parse(storage.values.get(cacheKey));
    envelope.canonicalStateSchemaVersion += 1;
    storage.values.set(cacheKey, JSON.stringify(envelope));
    expect((await loadCanonicalDraftCache({ namespace, storage })).errorCode)
      .toBe(CANONICAL_DRAFT_CACHE_ERROR_CODES.SCHEMA_MISMATCH);
  });

  it('rejects a canonical hash mismatch', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const envelope = JSON.parse(storage.values.get(cacheKey));
    envelope.canonicalStateHash = 'a'.repeat(64);
    storage.values.set(cacheKey, JSON.stringify(envelope));
    expect((await loadCanonicalDraftCache({ namespace, storage })).errorCode)
      .toBe(CANONICAL_DRAFT_CACHE_ERROR_CODES.HASH_MISMATCH);
  });

  it('rejects a byte-size mismatch before parsing state', async () => {
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    const envelope = JSON.parse(storage.values.get(cacheKey));
    envelope.byteSize += 1;
    storage.values.set(cacheKey, JSON.stringify(envelope));
    expect((await loadCanonicalDraftCache({ namespace, storage })).errorCode)
      .toBe(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE);
  });

  it('times out a cache read with a typed result', async () => {
    const stalled = { ...storage, getItem: () => new Promise(() => {}) };
    const result = await loadCanonicalDraftCache({
      namespace,
      storage: stalled,
      timeoutMs: 5,
    });
    expect(result.errorCode).toBe(CANONICAL_DRAFT_CACHE_ERROR_CODES.READ_TIMED_OUT);
  });

  it('removes only the current namespace cache', async () => {
    const otherNamespace = deriveQuestionnaireBrowserNamespace({ userId: 'other-cache-client' });
    await saveCanonicalDraftCache({ namespace, state: draft(), storage });
    await saveCanonicalDraftCache({ namespace: otherNamespace, state: draft(), storage });
    await removeCanonicalDraftCache({ namespace, storage });
    expect(storage.values.has(cacheKey)).toBe(false);
    expect(storage.values.has(createCanonicalDraftCacheKey(otherNamespace))).toBe(true);
  });

  it('migrates an explicitly supplied legacy canonical value', async () => {
    const result = await migrateLegacyCanonicalDraftCache({
      namespace,
      storage,
      legacyValue: draft({ responses: { '6': 'Explicit legacy cache' } }),
    });
    expect(result).toMatchObject({ ok: true, migrated: true });
    expect((await loadCanonicalDraftCache({ namespace, storage })).state.responses['6'])
      .toBe('Explicit legacy cache');
  });

  it('does not migrate malformed or implicit global legacy data', async () => {
    expect((await migrateLegacyCanonicalDraftCache({ namespace, storage })).ok).toBe(false);
    expect((await migrateLegacyCanonicalDraftCache({
      namespace,
      storage,
      legacyValue: '{bad',
    })).errorCode).toBe(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_JSON);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('warns safely above 750 KB and never truncates the canonical JSON', async () => {
    const onWarning = vi.fn();
    const largeValue = 'x'.repeat(PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES + 1_024);
    const result = await saveCanonicalDraftCache({
      namespace,
      storage,
      state: draft({ responses: { '6': largeValue } }),
      onWarning,
    });
    expect(result.ok).toBe(true);
    expect(result.envelope.byteSize).toBeGreaterThan(PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES);
    expect(result.envelope.canonicalStateJson).toContain(largeValue);
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CANONICAL_CACHE_RECOMMENDED_SIZE_EXCEEDED',
    }));
  });

  it('safe diagnostics default missing fields without leaking payloads', () => {
    expect(getSafeCanonicalDraftCacheDiagnostics({ errorCode: 'SYNTHETIC_ERROR' }))
      .toEqual({
        present: false,
        valid: false,
        cacheVersion: null,
        namespaceVersion: null,
        canonicalStateSchemaVersion: null,
        savedAtClient: null,
        storageMode: null,
        byteSize: 0,
        errorCode: 'SYNTHETIC_ERROR',
      });
  });
});
