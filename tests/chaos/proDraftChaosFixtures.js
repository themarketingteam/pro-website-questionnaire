import { LoadHarnessError } from '../../scripts/lib/pro-draft-load-harness.mjs';

export const CHAOS_PROFILES = Object.freeze([
  'network-timeout',
  'connection-reset',
  'http-500',
  'rate-limit-429',
  'offline-reconnect',
  'out-of-order-response',
  'duplicate-response',
  'browser-storage-unavailable',
  'local-storage-quota',
  'indexeddb-failure',
  'save-conflict',
  'event-append-failure',
  'ses-transport-failure',
  'migration-bundle-interruption',
  'cleanup-interruption',
]);

const errorFor = (profile) => {
  const definitions = {
    'network-timeout': ['CHAOS_NETWORK_TIMEOUT', 504, true, true],
    'connection-reset': ['CHAOS_CONNECTION_RESET', 503, true, false],
    'http-500': ['CHAOS_HTTP_500', 500, true, false],
    'rate-limit-429': ['CHAOS_RATE_LIMITED', 429, true, false],
    'offline-reconnect': ['CHAOS_OFFLINE', 503, true, false],
    'save-conflict': ['CHAOS_SAVE_CONFLICT', 409, false, false],
    'event-append-failure': ['CHAOS_EVENT_APPEND_FAILED', 500, true, false],
    'migration-bundle-interruption': ['CHAOS_MIGRATION_INTERRUPTED', 503, true, false],
    'cleanup-interruption': ['CHAOS_CLEANUP_INTERRUPTED', 503, true, false],
  };
  const [code, status, retryable, timedOut] = definitions[profile] || [
    'CHAOS_PROFILE_NOT_NETWORK_FAULT', 500, false, false,
  ];
  return new LoadHarnessError(code, { status, retryable, timedOut });
};

export const createChaosFault = (profile, { failCount = 1 } = {}) => {
  if (!CHAOS_PROFILES.includes(profile)) throw new Error('CHAOS_PROFILE_INVALID');
  let calls = 0;
  return async (operation) => {
    if (profile === 'out-of-order-response') {
      calls += 1;
      if (calls % 2 === 1) await new Promise((resolve) => setTimeout(resolve, 5));
      return;
    }
    if (profile === 'duplicate-response') return;
    if (profile === 'event-append-failure' && operation !== 'save') return;
    if (profile === 'cleanup-interruption' && operation !== 'cleanup') return;
    if (profile === 'migration-bundle-interruption' && operation !== 'migration') return;
    calls += 1;
    if (calls <= failCount && [
      'network-timeout',
      'connection-reset',
      'http-500',
      'rate-limit-429',
      'offline-reconnect',
      'save-conflict',
      'event-append-failure',
      'migration-bundle-interruption',
      'cleanup-interruption',
    ].includes(profile)) throw errorFor(profile);
  };
};

export const createBrowserStorageChaos = (profile) => {
  if (![
    'browser-storage-unavailable',
    'local-storage-quota',
    'indexeddb-failure',
  ].includes(profile)) throw new Error('CHAOS_STORAGE_PROFILE_INVALID');
  const code = {
    'browser-storage-unavailable': 'CHAOS_STORAGE_UNAVAILABLE',
    'local-storage-quota': 'CHAOS_STORAGE_QUOTA',
    'indexeddb-failure': 'CHAOS_INDEXEDDB_FAILED',
  }[profile];
  const fail = () => { throw new LoadHarnessError(code, { status: 507 }); };
  return Object.freeze({ getItem: fail, setItem: fail, removeItem: fail, open: fail });
};

export const createMockSesFailureTransport = () => Object.freeze({
  kind: 'in-memory',
  liveSendEnabled: false,
  async send() {
    throw new LoadHarnessError('CHAOS_SES_TRANSPORT_FAILED', { status: 503, retryable: true });
  },
});

export const interruptMigrationBundle = ({ afterRecords = 1 } = {}) => {
  let processed = 0;
  return (record) => {
    processed += 1;
    if (processed > afterRecords) {
      throw new LoadHarnessError('CHAOS_MIGRATION_INTERRUPTED', { status: 503, retryable: true });
    }
    return record;
  };
};

export const deliverDuplicateResponse = async (action) => {
  const response = await action();
  return Object.freeze([response, response]);
};
