import {
  DRAFT_STATE_ERROR_CODES,
  PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES,
  PRO_FORM_DRAFT_SCHEMA_VERSION,
  hashCanonicalDraftState,
  parseCanonicalDraftState,
  serializeCanonicalDraftState,
} from '@/lib/questionnaireDraftState';
import {
  QUESTIONNAIRE_STORAGE_KEY_VERSIONS,
  buildQuestionnaireStorageKey,
} from '@/lib/questionnaireBrowserNamespace';

export const CANONICAL_DRAFT_CACHE_VERSION = 1;
export const DEFAULT_CANONICAL_DRAFT_CACHE_TIMEOUT_MS = 2_000;

export const CANONICAL_DRAFT_CACHE_ERROR_CODES = Object.freeze({
  HASH_MISMATCH: 'CANONICAL_CACHE_HASH_MISMATCH',
  INVALID_ENVELOPE: 'CANONICAL_CACHE_INVALID_ENVELOPE',
  INVALID_JSON: 'CANONICAL_CACHE_INVALID_JSON',
  INVALID_NAMESPACE_VERSION: 'CANONICAL_CACHE_INVALID_NAMESPACE_VERSION',
  MISSING_DEPENDENCY: 'CANONICAL_CACHE_MISSING_DEPENDENCY',
  READ_FAILED: 'CANONICAL_CACHE_READ_FAILED',
  READ_TIMED_OUT: 'CANONICAL_CACHE_READ_TIMED_OUT',
  SCHEMA_MISMATCH: 'CANONICAL_CACHE_SCHEMA_MISMATCH',
  UNSUPPORTED_VERSION: 'CANONICAL_CACHE_UNSUPPORTED_VERSION',
  WRITE_FAILED: 'CANONICAL_CACHE_WRITE_FAILED',
});

const ENVELOPE_FIELDS = Object.freeze([
  'cacheVersion',
  'namespaceVersion',
  'canonicalStateJson',
  'canonicalStateHash',
  'canonicalStateSchemaVersion',
  'savedAtClient',
  'storageMode',
  'byteSize',
]);
const ENVELOPE_FIELD_SET = new Set(ENVELOPE_FIELDS);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const STORAGE_MODE_PATTERN = /^[a-z0-9_.:-]{1,80}$/;

export class CanonicalDraftCacheError extends Error {
  constructor(code, causeCode = null) {
    super(`Canonical draft cache operation failed (${code})`);
    this.name = 'CanonicalDraftCacheError';
    this.code = code;
    this.causeCode = causeCode;
  }
}

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeTimeout = (value) => (
  Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : DEFAULT_CANONICAL_DRAFT_CACHE_TIMEOUT_MS
);

const resolveTextEncoder = (injected) => {
  const Encoder = injected || globalThis.TextEncoder;
  if (typeof Encoder !== 'function') {
    throw new CanonicalDraftCacheError(
      CANONICAL_DRAFT_CACHE_ERROR_CODES.MISSING_DEPENDENCY,
      DRAFT_STATE_ERROR_CODES.SERIALIZATION_FAILED,
    );
  }
  return Encoder;
};

const byteSizeOf = (value, TextEncoderDependency) => (
  new (resolveTextEncoder(TextEncoderDependency))().encode(value).byteLength
);

const safeStorageMode = (storage) => {
  try {
    const mode = storage?.getMode?.();
    return STORAGE_MODE_PATTERN.test(String(mode || '')) ? mode : 'unknown';
  } catch {
    return 'unknown';
  }
};

const safeTimestamp = (now) => {
  const value = typeof now === 'function' ? now() : Date.now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE);
  }
  return date.toISOString();
};

const safeErrorCode = (error, fallback) => (
  typeof error?.code === 'string' ? error.code : fallback
);

