import {
  DRAFT_IDENTITY_ASSOCIATION_INTENTS,
  DRAFT_IDENTITY_SOURCE_VALUES,
  EMAIL_VERIFICATION_STATUS_VALUES,
  PRO_DRAFT_IDENTITY_VERSION,
  normalizeRecoveryEmail,
} from './proDraftIdentity.js';

export const PRO_FORM_DRAFT_SCHEMA_VERSION = 4;
export const PRO_FORM_DRAFT_SCHEMA_MIN_SUPPORTED_VERSION = 2;
export const PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES = 750 * 1024;

export const DRAFT_STATE_ERROR_CODES = Object.freeze({
  CIRCULAR_REFERENCE: 'CIRCULAR_REFERENCE',
  CRYPTO_UNAVAILABLE: 'CRYPTO_UNAVAILABLE',
  HASH_FAILED: 'HASH_FAILED',
  INVALID_FIELD: 'INVALID_FIELD',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_SCHEMA_VERSION: 'INVALID_SCHEMA_VERSION',
  MAX_DEPTH_EXCEEDED: 'MAX_DEPTH_EXCEEDED',
  MAX_PROPERTIES_EXCEEDED: 'MAX_PROPERTIES_EXCEEDED',
  SECRET_BEARING_FIELD: 'SECRET_BEARING_FIELD',
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  UNSAFE_PROPERTY_KEY: 'UNSAFE_PROPERTY_KEY',
  UNSUPPORTED_FUTURE_VERSION: 'UNSUPPORTED_FUTURE_VERSION',
  UNSUPPORTED_LEGACY_VERSION: 'UNSUPPORTED_LEGACY_VERSION',
  UNSUPPORTED_VALUE: 'UNSUPPORTED_VALUE',
});

export const DRAFT_STATE_SOURCE_TYPES = Object.freeze({
  CANONICAL: 'canonical',
  FAILURE_BACKUP: 'failure_backup',
  LEGACY_BASE44_DRAFT: 'legacy_base44_draft',
  LEGACY_REDUX: 'legacy_redux',
  LOAD_INITIAL_STATE: 'load_initial_state',
  REDUX_PERSIST_V2: 'redux_persist_v2',
  REDUX_PERSIST_V3: 'redux_persist_v3',
  REDUX_PERSIST_V4: 'redux_persist_v4',
  UNKNOWN: 'unknown',
});

export const DRAFT_STATE_STATUS_VALUES = Object.freeze([
  'active',
  'submit_attempted',
  'submit_failed',
  'submitted',
  'cleared_superseded',
  'expired',
  'deleted',
]);

export const DRAFT_FIELD_OPERATIONS = Object.freeze([
  'set',
  'delete',
  'reset',
  'merge',
]);

const TOP_LEVEL_FIELDS = Object.freeze([
  'schemaVersion',
  'formType',
  'draftId',
  'sessionId',
  'draftStatus',
  'clientRevision',
  'serverRevision',
  'savedAtClient',
  'savedAtServer',
  'sourceTabId',
  'responses',
  'validationStatus',
  'touchedQuestions',
  'expandedQuestions',
  'textValidationMeta',
  'credentials',
  'identityContext',
  'uiDraftState',
  'fieldChangeMetadata',
  'currentQuestionId',
  'lastChangedQuestionId',
  'lastMutation',
  'submission',
  'compatibility',
]);

const TOP_LEVEL_FIELD_SET = new Set(TOP_LEVEL_FIELDS);
const SOURCE_TYPE_SET = new Set(Object.values(DRAFT_STATE_SOURCE_TYPES));
const STATUS_SET = new Set(DRAFT_STATE_STATUS_VALUES);
const OPERATION_SET = new Set(DRAFT_FIELD_OPERATIONS);
const CREDENTIAL_FIELDS = Object.freeze([
  'userId',
  'userEmail',
  'userName',
  'businessName',
  'domain',
  'domainName',
  'recoveryEmail',
]);
const CREDENTIAL_FIELD_SET = new Set(CREDENTIAL_FIELDS);
const SECRET_FIELD_PATTERN = /(?:recovery.?code|recovery.?code.?hash|recovery.?session|resume.?token|admin.?recovery.?grant|admin.?grant|identity.?key.?hash|email.?lookup.?hash|draft.?access.?token|base44.?access.?token|access.?token|auth.?token|authorization|aws.?access|aws.?secret|private.?key|client.?secret|password)/i;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_CODE_PATTERN = /^[A-Z0-9_.:-]{1,160}$/;
const OMIT_VALUE = Symbol('omit-draft-value');

const safePathSegment = (segment) => {
  const text = String(segment);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(text) ? text : '<redacted>';
};

const appendPath = (path, segment) => (
  typeof segment === 'number'
    ? `${path}[${segment}]`
    : `${path}.${safePathSegment(segment)}`
);

export class DraftStateValidationError extends Error {
  constructor(code, path = '$', issues = []) {
    super(`Canonical draft-state validation failed (${code}) at ${path}`);
    this.name = 'DraftStateValidationError';
    this.code = code;
    this.path = path;
    this.issues = Array.isArray(issues) ? issues : [];
  }
}

export class DraftStateSerializationError extends Error {
  constructor(code, path = '$') {
    super(`Canonical draft-state serialization failed (${code}) at ${path}`);
    this.name = 'DraftStateSerializationError';
    this.code = code;
    this.path = path;
  }
}

export const isPlainDraftObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isSecretBearingField = (field) => SECRET_FIELD_PATTERN.test(String(field || ''));

const serializationFailure = (code, path) => {
  throw new DraftStateSerializationError(code, path);
};

