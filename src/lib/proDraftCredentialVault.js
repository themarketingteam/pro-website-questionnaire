import {
  buildQuestionnaireStorageKey,
} from './questionnaireBrowserNamespace.js';
import {
  formatRecoveryCode,
  normalizeRecoveryCodeInput,
} from './proDraftRecoveryCodeContract.js';
import {
  STORAGE_MODES,
  createResilientStorage,
  defaultResilientStorage,
} from './resilientStorage.js';
import { frontendRuntimeConfig } from './proDraftRuntimeConfig.js';

export const PRO_DRAFT_CREDENTIAL_VAULT_VERSION = 1;

export const PRO_DRAFT_CREDENTIAL_TYPES = Object.freeze({
  RESUME_TOKEN: 'resume_token',
  RECOVERY_SESSION_TOKEN: 'recovery_session_token',
  RECOVERY_CODE: 'recovery_code',
});

export const PRO_DRAFT_CREDENTIAL_ERROR_CODES = Object.freeze({
  INVALID_BUNDLE: 'DRAFT_CREDENTIAL_VAULT_INVALID_BUNDLE',
  INVALID_ENVIRONMENT: 'DRAFT_CREDENTIAL_VAULT_INVALID_ENVIRONMENT',
  ENVIRONMENT_MISMATCH: 'DRAFT_CREDENTIAL_VAULT_ENVIRONMENT_MISMATCH',
  INVALID_NAMESPACE: 'DRAFT_CREDENTIAL_VAULT_INVALID_NAMESPACE',
  INVALID_IDENTIFIER: 'DRAFT_CREDENTIAL_VAULT_INVALID_IDENTIFIER',
  INVALID_AUTHORIZATION_METHOD: 'DRAFT_CREDENTIAL_VAULT_INVALID_AUTHORIZATION_METHOD',
  INVALID_RESUME_TOKEN: 'DRAFT_CREDENTIAL_VAULT_INVALID_RESUME_TOKEN',
  INVALID_RECOVERY_SESSION_TOKEN: 'DRAFT_CREDENTIAL_VAULT_INVALID_RECOVERY_SESSION_TOKEN',
  INVALID_RECOVERY_SESSION_EXPIRATION: 'DRAFT_CREDENTIAL_VAULT_INVALID_RECOVERY_SESSION_EXPIRATION',
  INVALID_RECOVERY_CODE: 'DRAFT_CREDENTIAL_VAULT_INVALID_RECOVERY_CODE',
  RECOVERY_CODE_STORAGE_NOT_ALLOWED: 'DRAFT_CREDENTIAL_VAULT_RECOVERY_CODE_STORAGE_NOT_ALLOWED',
  UNSUPPORTED_VERSION: 'DRAFT_CREDENTIAL_VAULT_UNSUPPORTED_VERSION',
  READ_FAILED: 'DRAFT_CREDENTIAL_VAULT_READ_FAILED',
  WRITE_FAILED: 'DRAFT_CREDENTIAL_VAULT_WRITE_FAILED',
  REMOVE_FAILED: 'DRAFT_CREDENTIAL_VAULT_REMOVE_FAILED',
});

const ENVIRONMENTS = new Set(['local', 'test', 'staging', 'production']);
const AUTHORIZATION_METHODS = new Set([
  'resume_token',
  'signed_invitation',
  'recovery_session',
  'new_anonymous_draft',
  'email',
  'recovery_code',
  'email_otp',
  'magic_link',
]);
const BUNDLE_FIELDS = Object.freeze([
  'version',
  'environment',
  'browserNamespace',
  'draftId',
  'sessionId',
  'resumeToken',
  'recoverySessionToken',
  'recoverySessionExpiresAt',
  'recoveryCode',
  'recoveryCodeHint',
  'recoveryCodeVersion',
  'authorizationMethod',
  'storedAtClient',
  'lastUsedAtClient',
]);
const BUNDLE_FIELD_SET = new Set(BUNDLE_FIELDS);
const NAMESPACE_PATTERN = /^ns_[a-f\d]{32}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/u;
const RESUME_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,8192}$/u;
const RECOVERY_SESSION_PATTERN = /^[A-Za-z0-9_-]{16,4096}\.[A-Za-z0-9_-]{16,4096}$/u;
const RECOVERY_HINT_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/u;

class CredentialVaultError extends Error {
  constructor(code) {
    super(`Draft credential vault operation failed (${code})`);
    this.name = 'CredentialVaultError';
    this.code = code;
  }
}

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const fail = (code) => { throw new CredentialVaultError(code); };

const nullableString = (value, pattern, code) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !pattern.test(value)) fail(code);
  return value;
};

