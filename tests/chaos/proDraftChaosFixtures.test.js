import { describe, expect, it, vi } from 'vitest';
import {
  CHAOS_PROFILES,
  createBrowserStorageChaos,
  createChaosFault,
  createMockSesFailureTransport,
  deliverDuplicateResponse,
  interruptMigrationBundle,
} from './proDraftChaosFixtures.js';

describe('controlled client/interception chaos fixtures', () => {
  it('declares every required controlled failure without a backend endpoint', () => {
    expect(CHAOS_PROFILES).toEqual([
      'network-timeout', 'connection-reset', 'http-500', 'rate-limit-429',
      'offline-reconnect', 'out-of-order-response', 'duplicate-response',
      'browser-storage-unavailable', 'local-storage-quota', 'indexeddb-failure',
      'save-conflict', 'event-append-failure', 'ses-transport-failure',
      'migration-bundle-interruption', 'cleanup-interruption',
    ]);
  });

  it.each([
    ['network-timeout', 504, true],
    ['connection-reset', 503, true],
    ['http-500', 500, true],
    ['rate-limit-429', 429, true],
    ['offline-reconnect', 503, true],
    ['save-conflict', 409, false],
  ])('injects %s once and then permits recovery', async (profile, status, retryable) => {
    const fault = createChaosFault(profile);
    await expect(fault('save')).rejects.toMatchObject({ status, retryable });
    await expect(fault('save')).resolves.toBeUndefined();
  });

  it('models out-of-order and duplicate responses entirely in memory', async () => {
    const action = vi.fn(async () => ({ safe: true }));
    const [first, second] = await deliverDuplicateResponse(action);
    expect(first).toBe(second);
    expect(action).toHaveBeenCalledOnce();
    await expect(createChaosFault('out-of-order-response')('save')).resolves.toBeUndefined();
  });

  it.each([
    'browser-storage-unavailable', 'local-storage-quota', 'indexeddb-failure',
  ])('fails the %s storage adapter without touching browser globals', (profile) => {
    const storage = createBrowserStorageChaos(profile);
    expect(() => storage.setItem('safe', 'value')).toThrow(/^CHAOS_/u);
  });

  it('uses an in-memory SES failure adapter with live sending disabled', async () => {
    const transport = createMockSesFailureTransport();
    expect(transport).toMatchObject({ kind: 'in-memory', liveSendEnabled: false });
    await expect(transport.send()).rejects.toThrow('CHAOS_SES_TRANSPORT_FAILED');
  });

  it('interrupts migration deterministically after the configured safe record count', () => {
    const interrupt = interruptMigrationBundle({ afterRecords: 2 });
    expect(interrupt({ id: 'safe-1' })).toEqual({ id: 'safe-1' });
    expect(interrupt({ id: 'safe-2' })).toEqual({ id: 'safe-2' });
    expect(() => interrupt({ id: 'safe-3' })).toThrow('CHAOS_MIGRATION_INTERRUPTED');
  });

  it('injects cleanup interruption only at the cleanup boundary', async () => {
    const fault = createChaosFault('cleanup-interruption');
    await expect(fault('save')).resolves.toBeUndefined();
    await expect(fault('cleanup')).rejects.toThrow('CHAOS_CLEANUP_INTERRUPTED');
  });
});