export const sanitizeDraftSerializableValue = (value, options = {}) => {
  const {
    maxDepth = 64,
    maxProperties = 50_000,
    normalizeDates = false,
    omitUndefined = false,
    rejectSecretKeys = true,
  } = options;
  const ancestors = new WeakSet();
  const counter = { properties: 0 };

  const countProperty = (path) => {
    counter.properties += 1;
    if (counter.properties > maxProperties) {
      serializationFailure(DRAFT_STATE_ERROR_CODES.MAX_PROPERTIES_EXCEEDED, path);
    }
  };

  const visit = (candidate, path, depth, inArray = false) => {
    if (depth > maxDepth) {
      serializationFailure(DRAFT_STATE_ERROR_CODES.MAX_DEPTH_EXCEEDED, path);
    }
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
      return candidate;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
      }
      return candidate;
    }
    if (candidate === undefined) {
      if (omitUndefined && !inArray) return OMIT_VALUE;
      serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
    }
    if (['bigint', 'symbol', 'function'].includes(typeof candidate)) {
      serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
    }
    if (typeof candidate !== 'object') {
      serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
    }
    if (candidate instanceof Date) {
      if (normalizeDates && !Number.isNaN(candidate.getTime())) return candidate.toISOString();
      serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
    }
    if (ancestors.has(candidate)) {
      serializationFailure(DRAFT_STATE_ERROR_CODES.CIRCULAR_REFERENCE, path);
    }

    const tag = Object.prototype.toString.call(candidate);
    if (tag !== '[object Object]' && tag !== '[object Array]') {
      serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
    }

    ancestors.add(candidate);
    try {
      const symbolKeys = Object.getOwnPropertySymbols(candidate);
      if (symbolKeys.length > 0) {
        serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
      }
      const descriptors = Object.getOwnPropertyDescriptors(candidate);

      if (Array.isArray(candidate)) {
        const extraKeys = Object.keys(candidate).filter((key) => !/^\d+$/.test(key));
        if (extraKeys.length > 0) {
          serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
        }
        const output = [];
        for (let index = 0; index < candidate.length; index += 1) {
          const itemPath = appendPath(path, index);
          countProperty(itemPath);
          const descriptor = descriptors[index];
          if (!descriptor || descriptor.get || descriptor.set) {
            serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, itemPath);
          }
          const sanitized = visit(descriptor.value, itemPath, depth + 1, true);
          if (sanitized === OMIT_VALUE) {
            serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, itemPath);
          }
          output.push(sanitized);
        }
        return output;
      }

      if (!isPlainDraftObject(candidate)) {
        serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, path);
      }
      const output = {};
      for (const key of Object.keys(candidate)) {
        const itemPath = appendPath(path, key);
        countProperty(itemPath);
        if (['__proto__', 'prototype', 'constructor'].includes(key)) {
          serializationFailure(DRAFT_STATE_ERROR_CODES.UNSAFE_PROPERTY_KEY, itemPath);
        }
        if (rejectSecretKeys && isSecretBearingField(key)) {
          serializationFailure(DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD, itemPath);
        }
        const descriptor = descriptors[key];
        if (!descriptor || descriptor.get || descriptor.set) {
          serializationFailure(DRAFT_STATE_ERROR_CODES.UNSUPPORTED_VALUE, itemPath);
        }
        const sanitized = visit(descriptor.value, itemPath, depth + 1, false);
        if (sanitized !== OMIT_VALUE) output[key] = sanitized;
      }
      return output;
    } finally {
      ancestors.delete(candidate);
    }
  };

  return visit(value, '$', 0);
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const normalizeNullableString = (value, path) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
    const normalized = String(value).trim();
    return normalized || null;
  }
  throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
};

const normalizeRequiredString = (value, path, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
  }
  return value.trim();
};

const normalizeRevision = (value, path) => {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
  }
  return value;
};

const normalizeTimestamp = (value, path) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
  }
  return parsed.toISOString();
};

const normalizeOpaqueId = (value, path) => {
  const normalized = normalizeNullableString(value, path);
  if (normalized !== null && !OPAQUE_ID_PATTERN.test(normalized)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
  }
  return normalized;
};

const normalizePlainMap = (value, path) => {
  if (value === undefined || value === null) return {};
  if (!isPlainDraftObject(value)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
  }
  return sanitizeDraftSerializableValue(value);
};

const normalizeValidationMap = (value) => {
  const map = normalizePlainMap(value, '$.validationStatus');
  for (const [key, status] of Object.entries(map)) {
    if (typeof status !== 'string') {
      throw new DraftStateValidationError(
        DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
        appendPath('$.validationStatus', key),
      );
    }
  }
  return map;
};

const normalizeBooleanMap = (value, path) => {
  const map = normalizePlainMap(value, path);
  for (const [key, flag] of Object.entries(map)) {
    if (typeof flag !== 'boolean') {
      throw new DraftStateValidationError(
        DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
        appendPath(path, key),
      );
    }
  }
  return map;
};

const normalizeCredentials = (value) => {
  if (value === undefined || value === null) return {};
  if (!isPlainDraftObject(value)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.credentials');
  }
  const output = {};
  for (const key of Object.keys(value)) {
    if (isSecretBearingField(key)) {
      throw new DraftStateValidationError(
        DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD,
        appendPath('$.credentials', key),
      );
    }
    if (!CREDENTIAL_FIELD_SET.has(key)) continue;
    if (value[key] === undefined || value[key] === null || value[key] === '') continue;
    if (typeof value[key] !== 'string') {
      throw new DraftStateValidationError(
        DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
        appendPath('$.credentials', key),
      );
    }
    if (key === 'recoveryEmail') {
      const normalized = normalizeRecoveryEmail(value[key], { allowEmpty: true });
      if (!normalized.valid) {
        throw new DraftStateValidationError(
          DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
          '$.credentials.recoveryEmail',
        );
      }
      if (normalized.normalizedEmail) output[key] = normalized.normalizedEmail;
    } else {
      output[key] = value[key].trim();
    }
  }
  return output;
};

export const DEFAULT_DRAFT_IDENTITY_CONTEXT = Object.freeze({
  identityContextVersion: PRO_DRAFT_IDENTITY_VERSION,
  recoveryEmailSource: 'migrated_legacy',
  recoveryEmailVerificationStatus: 'unverified',
  identityAssociationIntent: 'legacy_migration',
  anonymousRecoveryAcknowledged: false,
  signedInvitationEmailChanged: false,
});

const IDENTITY_CONTEXT_FIELDS = Object.freeze(Object.keys(DEFAULT_DRAFT_IDENTITY_CONTEXT));
const IDENTITY_CONTEXT_FIELD_SET = new Set(IDENTITY_CONTEXT_FIELDS);
const IDENTITY_SOURCE_SET = new Set(DRAFT_IDENTITY_SOURCE_VALUES);
const IDENTITY_INTENT_SET = new Set(DRAFT_IDENTITY_ASSOCIATION_INTENTS);
const EMAIL_VERIFICATION_SET = new Set(EMAIL_VERIFICATION_STATUS_VALUES);

export const normalizeCanonicalDraftIdentityContext = (
  value,
  credentials = {},
) => {
  if (value === undefined || value === null) return { ...DEFAULT_DRAFT_IDENTITY_CONTEXT };
  if (!isPlainDraftObject(value)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.identityContext');
  }
  for (const key of Object.keys(value)) {
    if (isSecretBearingField(key)) {
      throw new DraftStateValidationError(
        DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD,
        appendPath('$.identityContext', key),
      );
    }
    if (!IDENTITY_CONTEXT_FIELD_SET.has(key)) {
      throw new DraftStateValidationError(
        DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD,
        appendPath('$.identityContext', key),
      );
    }
  }
  const output = { ...DEFAULT_DRAFT_IDENTITY_CONTEXT, ...value };
  if (output.identityContextVersion !== PRO_DRAFT_IDENTITY_VERSION) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.identityContext.identityContextVersion',
    );
  }
  if (!IDENTITY_SOURCE_SET.has(output.recoveryEmailSource)) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.identityContext.recoveryEmailSource',
    );
  }
  if (!EMAIL_VERIFICATION_SET.has(output.recoveryEmailVerificationStatus)) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.identityContext.recoveryEmailVerificationStatus',
    );
  }
  if (!IDENTITY_INTENT_SET.has(output.identityAssociationIntent)) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.identityContext.identityAssociationIntent',
    );
  }
  if (
    typeof output.anonymousRecoveryAcknowledged !== 'boolean'
    || typeof output.signedInvitationEmailChanged !== 'boolean'
  ) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.identityContext');
  }
  const hasEmail = Boolean(credentials.recoveryEmail);
  if (output.recoveryEmailSource === 'anonymous' && hasEmail) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.identityContext.recoveryEmailSource',
    );
  }
  if (
    output.identityAssociationIntent === 'anonymous_start'
    && !hasEmail
    && !output.anonymousRecoveryAcknowledged
  ) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.identityContext.anonymousRecoveryAcknowledged',
    );
  }
  if (
    output.signedInvitationEmailChanged
    !== (output.identityAssociationIntent === 'changed_signed_email')
  ) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.identityContext.signedInvitationEmailChanged',
    );
  }
  if (output.signedInvitationEmailChanged && (
    output.recoveryEmailSource !== 'client_entered'
    || output.recoveryEmailVerificationStatus !== 'unverified'
  )) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.identityContext');
  }
  if (
    output.recoveryEmailVerificationStatus === 'verified_signed_invitation'
    && output.recoveryEmailSource !== 'signed_invitation'
  ) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.identityContext');
  }
  if (
    ['client_entered', 'recovered_by_email', 'anonymous'].includes(output.recoveryEmailSource)
    && output.recoveryEmailVerificationStatus !== 'unverified'
  ) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.identityContext');
  }
  return output;
};