const normalizeTimestamp = (value, code, { required = false } = {}) => {
  if (value === null || value === undefined || value === '') {
    if (required) fail(code);
    return null;
  }
  let date;
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else {
    fail(code);
  }
  if (Number.isNaN(date.getTime())) fail(code);
  return date.toISOString();
};

const storageMode = (storage) => {
  try {
    const mode = storage?.getMode?.();
    return Object.values(STORAGE_MODES).includes(mode) ? mode : STORAGE_MODES.UNKNOWN;
  } catch {
    return STORAGE_MODES.UNKNOWN;
  }
};

const durableMode = (mode) => (
  mode === STORAGE_MODES.INDEXEDDB || mode === STORAGE_MODES.LOCALSTORAGE
);

export const createCredentialVaultKey = (namespaceOrOptions) => {
  const browserNamespace = typeof namespaceOrOptions === 'string'
    ? namespaceOrOptions
    : namespaceOrOptions?.browserNamespace ?? namespaceOrOptions?.namespace;
  return buildQuestionnaireStorageKey({
    namespace: browserNamespace,
    purpose: 'draft-credentials',
  });
};

/**
 * Possession of either stored token authorizes draft access. These values must
 * never be exposed to unrelated scripts, logs, Redux, or canonical state.
 */
export const validateCredentialBundle = (input, options = {}) => {
  if (!isPlainObject(input)) fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_BUNDLE);
  if (Object.keys(input).some((field) => !BUNDLE_FIELD_SET.has(field))) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_BUNDLE);
  }
  if (input.version !== PRO_DRAFT_CREDENTIAL_VAULT_VERSION) {
    fail(input.version > PRO_DRAFT_CREDENTIAL_VAULT_VERSION
      ? PRO_DRAFT_CREDENTIAL_ERROR_CODES.UNSUPPORTED_VERSION
      : PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_BUNDLE);
  }
  if (!ENVIRONMENTS.has(input.environment)) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_ENVIRONMENT);
  }
  const expectedEnvironment = options.environment ?? options.activeEnvironment;
  if (expectedEnvironment && input.environment !== expectedEnvironment) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.ENVIRONMENT_MISMATCH);
  }
  if (typeof input.browserNamespace !== 'string'
    || !NAMESPACE_PATTERN.test(input.browserNamespace)) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_NAMESPACE);
  }
  const expectedNamespace = options.browserNamespace ?? options.namespace;
  if (expectedNamespace && input.browserNamespace !== expectedNamespace) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_NAMESPACE);
  }
  const draftId = nullableString(
    input.draftId,
    IDENTIFIER_PATTERN,
    PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_IDENTIFIER,
  );
  const sessionId = nullableString(
    input.sessionId,
    IDENTIFIER_PATTERN,
    PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_IDENTIFIER,
  );
  const resumeToken = nullableString(
    input.resumeToken,
    RESUME_TOKEN_PATTERN,
    PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RESUME_TOKEN,
  );
  const recoverySessionToken = nullableString(
    input.recoverySessionToken,
    RECOVERY_SESSION_PATTERN,
    PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_SESSION_TOKEN,
  );
  if (recoverySessionToken && recoverySessionToken.length > 8192) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_SESSION_TOKEN);
  }
  const recoverySessionExpiresAt = normalizeTimestamp(
    input.recoverySessionExpiresAt,
    PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_SESSION_EXPIRATION,
  );
  if (Boolean(recoverySessionToken) !== Boolean(recoverySessionExpiresAt)) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_SESSION_EXPIRATION);
  }
  let recoveryCode = null;
  if (input.recoveryCode !== null && input.recoveryCode !== undefined && input.recoveryCode !== '') {
    if (options.allowRecoveryCode === false) {
      fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.RECOVERY_CODE_STORAGE_NOT_ALLOWED);
    }
    const normalized = normalizeRecoveryCodeInput(input.recoveryCode);
    if (!normalized.valid) fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_CODE);
    recoveryCode = formatRecoveryCode(normalized.normalizedCode);
  }
  const recoveryCodeHint = nullableString(
    input.recoveryCodeHint,
    RECOVERY_HINT_PATTERN,
    PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_CODE,
  );
  if (recoveryCode && recoveryCodeHint
    && recoveryCode.replaceAll('-', '').slice(-4) !== recoveryCodeHint) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_CODE);
  }
  const recoveryCodeVersion = input.recoveryCodeVersion === null
    || input.recoveryCodeVersion === undefined
    ? null
    : input.recoveryCodeVersion;
  if (recoveryCodeVersion !== null
    && (!Number.isSafeInteger(recoveryCodeVersion) || recoveryCodeVersion < 1)) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_CODE);
  }
  const authorizationMethod = input.authorizationMethod === null
    || input.authorizationMethod === undefined
    || input.authorizationMethod === ''
    ? null
    : input.authorizationMethod;
  if (authorizationMethod !== null && !AUTHORIZATION_METHODS.has(authorizationMethod)) {
    fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_AUTHORIZATION_METHOD);
  }
  const storedAtClient = normalizeTimestamp(
    input.storedAtClient,
    PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_BUNDLE,
    { required: true },
  );
  const lastUsedAtClient = normalizeTimestamp(
    input.lastUsedAtClient,
    PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_BUNDLE,
  );
  return Object.freeze({
    version: PRO_DRAFT_CREDENTIAL_VAULT_VERSION,
    environment: input.environment,
    browserNamespace: input.browserNamespace,
    draftId,
    sessionId,
    resumeToken,
    recoverySessionToken,
    recoverySessionExpiresAt,
    recoveryCode,
    recoveryCodeHint,
    recoveryCodeVersion,
    authorizationMethod,
    storedAtClient,
    lastUsedAtClient,
  });
};

