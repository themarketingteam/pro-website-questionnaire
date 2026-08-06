import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createProDraftAdminAuthorizationClient } from '@/lib/proDraftAdminAuthorizationClient';

const DEVICE_ID = `pdd_${'C'.repeat(22)}`;
const GRANT = `${'g'.repeat(43)}.${'s'.repeat(43)}`;

const available = () => ({
  status: 'available', storageMode: 'indexeddb', persistentNotice: 'persistent',
  bundle: {
    vaultVersion: 1, environment: 'test', grant: GRANT, deviceId: DEVICE_ID,
    grantVersion: 1, passwordVersion: 1, recoveryPolicyVersion: 1,
    storedAtClient: '2033-05-18T00:00:00.000Z',
    lastValidatedAtClient: '2033-05-18T00:00:00.000Z',
  },
});

const makeVault = (loaded = available()) => ({
  getOrCreateDeviceId: vi.fn(async () => DEVICE_ID),
  loadAdminRecoveryGrant: vi.fn(async () => loaded),
  saveAdminRecoveryGrant: vi.fn(async (value) => ({
    bundle: value, storageMode: 'indexeddb', persistentNotice: 'persistent',
  })),
  markAdminRecoveryGrantValidated: vi.fn(async (bundle) => ({
    bundle, storageMode: 'indexeddb', persistentNotice: 'persistent',
  })),
  removeAdminRecoveryGrant: vi.fn(async () => {}),
  clearAdminRecoveryDevice: vi.fn(async () => true),
  getSafeAdminGrantVaultDiagnostics: vi.fn(() => ({
    storageMode: 'indexeddb', persistentNotice: 'persistent',
  })),
});

describe('admin authorization client', () => {
  it('sends the password only to the backend, saves the grant, and returns safe state', async () => {
    const invoke = vi.fn(async () => ({ data: {
      success: true, authorized: true, grant: GRANT,
      grantVersion: 1, passwordVersion: 1, recoveryPolicyVersion: 1,
      requestId: 'request-1',
    } }));
    const vault = makeVault();
    const client = createProDraftAdminAuthorizationClient({ invoke, vault });
    const state = await client.authorizeWithRecoveryPassword('synthetic-password');
    expect(invoke).toHaveBeenCalledWith('verifyDraftRecoveryAccess', {
      mode: 'password', password: 'synthetic-password', deviceId: DEVICE_ID,
    });
    expect(vault.saveAdminRecoveryGrant).toHaveBeenCalledWith(expect.objectContaining({ grant: GRANT }));
    expect(state).toMatchObject({ status: 'authorized', authorized: true });
    expect(state).not.toHaveProperty('grant');
    expect(state).not.toHaveProperty('password');
  });

  it('does not log the password or grant', async () => {
    const spies = ['log', 'info', 'warn', 'error'].map((name) => vi.spyOn(console, name));
    const client = createProDraftAdminAuthorizationClient({
      invoke: vi.fn(async () => ({ data: {
        success: true, authorized: true, grant: GRANT,
        grantVersion: 1, passwordVersion: 1, recoveryPolicyVersion: 1,
      } })),
      vault: makeVault(),
    });
    await client.authorizeWithRecoveryPassword('synthetic-password');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('validates a stored grant and never returns it in rendered state', async () => {
    const vault = makeVault();
    const invoke = vi.fn(async () => ({ data: { success: true, authorized: true } }));
    const state = await createProDraftAdminAuthorizationClient({ invoke, vault })
      .validateStoredAdminRecoveryGrant();
    expect(invoke).toHaveBeenCalledWith('verifyDraftRecoveryAccess', {
      mode: 'grant', grant: GRANT, deviceId: DEVICE_ID,
    });
    expect(vault.markAdminRecoveryGrantValidated).toHaveBeenCalled();
    expect(state).toMatchObject({ status: 'authorized' });
    expect(JSON.stringify(state)).not.toContain(GRANT);
  });

  it('removes an invalid stored grant', async () => {
    const vault = makeVault();
    const client = createProDraftAdminAuthorizationClient({
      invoke: vi.fn(async () => ({ data: { success: false, authorized: false } })), vault,
    });
    expect(await client.validateStoredAdminRecoveryGrant()).toMatchObject({
      status: 'password_required', authorized: false,
    });
    expect(vault.removeAdminRecoveryGrant).toHaveBeenCalledTimes(1);
  });

  it('does not send malformed or wrong-environment vault data', async () => {
    for (const status of ['malformed', 'wrong_environment']) {
      const invoke = vi.fn();
      const vault = makeVault({
        status, bundle: null, storageMode: 'memory_only', persistentNotice: 'session only',
      });
      await createProDraftAdminAuthorizationClient({ invoke, vault })
        .validateStoredAdminRecoveryGrant();
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  it('best-effort audits forget and always clears local grant and device', async () => {
    const vault = makeVault();
    const invoke = vi.fn(async () => { throw new Error('synthetic offline'); });
    const state = await createProDraftAdminAuthorizationClient({ invoke, vault })
      .forgetAdminRecoveryDevice();
    expect(invoke).toHaveBeenCalledWith('verifyDraftRecoveryAccess', {
      mode: 'forget_device', grant: GRANT, deviceId: DEVICE_ID,
    });
    expect(vault.removeAdminRecoveryGrant).toHaveBeenCalled();
    expect(vault.clearAdminRecoveryDevice).toHaveBeenCalled();
    expect(state.status).toBe('password_required');
  });

  it('normalizes throttling to locked state without credential details', async () => {
    const client = createProDraftAdminAuthorizationClient({
      invoke: vi.fn(async () => {
        throw { response: { status: 429, data: { retryAfterSeconds: 30 } } };
      }),
      vault: makeVault(),
    });
    expect(await client.authorizeWithRecoveryPassword('synthetic')).toEqual(expect.objectContaining({
      status: 'locked', locked: true, retryAfterSeconds: 30,
    }));
  });

  it('exposes a raw grant only through the narrow accessor', async () => {
    const client = createProDraftAdminAuthorizationClient({ invoke: vi.fn(), vault: makeVault() });
    await expect(client.getGrantForAuthorizedRequest()).resolves.toBe(GRANT);
    const diagnostics = client.getSafeAdminAuthorizationClientDiagnostics();
    expect(diagnostics).toMatchObject({
      exposesGrantInUiState: false, storesInRedux: false, storesInUrl: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain(GRANT);
  });

  it('has no Redux, URL, analytics, or logging credential sink', () => {
    const sources = [
      'src/lib/proDraftAdminGrantVault.js',
      'src/lib/proDraftAdminAuthorizationClient.js',
      'src/contexts/ProDraftAdminAuthorizationContext.jsx',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(sources).not.toMatch(/\b(?:dispatch|useDispatch|window\.location|URLSearchParams)\s*\(/u);
    expect(sources).not.toMatch(/\b(?:analytics|track|identify)\s*\(/u);
    expect(sources).not.toMatch(/console\.(?:log|info|warn|error)\s*\(/u);
    expect(sources).not.toMatch(/localStorage\.(?:getItem|setItem)\s*\(/u);
  });
});