const normalizeUiDraftState = (value) => {
  const map = normalizePlainMap(value, '$.uiDraftState');
  const output = {};
  for (const [scope, entry] of Object.entries(map)) {
    const path = appendPath('$.uiDraftState', scope);
    if (!isPlainDraftObject(entry)) {
      throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
    }
    if (typeof entry.kind !== 'string' || !entry.kind.trim()) {
      throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, `${path}.kind`);
    }
    if (!Number.isSafeInteger(entry.version) || entry.version < 1) {
      throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, `${path}.version`);
    }
    output[scope] = {
      kind: entry.kind.trim(),
      version: entry.version,
      data: sanitizeDraftSerializableValue(entry.data, { omitUndefined: false }),
      updatedAtClient: normalizeTimestamp(entry.updatedAtClient, `${path}.updatedAtClient`),
      sourceTabId: normalizeOpaqueId(entry.sourceTabId, `${path}.sourceTabId`),
    };
  }
  return output;
};

export const normalizeFieldChangeMetadata = (value) => {
  const map = normalizePlainMap(value, '$.fieldChangeMetadata');
  const output = {};
  for (const [fieldPath, entry] of Object.entries(map)) {
    const path = appendPath('$.fieldChangeMetadata', fieldPath);
    if (!isPlainDraftObject(entry) || !OPERATION_SET.has(entry.operation)) {
      throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, path);
    }
    output[fieldPath] = {
      operation: entry.operation,
      clientRevision: normalizeRevision(entry.clientRevision, `${path}.clientRevision`),
      serverRevision: normalizeRevision(entry.serverRevision, `${path}.serverRevision`),
      changedAtClient: normalizeTimestamp(entry.changedAtClient, `${path}.changedAtClient`),
      sourceTabId: normalizeOpaqueId(entry.sourceTabId, `${path}.sourceTabId`),
      mutationId: normalizeOpaqueId(entry.mutationId, `${path}.mutationId`),
    };
  }
  return output;
};

const normalizeLastMutation = (value) => {
  if (value === undefined || value === null) return null;
  if (!isPlainDraftObject(value)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.lastMutation');
  }
  return {
    mutationId: normalizeOpaqueId(value.mutationId, '$.lastMutation.mutationId'),
    mutationType: normalizeRequiredString(value.mutationType, '$.lastMutation.mutationType', 'unknown'),
    reason: value.reason === undefined || value.reason === null
      ? null
      : normalizeRequiredString(value.reason, '$.lastMutation.reason', null),
    changedAtClient: normalizeTimestamp(value.changedAtClient, '$.lastMutation.changedAtClient'),
    sourceTabId: normalizeOpaqueId(value.sourceTabId, '$.lastMutation.sourceTabId'),
  };
};

const normalizeSubmission = (value) => {
  if (value === undefined || value === null) value = {};
  if (!isPlainDraftObject(value)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.submission');
  }
  const errorCode = value.lastSubmissionErrorCode;
  if (
    errorCode !== undefined
    && errorCode !== null
    && errorCode !== ''
    && (typeof errorCode !== 'string' || !SAFE_CODE_PATTERN.test(errorCode))
  ) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.submission.lastSubmissionErrorCode',
    );
  }
  return {
    finalSubmissionId: normalizeNullableString(
      value.finalSubmissionId,
      '$.submission.finalSubmissionId',
    ),
    submittedAt: normalizeTimestamp(value.submittedAt, '$.submission.submittedAt'),
    submittedStateHash: normalizeNullableString(
      value.submittedStateHash,
      '$.submission.submittedStateHash',
    ),
    pdfSourceStateHash: normalizeNullableString(
      value.pdfSourceStateHash,
      '$.submission.pdfSourceStateHash',
    ),
    lastSubmissionErrorCode: errorCode ? String(errorCode) : null,
  };
};

const normalizeCompatibility = (value) => {
  if (value === undefined || value === null) value = {};
  if (!isPlainDraftObject(value)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.compatibility');
  }
  const sourceType = value.sourceType || DRAFT_STATE_SOURCE_TYPES.CANONICAL;
  if (!SOURCE_TYPE_SET.has(sourceType)) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.compatibility.sourceType',
    );
  }
  const sourceVersion = value.sourceVersion === undefined
    ? PRO_FORM_DRAFT_SCHEMA_VERSION
    : value.sourceVersion;
  if (
    sourceVersion !== null
    && (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0)
  ) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.compatibility.sourceVersion',
    );
  }
  const warnings = value.migrationWarnings === undefined ? [] : value.migrationWarnings;
  if (!Array.isArray(warnings) || warnings.some((warning) => (
    typeof warning !== 'string' || !SAFE_CODE_PATTERN.test(warning)
  ))) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      '$.compatibility.migrationWarnings',
    );
  }
  return {
    sourceType,
    sourceVersion,
    migratedAtClient: normalizeTimestamp(
      value.migratedAtClient,
      '$.compatibility.migratedAtClient',
    ),
    migrationWarnings: [...new Set(warnings)].slice(0, 100),
  };
};

const buildEmptyCanonicalState = () => ({
  schemaVersion: PRO_FORM_DRAFT_SCHEMA_VERSION,
  formType: 'pro-questionnaire',
  draftId: null,
  sessionId: null,
  draftStatus: 'active',
  clientRevision: 0,
  serverRevision: 0,
  savedAtClient: null,
  savedAtServer: null,
  sourceTabId: null,
  responses: {},
  validationStatus: {},
  touchedQuestions: {},
  expandedQuestions: {},
  textValidationMeta: {},
  credentials: {},
  identityContext: { ...DEFAULT_DRAFT_IDENTITY_CONTEXT },
  uiDraftState: {},
  fieldChangeMetadata: {},
  currentQuestionId: null,
  lastChangedQuestionId: null,
  lastMutation: null,
  submission: {
    finalSubmissionId: null,
    submittedAt: null,
    submittedStateHash: null,
    pdfSourceStateHash: null,
    lastSubmissionErrorCode: null,
  },
  compatibility: {
    sourceType: DRAFT_STATE_SOURCE_TYPES.CANONICAL,
    sourceVersion: PRO_FORM_DRAFT_SCHEMA_VERSION,
    migratedAtClient: null,
    migrationWarnings: [],
  },
});