export const getSafeCredentialVaultDiagnostics = (value = {}) => {
  const bundle = value.bundle || value;
  const mode = typeof value.storageMode === 'string' ? value.storageMode : STORAGE_MODES.UNKNOWN;
  return Object.freeze({
    version: Number.isSafeInteger(bundle?.version) ? bundle.version : null,
    present: value.present === true || Boolean(bundle?.draftId),
    valid: value.ok === true,
    environment: ENVIRONMENTS.has(bundle?.environment) ? bundle.environment : 'unknown',
    storageMode: mode,
    durable: durableMode(mode),
    memoryOnly: mode === STORAGE_MODES.MEMORY_ONLY,
    repaired: value.repaired === true,
    hasDraftId: Boolean(bundle?.draftId),
    hasSessionId: Boolean(bundle?.sessionId),
    hasResumeToken: Boolean(bundle?.resumeToken),
    hasRecoverySession: Boolean(bundle?.recoverySessionToken),
    recoverySessionExpired: value.recoverySessionExpired === true,
    hasRecoveryCode: Boolean(bundle?.recoveryCode),
    hasRecoveryCodeHint: Boolean(bundle?.recoveryCodeHint),
    authorizationMethod: AUTHORIZATION_METHODS.has(bundle?.authorizationMethod)
      ? bundle.authorizationMethod
      : null,
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : null,
  });
};

const result = (details) => Object.freeze({
  ...details,
  safeDiagnostics: getSafeCredentialVaultDiagnostics(details),
});

const nowIso = (now = Date.now) => {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail(PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_BUNDLE);
  return date.toISOString();
};

const repairIsolatedCredentialField = (parsed, errorCode, active) => {
  let candidate;
  if (errorCode === PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RESUME_TOKEN) {
    candidate = { ...parsed, resumeToken: null };
  } else if (
    errorCode === PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_SESSION_TOKEN
    || errorCode === PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_SESSION_EXPIRATION
  ) {
    candidate = {
      ...parsed,
      recoverySessionToken: null,
      recoverySessionExpiresAt: null,
    };
  } else if (errorCode === PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_CODE) {
    candidate = {
      ...parsed,
      recoveryCode: null,
      recoveryCodeHint: null,
      recoveryCodeVersion: null,
    };
  } else {
    return null;
  }
  try {
    return validateCredentialBundle(candidate, active);
  } catch {
    return null;
  }
};