const resultFailure = (error, fallback, present = false) => {
  const errorCode = safeErrorCode(error, fallback);
  const result = {
    ok: false,
    present,
    state: null,
    envelope: null,
    errorCode,
    causeCode: error?.causeCode || null,
  };
  return Object.freeze({
    ...result,
    safeDiagnostics: getSafeCanonicalDraftCacheDiagnostics(result),
  });
};

const withReadTimeout = async (operation, options = {}) => {
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  if (timeoutMs === 0) return operation();
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  let timeoutId;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeoutId = setTimer(() => reject(new CanonicalDraftCacheError(
          CANONICAL_DRAFT_CACHE_ERROR_CODES.READ_TIMED_OUT,
        )), timeoutMs);
      }),
    ]);
  } finally {
    clearTimer(timeoutId);
  }
};

const parseEnvelopeJson = (raw) => {
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_JSON);
  }
  if (!isPlainObject(envelope)) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE);
  }
  if (
    ENVELOPE_FIELDS.some((field) => !Object.hasOwn(envelope, field))
    || Object.keys(envelope).some((field) => !ENVELOPE_FIELD_SET.has(field))
  ) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE);
  }
  return envelope;
};

const validateEnvelope = async (raw, options = {}) => {
  const envelope = parseEnvelopeJson(raw);
  if (envelope.cacheVersion !== CANONICAL_DRAFT_CACHE_VERSION) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.UNSUPPORTED_VERSION);
  }
  if (envelope.namespaceVersion !== QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT) {
    throw new CanonicalDraftCacheError(
      CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_NAMESPACE_VERSION,
    );
  }
  if (envelope.canonicalStateSchemaVersion !== PRO_FORM_DRAFT_SCHEMA_VERSION) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.SCHEMA_MISMATCH);
  }
  if (
    !Number.isSafeInteger(envelope.byteSize)
    || envelope.byteSize < 0
    || typeof envelope.canonicalStateJson !== 'string'
    || !HASH_PATTERN.test(String(envelope.canonicalStateHash || ''))
    || !STORAGE_MODE_PATTERN.test(String(envelope.storageMode || ''))
    || typeof envelope.savedAtClient !== 'string'
    || Number.isNaN(new Date(envelope.savedAtClient).getTime())
  ) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE);
  }
  if (byteSizeOf(envelope.canonicalStateJson, options.TextEncoder) !== envelope.byteSize) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE);
  }
  const parsed = parseCanonicalDraftState(envelope.canonicalStateJson);
  if (!parsed.ok) {
    throw new CanonicalDraftCacheError(
      CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE,
      parsed.errorCode,
    );
  }
  if (parsed.state.schemaVersion !== envelope.canonicalStateSchemaVersion) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.SCHEMA_MISMATCH);
  }
  const hash = await hashCanonicalDraftState(parsed.state, {
    ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
    ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
  });
  if (hash !== envelope.canonicalStateHash) {
    throw new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.HASH_MISMATCH);
  }
  return { envelope: Object.freeze({ ...envelope }), state: parsed.state };
};

const shouldLogDevelopmentDiagnostics = () => {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(globalThis.location?.hostname || '');
  } catch {
    return false;
  }
};

const logOversizeWarning = (byteSize, options) => {
  if (byteSize <= PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES) return;
  const diagnostics = Object.freeze({
    code: 'CANONICAL_CACHE_RECOMMENDED_SIZE_EXCEEDED',
    byteSize,
    recommendedMaxBytes: PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES,
  });
  if (typeof options.onWarning === 'function') {
    options.onWarning(diagnostics);
  } else if (shouldLogDevelopmentDiagnostics()) {
    console.warn('[questionnaire-canonical-cache]', diagnostics);
  }
};

export const createCanonicalDraftCacheKey = (namespaceOrOptions) => {
  const namespace = typeof namespaceOrOptions === 'string'
    ? namespaceOrOptions
    : namespaceOrOptions?.namespace;
  return buildQuestionnaireStorageKey({ namespace, purpose: 'draft-cache' });
};