export const createEmptyCanonicalDraftState = (options = {}) => {
  if (!isPlainDraftObject(options)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_INPUT, '$.options');
  }
  for (const key of Object.keys(options)) {
    if (isSecretBearingField(key)) {
      throw new DraftStateValidationError(
        DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD,
        appendPath('$.options', key),
      );
    }
  }
  const state = buildEmptyCanonicalState();
  state.formType = normalizeRequiredString(
    options.formType,
    '$.formType',
    state.formType,
  );
  state.draftId = normalizeNullableString(options.draftId, '$.draftId');
  state.sessionId = normalizeNullableString(options.sessionId, '$.sessionId');
  state.sourceTabId = normalizeOpaqueId(options.sourceTabId, '$.sourceTabId');
  state.credentials = normalizeCredentials(options.credentials);
  state.identityContext = normalizeCanonicalDraftIdentityContext(
    options.identityContext,
    state.credentials,
  );
  return options.freeze === true ? deepFreeze(state) : state;
};

const normalizeCurrentCanonicalDraftState = (input, options = {}) => {
  if (!isPlainDraftObject(input)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_INPUT, '$');
  }
  for (const key of Object.keys(input)) {
    if (isSecretBearingField(key)) {
      throw new DraftStateValidationError(
        DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD,
        appendPath('$', key),
      );
    }
  }
  const unknownFields = Object.keys(input).filter((key) => !TOP_LEVEL_FIELD_SET.has(key));
  const compatibilityInput = isPlainDraftObject(input.compatibility)
    ? { ...input.compatibility }
    : (input.compatibility === undefined ? {} : input.compatibility);
  if (options.reportUnknownFields && unknownFields.length > 0) {
    const existingWarnings = isPlainDraftObject(compatibilityInput)
      && Array.isArray(compatibilityInput.migrationWarnings)
      ? compatibilityInput.migrationWarnings
      : [];
    const safeWarnings = unknownFields.map((key) => (
      `UNKNOWN_TOP_LEVEL_FIELD:${safePathSegment(key).toUpperCase()}`
    )).filter((warning) => SAFE_CODE_PATTERN.test(warning));
    compatibilityInput.migrationWarnings = [...existingWarnings, ...safeWarnings];
  }
  if (options.strictServer === true && unknownFields.length > 0) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD,
      appendPath('$', unknownFields[0]),
    );
  }

  const schemaVersion = input.schemaVersion === undefined
    ? PRO_FORM_DRAFT_SCHEMA_VERSION
    : input.schemaVersion;
  if (!Number.isSafeInteger(schemaVersion)) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_SCHEMA_VERSION,
      '$.schemaVersion',
    );
  }
  if (schemaVersion > PRO_FORM_DRAFT_SCHEMA_VERSION) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.UNSUPPORTED_FUTURE_VERSION,
      '$.schemaVersion',
    );
  }
  if (schemaVersion < PRO_FORM_DRAFT_SCHEMA_MIN_SUPPORTED_VERSION) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.UNSUPPORTED_LEGACY_VERSION,
      '$.schemaVersion',
    );
  }
  if (schemaVersion !== PRO_FORM_DRAFT_SCHEMA_VERSION) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_SCHEMA_VERSION,
      '$.schemaVersion',
    );
  }
  const status = input.draftStatus === undefined ? 'active' : input.draftStatus;
  if (!STATUS_SET.has(status)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.draftStatus');
  }
  const formType = normalizeRequiredString(input.formType, '$.formType', 'pro-questionnaire');
  if (options.strictServer === true && formType !== 'pro-questionnaire') {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.formType');
  }
  const credentials = normalizeCredentials(input.credentials);
  const state = {
    schemaVersion,
    formType,
    draftId: normalizeNullableString(input.draftId, '$.draftId'),
    sessionId: normalizeNullableString(input.sessionId, '$.sessionId'),
    draftStatus: status,
    clientRevision: normalizeRevision(input.clientRevision, '$.clientRevision'),
    serverRevision: normalizeRevision(input.serverRevision, '$.serverRevision'),
    savedAtClient: normalizeTimestamp(input.savedAtClient, '$.savedAtClient'),
    savedAtServer: normalizeTimestamp(input.savedAtServer, '$.savedAtServer'),
    sourceTabId: normalizeOpaqueId(input.sourceTabId, '$.sourceTabId'),
    responses: normalizePlainMap(input.responses, '$.responses'),
    validationStatus: normalizeValidationMap(input.validationStatus),
    touchedQuestions: normalizeBooleanMap(input.touchedQuestions, '$.touchedQuestions'),
    expandedQuestions: normalizeBooleanMap(input.expandedQuestions, '$.expandedQuestions'),
    textValidationMeta: normalizePlainMap(input.textValidationMeta, '$.textValidationMeta'),
    credentials,
    identityContext: normalizeCanonicalDraftIdentityContext(input.identityContext, credentials),
    uiDraftState: normalizeUiDraftState(input.uiDraftState),
    fieldChangeMetadata: normalizeFieldChangeMetadata(input.fieldChangeMetadata),
    currentQuestionId: normalizeNullableString(input.currentQuestionId, '$.currentQuestionId'),
    lastChangedQuestionId: normalizeNullableString(
      input.lastChangedQuestionId,
      '$.lastChangedQuestionId',
    ),
    lastMutation: normalizeLastMutation(input.lastMutation),
    submission: normalizeSubmission(input.submission),
    compatibility: normalizeCompatibility(compatibilityInput),
  };
  return options.freeze === true ? deepFreeze(state) : state;
};

export function normalizeCanonicalDraftState(input, options = {}) {
  if (
    isPlainDraftObject(input)
    && Number.isSafeInteger(input.schemaVersion)
    && input.schemaVersion !== PRO_FORM_DRAFT_SCHEMA_VERSION
    && options.skipMigration !== true
  ) {
    return migrateCanonicalDraftState(input, options);
  }
  return normalizeCurrentCanonicalDraftState(input, options);
}

const issue = (code, path) => ({ code, path });

export const validateCanonicalDraftState = (input, options = {}) => {
  const issues = [];
  if (!isPlainDraftObject(input)) {
    issues.push(issue(DRAFT_STATE_ERROR_CODES.INVALID_INPUT, '$'));
  } else {
    for (const field of TOP_LEVEL_FIELDS) {
      if (!Object.hasOwn(input, field)) {
        issues.push(issue(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, appendPath('$', field)));
      }
    }
    if (options.allowUnknownFields !== true) {
      for (const field of Object.keys(input)) {
        if (!TOP_LEVEL_FIELD_SET.has(field)) {
          issues.push(issue(DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD, appendPath('$', field)));
        }
      }
    }
  }
  try {
    if (issues.length === 0) normalizeCanonicalDraftState(input);
  } catch (error) {
    issues.push(issue(
      error?.code || DRAFT_STATE_ERROR_CODES.INVALID_FIELD,
      error?.path || '$',
    ));
  }
  const errorCode = issues[0]?.code || null;
  return {
    valid: issues.length === 0,
    issues,
    errorCode,
    safeDiagnostics: getSafeCanonicalDraftDiagnostics({ state: input, errorCode }),
  };
};

const addWarning = (warnings, code) => {
  if (SAFE_CODE_PATTERN.test(code) && !warnings.includes(code)) warnings.push(code);
};

const parseLegacyJsonField = (value, fieldCode, warnings) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    try {
      return sanitizeDraftSerializableValue(value);
    } catch {
      addWarning(warnings, `INVALID_${fieldCode}`);
      return null;
    }
  }
  try {
    return sanitizeDraftSerializableValue(JSON.parse(value));
  } catch {
    addWarning(warnings, `MALFORMED_${fieldCode}`);
    return null;
  }
};

