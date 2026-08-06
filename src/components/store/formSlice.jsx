import { createSlice } from '@reduxjs/toolkit';
import {
  DRAFT_STATE_ERROR_CODES,
  DRAFT_STATE_STATUS_VALUES,
  DEFAULT_DRAFT_IDENTITY_CONTEXT,
  DraftStateValidationError,
  PRO_FORM_DRAFT_SCHEMA_VERSION,
  createEmptyCanonicalDraftState,
  getSafeCanonicalDraftDiagnostics,
  migrateCanonicalDraftState,
  normalizeCanonicalDraftState,
  normalizeCanonicalDraftIdentityContext,
  normalizeFieldChangeMetadata,
  sanitizeDraftSerializableValue,
} from '@/lib/questionnaireDraftState';
import {
  APPLY_FORM_MUTATION_ACTION_TYPE,
  DRAFT_MUTATION_REASONS,
  createApplyFormMutationAction,
  prepareFormMutationPayload,
} from './formMutationFactory';

export { DRAFT_MUTATION_REASONS } from './formMutationFactory';

export const DRAFT_BOOTSTRAP_STATES = Object.freeze([
  'idle',
  'loading',
  'ready',
  'error',
]);

export const DRAFT_SYNC_STATES = Object.freeze([
  'idle',
  'local_saving',
  'local_saved',
  'server_saving',
  'server_saved',
  'offline_local_only',
  'retrying',
  'error',
  'restored',
  'submitted',
]);

export const DRAFT_RESTORED_FROM_VALUES = Object.freeze([
  'none',
  'browser',
  'server',
  'merged',
  'legacy',
  'submitted_receipt',
]);

export const LOAD_CANONICAL_DRAFT_STATE_ACTION_TYPE = 'form/loadCanonicalDraftState';

const STATUS_SET = new Set(DRAFT_STATE_STATUS_VALUES);
const RESTORED_FROM_SET = new Set(DRAFT_RESTORED_FROM_VALUES);
const MUTATION_REASON_SET = new Set(DRAFT_MUTATION_REASONS);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_CODE_PATTERN = /^[A-Z0-9_.:-]{1,160}$/;
const SAFE_OPAQUE_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SECRET_KEY_PATTERN = /(?:recovery.?code|recovery.?code.?hash|recovery.?session|resume.?token|admin.?grant|identity.?key.?hash|email.?lookup.?hash|draft.?access.?token|access.?token|authorization|private.?key|client.?secret|password)/i;

const DRAFT_IDENTITY_CONTEXT_FIELDS = new Set([
  'identityContextVersion',
  'recoveryEmailSource',
  'recoveryEmailVerificationStatus',
  'identityAssociationIntent',
  'anonymousRecoveryAcknowledged',
  'signedInvitationEmailChanged',
]);

const DRAFT_CONTEXT_FIELDS = new Set([
  'draftId',
  'sessionId',
  'draftStatus',
  'schemaVersion',
  'clientRevision',
  'serverRevision',
  'sourceTabId',
  'namespace',
  'restoredFrom',
  'lastStateHash',
  ...DRAFT_IDENTITY_CONTEXT_FIELDS,
]);

const LEGACY_FORM_FIELDS = new Set([
  'responses',
  'validationStatus',
  'touchedQuestions',
  'expandedQuestions',
  'credentials',
  'textValidationMeta',
  'uiDraftState',
  'fieldChangeMetadata',
  'draftContext',
  'currentQuestionId',
  'lastChangedQuestionId',
  'lastMutation',
  'submittedReceipt',
]);

export const getSafeLoadInitialStateDiagnostics = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({
      acceptedFieldCount: 0,
      canonicalInput: false,
      rejectedFieldCount: 0,
      validInputShape: false,
    });
  }
  const canonicalInput = Object.hasOwn(value, 'schemaVersion')
    || Object.hasOwn(value, 'formType');
  const fields = Object.keys(value);
  return Object.freeze({
    acceptedFieldCount: canonicalInput
      ? fields.length
      : fields.filter((key) => LEGACY_FORM_FIELDS.has(key)).length,
    canonicalInput,
    rejectedFieldCount: canonicalInput
      ? 0
      : fields.filter((key) => !LEGACY_FORM_FIELDS.has(key)).length,
    validInputShape: true,
  });
};

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * @param {string} path
 * @param {string} [code]
 */
const fail = (path, code = DRAFT_STATE_ERROR_CODES.INVALID_FIELD) => {
  throw new DraftStateValidationError(code, path);
};

const attempt = (normalizer) => {
  try {
    return { valid: true, value: normalizer() };
  } catch {
    return { valid: false, value: null };
  }
};

const normalizeKey = (value, path = '$.<key>') => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) fail(path);
  const normalized = value.trim();
  if (FORBIDDEN_KEYS.has(normalized)) {
    fail(path, DRAFT_STATE_ERROR_CODES.UNSAFE_PROPERTY_KEY);
  }
  if (SECRET_KEY_PATTERN.test(normalized)) {
    fail(path, DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD);
  }
  return normalized;
};

const normalizeNullableString = (value, path) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
    fail(path);
  }
  const normalized = String(value).trim();
  return normalized || null;
};

const normalizeOpaqueString = (value, path) => {
  const normalized = normalizeNullableString(value, path);
  if (normalized !== null && !SAFE_OPAQUE_PATTERN.test(normalized)) fail(path);
  return normalized;
};

const normalizeTimestamp = (value, path, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) fail(path);
    return null;
  }
  if (typeof value !== 'string') fail(path);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(path);
  return parsed.toISOString();
};

const normalizeRevision = (value, path, { required = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) fail(path);
    return 0;
  }
  if (!Number.isSafeInteger(value) || value < 0) fail(path);
  return value;
};

const normalizeSafeCode = (value, path, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) fail(path);
    return null;
  }
  if (typeof value !== 'string' || !SAFE_CODE_PATTERN.test(value)) fail(path);
  return value;
};

const normalizeMap = (value, path, normalizeValue) => {
  if (!isPlainObject(value)) fail(path);
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeKey(rawKey, `${path}.<key>`);
    output[key] = normalizeValue(rawValue, `${path}.${key}`);
  }
  return output;
};

const normalizeSerializableMap = (value, path) => normalizeMap(
  value,
  path,
  (entry) => sanitizeDraftSerializableValue(entry),
);

const normalizeStringMap = (value, path) => normalizeMap(value, path, (entry, entryPath) => {
  if (typeof entry !== 'string') fail(entryPath);
  return entry;
});

const normalizeBooleanMap = (value, path) => normalizeMap(value, path, (entry, entryPath) => {
  if (typeof entry !== 'boolean') fail(entryPath);
  return entry;
});

const normalizeCredentials = (value) => normalizeCanonicalDraftState({
  ...createEmptyCanonicalDraftState(),
  credentials: value,
}).credentials;

const normalizeUiDraftMap = (value) => normalizeCanonicalDraftState({
  ...createEmptyCanonicalDraftState(),
  uiDraftState: value,
}).uiDraftState;

const normalizeUiDraftEntry = (scopeKey, entry) => normalizeUiDraftMap({
  [normalizeKey(scopeKey, '$.scopeKey')]: entry,
})[scopeKey.trim()];

const normalizeFieldMetadataMap = (value) => normalizeFieldChangeMetadata(value);

const normalizeDeleteKeys = (value, path) => {
  if (!Array.isArray(value)) fail(path);
  return [...new Set(value.map((key, index) => normalizeKey(key, `${path}[${index}]`)))];
};

