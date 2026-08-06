import {
  STORAGE_MODES,
  defaultResilientStorage,
} from '@/lib/resilientStorage';
import {
  clearProDraftDeviceId,
  getOrCreateProDraftDeviceId,
  validateProDraftDeviceId,
} from '@/lib/proDraftDeviceId';
import { frontendRuntimeConfig } from '@/lib/proDraftRuntimeConfig';

export const PRO_DRAFT_ADMIN_GRANT_VAULT_VERSION = 1;

const ENVIRONMENTS = new Set(['local', 'test', 'staging', 'production']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

const normalizeEnvironment = (value) => (
  typeof value === 'string' && ENVIRONMENTS.has(value) ? value : 'unknown'
);

const keyFor = (environment) => `pro-draft-admin:grant:v1:${environment}`;
const isVersion = (value) => Number.isSafeInteger(value) && value >= 1;
const isTimestamp = (value) => (
  typeof value === 'string' && Number.isFinite(Date.parse(value))
);

function normalizeBundle(value, expectedEnvironment) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.vaultVersion !== PRO_DRAFT_ADMIN_GRANT_VAULT_VERSION
    || value.environment !== expectedEnvironment
    || typeof value.grant !== 'string' || value.grant.length > 8192
    || !TOKEN_PATTERN.test(value.grant)
    || !validateProDraftDeviceId(value.deviceId)
    || !isVersion(value.grantVersion)
    || !isVersion(value.passwordVersion)
    || !isVersion(value.recoveryPolicyVersion)
    || !isTimestamp(value.storedAtClient)
    || !isTimestamp(value.lastValidatedAtClient)) return null;
  return Object.freeze({
    vaultVersion: value.vaultVersion,
    environment: value.environment,
    grant: value.grant,
    deviceId: value.deviceId,
    grantVersion: value.grantVersion,
    passwordVersion: value.passwordVersion,
    recoveryPolicyVersion: value.recoveryPolicyVersion,
    storedAtClient: value.storedAtClient,
    lastValidatedAtClient: value.lastValidatedAtClient,
  });
}

export function createProDraftAdminGrantVault(options = {}) {
  const storage = options.storage ?? defaultResilientStorage;
  const environment = normalizeEnvironment(
    options.environment ?? frontendRuntimeConfig.environment,
  );
  const now = options.now ?? (() => new Date());
  const deviceOptions = { storage, cryptoProvider: options.cryptoProvider };

  const diagnostics = () => {
    const mode = storage.getMode?.() ?? STORAGE_MODES.UNKNOWN;
    return Object.freeze({
      version: PRO_DRAFT_ADMIN_GRANT_VAULT_VERSION,
      environment,
      storageMode: mode,
      durable: mode === STORAGE_MODES.INDEXEDDB || mode === STORAGE_MODES.LOCALSTORAGE,
      persistentNotice: mode === STORAGE_MODES.MEMORY_ONLY
        ? 'Authorization lasts only for this page session because persistent browser storage is unavailable.'
        : 'Authorization can persist in this browser until it is revoked or cleared.',
      storesInRedux: false,
      storesInUrl: false,
      containsPassword: false,
    });
  };

  return Object.freeze({
    async loadAdminRecoveryGrant() {
      if (!ENVIRONMENTS.has(environment)) {
        return Object.freeze({ status: 'wrong_environment', bundle: null, ...diagnostics() });
      }
      let raw;
      try {
        raw = await storage.getItem(keyFor(environment));
      } catch {
        return Object.freeze({ status: 'missing', bundle: null, ...diagnostics() });
      }
      if (raw == null) return Object.freeze({ status: 'missing', bundle: null, ...diagnostics() });
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return Object.freeze({ status: 'malformed', bundle: null, ...diagnostics() });
      }
      if (parsed?.environment !== environment) {
        return Object.freeze({ status: 'wrong_environment', bundle: null, ...diagnostics() });
      }
      const bundle = normalizeBundle(parsed, environment);
      return Object.freeze({
        status: bundle ? 'available' : 'malformed',
        bundle,
        ...diagnostics(),
      });
    },

    async saveAdminRecoveryGrant(value) {
      if (!ENVIRONMENTS.has(environment)) throw new Error('ADMIN_GRANT_ENVIRONMENT_INVALID');
      const timestamp = now().toISOString();
      const deviceId = value?.deviceId ?? await getOrCreateProDraftDeviceId(deviceOptions);
      const bundle = normalizeBundle({
        vaultVersion: PRO_DRAFT_ADMIN_GRANT_VAULT_VERSION,
        environment,
        grant: value?.grant,
        deviceId,
        grantVersion: value?.grantVersion,
        passwordVersion: value?.passwordVersion,
        recoveryPolicyVersion: value?.recoveryPolicyVersion,
        storedAtClient: value?.storedAtClient ?? timestamp,
        lastValidatedAtClient: value?.lastValidatedAtClient ?? timestamp,
      }, environment);
      if (!bundle) throw new Error('ADMIN_GRANT_BUNDLE_INVALID');
      await storage.setItem(keyFor(environment), JSON.stringify(bundle));
      return Object.freeze({ bundle, ...diagnostics() });
    },

    async markAdminRecoveryGrantValidated(bundle) {
      return this.saveAdminRecoveryGrant({
        ...bundle,
        storedAtClient: bundle.storedAtClient,
        lastValidatedAtClient: now().toISOString(),
      });
    },

    async removeAdminRecoveryGrant() {
      if (ENVIRONMENTS.has(environment)) await storage.removeItem(keyFor(environment));
      return diagnostics();
    },

    async clearAdminRecoveryDevice() {
      return clearProDraftDeviceId(deviceOptions);
    },

    async getOrCreateDeviceId() {
      return getOrCreateProDraftDeviceId(deviceOptions);
    },

    getSafeAdminGrantVaultDiagnostics: diagnostics,
  });
}

export const defaultProDraftAdminGrantVault = createProDraftAdminGrantVault();
export const loadAdminRecoveryGrant = (...args) => (
  defaultProDraftAdminGrantVault.loadAdminRecoveryGrant(...args)
);
export const saveAdminRecoveryGrant = (...args) => (
  defaultProDraftAdminGrantVault.saveAdminRecoveryGrant(...args)
);
export const removeAdminRecoveryGrant = (...args) => (
  defaultProDraftAdminGrantVault.removeAdminRecoveryGrant(...args)
);
export const clearAdminRecoveryDevice = (...args) => (
  defaultProDraftAdminGrantVault.clearAdminRecoveryDevice(...args)
);
export const getSafeAdminGrantVaultDiagnostics = () => (
  defaultProDraftAdminGrantVault.getSafeAdminGrantVaultDiagnostics()
);