const legacyMap = (value, fieldCode, warnings) => {
  const parsed = parseLegacyJsonField(value, fieldCode, warnings);
  if (parsed === null) return {};
  if (!isPlainDraftObject(parsed)) {
    addWarning(warnings, `INVALID_${fieldCode}`);
    return {};
  }
  return parsed;
};

const legacyBooleanMap = (value, fieldCode, warnings) => {
  const parsed = legacyMap(value, fieldCode, warnings);
  const output = {};
  for (const [key, flag] of Object.entries(parsed)) {
    if (flag === true || flag === false) output[key] = flag;
    else addWarning(warnings, `INVALID_${fieldCode}_BOOLEAN`);
  }
  return output;
};

const legacyValidationMap = (value, warnings) => {
  const parsed = legacyMap(value, 'VALIDATION_STATUS_JSON', warnings);
  const output = {};
  for (const [key, status] of Object.entries(parsed)) {
    if (typeof status === 'string') output[key] = status;
    else addWarning(warnings, 'INVALID_VALIDATION_STATUS_VALUE');
  }
  return output;
};

const legacyStatus = (value, warnings) => {
  if (STATUS_SET.has(value)) return value;
  if (value === 'draft' || value === undefined || value === null || value === '') {
    if (value === 'draft') addWarning(warnings, 'LEGACY_DRAFT_STATUS_MAPPED_TO_ACTIVE');
    return 'active';
  }
  addWarning(warnings, 'INVALID_LEGACY_DRAFT_STATUS');
  return 'active';
};

const legacySourceType = (version, fallback) => {
  if (version === 2) return DRAFT_STATE_SOURCE_TYPES.REDUX_PERSIST_V2;
  if (version === 3) return DRAFT_STATE_SOURCE_TYPES.REDUX_PERSIST_V3;
  return fallback;
};

const withNormalizedLegacyRecoveryEmail = (credentials, recoveryEmail, warnings) => {
  const output = { ...(isPlainDraftObject(credentials) ? credentials : {}) };
  const candidate = recoveryEmail ?? output.recoveryEmail;
  if (candidate === undefined || candidate === null || candidate === '') {
    delete output.recoveryEmail;
    return output;
  }
  const normalized = normalizeRecoveryEmail(candidate, { allowEmpty: true });
  if (!normalized.valid) {
    delete output.recoveryEmail;
    addWarning(warnings, 'MALFORMED_LEGACY_RECOVERY_EMAIL');
    return output;
  }
  if (normalized.normalizedEmail) output.recoveryEmail = normalized.normalizedEmail;
  return output;
};

export const extractCanonicalStateFromLegacyRedux = (input, options = {}) => {
  const warnings = [];
  let root = input;
  if (typeof root === 'string') root = parseLegacyJsonField(root, 'REDUX_ROOT', warnings);
  if (!isPlainDraftObject(root)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_INPUT, '$');
  }
  const nested = isPlainDraftObject(root.form)
    ? root.form
    : (isPlainDraftObject(root.state?.form) ? root.state.form : root);
  const persistVersion = options.sourceVersion
    ?? nested?._persist?.version
    ?? root?._persist?.version
    ?? null;
  const sourceType = options.sourceType
    || legacySourceType(persistVersion, DRAFT_STATE_SOURCE_TYPES.LEGACY_REDUX);
  const responses = legacyMap(nested.responses, 'RESPONSES_JSON', warnings);
  const legacyCredentials = withNormalizedLegacyRecoveryEmail(
    legacyMap(nested.credentials, 'CREDENTIALS_JSON', warnings),
    nested.recoveryEmail ?? root.recovery_email,
    warnings,
  );
  const state = createEmptyCanonicalDraftState({
    formType: options.formType || 'pro-questionnaire',
    draftId: options.draftId ?? root.draftId,
    sessionId: options.sessionId ?? root.sessionId ?? root.questionnaireSessionId,
    sourceTabId: options.sourceTabId ?? root.sourceTabId,
    credentials: legacyCredentials,
  });
  Object.assign(state, {
    draftStatus: legacyStatus(options.draftStatus ?? root.draftStatus ?? root.status, warnings),
    savedAtClient: normalizeTimestamp(
      options.savedAtClient ?? root.savedAtClient ?? root.savedAt,
      '$.savedAtClient',
    ),
    responses,
    validationStatus: legacyValidationMap(nested.validationStatus, warnings),
    touchedQuestions: legacyBooleanMap(
      nested.touchedQuestions,
      'TOUCHED_QUESTIONS_JSON',
      warnings,
    ),
    expandedQuestions: legacyBooleanMap(
      nested.expandedQuestions,
      'EXPANDED_QUESTIONS_JSON',
      warnings,
    ),
    textValidationMeta: legacyMap(
      nested.textValidationMeta,
      'TEXT_VALIDATION_META_JSON',
      warnings,
    ),
    currentQuestionId: normalizeNullableString(
      root.currentQuestionId,
      '$.currentQuestionId',
    ),
    lastChangedQuestionId: normalizeNullableString(
      root.lastChangedQuestionId,
      '$.lastChangedQuestionId',
    ),
    compatibility: {
      sourceType,
      sourceVersion: Number.isSafeInteger(persistVersion) ? persistVersion : null,
      migratedAtClient: options.migratedAtClient || null,
      migrationWarnings: warnings,
    },
  });
  return normalizeCurrentCanonicalDraftState(state);
};

const hasOwn = (object, key) => Object.hasOwn(object || {}, key);

