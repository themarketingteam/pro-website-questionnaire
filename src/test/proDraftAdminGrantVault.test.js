import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createProDraftAdminGrantVault } from '@/lib/proDraftAdminGrantVault';
import { createResilientStorage } from '@/lib/resilientStorage';
import { createMemoryStorage } from '@/test/utils/storage';

const DEVICE_ID = `pdd_${'V'.repeat(22)}`;
const GRANT = `${'a'.repeat(43)}.${'b'.repeat(43)}`;
const KEY = 'pro-draft-admin:grant:v1:staging';
const TIMESTAMP = '2033-05-18T00:00:00.000Z';

const value = (overrides = {}) => ({
  grant: GRANT,
  deviceId: DEVICE_ID,
  grantVersion: 1,
  passwordVersion: 2,
  recoveryPolicyVersion: 3,
  ...overrides,
});

const storage = (overrides = {}) => createResilientStorage({
  indexedDB: null,
  localStorage: null,
  sessionStorage: null,
  timeoutMs: 20,
  ...overrides,
});

const vault = (adapter, environment = 'staging') => createProDraftAdminGrantVault({
  storage: adapter,
  environment,
  now: () => new Date(TIMESTAMP),
});

describe('admin recovery grant vault', () => {
  it('stores and loads the exact logical bundle in IndexedDB', async () => {
    const adapter = storage({ indexedDB: new IDBFactory(), databaseName: 'admin-grant-idb' });
    const subject = vault(adapter);
    const saved = await subject.saveAdminRecoveryGrant(value());
    const loaded = await subject.loadAdminRecoveryGrant();
    expect(saved.storageMode).toBe('indexeddb');
    expect(loaded).toMatchObject({ status: 'available', durable: true });
    expect(loaded.bundle).toEqual({
      vaultVersion: 1, environment: 'staging', ...value(),
      storedAtClient: TIMESTAMP, lastValidatedAtClient: TIMESTAMP,
    });
  });

  it('falls back to localStorage with truthful durable diagnostics', async () => {
    const adapter = storage({ localStorage: createMemoryStorage() });
    const saved = await vault(adapter).saveAdminRecoveryGrant(value());
    expect(saved).toMatchObject({ storageMode: 'localstorage', durable: true });
  });

  it('uses page memory and does not claim browser-close persistence', async () => {
    const adapter = storage();
    const subject = vault(adapter);
    const saved = await subject.saveAdminRecoveryGrant(value());
    expect(saved.storageMode).toBe('memory_only');
    expect(saved.durable).toBe(false);
    expect(saved.persistentNotice).toMatch(/only for this page session/iu);
    expect((await subject.loadAdminRecoveryGrant()).bundle.grant).toBe(GRANT);
  });

  it('reports malformed data without deleting it', async () => {
    const adapter = storage();
    await adapter.setItem(KEY, '{malformed');
    expect(await vault(adapter).loadAdminRecoveryGrant()).toMatchObject({
      status: 'malformed', bundle: null,
    });
    expect(await adapter.getItem(KEY)).toBe('{malformed');
  });

  it('ignores a wrong-environment bundle and does not expose it', async () => {
    const adapter = storage();
    await adapter.setItem(KEY, JSON.stringify({
      vaultVersion: 1, environment: 'production', ...value(),
      storedAtClient: TIMESTAMP, lastValidatedAtClient: TIMESTAMP,
    }));
    expect(await vault(adapter).loadAdminRecoveryGrant()).toMatchObject({
      status: 'wrong_environment', bundle: null,
    });
  });

  it('rejects malformed tokens, device identifiers, versions, and timestamps', async () => {
    const subject = vault(storage());
    await expect(subject.saveAdminRecoveryGrant(value({ grant: 'bad' }))).rejects.toThrow();
    await expect(subject.saveAdminRecoveryGrant(value({ deviceId: 'fingerprint' }))).rejects.toThrow();
    await expect(subject.saveAdminRecoveryGrant(value({ grantVersion: 0 }))).rejects.toThrow();
    await expect(subject.saveAdminRecoveryGrant(value({ storedAtClient: 'tomorrow' }))).rejects.toThrow();
  });

  it('removes only its environment-scoped credential key', async () => {
    const adapter = storage();
    await adapter.setItem('unrelated', 'keep');
    const subject = vault(adapter);
    await subject.saveAdminRecoveryGrant(value());
    await subject.removeAdminRecoveryGrant();
    expect(await subject.loadAdminRecoveryGrant()).toMatchObject({ status: 'missing' });
    expect(await adapter.getItem('unrelated')).toBe('keep');
  });

  it('safe diagnostics contain no grant or device identifier', () => {
    const diagnostics = vault(storage()).getSafeAdminGrantVaultDiagnostics();
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(GRANT);
    expect(serialized).not.toContain(DEVICE_ID);
    expect(diagnostics).toMatchObject({ storesInRedux: false, storesInUrl: false });
  });
});