export const getSafeCanonicalDraftCacheDiagnostics = (value = {}) => {
  const envelope = value?.envelope || value;
  const present = value?.present === true || (
    isPlainObject(envelope) && envelope.cacheVersion !== undefined
  );
  return Object.freeze({
    present,
    valid: value?.ok === true,
    cacheVersion: Number.isSafeInteger(envelope?.cacheVersion)
      ? envelope.cacheVersion
      : null,
    namespaceVersion: typeof envelope?.namespaceVersion === 'string'
      ? envelope.namespaceVersion
      : null,
    canonicalStateSchemaVersion: Number.isSafeInteger(envelope?.canonicalStateSchemaVersion)
      ? envelope.canonicalStateSchemaVersion
      : null,
    savedAtClient: typeof envelope?.savedAtClient === 'string'
      ? envelope.savedAtClient
      : null,
    storageMode: typeof envelope?.storageMode === 'string' ? envelope.storageMode : null,
    byteSize: Number.isSafeInteger(envelope?.byteSize) ? envelope.byteSize : 0,
    errorCode: typeof value?.errorCode === 'string' ? value.errorCode : null,
  });
};

export const loadCanonicalDraftCache = async (options = {}) => {
  const { namespace, storage } = options;
  if (!storage || typeof storage.getItem !== 'function') {
    return resultFailure(
      new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.MISSING_DEPENDENCY),
      CANONICAL_DRAFT_CACHE_ERROR_CODES.READ_FAILED,
    );
  }
  let raw;
  try {
    raw = await withReadTimeout(
      () => Promise.resolve(storage.getItem(createCanonicalDraftCacheKey(namespace))),
      options,
    );
  } catch (error) {
    return resultFailure(error, CANONICAL_DRAFT_CACHE_ERROR_CODES.READ_FAILED);
  }
  if (raw === null || raw === undefined) {
    const result = {
      ok: true,
      present: false,
      state: null,
      envelope: null,
      errorCode: null,
    };
    return Object.freeze({
      ...result,
      safeDiagnostics: getSafeCanonicalDraftCacheDiagnostics(result),
    });
  }
  try {
    const validated = await validateEnvelope(raw, options);
    const result = {
      ok: true,
      present: true,
      state: validated.state,
      envelope: validated.envelope,
      errorCode: null,
    };
    return Object.freeze({
      ...result,
      safeDiagnostics: getSafeCanonicalDraftCacheDiagnostics(result),
    });
  } catch (error) {
    return resultFailure(error, CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE, true);
  }
};

export const inspectCanonicalDraftCache = async (options = {}) => {
  const result = await loadCanonicalDraftCache(options);
  return result.safeDiagnostics;
};