const legacyPayloadResponses = (userdata) => {
  if (!isPlainDraftObject(userdata)) return {};
  const responses = {};
  const copy = (payloadKey, responseKey) => {
    if (hasOwn(userdata, payloadKey)) responses[responseKey] = userdata[payloadKey];
  };
  const additional = userdata.additional_pages_list;
  if (isPlainDraftObject(additional?.why_choose_us_page)) {
    responses['1'] = additional.why_choose_us_page.generate_page ? 'yes' : 'no';
    if (hasOwn(additional.why_choose_us_page, 'why_choose_us_description')) {
      responses['1.1'] = additional.why_choose_us_page.why_choose_us_description;
    }
  }
  if (isPlainDraftObject(additional?.meet_the_team_page)) {
    responses['2'] = additional.meet_the_team_page.generate_page ? 'yes' : 'no';
    if (hasOwn(additional.meet_the_team_page, 'team_introduction')) {
      responses['2.1'] = additional.meet_the_team_page.team_introduction;
    }
    if (hasOwn(additional.meet_the_team_page, 'team_photo_with_tags')) {
      responses['2.2'] = additional.meet_the_team_page.team_photo_with_tags;
    }
  }
  [
    ['service_offerings', '3'],
    ['service_offerings_other', '3_other'],
    ['target_industries', '4'],
    ['target_industries_other', '4_other'],
    ['company_description', '6'],
    ['delivery_model', '7'],
    ['delivery_model_other', '7_other'],
    ['pricing_packaging', '8'],
    ['pricing_packaging_other', '8_other'],
    ['differentiation', '9'],
    ['company_goals', '10'],
    ['company_goals_other', '10_other'],
    ['brand_tone', '11'],
    ['brand_tone_other', '11_other'],
    ['sales_process', '13'],
    ['client_acquisition', '15'],
    ['client_acquisition_other', '15_other'],
    ['website_objectives', '16'],
    ['website_objectives_other', '16_other'],
    ['client_size', '17'],
    ['client_challenges', '18'],
    ['client_challenges_other', '18_other'],
    ['client_frustrations', '19'],
    ['client_outcomes', '20'],
    ['client_outcomes_other', '20_other'],
    ['value_description', '21'],
    ['ideal_client', '22'],
    ['primary_cta', '24'],
    ['primary_cta_other', '24_other'],
  ].forEach(([payloadKey, responseKey]) => copy(payloadKey, responseKey));

  if (Array.isArray(userdata.geographic_areas)) {
    let primaryIndex = 0;
    responses['5'] = userdata.geographic_areas.map((item, index) => {
      const meta = isPlainDraftObject(item?.geographic_area_meta)
        ? item.geographic_area_meta
        : {};
      if (meta.primary === true) primaryIndex = index;
      return {
        name: meta.name || '',
        label: meta.label || '',
        latitude: meta.lat ?? '',
        longitude: meta.lon ?? '',
        place_id: meta.place_id || '',
        source: meta.source || '',
      };
    });
    responses['5_primary'] = primaryIndex;
  }
  if (hasOwn(userdata, 'certifications_partnerships')) {
    const items = Array.isArray(userdata.certifications_partnerships)
      ? userdata.certifications_partnerships
      : [];
    responses['12'] = items.length > 0 ? 'yes' : 'no';
    responses['12.1'] = items;
  }
  if (hasOwn(userdata, 'service_guarantee')) {
    responses['14'] = userdata.service_guarantee === true ? 'yes' : 'no';
  }
  copy('service_guarantee_items', '14.1');
  if (hasOwn(userdata, 'avoided_clients')) {
    responses['23'] = userdata.avoided_clients ? 'yes' : 'no';
    responses['23.1'] = userdata.avoided_clients;
  }
  if (hasOwn(userdata, 'additional_notes')) {
    responses['25'] = userdata.additional_notes ? 'yes' : 'no';
    responses['25.1'] = userdata.additional_notes;
  }
  return responses;
};

export const extractCanonicalStateFromLegacyDraftRecord = (record, options = {}) => {
  if (!isPlainDraftObject(record)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_INPUT, '$');
  }
  const warnings = [];
  const responsesFromColumn = legacyMap(record.responses_json, 'RESPONSES_JSON', warnings);
  const metadata = legacyMap(record.metadata_json, 'METADATA_JSON', warnings);
  const userdata = legacyMap(record.userdata_json, 'USERDATA_JSON', warnings);
  const mappedPayload = legacyMap(record.mapped_payload_json, 'MAPPED_PAYLOAD_JSON', warnings);
  legacyMap(record.draft_metadata_json, 'DRAFT_METADATA_JSON', warnings);
  const effectiveMetadata = Object.keys(metadata).length > 0
    ? metadata
    : (isPlainDraftObject(mappedPayload.metadata) ? mappedPayload.metadata : {});
  const effectiveUserdata = Object.keys(userdata).length > 0
    ? userdata
    : (isPlainDraftObject(mappedPayload.userdata) ? mappedPayload.userdata : {});
  const responses = Object.keys(responsesFromColumn).length > 0
    ? responsesFromColumn
    : legacyPayloadResponses(effectiveUserdata);
  if (Object.keys(responsesFromColumn).length === 0 && Object.keys(responses).length > 0) {
    addWarning(warnings, 'RESPONSES_RECONSTRUCTED_FROM_MAPPED_PAYLOAD');
  }

  const legacyCredentials = withNormalizedLegacyRecoveryEmail({
    businessName: record.business_name || effectiveMetadata.business_name || '',
    domain: record.domain || effectiveMetadata.businessDomain || '',
    userId: record.user_id || '',
    userName: record.user_name || '',
    userEmail: record.user_email || '',
  }, record.recovery_email || effectiveMetadata.recovery_email, warnings);
  const state = createEmptyCanonicalDraftState({
    formType: 'pro-questionnaire',
    draftId: record.id,
    sessionId: record.session_id,
    credentials: legacyCredentials,
  });
  Object.assign(state, {
    draftStatus: legacyStatus(record.status, warnings),
    savedAtClient: normalizeTimestamp(record.last_saved_at, '$.savedAtClient'),
    responses,
    validationStatus: legacyValidationMap(record.validation_status_json, warnings),
    touchedQuestions: legacyBooleanMap(
      record.touched_questions_json,
      'TOUCHED_QUESTIONS_JSON',
      warnings,
    ),
    expandedQuestions: legacyBooleanMap(
      record.expanded_questions_json,
      'EXPANDED_QUESTIONS_JSON',
      warnings,
    ),
    currentQuestionId: normalizeNullableString(
      record.current_question_id,
      '$.currentQuestionId',
    ),
    lastChangedQuestionId: normalizeNullableString(
      record.last_changed_question_id,
      '$.lastChangedQuestionId',
    ),
    submission: {
      finalSubmissionId: record.final_submission_id || null,
      submittedAt: record.submitted_at || null,
      submittedStateHash: null,
      pdfSourceStateHash: null,
      lastSubmissionErrorCode: record.submit_error ? 'LEGACY_SUBMISSION_ERROR' : null,
    },
    compatibility: {
      sourceType: DRAFT_STATE_SOURCE_TYPES.LEGACY_BASE44_DRAFT,
      sourceVersion: options.sourceVersion ?? 0,
      migratedAtClient: options.migratedAtClient || null,
      migrationWarnings: warnings,
    },
  });
  return normalizeCurrentCanonicalDraftState(state);
};