export const createProDraftCredentialVault = (options = {}) => {
  const storage = options.storage || createResilientStorage(options.storageOptions);
  const environment = options.environment || frontendRuntimeConfig.environment;
  const browserNamespace = options.browserNamespace || options.namespace;

  const context = (overrides = {}) => ({
    storage: overrides.storage || storage,
    environment: overrides.environment || environment,
    browserNamespace: overrides.browserNamespace || overrides.namespace || browserNamespace,
  });

  const load = async (overrides = {}) => {
    const active = context(overrides);
    const mode = storageMode(active.storage);
    let raw;
    try {
      raw = await active.storage.getItem(createCredentialVaultKey(active.browserNamespace));
      if (raw === null || raw === undefined) {
        return result({ ok: true, present: false, bundle: null, storageMode: mode, errorCode: null });
      }
      let parsed;
      try { parsed = JSON.parse(raw); } catch {
        return result({
          ok: false,
          present: true,
          bundle: null,
          storageMode: storageMode(active.storage),
          errorCode: PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_BUNDLE,
        });
      }
      let bundle;
      let repaired = false;
      try {
        bundle = validateCredentialBundle(parsed, active);
      } catch (error) {
        bundle = repairIsolatedCredentialField(parsed, error?.code, active);
        if (!bundle) throw error;
        repaired = true;
        try {
          await active.storage.setItem(
            createCredentialVaultKey(active.browserNamespace),
            JSON.stringify(bundle),
          );
        } catch {
          // The repaired in-memory value is still safe for this page. The
          // adapter remains authoritative about whether persistence succeeded.
        }
      }
      return result({
        ok: true,
        present: true,
        bundle,
        repaired,
        storageMode: storageMode(active.storage),
        errorCode: null,
      });
    } catch (error) {
      return result({
        ok: false,
        present: raw !== null && raw !== undefined,
        bundle: null,
        storageMode: storageMode(active.storage),
        errorCode: error?.code || PRO_DRAFT_CREDENTIAL_ERROR_CODES.READ_FAILED,
      });
    }
  };

  const save = async (bundleInput, overrides = {}) => {
    const active = context(overrides);
    try {
      const bundle = validateCredentialBundle(bundleInput, {
        ...active,
        // Raw-code persistence is fail-closed. Only callers that just received
        // or successfully used the code may opt in deliberately.
        allowRecoveryCode: !bundleInput?.recoveryCode || overrides.allowRecoveryCode === true,
      });
      // Complete validation and serialization happen before the storage write,
      // preserving any last-known-good record when either step fails.
      const serialized = JSON.stringify(bundle);
      await active.storage.setItem(createCredentialVaultKey(active.browserNamespace), serialized);
      return result({
        ok: true,
        present: true,
        bundle,
        storageMode: storageMode(active.storage),
        errorCode: null,
      });
    } catch (error) {
      return result({
        ok: false,
        present: false,
        bundle: null,
        storageMode: storageMode(active.storage),
        errorCode: error?.code || PRO_DRAFT_CREDENTIAL_ERROR_CODES.WRITE_FAILED,
      });
    }
  };

  const remove = async (overrides = {}) => {
    const active = context(overrides);
    try {
      await active.storage.removeItem(createCredentialVaultKey(active.browserNamespace));
      return result({
        ok: true,
        present: false,
        removed: true,
        bundle: null,
        storageMode: storageMode(active.storage),
        errorCode: null,
      });
    } catch {
      return result({
        ok: false,
        present: false,
        removed: false,
        bundle: null,
        storageMode: storageMode(active.storage),
        errorCode: PRO_DRAFT_CREDENTIAL_ERROR_CODES.REMOVE_FAILED,
      });
    }
  };

  const rotate = async (patch, overrides = {}) => {
    const loaded = await load(overrides);
    if (!loaded.ok || !loaded.bundle) return loaded;
    const next = {
      ...loaded.bundle,
      ...(typeof patch === 'function' ? patch(loaded.bundle) : patch),
      storedAtClient: loaded.bundle.storedAtClient,
      lastUsedAtClient: nowIso(overrides.now),
    };
    return save(next, {
      ...overrides,
      allowRecoveryCode: Boolean(next.recoveryCode),
    });
  };

  const removeExpired = async (overrides = {}) => {
    const loaded = await load(overrides);
    if (!loaded.ok || !loaded.bundle?.recoverySessionToken) return loaded;
    const currentTime = new Date(typeof overrides.now === 'function'
      ? overrides.now()
      : overrides.now ?? Date.now()).getTime();
    const expires = new Date(loaded.bundle.recoverySessionExpiresAt).getTime();
    if (expires > currentTime) return loaded;
    const updated = await rotate({
      recoverySessionToken: null,
      recoverySessionExpiresAt: null,
    }, overrides);
    return result({
      ...updated,
      recoverySessionExpired: true,
    });
  };

  return Object.freeze({
    saveDraftCredentialBundle: save,
    loadDraftCredentialBundle: load,
    removeDraftCredentialBundle: remove,
    removeExpiredRecoverySession: removeExpired,
    rotateDraftCredentialBundle: rotate,
    getDiagnostics: () => getSafeCredentialVaultDiagnostics({
      storageMode: storageMode(storage),
    }),
  });
};

export const defaultProDraftCredentialVault = createProDraftCredentialVault({
  storage: defaultResilientStorage,
  environment: frontendRuntimeConfig.environment,
});

export const saveDraftCredentialBundle = (bundle, options = {}) => (
  (options.vault || defaultProDraftCredentialVault).saveDraftCredentialBundle(bundle, options)
);

export const loadDraftCredentialBundle = (options = {}) => (
  (options.vault || defaultProDraftCredentialVault).loadDraftCredentialBundle(options)
);

export const removeDraftCredentialBundle = (options = {}) => (
  (options.vault || defaultProDraftCredentialVault).removeDraftCredentialBundle(options)
);

export const removeExpiredRecoverySession = (options = {}) => (
  (options.vault || defaultProDraftCredentialVault).removeExpiredRecoverySession(options)
);

export const rotateDraftCredentialBundle = (patch, options = {}) => (
  (options.vault || defaultProDraftCredentialVault).rotateDraftCredentialBundle(patch, options)
);