const createDraftContext = () => ({
  draftId: null,
  sessionId: null,
  draftStatus: 'active',
  schemaVersion: PRO_FORM_DRAFT_SCHEMA_VERSION,
  clientRevision: 0,
  serverRevision: 0,
  sourceTabId: null,
  namespace: null,
  restoredFrom: null,
  lastStateHash: null,
  ...DEFAULT_DRAFT_IDENTITY_CONTEXT,
});

const createDraftBootstrapStatus = () => ({
  state: 'idle',
  errorCode: null,
  startedAt: null,
  completedAt: null,
  source: null,
});

const createDraftSyncStatus = () => ({
  state: 'idle',
  storageMode: null,
  lastLocalSavedAt: null,
  lastServerSavedAt: null,
  pendingClientRevision: null,
  confirmedClientRevision: null,
  confirmedServerRevision: null,
  errorCode: null,
  retryCount: 0,
});

export const createInitialFormState = () => ({
  responses: {},
  validationStatus: {},
  touchedQuestions: {},
  expandedQuestions: {},
  credentials: {},
  textValidationMeta: {},
  uiDraftState: {},
  fieldChangeMetadata: {},
  draftContext: createDraftContext(),
  draftBootstrapStatus: createDraftBootstrapStatus(),
  draftSyncStatus: createDraftSyncStatus(),
  currentQuestionId: null,
  lastChangedQuestionId: null,
  lastMutation: null,
  submittedReceipt: null,
});

export const initialState = createInitialFormState();

const ensureDraftFoundation = (state) => {
  if (!isPlainObject(state.uiDraftState)) state.uiDraftState = {};
  if (!isPlainObject(state.fieldChangeMetadata)) state.fieldChangeMetadata = {};
  if (!isPlainObject(state.draftContext)) state.draftContext = createDraftContext();
  if (!isPlainObject(state.draftBootstrapStatus)) {
    state.draftBootstrapStatus = createDraftBootstrapStatus();
  }
  if (!isPlainObject(state.draftSyncStatus)) state.draftSyncStatus = createDraftSyncStatus();
  if (!Object.hasOwn(state, 'currentQuestionId')) state.currentQuestionId = null;
  if (!Object.hasOwn(state, 'lastChangedQuestionId')) state.lastChangedQuestionId = null;
  if (!Object.hasOwn(state, 'lastMutation')) state.lastMutation = null;
  if (!Object.hasOwn(state, 'submittedReceipt')) state.submittedReceipt = null;
  for (const [field, fallback] of Object.entries(DEFAULT_DRAFT_IDENTITY_CONTEXT)) {
    if (!Object.hasOwn(state.draftContext, field)) state.draftContext[field] = fallback;
  }
};

const pickDraftIdentityContext = (draftContext = {}) => Object.fromEntries(
  [...DRAFT_IDENTITY_CONTEXT_FIELDS].map((field) => [
    field,
    Object.hasOwn(draftContext, field)
      ? draftContext[field]
      : DEFAULT_DRAFT_IDENTITY_CONTEXT[field],
  ]),
);

const validateDraftIdentityCombination = (draftContext, credentials) => (
  normalizeCanonicalDraftIdentityContext(pickDraftIdentityContext(draftContext), credentials)
);