export function migrateCanonicalDraftState(input, options = {}) {
  if (!isPlainDraftObject(input)) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_INPUT, '$');
  }
  if (!Object.hasOwn(input, 'schemaVersion')) {
    const isLegacyDraftRecord = Object.keys(input).some((key) => key.endsWith('_json'));
    return isLegacyDraftRecord
      ? extractCanonicalStateFromLegacyDraftRecord(input, options)
      : extractCanonicalStateFromLegacyRedux(input, options);
  }
  const version = input.schemaVersion;
  if (!Number.isSafeInteger(version)) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.INVALID_SCHEMA_VERSION,
      '$.schemaVersion',
    );
  }
  if (version > PRO_FORM_DRAFT_SCHEMA_VERSION) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.UNSUPPORTED_FUTURE_VERSION,
      '$.schemaVersion',
    );
  }
  if (version < PRO_FORM_DRAFT_SCHEMA_MIN_SUPPORTED_VERSION) {
    throw new DraftStateValidationError(
      DRAFT_STATE_ERROR_CODES.UNSUPPORTED_LEGACY_VERSION,
      '$.schemaVersion',
    );
  }
  if (version === PRO_FORM_DRAFT_SCHEMA_VERSION) {
    return normalizeCurrentCanonicalDraftState(input, options);
  }

  const warnings = [];
  let working = sanitizeDraftSerializableValue(input, { omitUndefined: true });
  if (version === 2) {
    if (working.textValidationMeta === undefined) working.textValidationMeta = {};
    working.schemaVersion = 3;
    addWarning(warnings, 'MIGRATED_SCHEMA_V2_TO_V3');
  }
  if (working.schemaVersion === 3) {
    const legacy = extractCanonicalStateFromLegacyRedux(working, {
      ...options,
      sourceVersion: version,
      sourceType: legacySourceType(version, DRAFT_STATE_SOURCE_TYPES.LEGACY_REDUX),
    });
    const state = {
      ...legacy,
      draftId: input.draftId ?? legacy.draftId,
      sessionId: input.sessionId ?? legacy.sessionId,
      draftStatus: legacyStatus(input.draftStatus ?? input.status, warnings),
      clientRevision: input.clientRevision ?? 0,
      serverRevision: input.serverRevision ?? 0,
      savedAtClient: input.savedAtClient ?? legacy.savedAtClient,
      savedAtServer: input.savedAtServer ?? null,
      sourceTabId: input.sourceTabId ?? null,
      uiDraftState: input.uiDraftState ?? {},
      fieldChangeMetadata: input.fieldChangeMetadata ?? {},
      currentQuestionId: input.currentQuestionId ?? legacy.currentQuestionId,
      lastChangedQuestionId: input.lastChangedQuestionId ?? legacy.lastChangedQuestionId,
      lastMutation: input.lastMutation ?? null,
      submission: input.submission ?? legacy.submission,
      compatibility: {
        sourceType: legacySourceType(version, DRAFT_STATE_SOURCE_TYPES.LEGACY_REDUX),
        sourceVersion: version,
        migratedAtClient: options.migratedAtClient || null,
        migrationWarnings: [
          ...legacy.compatibility.migrationWarnings,
          ...warnings,
          'MIGRATED_SCHEMA_V3_TO_V4',
        ],
      },
      schemaVersion: PRO_FORM_DRAFT_SCHEMA_VERSION,
    };
    return normalizeCurrentCanonicalDraftState(state, options);
  }
  throw new DraftStateValidationError(
    DRAFT_STATE_ERROR_CODES.INVALID_SCHEMA_VERSION,
    '$.schemaVersion',
  );
}

const sortKeysRecursively = (value) => {
  if (Array.isArray(value)) return value.map(sortKeysRecursively);
  if (!isPlainDraftObject(value)) return value;
  return Object.keys(value).sort().reduce((output, key) => {
    output[key] = sortKeysRecursively(value[key]);
    return output;
  }, {});
};

const createHashProjection = (state) => {
  const projection = sanitizeDraftSerializableValue(state);
  projection.savedAtClient = null;
  projection.savedAtServer = null;
  projection.compatibility = {
    sourceType: DRAFT_STATE_SOURCE_TYPES.CANONICAL,
    sourceVersion: PRO_FORM_DRAFT_SCHEMA_VERSION,
    migratedAtClient: null,
    migrationWarnings: [],
  };
  projection.submission.submittedStateHash = null;
  projection.submission.pdfSourceStateHash = null;
  return projection;
};

export const stableStringifyCanonicalDraftState = (state, options = {}) => {
  const normalized = normalizeCanonicalDraftState(state);
  const projected = options.hashProjection === true
    ? createHashProjection(normalized)
    : normalized;
  return JSON.stringify(sortKeysRecursively(projected), null, options.pretty === true ? 2 : 0);
};

export const serializeCanonicalDraftState = (state, options = {}) => {
  try {
    return stableStringifyCanonicalDraftState(state, options);
  } catch (error) {
    if (error instanceof DraftStateSerializationError) throw error;
    if (error instanceof DraftStateValidationError) throw error;
    throw new DraftStateSerializationError(DRAFT_STATE_ERROR_CODES.SERIALIZATION_FAILED, '$');
  }
};

export const parseCanonicalDraftState = (serialized, options = {}) => {
  let parsed;
  try {
    if (typeof serialized !== 'string') {
      throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_INPUT, '$');
    }
    parsed = JSON.parse(serialized);
  } catch (error) {
    const errorCode = error?.code || DRAFT_STATE_ERROR_CODES.INVALID_JSON;
    return {
      ok: false,
      state: null,
      lastKnownGoodState: options.lastKnownGoodState
        ? cloneCanonicalDraftState(options.lastKnownGoodState)
        : null,
      errorCode,
      issues: [issue(errorCode, '$')],
      safeDiagnostics: getSafeCanonicalDraftDiagnostics({ errorCode }),
    };
  }
  try {
    const state = migrateCanonicalDraftState(parsed, options);
    return {
      ok: true,
      state,
      lastKnownGoodState: null,
      errorCode: null,
      issues: [],
      safeDiagnostics: getSafeCanonicalDraftDiagnostics({ state }),
    };
  } catch (error) {
    const errorCode = error?.code || DRAFT_STATE_ERROR_CODES.INVALID_FIELD;
    return {
      ok: false,
      state: null,
      lastKnownGoodState: options.lastKnownGoodState
        ? cloneCanonicalDraftState(options.lastKnownGoodState)
        : null,
      errorCode,
      issues: [issue(errorCode, error?.path || '$')],
      safeDiagnostics: getSafeCanonicalDraftDiagnostics({ errorCode }),
    };
  }
};

const resolveWebCrypto = async (injectedCrypto, injectionRequired = false) => {
  if (injectedCrypto?.subtle) return injectedCrypto;
  if (injectionRequired) {
    throw new DraftStateSerializationError(DRAFT_STATE_ERROR_CODES.CRYPTO_UNAVAILABLE, '$');
  }
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  if (globalThis.process?.versions?.node) {
    try {
      // Keep the Node-only fallback out of browser/check-JS module resolution.
      const nodeCryptoSpecifier = 'node:crypto';
      const nodeCrypto = await import(/* @vite-ignore */ nodeCryptoSpecifier);
      if (nodeCrypto.webcrypto?.subtle) return nodeCrypto.webcrypto;
    } catch {
      // Return the typed error below without exposing runtime details.
    }
  }
  throw new DraftStateSerializationError(DRAFT_STATE_ERROR_CODES.CRYPTO_UNAVAILABLE, '$');
};

const bytesToHex = (buffer) => Array.from(new Uint8Array(buffer))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

export const hashCanonicalDraftState = async (state, options = {}) => {
  const cryptoProvider = await resolveWebCrypto(
    options.crypto,
    Object.hasOwn(options, 'crypto'),
  );
  const textEncoder = options.TextEncoder || globalThis.TextEncoder;
  if (typeof textEncoder !== 'function') {
    throw new DraftStateSerializationError(DRAFT_STATE_ERROR_CODES.HASH_FAILED, '$');
  }
  try {
    const input = stableStringifyCanonicalDraftState(state, { hashProjection: true });
    const digest = await cryptoProvider.subtle.digest('SHA-256', new textEncoder().encode(input));
    return bytesToHex(digest);
  } catch (error) {
    if (error instanceof DraftStateSerializationError || error instanceof DraftStateValidationError) {
      throw error;
    }
    throw new DraftStateSerializationError(DRAFT_STATE_ERROR_CODES.HASH_FAILED, '$');
  }
};

export const getCanonicalDraftStateByteSize = (state) => {
  const serialized = serializeCanonicalDraftState(state);
  if (typeof globalThis.TextEncoder !== 'function') {
    throw new DraftStateSerializationError(DRAFT_STATE_ERROR_CODES.SERIALIZATION_FAILED, '$');
  }
  const bytes = new TextEncoder().encode(serialized).byteLength;
  return {
    bytes,
    kilobytes: bytes / 1024,
    withinRecommendedLimit: bytes <= PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES,
  };
};