export const saveCanonicalDraftCache = async (options = {}) => {
  const { namespace, state, storage } = options;
  if (!storage || typeof storage.setItem !== 'function') {
    return resultFailure(
      new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.MISSING_DEPENDENCY),
      CANONICAL_DRAFT_CACHE_ERROR_CODES.WRITE_FAILED,
    );
  }

  let canonicalStateJson;
  let canonicalStateHash;
  let byteSize;
  try {
    canonicalStateJson = serializeCanonicalDraftState(state);
    canonicalStateHash = await hashCanonicalDraftState(state, {
      ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
      ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
    });
    byteSize = byteSizeOf(canonicalStateJson, options.TextEncoder);
    logOversizeWarning(byteSize, options);
  } catch (error) {
    return resultFailure(error, DRAFT_STATE_ERROR_CODES.SERIALIZATION_FAILED);
  }

  const existing = await loadCanonicalDraftCache(options);
  if (
    existing.ok
    && existing.present
    && existing.envelope.canonicalStateHash === canonicalStateHash
  ) {
    return Object.freeze({
      ...existing,
      written: false,
      unchanged: true,
    });
  }

  const buildEnvelope = (storageMode) => ({
    cacheVersion: CANONICAL_DRAFT_CACHE_VERSION,
    namespaceVersion: QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT,
    canonicalStateJson,
    canonicalStateHash,
    canonicalStateSchemaVersion: PRO_FORM_DRAFT_SCHEMA_VERSION,
    savedAtClient: safeTimestamp(options.now || Date.now),
    storageMode,
    byteSize,
  });

  let envelope = buildEnvelope(safeStorageMode(storage));
  let serializedEnvelope;
  try {
    serializedEnvelope = JSON.stringify(envelope);
    await validateEnvelope(serializedEnvelope, options);
  } catch (error) {
    return resultFailure(error, CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE);
  }

  try {
    const key = createCanonicalDraftCacheKey(namespace);
    await storage.setItem(key, serializedEnvelope);
    const actualStorageMode = safeStorageMode(storage);
    if (actualStorageMode !== envelope.storageMode) {
      const correctedEnvelope = { ...envelope, storageMode: actualStorageMode };
      const correctedSerializedEnvelope = JSON.stringify(correctedEnvelope);
      await validateEnvelope(correctedSerializedEnvelope, options);
      try {
        await storage.setItem(key, correctedSerializedEnvelope);
        envelope = correctedEnvelope;
      } catch {
        // The first complete envelope is already a valid last-known-good
        // snapshot. A metadata-only correction must not turn that write into
        // a false failure or destroy the prior recoverable state.
      }
    }
    const result = {
      ok: true,
      present: true,
      state,
      envelope: Object.freeze({ ...envelope }),
      errorCode: null,
      written: true,
      unchanged: false,
    };
    return Object.freeze({
      ...result,
      safeDiagnostics: getSafeCanonicalDraftCacheDiagnostics(result),
    });
  } catch (error) {
    return resultFailure(error, CANONICAL_DRAFT_CACHE_ERROR_CODES.WRITE_FAILED);
  }
};

/** @param {{ namespace?: string, storage?: any }} [options] */
export const removeCanonicalDraftCache = async (options = {}) => {
  const { namespace, storage } = options;
  if (!storage || typeof storage.removeItem !== 'function') {
    return Object.freeze({
      ok: false,
      removed: false,
      errorCode: CANONICAL_DRAFT_CACHE_ERROR_CODES.MISSING_DEPENDENCY,
    });
  }
  try {
    await storage.removeItem(createCanonicalDraftCacheKey(namespace));
    return Object.freeze({ ok: true, removed: true, errorCode: null });
  } catch {
    return Object.freeze({
      ok: false,
      removed: false,
      errorCode: CANONICAL_DRAFT_CACHE_ERROR_CODES.WRITE_FAILED,
    });
  }
};

// Migration is explicit and namespace-scoped. It never reads an ambiguous
// global key and never removes the source value automatically.
export const migrateLegacyCanonicalDraftCache = async (options = {}) => {
  let legacy = options.legacyValue;
  if (typeof legacy === 'string') {
    try { legacy = JSON.parse(legacy); } catch {
      return resultFailure(
        new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_JSON),
        CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_JSON,
      );
    }
  }
  if (!isPlainObject(legacy)) {
    return resultFailure(
      new CanonicalDraftCacheError(CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE),
      CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE,
    );
  }
  let legacyState = legacy;
  if (typeof legacy.canonicalStateJson === 'string') {
    const parsed = parseCanonicalDraftState(legacy.canonicalStateJson);
    if (!parsed.ok) {
      return resultFailure(
        new CanonicalDraftCacheError(
          CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE,
          parsed.errorCode,
        ),
        CANONICAL_DRAFT_CACHE_ERROR_CODES.INVALID_ENVELOPE,
      );
    }
    legacyState = parsed.state;
  }
  const result = await saveCanonicalDraftCache({ ...options, state: legacyState });
  return Object.freeze({
    ...result,
    migrated: result.ok && /** @type {any} */ (result).written === true,
  });
};