export const prepareDraftIdentityContextPayload = (value, { partial = false } = {}) => {
  if (!isPlainObject(value)) fail('$.draftIdentityContext');
  const allowed = new Set([...DRAFT_IDENTITY_CONTEXT_FIELDS, 'recoveryEmail']);
  for (const key of Object.keys(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      fail(`$.draftIdentityContext.${key}`, DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD);
    }
    if (!allowed.has(key)) {
      fail(`$.draftIdentityContext.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
    }
  }
  const metadata = {};
  for (const field of DRAFT_IDENTITY_CONTEXT_FIELDS) {
    if (!partial || Object.hasOwn(value, field)) metadata[field] = value[field];
  }
  const recoveryEmail = Object.hasOwn(value, 'recoveryEmail')
    ? normalizeCredentials({ recoveryEmail: value.recoveryEmail }).recoveryEmail || null
    : undefined;
  if (!partial) {
    const credentials = recoveryEmail ? { recoveryEmail } : {};
    Object.assign(metadata, normalizeCanonicalDraftIdentityContext(metadata, credentials));
  } else {
    const candidate = {
      ...DEFAULT_DRAFT_IDENTITY_CONTEXT,
      ...metadata,
    };
    const credentials = recoveryEmail ? { recoveryEmail } : {};
    // Partial payloads receive strict enum/type validation here; full
    // cross-field validation is repeated atomically against current state.
    normalizeCanonicalDraftIdentityContext(candidate, credentials);
  }
  return {
    ...metadata,
    ...(recoveryEmail !== undefined ? { recoveryEmail } : {}),
  };
};

export const createSetDraftIdentityContextAction = (value) => ({
  type: 'form/setDraftIdentityContext',
  payload: prepareDraftIdentityContextPayload(value, { partial: false }),
});

const normalizeDraftContextPayload = (value, { partial = false } = {}) => {
  if (!isPlainObject(value)) fail('$.draftContext');
  for (const key of Object.keys(value)) {
    if (!DRAFT_CONTEXT_FIELDS.has(key)) {
      fail(`$.draftContext.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
    }
    if (SECRET_KEY_PATTERN.test(key)) {
      fail(`$.draftContext.${key}`, DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD);
    }
  }
  const output = {};
  const set = (field, normalizer) => {
    if (!partial || Object.hasOwn(value, field)) output[field] = normalizer(value[field]);
  };
  set('draftId', (entry) => normalizeNullableString(entry, '$.draftContext.draftId'));
  set('sessionId', (entry) => normalizeNullableString(entry, '$.draftContext.sessionId'));
  set('draftStatus', (entry) => {
    const status = entry === undefined ? 'active' : entry;
    if (!STATUS_SET.has(status)) fail('$.draftContext.draftStatus');
    return status;
  });
  set('schemaVersion', (entry) => {
    const version = entry === undefined ? PRO_FORM_DRAFT_SCHEMA_VERSION : entry;
    if (version !== PRO_FORM_DRAFT_SCHEMA_VERSION) fail('$.draftContext.schemaVersion');
    return version;
  });
  set('clientRevision', (entry) => normalizeRevision(entry, '$.draftContext.clientRevision'));
  set('serverRevision', (entry) => normalizeRevision(entry, '$.draftContext.serverRevision'));
  set('sourceTabId', (entry) => normalizeOpaqueString(entry, '$.draftContext.sourceTabId'));
  set('namespace', (entry) => normalizeOpaqueString(entry, '$.draftContext.namespace'));
  set('restoredFrom', (entry) => {
    if (entry === undefined || entry === null) return null;
    if (!RESTORED_FROM_SET.has(entry)) fail('$.draftContext.restoredFrom');
    return entry;
  });
  set('lastStateHash', (entry) => {
    if (entry === undefined || entry === null || entry === '') return null;
    if (typeof entry !== 'string' || !HASH_PATTERN.test(entry)) {
      fail('$.draftContext.lastStateHash');
    }
    return entry;
  });
  for (const field of DRAFT_IDENTITY_CONTEXT_FIELDS) {
    if (!partial || Object.hasOwn(value, field)) {
      output[field] = Object.hasOwn(value, field)
        ? value[field]
        : DEFAULT_DRAFT_IDENTITY_CONTEXT[field];
    }
  }
  const complete = partial ? output : { ...createDraftContext(), ...output };
  if (!partial) validateDraftIdentityCombination(complete, {});
  return complete;
};

const normalizeRestoredSource = (value, path = '$.source') => {
  if (!RESTORED_FROM_SET.has(value)) fail(path);
  return value;
};

const normalizeStorageMode = (value, path = '$.storageMode') => {
  if (typeof value !== 'string' || !SAFE_OPAQUE_PATTERN.test(value)) fail(path);
  return value;
};

const normalizeSubmittedReceipt = (value) => {
  if (!isPlainObject(value)) fail('$.submittedReceipt');
  const allowed = new Set(['finalSubmissionId', 'submittedAt', 'pdfAvailable']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`$.submittedReceipt.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
  }
  if (typeof value.pdfAvailable !== 'boolean') fail('$.submittedReceipt.pdfAvailable');
  return {
    finalSubmissionId: normalizeNullableString(
      value.finalSubmissionId,
      '$.submittedReceipt.finalSubmissionId',
    ),
    submittedAt: normalizeTimestamp(value.submittedAt, '$.submittedReceipt.submittedAt'),
    pdfAvailable: value.pdfAvailable,
  };
};

const normalizeSetUiPayload = (value) => {
  if (!isPlainObject(value)) fail('$');
  const scopeKey = normalizeKey(value.scopeKey, '$.scopeKey');
  return { scopeKey, entry: normalizeUiDraftEntry(scopeKey, value.entry) };
};

const normalizeUiPatchPayload = (value) => {
  if (!isPlainObject(value) || !isPlainObject(value.patch)) fail('$');
  const scopeKey = normalizeKey(value.scopeKey, '$.scopeKey');
  const allowed = new Set(['kind', 'version', 'data', 'updatedAtClient', 'sourceTabId']);
  for (const key of Object.keys(value.patch)) {
    if (!allowed.has(key)) fail(`$.patch.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
  }
  const patch = sanitizeDraftSerializableValue(value.patch);
  if (Object.hasOwn(patch, 'kind') && (typeof patch.kind !== 'string' || !patch.kind.trim())) {
    fail('$.patch.kind');
  }
  if (Object.hasOwn(patch, 'version') && (!Number.isSafeInteger(patch.version) || patch.version < 1)) {
    fail('$.patch.version');
  }
  if (Object.hasOwn(patch, 'updatedAtClient')) {
    patch.updatedAtClient = normalizeTimestamp(patch.updatedAtClient, '$.patch.updatedAtClient');
  }
  if (Object.hasOwn(patch, 'sourceTabId')) {
    patch.sourceTabId = normalizeOpaqueString(patch.sourceTabId, '$.patch.sourceTabId');
  }
  return { scopeKey, patch };
};

const normalizeScopePayload = (value) => ({
  scopeKey: normalizeKey(value?.scopeKey, '$.scopeKey'),
});

const normalizeFieldMetadataPayload = (value) => {
  if (!isPlainObject(value)) fail('$');
  const fieldPath = normalizeKey(value.fieldPath, '$.fieldPath');
  return {
    fieldPath,
    metadata: normalizeFieldMetadataMap({ [fieldPath]: value.metadata })[fieldPath],
  };
};

const normalizeLegacyStatePayload = (value) => {
  if (!isPlainObject(value)) fail('$');
  if (Object.hasOwn(value, 'schemaVersion') || Object.hasOwn(value, 'formType')) {
    const canonical = normalizeCanonicalDraftState(migrateCanonicalDraftState(value));
    return {
      responses: canonical.responses,
      validationStatus: canonical.validationStatus,
      touchedQuestions: canonical.touchedQuestions,
      expandedQuestions: canonical.expandedQuestions,
      credentials: canonical.credentials,
      textValidationMeta: canonical.textValidationMeta,
      uiDraftState: canonical.uiDraftState,
      fieldChangeMetadata: canonical.fieldChangeMetadata,
      draftContext: {
        draftId: canonical.draftId,
        sessionId: canonical.sessionId,
        draftStatus: canonical.draftStatus,
        schemaVersion: canonical.schemaVersion,
        clientRevision: canonical.clientRevision,
        serverRevision: canonical.serverRevision,
        sourceTabId: canonical.sourceTabId,
        namespace: null,
        restoredFrom: null,
        lastStateHash: null,
        ...canonical.identityContext,
      },
      currentQuestionId: canonical.currentQuestionId,
      lastChangedQuestionId: canonical.lastChangedQuestionId,
      lastMutation: canonical.lastMutation,
      submittedReceipt: (
        canonical.draftStatus === 'submitted'
        || canonical.submission.finalSubmissionId
        || canonical.submission.submittedAt
      ) ? {
          finalSubmissionId: canonical.submission.finalSubmissionId,
          submittedAt: canonical.submission.submittedAt,
          pdfAvailable: Boolean(canonical.submission.pdfSourceStateHash),
        } : null,
    };
  }
  const output = {};
  for (const key of Object.keys(value)) {
    if (!LEGACY_FORM_FIELDS.has(key)) continue;
    if (key === 'responses' || key === 'textValidationMeta') {
      output[key] = normalizeSerializableMap(value[key], `$.${key}`);
    } else if (key === 'validationStatus') {
      output[key] = normalizeStringMap(value[key], `$.${key}`);
    } else if (key === 'touchedQuestions' || key === 'expandedQuestions') {
      output[key] = normalizeBooleanMap(value[key], `$.${key}`);
    } else if (key === 'credentials') {
      output[key] = normalizeCredentials(value[key]);
    } else if (key === 'uiDraftState') {
      output[key] = normalizeUiDraftMap(value[key]);
    } else if (key === 'fieldChangeMetadata') {
      output[key] = normalizeFieldMetadataMap(value[key]);
    } else if (key === 'draftContext') {
      output[key] = normalizeDraftContextPayload(value[key]);
    } else if (key === 'currentQuestionId' || key === 'lastChangedQuestionId') {
      output[key] = normalizeNullableString(value[key], `$.${key}`);
    } else if (key === 'lastMutation') {
      output[key] = normalizeCanonicalDraftState({
        ...createEmptyCanonicalDraftState(),
        lastMutation: value[key],
      }).lastMutation;
    } else if (key === 'submittedReceipt') {
      output[key] = value[key] === null ? null : normalizeSubmittedReceipt(value[key]);
    }
  }
  return output;
};

const normalizeQuestionResetPayload = (value) => {
  if (!isPlainObject(value)) fail('$');
  const allowed = new Set([
    'responseKey',
    'auxiliaryResponseKeys',
    'validationKeys',
    'touchedKeys',
    'expandedKeys',
    'textValidationMetaKeys',
    'uiDraftScopeKeys',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`$.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
  }
  const responseKey = normalizeKey(value.responseKey, '$.responseKey');
  const keys = (field, fallback) => (
    Object.hasOwn(value, field) ? normalizeDeleteKeys(value[field], `$.${field}`) : fallback
  );
  return {
    responseKeys: [responseKey, ...keys('auxiliaryResponseKeys', [])],
    validationKeys: keys('validationKeys', [responseKey]),
    touchedKeys: keys('touchedKeys', [responseKey]),
    expandedKeys: keys('expandedKeys', [responseKey]),
    textValidationMetaKeys: keys('textValidationMetaKeys', [responseKey]),
    uiDraftScopeKeys: keys('uiDraftScopeKeys', []),
  };
};

const normalizeResetPayload = (value = {}) => {
  if (!isPlainObject(value)) fail('$');
  const defaults = {
    preserveCredentials: true,
    preserveDraftContext: false,
    preserveSubmittedReceipt: false,
    preserveNamespace: true,
    resetReason: 'system',
  };
  const allowed = new Set(Object.keys(defaults));
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`$.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
  }
  const output = { ...defaults, ...value };
  for (const key of [
    'preserveCredentials',
    'preserveDraftContext',
    'preserveSubmittedReceipt',
    'preserveNamespace',
  ]) {
    if (typeof output[key] !== 'boolean') fail(`$.${key}`);
  }
  if (!MUTATION_REASON_SET.has(output.resetReason)) fail('$.resetReason');
  return output;
};

const resetQuestionnaire = (state, options) => {
  const credentials = options.preserveCredentials
    ? sanitizeDraftSerializableValue(state.credentials || {})
    : {};
  const draftContext = options.preserveDraftContext
    ? sanitizeDraftSerializableValue(state.draftContext || createDraftContext())
    : createDraftContext();
  const namespace = state.draftContext?.namespace || null;
  const submittedReceipt = options.preserveSubmittedReceipt
    ? sanitizeDraftSerializableValue(state.submittedReceipt)
    : null;
  const next = createInitialFormState();
  next.credentials = credentials;
  next.draftContext = draftContext;
  next.submittedReceipt = submittedReceipt;
  next.draftContext.namespace = options.preserveNamespace ? namespace : null;
  return next;
};

const shouldIgnoreBecauseSubmitted = (state) => state.draftContext?.draftStatus === 'submitted';
const shouldIgnoreSyncTransition = (state) => (
  shouldIgnoreBecauseSubmitted(state) || state.draftSyncStatus?.state === 'submitted'
);

const applyFieldMetadata = (state, fieldPath, operation, metadata, clientRevision) => {
  state.fieldChangeMetadata[fieldPath] = {
    operation,
    clientRevision,
    serverRevision: metadata.baseServerRevision,
    changedAtClient: metadata.changedAtClient,
    sourceTabId: metadata.sourceTabId,
    mutationId: metadata.mutationId,
  };
};

const applyAtomicMutation = (state, rawPayload) => {
  ensureDraftFoundation(state);
  if (shouldIgnoreBecauseSubmitted(state)) return;
  const prepared = attempt(() => prepareFormMutationPayload(rawPayload));
  if (!prepared.valid) return;
  const payload = prepared.value;
  if (Object.hasOwn(payload, 'setCredentials')) {
    const identityValid = attempt(() => validateDraftIdentityCombination(
      state.draftContext,
      payload.setCredentials,
    ));
    if (!identityValid.valid) return;
  }
  if (state.draftContext.clientRevision >= Number.MAX_SAFE_INTEGER) return;
  const nextClientRevision = state.draftContext.clientRevision + 1;
  const metadata = payload.mutationMetadata;

  const applyDeletes = (field, target, prefix) => {
    for (const key of payload[field] || []) {
      delete target[key];
      applyFieldMetadata(state, `${prefix}.${key}`, 'delete', metadata, nextClientRevision);
    }
  };
  applyDeletes('deleteResponseKeys', state.responses, 'responses');
  applyDeletes('deleteValidationKeys', state.validationStatus, 'validationStatus');
  applyDeletes('deleteTouchedKeys', state.touchedQuestions, 'touchedQuestions');
  applyDeletes('deleteExpandedKeys', state.expandedQuestions, 'expandedQuestions');
  applyDeletes('deleteTextValidationMetaKeys', state.textValidationMeta, 'textValidationMeta');
  applyDeletes('deleteUiDraftStateKeys', state.uiDraftState, 'uiDraftState');

  const applySets = (field, target, prefix) => {
    for (const [key, value] of Object.entries(payload[field] || {})) {
      target[key] = value;
      applyFieldMetadata(state, `${prefix}.${key}`, 'set', metadata, nextClientRevision);
    }
  };
  applySets('setResponses', state.responses, 'responses');
  applySets('setValidationStatus', state.validationStatus, 'validationStatus');
  applySets('setTouchedQuestions', state.touchedQuestions, 'touchedQuestions');
  applySets('setExpandedQuestions', state.expandedQuestions, 'expandedQuestions');
  applySets('setTextValidationMeta', state.textValidationMeta, 'textValidationMeta');
  applySets('setUiDraftState', state.uiDraftState, 'uiDraftState');

  if (Object.hasOwn(payload, 'setCredentials')) {
    const previousKeys = Object.keys(state.credentials || {});
    state.credentials = payload.setCredentials;
    for (const key of previousKeys) {
      if (!Object.hasOwn(payload.setCredentials, key)) {
        applyFieldMetadata(state, `credentials.${key}`, 'delete', metadata, nextClientRevision);
      }
    }
    for (const key of Object.keys(payload.setCredentials)) {
      applyFieldMetadata(state, `credentials.${key}`, 'set', metadata, nextClientRevision);
    }
  }
  if (Object.hasOwn(payload, 'currentQuestionId')) {
    state.currentQuestionId = payload.currentQuestionId;
    applyFieldMetadata(state, 'currentQuestionId', 'set', metadata, nextClientRevision);
  }
  if (Object.hasOwn(payload, 'lastChangedQuestionId')) {
    state.lastChangedQuestionId = payload.lastChangedQuestionId;
    applyFieldMetadata(state, 'lastChangedQuestionId', 'set', metadata, nextClientRevision);
  }

  state.draftContext.clientRevision = nextClientRevision;
  state.draftContext.sourceTabId = metadata.sourceTabId;
  state.lastMutation = {
    mutationId: metadata.mutationId,
    mutationType: metadata.mutationType,
    reason: metadata.reason,
    changedAtClient: metadata.changedAtClient,
    sourceTabId: metadata.sourceTabId,
  };
};

const normalizeHydrationOptions = (options) => {
  if (!isPlainObject(options)) fail('$.options');
  const allowed = new Set(['source', 'completedAt', 'namespace', 'lastStateHash', 'storageMode']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`$.options.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
  }
  return {
    source: normalizeRestoredSource(options.source, '$.options.source'),
    completedAt: normalizeTimestamp(options.completedAt, '$.options.completedAt', { required: true }),
    namespace: normalizeOpaqueString(options.namespace, '$.options.namespace'),
    lastStateHash: options.lastStateHash === undefined || options.lastStateHash === null
      ? null
      : normalizeDraftContextPayload({ lastStateHash: options.lastStateHash }, { partial: true })
        .lastStateHash,
    storageMode: options.storageMode === undefined || options.storageMode === null
      ? null
      : normalizeStorageMode(options.storageMode, '$.options.storageMode'),
  };
};

export const createLoadCanonicalDraftStateAction = (input, options) => {
  try {
    const normalizedOptions = normalizeHydrationOptions(options);
    const strictServer = normalizedOptions.source === 'server';
    const canonicalState = normalizeCanonicalDraftState(
      migrateCanonicalDraftState(input, { strictServer }),
      { strictServer },
    );
    return {
      ok: true,
      action: {
        type: LOAD_CANONICAL_DRAFT_STATE_ACTION_TYPE,
        payload: { canonicalState, ...normalizedOptions },
      },
      errorCode: null,
      issues: [],
      safeDiagnostics: getSafeCanonicalDraftDiagnostics({ state: canonicalState }),
    };
  } catch (error) {
    const errorCode = error?.code || DRAFT_STATE_ERROR_CODES.INVALID_INPUT;
    return {
      ok: false,
      action: null,
      errorCode,
      issues: [{ code: errorCode, path: error?.path || '$' }],
      safeDiagnostics: getSafeCanonicalDraftDiagnostics({ errorCode }),
    };
  }
};

export const loadCanonicalDraftState = (input, options) => {
  const result = createLoadCanonicalDraftStateAction(input, options);
  if (!result.ok) {
    throw new DraftStateValidationError(
      result.errorCode,
      result.issues[0]?.path || '$',
      result.issues,
    );
  }
  return result.action;
};

loadCanonicalDraftState.type = LOAD_CANONICAL_DRAFT_STATE_ACTION_TYPE;

export const applyFormMutation = createApplyFormMutationAction;

// RTK's prepared-reducer generic inference is incomplete for check-JS files. The
// preparation and reducer contracts are validated at runtime and by focused tests.
const formSlice = createSlice(/** @type {any} */ ({
  name: 'form',
  initialState,
  reducers: {
    setResponse: {
      prepare: (payload) => ({
        payload: {
          questionId: normalizeKey(payload?.questionId, '$.questionId'),
          value: sanitizeDraftSerializableValue(payload?.value),
        },
      }),
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => ({
          questionId: normalizeKey(action.payload?.questionId, '$.questionId'),
          value: sanitizeDraftSerializableValue(action.payload?.value),
        }));
        if (prepared.valid) state.responses[prepared.value.questionId] = prepared.value.value;
      },
    },
    setMultipleResponses: {
      prepare: (payload) => ({ payload: normalizeSerializableMap(payload, '$.responses') }),
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeSerializableMap(action.payload, '$.responses'));
        if (prepared.valid) state.responses = { ...state.responses, ...prepared.value };
      },
    },
    setValidationStatus: {
      prepare: (payload) => {
        const questionId = normalizeKey(payload?.questionId, '$.questionId');
        if (typeof payload?.status !== 'string') fail('$.status');
        return { payload: { questionId, status: payload.status } };
      },
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => {
          const questionId = normalizeKey(action.payload?.questionId, '$.questionId');
          if (typeof action.payload?.status !== 'string') fail('$.status');
          return { questionId, status: action.payload.status };
        });
        if (prepared.valid) {
          state.validationStatus[prepared.value.questionId] = prepared.value.status;
        }
      },
    },
    setMultipleValidationStatus: {
      prepare: (payload) => ({ payload: normalizeStringMap(payload, '$.validationStatus') }),
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeStringMap(action.payload, '$.validationStatus'));
        if (prepared.valid) {
          state.validationStatus = { ...state.validationStatus, ...prepared.value };
        }
      },
    },
    setTouchedQuestion: {
      prepare: (payload) => {
        const questionId = normalizeKey(payload?.questionId, '$.questionId');
        if (typeof payload?.touched !== 'boolean') fail('$.touched');
        return { payload: { questionId, touched: payload.touched } };
      },
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => {
          const questionId = normalizeKey(action.payload?.questionId, '$.questionId');
          if (typeof action.payload?.touched !== 'boolean') fail('$.touched');
          return { questionId, touched: action.payload.touched };
        });
        if (prepared.valid) {
          state.touchedQuestions[prepared.value.questionId] = prepared.value.touched;
        }
      },
    },
    setExpandedQuestion: {
      prepare: (payload) => {
        const questionId = normalizeKey(payload?.questionId, '$.questionId');
        if (typeof payload?.expanded !== 'boolean') fail('$.expanded');
        return { payload: { questionId, expanded: payload.expanded } };
      },
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => {
          const questionId = normalizeKey(action.payload?.questionId, '$.questionId');
          if (typeof action.payload?.expanded !== 'boolean') fail('$.expanded');
          return { questionId, expanded: action.payload.expanded };
        });
        if (prepared.valid) {
          state.expandedQuestions[prepared.value.questionId] = prepared.value.expanded;
        }
      },
    },
    setAllExpanded: {
      prepare: (payload) => ({ payload: normalizeBooleanMap(payload, '$.expandedQuestions') }),
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeBooleanMap(action.payload, '$.expandedQuestions'));
        if (prepared.valid) state.expandedQuestions = prepared.value;
      },
    },
    setCredentials: {
      prepare: (payload) => ({ payload: normalizeCredentials(payload) }),
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeCredentials(action.payload));
        if (!prepared.valid) return;
        const credentials = {
          ...prepared.value,
          ...(
            !Object.hasOwn(prepared.value, 'recoveryEmail') && state.credentials?.recoveryEmail
              ? { recoveryEmail: state.credentials.recoveryEmail }
              : {}
          ),
        };
        const identityValid = attempt(() => validateDraftIdentityCombination(
          state.draftContext,
          credentials,
        ));
        if (identityValid.valid) state.credentials = credentials;
      },
    },
    setDraftIdentityContext: {
      prepare: (payload) => ({
        payload: prepareDraftIdentityContextPayload(payload, { partial: false }),
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => prepareDraftIdentityContextPayload(
          action.payload,
          { partial: false },
        ));
        if (!prepared.valid) return;
        const { recoveryEmail, ...metadata } = prepared.value;
        const credentials = { ...state.credentials };
        if (recoveryEmail) credentials.recoveryEmail = recoveryEmail;
        else delete credentials.recoveryEmail;
        const validated = attempt(() => validateDraftIdentityCombination(metadata, credentials));
        if (!validated.valid) return;
        state.credentials = credentials;
        Object.assign(state.draftContext, validated.value);
      },
    },
    patchDraftIdentityContext: {
      prepare: (payload) => ({
        payload: prepareDraftIdentityContextPayload(payload, { partial: true }),
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => prepareDraftIdentityContextPayload(
          action.payload,
          { partial: true },
        ));
        if (!prepared.valid) return;
        const { recoveryEmail, ...metadataPatch } = prepared.value;
        const credentials = { ...state.credentials };
        if (Object.hasOwn(prepared.value, 'recoveryEmail')) {
          if (recoveryEmail) credentials.recoveryEmail = recoveryEmail;
          else delete credentials.recoveryEmail;
        }
        const proposed = { ...state.draftContext, ...metadataPatch };
        const validated = attempt(() => validateDraftIdentityCombination(proposed, credentials));
        if (!validated.valid) return;
        state.credentials = credentials;
        Object.assign(state.draftContext, validated.value);
      },
    },
    resetForm: (state) => resetQuestionnaire(state, normalizeResetPayload()),
    deleteResponse: {
      prepare: (payload) => ({ payload: normalizeKey(payload, '$.questionId') }),
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeKey(action.payload, '$.questionId'));
        if (!prepared.valid) return;
        const questionId = prepared.value;
        delete state.responses[questionId];
        delete state.responses[`${questionId}_other`];
        delete state.responses[`${questionId}_primary`];
        delete state.textValidationMeta[questionId];
        delete state.validationStatus[questionId];
        delete state.touchedQuestions[questionId];
        delete state.expandedQuestions[questionId];
      },
    },
    initializeExpandedQuestions: {
      prepare: (payload) => ({ payload: normalizeBooleanMap(payload, '$.expandedQuestions') }),
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeBooleanMap(action.payload, '$.expandedQuestions'));
        if (prepared.valid) state.expandedQuestions = prepared.value;
      },
    },
    setTextareaDirtyMeta: {
      prepare: (payload) => {
        const questionId = normalizeKey(payload?.questionId, '$.questionId');
        if (
          Object.hasOwn(payload || {}, 'lastValidatedValue')
          && payload.lastValidatedValue !== undefined
          && payload.lastValidatedValue !== null
          && typeof payload.lastValidatedValue !== 'string'
        ) fail('$.lastValidatedValue');
        if (
          Object.hasOwn(payload || {}, 'isDirty')
          && payload.isDirty !== undefined
          && payload.isDirty !== null
          && typeof payload.isDirty !== 'boolean'
        ) fail('$.isDirty');
        return { payload: { ...payload, questionId } };
      },
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const { questionId, lastValidatedValue, isDirty } = action.payload || {};
        const prepared = attempt(() => normalizeKey(questionId, '$.questionId'));
        if (!prepared.valid) return;
        if (lastValidatedValue != null && typeof lastValidatedValue !== 'string') return;
        if (isDirty != null && typeof isDirty !== 'boolean') return;
        state.textValidationMeta[prepared.value] = {
          lastValidatedValue:
            lastValidatedValue ?? state.textValidationMeta[prepared.value]?.lastValidatedValue ?? '',
          isDirty: isDirty ?? state.textValidationMeta[prepared.value]?.isDirty ?? false,
        };
      },
    },
    loadInitialState: {
      prepare: (payload) => ({
        payload: normalizeLegacyStatePayload(payload),
        meta: { safeDiagnostics: getSafeLoadInitialStateDiagnostics(payload) },
      }),
      reducer: (state, action) => {
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeLegacyStatePayload(action.payload));
        if (!prepared.valid) return;
        Object.assign(state, prepared.value);
      },
    },
    setUiDraftState: {
      prepare: (payload) => ({ payload: normalizeSetUiPayload(payload) }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeSetUiPayload(action.payload));
        if (prepared.valid) {
          state.uiDraftState[prepared.value.scopeKey] = prepared.value.entry;
        }
      },
    },
    patchUiDraftState: {
      prepare: (payload) => ({ payload: normalizeUiPatchPayload(payload) }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeUiPatchPayload(action.payload));
        if (!prepared.valid) return;
        const { scopeKey, patch } = prepared.value;
        const merged = state.uiDraftState[scopeKey]
          ? { ...state.uiDraftState[scopeKey], ...patch }
          : patch;
        const entry = attempt(() => normalizeUiDraftEntry(scopeKey, merged));
        if (entry.valid) state.uiDraftState[scopeKey] = entry.value;
      },
    },
    clearUiDraftState: {
      prepare: (payload) => ({ payload: normalizeScopePayload(payload) }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => normalizeScopePayload(action.payload));
        if (prepared.valid) delete state.uiDraftState[prepared.value.scopeKey];
      },
    },
    clearAllUiDraftState: (state) => {
      ensureDraftFoundation(state);
      if (shouldIgnoreBecauseSubmitted(state)) return;
      state.uiDraftState = {};
    },
    setDraftContext: {
      prepare: (payload) => ({ payload: normalizeDraftContextPayload(payload) }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        const prepared = attempt(() => normalizeDraftContextPayload(action.payload));
        if (!prepared.valid) return;
        if (shouldIgnoreBecauseSubmitted(state) && prepared.value.draftStatus !== 'submitted') {
          prepared.value.draftStatus = 'submitted';
        }
        state.draftContext = prepared.value;
      },
    },
    patchDraftContext: {
      prepare: (payload) => ({
        payload: normalizeDraftContextPayload(payload, { partial: true }),
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        const prepared = attempt(() => normalizeDraftContextPayload(action.payload, { partial: true }));
        if (!prepared.valid) return;
        if (
          shouldIgnoreBecauseSubmitted(state)
          && Object.hasOwn(prepared.value, 'draftStatus')
          && prepared.value.draftStatus !== 'submitted'
        ) delete prepared.value.draftStatus;
        if ([...DRAFT_IDENTITY_CONTEXT_FIELDS].some((field) => (
          Object.hasOwn(prepared.value, field)
        ))) {
          const proposed = { ...state.draftContext, ...prepared.value };
          const identityValid = attempt(() => validateDraftIdentityCombination(
            proposed,
            state.credentials,
          ));
          if (!identityValid.valid) return;
          Object.assign(prepared.value, identityValid.value);
        }
        Object.assign(state.draftContext, prepared.value);
      },
    },
    setDraftStatus: {
      prepare: (payload) => {
        const status = isPlainObject(payload) ? payload.draftStatus : payload;
        if (!STATUS_SET.has(status)) fail('$.draftStatus');
        return { payload: status };
      },
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (!STATUS_SET.has(action.payload)) return;
        if (shouldIgnoreBecauseSubmitted(state) && action.payload !== 'submitted') return;
        state.draftContext.draftStatus = action.payload;
      },
    },
    setDraftRevisions: {
      prepare: (payload) => {
        if (!isPlainObject(payload)) fail('$');
        return {
          payload: {
            clientRevision: normalizeRevision(
              payload.clientRevision,
              '$.clientRevision',
              { required: true },
            ),
            serverRevision: normalizeRevision(
              payload.serverRevision,
              '$.serverRevision',
              { required: true },
            ),
          },
        };
      },
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        const client = attempt(() => normalizeRevision(
          action.payload?.clientRevision,
          '$.clientRevision',
          { required: true },
        ));
        const server = attempt(() => normalizeRevision(
          action.payload?.serverRevision,
          '$.serverRevision',
          { required: true },
        ));
        if (!client.valid || !server.valid) return;
        state.draftContext.clientRevision = client.value;
        state.draftContext.serverRevision = server.value;
      },
    },
    setDraftStateHash: {
      prepare: (payload) => ({
        payload: normalizeDraftContextPayload(
          { lastStateHash: payload },
          { partial: true },
        ).lastStateHash,
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        const prepared = attempt(() => normalizeDraftContextPayload(
          { lastStateHash: action.payload },
          { partial: true },
        ).lastStateHash);
        if (prepared.valid) state.draftContext.lastStateHash = prepared.value;
      },
    },
    clearDraftContext: {
      prepare: (payload) => {
        if (!isPlainObject(payload)) fail('$');
        const fields = ['clearSessionId', 'preserveNamespace', 'preserveSubmittedReceipt'];
        if (Object.keys(payload).some((key) => !fields.includes(key))) {
          fail('$', DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
        }
        for (const field of fields) {
          if (typeof payload[field] !== 'boolean') fail(`$.${field}`);
        }
        return { payload: { ...payload } };
      },
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        const payload = action.payload || {};
        if (
          typeof payload.clearSessionId !== 'boolean'
          || typeof payload.preserveNamespace !== 'boolean'
          || typeof payload.preserveSubmittedReceipt !== 'boolean'
        ) return;
        const sessionId = state.draftContext.sessionId;
        const namespace = state.draftContext.namespace;
        state.draftContext = createDraftContext();
        if (!payload.clearSessionId) state.draftContext.sessionId = sessionId;
        if (payload.preserveNamespace) state.draftContext.namespace = namespace;
        if (!payload.preserveSubmittedReceipt) state.submittedReceipt = null;
      },
    },
    setDraftBootstrapLoading: {
      prepare: (payload) => {
        if (!isPlainObject(payload)) fail('$');
        if (payload.beginNew !== undefined && typeof payload.beginNew !== 'boolean') fail('$.beginNew');
        return {
          payload: {
            source: normalizeRestoredSource(payload.source),
            startedAt: normalizeTimestamp(payload.startedAt, '$.startedAt', { required: true }),
            beginNew: payload.beginNew === true,
          },
        };
      },
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (
          ['ready', 'error'].includes(state.draftBootstrapStatus.state)
          && action.payload?.beginNew !== true
        ) return;
        state.draftBootstrapStatus = {
          state: 'loading',
          errorCode: null,
          startedAt: action.payload.startedAt,
          completedAt: null,
          source: action.payload.source,
        };
      },
    },
    setDraftBootstrapReady: {
      prepare: (payload) => ({
        payload: {
          source: normalizeRestoredSource(payload?.source),
          completedAt: normalizeTimestamp(payload?.completedAt, '$.completedAt', { required: true }),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        state.draftBootstrapStatus = {
          state: 'ready',
          errorCode: null,
          startedAt: state.draftBootstrapStatus.startedAt,
          completedAt: action.payload.completedAt,
          source: action.payload.source,
        };
      },
    },
    setDraftBootstrapError: {
      prepare: (payload) => ({
        payload: {
          errorCode: normalizeSafeCode(payload?.errorCode, '$.errorCode', { required: true }),
          completedAt: normalizeTimestamp(payload?.completedAt, '$.completedAt', { required: true }),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        state.draftBootstrapStatus = {
          ...state.draftBootstrapStatus,
          state: 'error',
          errorCode: action.payload.errorCode,
          completedAt: action.payload.completedAt,
        };
      },
    },
    resetDraftBootstrapStatus: (state) => {
      ensureDraftFoundation(state);
      state.draftBootstrapStatus = createDraftBootstrapStatus();
    },
    setDraftLocalSaving: {
      prepare: (payload) => ({
        payload: {
          storageMode: normalizeStorageMode(payload?.storageMode),
          pendingClientRevision: normalizeRevision(
            payload?.pendingClientRevision,
            '$.pendingClientRevision',
            { required: true },
          ),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreSyncTransition(state)) return;
        Object.assign(state.draftSyncStatus, {
          state: 'local_saving',
          storageMode: action.payload.storageMode,
          pendingClientRevision: action.payload.pendingClientRevision,
          errorCode: null,
        });
      },
    },
    setDraftLocalSaved: {
      prepare: (payload) => ({
        payload: {
          storageMode: normalizeStorageMode(payload?.storageMode),
          lastLocalSavedAt: normalizeTimestamp(
            payload?.lastLocalSavedAt,
            '$.lastLocalSavedAt',
            { required: true },
          ),
          confirmedClientRevision: payload?.confirmedClientRevision === undefined
            ? null
            : normalizeRevision(
              payload.confirmedClientRevision,
              '$.confirmedClientRevision',
              { required: true },
            ),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreSyncTransition(state)) return;
        const memoryOnly = action.payload.storageMode === 'memory_only';
        Object.assign(state.draftSyncStatus, {
          state: memoryOnly ? 'offline_local_only' : 'local_saved',
          storageMode: action.payload.storageMode,
          lastLocalSavedAt: action.payload.lastLocalSavedAt,
          confirmedClientRevision: action.payload.confirmedClientRevision,
          pendingClientRevision: null,
          errorCode: null,
        });
      },
    },
    setDraftServerSaving: {
      prepare: (payload) => ({
        payload: {
          pendingClientRevision: normalizeRevision(
            payload?.pendingClientRevision,
            '$.pendingClientRevision',
            { required: true },
          ),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreSyncTransition(state)) return;
        Object.assign(state.draftSyncStatus, {
          state: 'server_saving',
          pendingClientRevision: action.payload.pendingClientRevision,
          errorCode: null,
        });
      },
    },
    setDraftServerSaved: {
      prepare: (payload) => ({
        payload: {
          confirmedClientRevision: normalizeRevision(
            payload?.confirmedClientRevision,
            '$.confirmedClientRevision',
            { required: true },
          ),
          confirmedServerRevision: normalizeRevision(
            payload?.confirmedServerRevision,
            '$.confirmedServerRevision',
            { required: true },
          ),
          lastServerSavedAt: normalizeTimestamp(
            payload?.lastServerSavedAt,
            '$.lastServerSavedAt',
            { required: true },
          ),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreSyncTransition(state)) return;
        Object.assign(state.draftSyncStatus, {
          state: 'server_saved',
          ...action.payload,
          pendingClientRevision: null,
          errorCode: null,
          retryCount: 0,
        });
        state.draftContext.clientRevision = action.payload.confirmedClientRevision;
        state.draftContext.serverRevision = action.payload.confirmedServerRevision;
      },
    },
    setDraftOfflineLocalOnly: {
      prepare: (payload) => ({
        payload: {
          storageMode: normalizeStorageMode(payload?.storageMode),
          errorCode: normalizeSafeCode(payload?.errorCode, '$.errorCode'),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreSyncTransition(state)) return;
        Object.assign(state.draftSyncStatus, {
          state: 'offline_local_only',
          storageMode: action.payload.storageMode,
          errorCode: action.payload.errorCode,
        });
      },
    },
    setDraftRetrying: {
      prepare: (payload) => ({
        payload: {
          errorCode: normalizeSafeCode(payload?.errorCode, '$.errorCode'),
          retryCount: normalizeRevision(payload?.retryCount, '$.retryCount', { required: true }),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreSyncTransition(state)) return;
        Object.assign(state.draftSyncStatus, { state: 'retrying', ...action.payload });
      },
    },
    setDraftSyncError: {
      prepare: (payload) => ({
        payload: {
          errorCode: normalizeSafeCode(payload?.errorCode, '$.errorCode', { required: true }),
          retryCount: normalizeRevision(payload?.retryCount, '$.retryCount', { required: true }),
        },
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreSyncTransition(state)) return;
        Object.assign(state.draftSyncStatus, { state: 'error', ...action.payload });
      },
    },
    setDraftSubmitted: {
      prepare: (payload) => ({ payload: normalizeSubmittedReceipt(payload) }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        state.draftContext.draftStatus = 'submitted';
        state.draftSyncStatus = {
          ...state.draftSyncStatus,
          state: 'submitted',
          errorCode: null,
          pendingClientRevision: null,
        };
        state.submittedReceipt = action.payload;
      },
    },
    resetDraftSyncStatus: (state) => {
      ensureDraftFoundation(state);
      state.draftSyncStatus = createDraftSyncStatus();
    },
    setCurrentQuestionId: {
      prepare: (payload) => ({
        payload: normalizeNullableString(payload, '$.currentQuestionId'),
      }),
      reducer: (state, action) => {
        const prepared = attempt(() => normalizeNullableString(action.payload, '$.currentQuestionId'));
        if (prepared.valid) state.currentQuestionId = prepared.value;
      },
    },
    setLastChangedQuestionId: {
      prepare: (payload) => ({
        payload: normalizeNullableString(payload, '$.lastChangedQuestionId'),
      }),
      reducer: (state, action) => {
        const prepared = attempt(() => normalizeNullableString(
          action.payload,
          '$.lastChangedQuestionId',
        ));
        if (prepared.valid) state.lastChangedQuestionId = prepared.value;
      },
    },
    setFieldChangeMetadata: {
      prepare: (payload) => ({ payload: normalizeFieldMetadataPayload(payload) }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        const prepared = attempt(() => normalizeFieldMetadataPayload(action.payload));
        if (prepared.valid) {
          state.fieldChangeMetadata[prepared.value.fieldPath] = prepared.value.metadata;
        }
      },
    },
    setMultipleFieldChangeMetadata: {
      prepare: (payload) => ({ payload: normalizeFieldMetadataMap(payload) }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        const prepared = attempt(() => normalizeFieldMetadataMap(action.payload));
        if (prepared.valid) {
          state.fieldChangeMetadata = { ...state.fieldChangeMetadata, ...prepared.value };
        }
      },
    },
    deleteFieldChangeMetadata: {
      prepare: (payload) => ({
        payload: normalizeKey(payload?.fieldPath, '$.fieldPath'),
      }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        const prepared = attempt(() => normalizeKey(action.payload, '$.fieldPath'));
        if (prepared.valid) delete state.fieldChangeMetadata[prepared.value];
      },
    },
    clearFieldChangeMetadata: (state) => {
      ensureDraftFoundation(state);
      state.fieldChangeMetadata = {};
    },
    resetQuestionnaireState: {
      prepare: (payload = {}) => ({ payload: normalizeResetPayload(payload) }),
      reducer: (state, action) => resetQuestionnaire(state, action.payload),
    },
    resetQuestionState: {
      prepare: (payload) => ({ payload: normalizeQuestionResetPayload(payload) }),
      reducer: (state, action) => {
        ensureDraftFoundation(state);
        if (shouldIgnoreBecauseSubmitted(state)) return;
        const prepared = attempt(() => ({
          responseKeys: normalizeDeleteKeys(action.payload?.responseKeys, '$.responseKeys'),
          validationKeys: normalizeDeleteKeys(action.payload?.validationKeys, '$.validationKeys'),
          touchedKeys: normalizeDeleteKeys(action.payload?.touchedKeys, '$.touchedKeys'),
          expandedKeys: normalizeDeleteKeys(action.payload?.expandedKeys, '$.expandedKeys'),
          textValidationMetaKeys: normalizeDeleteKeys(
            action.payload?.textValidationMetaKeys,
            '$.textValidationMetaKeys',
          ),
          uiDraftScopeKeys: normalizeDeleteKeys(
            action.payload?.uiDraftScopeKeys,
            '$.uiDraftScopeKeys',
          ),
        }));
        if (!prepared.valid) return;
        for (const key of prepared.value.responseKeys) delete state.responses[key];
        for (const key of prepared.value.validationKeys) delete state.validationStatus[key];
        for (const key of prepared.value.touchedKeys) delete state.touchedQuestions[key];
        for (const key of prepared.value.expandedKeys) delete state.expandedQuestions[key];
        for (const key of prepared.value.textValidationMetaKeys) delete state.textValidationMeta[key];
        for (const key of prepared.value.uiDraftScopeKeys) delete state.uiDraftState[key];
      },
    },
  },
  extraReducers: (builder) => {
    builder.addCase(APPLY_FORM_MUTATION_ACTION_TYPE, (state, action) => {
      applyAtomicMutation(state, action.payload);
    });
    builder.addCase(LOAD_CANONICAL_DRAFT_STATE_ACTION_TYPE, (state, action) => {
      const prepared = attempt(() => {
        const canonicalState = normalizeCanonicalDraftState(action.payload?.canonicalState);
        return {
          canonicalState,
          ...normalizeHydrationOptions({
            source: action.payload?.source,
            completedAt: action.payload?.completedAt,
            namespace: action.payload?.namespace,
            lastStateHash: action.payload?.lastStateHash,
            storageMode: action.payload?.storageMode,
          }),
        };
      });
      if (!prepared.valid) return;
      const { canonicalState, source, completedAt, namespace, lastStateHash, storageMode } = prepared.value;
      state.responses = canonicalState.responses;
      state.validationStatus = canonicalState.validationStatus;
      state.touchedQuestions = canonicalState.touchedQuestions;
      state.expandedQuestions = canonicalState.expandedQuestions;
      state.textValidationMeta = canonicalState.textValidationMeta;
      state.credentials = canonicalState.credentials;
      state.uiDraftState = canonicalState.uiDraftState;
      state.fieldChangeMetadata = canonicalState.fieldChangeMetadata;
      state.currentQuestionId = canonicalState.currentQuestionId;
      state.lastChangedQuestionId = canonicalState.lastChangedQuestionId;
      state.lastMutation = canonicalState.lastMutation;
      state.draftContext = {
        draftId: canonicalState.draftId,
        sessionId: canonicalState.sessionId,
        draftStatus: canonicalState.draftStatus,
        schemaVersion: canonicalState.schemaVersion,
        clientRevision: canonicalState.clientRevision,
        serverRevision: canonicalState.serverRevision,
        sourceTabId: canonicalState.sourceTabId,
        namespace,
        restoredFrom: source,
        lastStateHash,
        ...canonicalState.identityContext,
      };
      state.draftBootstrapStatus = {
        state: 'ready',
        errorCode: null,
        startedAt: state.draftBootstrapStatus?.startedAt || null,
        completedAt,
        source,
      };
      state.draftSyncStatus = {
        ...createDraftSyncStatus(),
        state: canonicalState.draftStatus === 'submitted' ? 'submitted' : 'restored',
        storageMode,
        lastLocalSavedAt: canonicalState.savedAtClient,
        lastServerSavedAt: canonicalState.savedAtServer,
        confirmedClientRevision: canonicalState.clientRevision,
        confirmedServerRevision: canonicalState.serverRevision,
      };
      const submission = canonicalState.submission;
      state.submittedReceipt = (
        canonicalState.draftStatus === 'submitted'
        || submission.finalSubmissionId
        || submission.submittedAt
      ) ? {
          finalSubmissionId: submission.finalSubmissionId,
          submittedAt: submission.submittedAt,
          pdfAvailable: Boolean(submission.pdfSourceStateHash),
        } : null;
    });
  },
}));

export const {
  setResponse,
  setMultipleResponses,
  setValidationStatus,
  setMultipleValidationStatus,
  setTouchedQuestion,
  setExpandedQuestion,
  setAllExpanded,
  setCredentials,
  setDraftIdentityContext,
  patchDraftIdentityContext,
  resetForm,
  deleteResponse,
  initializeExpandedQuestions,
  setTextareaDirtyMeta,
  loadInitialState,
  setUiDraftState,
  patchUiDraftState,
  clearUiDraftState,
  clearAllUiDraftState,
  setDraftContext,
  patchDraftContext,
  setDraftStatus,
  setDraftRevisions,
  setDraftStateHash,
  clearDraftContext,
  setDraftBootstrapLoading,
  setDraftBootstrapReady,
  setDraftBootstrapError,
  resetDraftBootstrapStatus,
  setDraftLocalSaving,
  setDraftLocalSaved,
  setDraftServerSaving,
  setDraftServerSaved,
  setDraftOfflineLocalOnly,
  setDraftRetrying,
  setDraftSyncError,
  setDraftSubmitted,
  resetDraftSyncStatus,
  setCurrentQuestionId,
  setLastChangedQuestionId,
  setFieldChangeMetadata,
  setMultipleFieldChangeMetadata,
  deleteFieldChangeMetadata,
  clearFieldChangeMetadata,
  resetQuestionnaireState,
  resetQuestionState,
} = formSlice.actions;

export default formSlice.reducer;