export const areCanonicalDraftStatesCompatible = (a, b) => {
  let left;
  let right;
  try {
    left = normalizeCanonicalDraftState(a);
    right = normalizeCanonicalDraftState(b);
  } catch {
    return false;
  }
  if (left.formType !== right.formType) return false;
  if (left.draftId !== null || right.draftId !== null) {
    return left.draftId !== null && right.draftId !== null && left.draftId === right.draftId;
  }
  if (left.sessionId !== null || right.sessionId !== null) {
    return left.sessionId !== null
      && right.sessionId !== null
      && left.sessionId === right.sessionId;
  }
  return false;
};

const freshnessResult = (result, reason, compatible = true, requiresMerge = false) => ({
  result,
  reason,
  compatible,
  requiresMerge,
});

const compareTimestamps = (left, right) => {
  if (left && !right) return 1;
  if (!left && right) return -1;
  if (!left && !right) return 0;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return leftTime === rightTime ? 0 : (leftTime > rightTime ? 1 : -1);
};

export const compareCanonicalDraftFreshness = async (a, b, options = {}) => {
  let left;
  let right;
  try {
    left = normalizeCanonicalDraftState(a);
    right = normalizeCanonicalDraftState(b);
  } catch {
    return freshnessResult('indeterminate', 'invalid_state', false, false);
  }
  if (!areCanonicalDraftStatesCompatible(left, right)) {
    return freshnessResult('incompatible', 'identity_mismatch', false, false);
  }
  if (left.draftStatus === 'submitted' && right.draftStatus !== 'submitted') {
    return freshnessResult('a_newer', 'submitted_state_protection');
  }
  if (right.draftStatus === 'submitted' && left.draftStatus !== 'submitted') {
    return freshnessResult('b_newer', 'submitted_state_protection');
  }
  if (left.serverRevision !== right.serverRevision) {
    return freshnessResult(
      left.serverRevision > right.serverRevision ? 'a_newer' : 'b_newer',
      'server_revision',
    );
  }
  if (left.clientRevision !== right.clientRevision) {
    return freshnessResult(
      left.clientRevision > right.clientRevision ? 'a_newer' : 'b_newer',
      'client_revision',
    );
  }
  const serverTimeComparison = compareTimestamps(left.savedAtServer, right.savedAtServer);
  if (serverTimeComparison !== 0) {
    return freshnessResult(
      serverTimeComparison > 0 ? 'a_newer' : 'b_newer',
      'server_timestamp',
    );
  }
  const clientTimeComparison = compareTimestamps(left.savedAtClient, right.savedAtClient);
  if (clientTimeComparison !== 0) {
    return freshnessResult(
      clientTimeComparison > 0 ? 'a_newer' : 'b_newer',
      'client_timestamp_non_authoritative_hint',
    );
  }
  const [leftHash, rightHash] = await Promise.all([
    hashCanonicalDraftState(left, options),
    hashCanonicalDraftState(right, options),
  ]);
  if (leftHash === rightHash) return freshnessResult('equal', 'state_hash');
  return freshnessResult('diverged', 'equal_revision_different_hash', true, true);
};

export const cloneCanonicalDraftState = (state) => (
  normalizeCanonicalDraftState(sanitizeDraftSerializableValue(state))
);

export const getSafeCanonicalDraftDiagnostics = (stateOrResult) => {
  const candidate = isPlainDraftObject(stateOrResult?.state)
    ? stateOrResult.state
    : stateOrResult;
  const errorCode = stateOrResult?.errorCode || null;
  const diagnostics = {
    schemaVersion: Number.isSafeInteger(candidate?.schemaVersion)
      ? candidate.schemaVersion
      : null,
    status: STATUS_SET.has(candidate?.draftStatus) ? candidate.draftStatus : null,
    clientRevision: Number.isSafeInteger(candidate?.clientRevision)
      ? candidate.clientRevision
      : null,
    serverRevision: Number.isSafeInteger(candidate?.serverRevision)
      ? candidate.serverRevision
      : null,
    draftIdPresent: typeof candidate?.draftId === 'string' && candidate.draftId.length > 0,
    sessionIdPresent: typeof candidate?.sessionId === 'string' && candidate.sessionId.length > 0,
    responseCount: isPlainDraftObject(candidate?.responses)
      ? Object.keys(candidate.responses).length
      : 0,
    validationCount: isPlainDraftObject(candidate?.validationStatus)
      ? Object.keys(candidate.validationStatus).length
      : 0,
    uiDraftScopeCount: isPlainDraftObject(candidate?.uiDraftState)
      ? Object.keys(candidate.uiDraftState).length
      : 0,
    metadataCount: isPlainDraftObject(candidate?.fieldChangeMetadata)
      ? Object.keys(candidate.fieldChangeMetadata).length
      : 0,
    identityContextVersion: Number.isSafeInteger(candidate?.identityContext?.identityContextVersion)
      ? candidate.identityContext.identityContextVersion
      : null,
    identitySource: IDENTITY_SOURCE_SET.has(candidate?.identityContext?.recoveryEmailSource)
      ? candidate.identityContext.recoveryEmailSource
      : null,
    associationIntent: IDENTITY_INTENT_SET.has(
      candidate?.identityContext?.identityAssociationIntent,
    ) ? candidate.identityContext.identityAssociationIntent : null,
    hasRecoveryEmail: Boolean(candidate?.credentials?.recoveryEmail),
    recoveryEmailVerificationStatus: EMAIL_VERIFICATION_SET.has(
      candidate?.identityContext?.recoveryEmailVerificationStatus,
    ) ? candidate.identityContext.recoveryEmailVerificationStatus : null,
    signedInvitationEmailChanged: candidate?.identityContext?.signedInvitationEmailChanged === true,
    anonymousRecoveryAcknowledged:
      candidate?.identityContext?.anonymousRecoveryAcknowledged === true,
    warningCount: Array.isArray(candidate?.compatibility?.migrationWarnings)
      ? candidate.compatibility.migrationWarnings.length
      : 0,
    bytes: null,
    hashPrefix: typeof stateOrResult?.hash === 'string'
      ? stateOrResult.hash.slice(0, 12)
      : null,
    errorCode,
  };
  try {
    if (isPlainDraftObject(candidate)) {
      diagnostics.bytes = getCanonicalDraftStateByteSize(candidate).bytes;
    }
  } catch {
    diagnostics.bytes = null;
  }
  return diagnostics;
};

export const buildCanonicalFieldPath = (...inputSegments) => {
  const segments = Array.isArray(inputSegments[0]) && inputSegments.length === 1
    ? inputSegments[0]
    : inputSegments;
  if (segments.length === 0) {
    throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.fieldPath');
  }
  return `/${segments.map((segment) => {
    if (
      !['string', 'number'].includes(typeof segment)
      || String(segment).length === 0
      || !Number.isFinite(typeof segment === 'number' ? segment : 0)
    ) {
      throw new DraftStateValidationError(DRAFT_STATE_ERROR_CODES.INVALID_FIELD, '$.fieldPath');
    }
    return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
  }).join('/')}`;
};
