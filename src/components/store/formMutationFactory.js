import {
  DRAFT_STATE_ERROR_CODES,
  DraftStateValidationError,
  createEmptyCanonicalDraftState,
  normalizeCanonicalDraftState,
  sanitizeDraftSerializableValue,
} from '@/lib/questionnaireDraftState';

export const APPLY_FORM_MUTATION_ACTION_TYPE = 'form/applyFormMutation';

export const DRAFT_MUTATION_REASONS = Object.freeze([
  'response_change',
  'validation_change',
  'touch_change',
  'expanded_change',
  'ui_draft_change',
  'credentials_change',
  'question_reset',
  'conditional_cleanup',
  'clear_all',
  'bootstrap',
  'restore',
  'submission_attempt',
  'submission_failure',
  'submission_success',
  'system',
]);

const MUTATION_REASON_SET = new Set(DRAFT_MUTATION_REASONS);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PAYLOAD_FIELDS = new Set([
  'setResponses',
  'deleteResponseKeys',
  'setValidationStatus',
  'deleteValidationKeys',
  'setTouchedQuestions',
  'deleteTouchedKeys',
  'setExpandedQuestions',
  'deleteExpandedKeys',
  'setTextValidationMeta',
  'deleteTextValidationMetaKeys',
  'setUiDraftState',
  'deleteUiDraftStateKeys',
  'setCredentials',
  'currentQuestionId',
  'lastChangedQuestionId',
  'mutationMetadata',
]);

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

const normalizeKey = (value, path) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) fail(path);
  const key = value.trim();
  if (FORBIDDEN_KEYS.has(key)) fail(path, DRAFT_STATE_ERROR_CODES.UNSAFE_PROPERTY_KEY);
  return key;
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

const normalizeBooleanMap = (value, path) => normalizeMap(value, path, (entry, entryPath) => {
  if (typeof entry !== 'boolean') fail(entryPath);
  return entry;
});

const normalizeStringMap = (value, path) => normalizeMap(value, path, (entry, entryPath) => {
  if (typeof entry !== 'string') fail(entryPath);
  return entry;
});

const normalizeDeleteKeys = (value, path) => {
  if (!Array.isArray(value)) fail(path);
  return [...new Set(value.map((key, index) => normalizeKey(key, `${path}[${index}]`)))];
};

const normalizeUiDraftMap = (value) => normalizeCanonicalDraftState({
  ...createEmptyCanonicalDraftState(),
  uiDraftState: value,
}).uiDraftState;

const normalizeCredentials = (value) => normalizeCanonicalDraftState({
  ...createEmptyCanonicalDraftState(),
  credentials: value,
}).credentials;

const normalizeQuestionId = (value, field) => normalizeCanonicalDraftState({
  ...createEmptyCanonicalDraftState(),
  [field]: value,
})[field];

const normalizeRevision = (value, path) => {
  if (!Number.isSafeInteger(value) || value < 0) fail(path);
  return value;
};

const normalizeMutationMetadata = (value) => {
  if (!isPlainObject(value)) fail('$.mutationMetadata');
  const allowed = new Set([
    'mutationId',
    'mutationType',
    'reason',
    'changedAtClient',
    'sourceTabId',
    'baseServerRevision',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`$.mutationMetadata.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
  }
  if (!MUTATION_REASON_SET.has(value.reason)) fail('$.mutationMetadata.reason');
  if (typeof value.mutationType !== 'string' || !value.mutationType.trim()) {
    fail('$.mutationMetadata.mutationType');
  }
  const normalized = normalizeCanonicalDraftState({
    ...createEmptyCanonicalDraftState(),
    sourceTabId: value.sourceTabId,
    lastMutation: {
      mutationId: value.mutationId,
      mutationType: value.mutationType,
      reason: value.reason,
      changedAtClient: value.changedAtClient,
      sourceTabId: value.sourceTabId,
    },
  });
  if (!normalized.lastMutation.mutationId) fail('$.mutationMetadata.mutationId');
  if (!normalized.lastMutation.changedAtClient) fail('$.mutationMetadata.changedAtClient');
  return {
    ...normalized.lastMutation,
    baseServerRevision: normalizeRevision(
      value.baseServerRevision,
      '$.mutationMetadata.baseServerRevision',
    ),
  };
};

const randomHex = (length, random) => {
  let output = '';
  while (output.length < length) {
    output += Math.floor(random() * 0x100000000).toString(16).padStart(8, '0');
  }
  return output.slice(0, length);
};

export const createMutationId = (dependencies = {}) => {
  const cryptoProvider = Object.hasOwn(dependencies, 'crypto')
    ? dependencies.crypto
    : globalThis.crypto;
  if (typeof cryptoProvider?.randomUUID === 'function') {
    return cryptoProvider.randomUUID().replace(/-/g, '');
  }
  if (typeof cryptoProvider?.getRandomValues === 'function') {
    const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  const random = dependencies.random ?? Math.random;
  if (typeof random !== 'function') fail('$.dependencies.random');
  return randomHex(32, random);
};

export const createDraftMutationMetadata = (input = {}, dependencies = {}) => {
  if (!isPlainObject(input)) fail('$.mutationMetadata');
  const now = dependencies.now ?? Date.now;
  if (typeof now !== 'function') fail('$.dependencies.now');
  const timestamp = new Date(now());
  if (Number.isNaN(timestamp.getTime())) fail('$.dependencies.now');
  return normalizeMutationMetadata({
    mutationId: input.mutationId || createMutationId(dependencies),
    mutationType: input.mutationType,
    reason: input.reason,
    changedAtClient: input.changedAtClient || timestamp.toISOString(),
    sourceTabId: input.sourceTabId ?? null,
    baseServerRevision: input.baseServerRevision ?? 0,
  });
};

export const prepareFormMutationPayload = (input) => {
  if (!isPlainObject(input)) fail('$');
  for (const key of Object.keys(input)) {
    if (!PAYLOAD_FIELDS.has(key)) fail(`$.${key}`, DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
  }
  const output = {
    mutationMetadata: normalizeMutationMetadata(input.mutationMetadata),
  };
  if (Object.hasOwn(input, 'setResponses')) {
    output.setResponses = normalizeSerializableMap(input.setResponses, '$.setResponses');
  }
  if (Object.hasOwn(input, 'deleteResponseKeys')) {
    output.deleteResponseKeys = normalizeDeleteKeys(input.deleteResponseKeys, '$.deleteResponseKeys');
  }
  if (Object.hasOwn(input, 'setValidationStatus')) {
    output.setValidationStatus = normalizeStringMap(
      input.setValidationStatus,
      '$.setValidationStatus',
    );
  }
  if (Object.hasOwn(input, 'deleteValidationKeys')) {
    output.deleteValidationKeys = normalizeDeleteKeys(
      input.deleteValidationKeys,
      '$.deleteValidationKeys',
    );
  }
  if (Object.hasOwn(input, 'setTouchedQuestions')) {
    output.setTouchedQuestions = normalizeBooleanMap(
      input.setTouchedQuestions,
      '$.setTouchedQuestions',
    );
  }
  if (Object.hasOwn(input, 'deleteTouchedKeys')) {
    output.deleteTouchedKeys = normalizeDeleteKeys(input.deleteTouchedKeys, '$.deleteTouchedKeys');
  }
  if (Object.hasOwn(input, 'setExpandedQuestions')) {
    output.setExpandedQuestions = normalizeBooleanMap(
      input.setExpandedQuestions,
      '$.setExpandedQuestions',
    );
  }
  if (Object.hasOwn(input, 'deleteExpandedKeys')) {
    output.deleteExpandedKeys = normalizeDeleteKeys(
      input.deleteExpandedKeys,
      '$.deleteExpandedKeys',
    );
  }
  if (Object.hasOwn(input, 'setTextValidationMeta')) {
    output.setTextValidationMeta = normalizeSerializableMap(
      input.setTextValidationMeta,
      '$.setTextValidationMeta',
    );
  }
  if (Object.hasOwn(input, 'deleteTextValidationMetaKeys')) {
    output.deleteTextValidationMetaKeys = normalizeDeleteKeys(
      input.deleteTextValidationMetaKeys,
      '$.deleteTextValidationMetaKeys',
    );
  }
  if (Object.hasOwn(input, 'setUiDraftState')) {
    output.setUiDraftState = normalizeUiDraftMap(input.setUiDraftState);
  }
  if (Object.hasOwn(input, 'deleteUiDraftStateKeys')) {
    output.deleteUiDraftStateKeys = normalizeDeleteKeys(
      input.deleteUiDraftStateKeys,
      '$.deleteUiDraftStateKeys',
    );
  }
  if (Object.hasOwn(input, 'setCredentials')) {
    output.setCredentials = normalizeCredentials(input.setCredentials);
  }
  if (Object.hasOwn(input, 'currentQuestionId')) {
    output.currentQuestionId = normalizeQuestionId(input.currentQuestionId, 'currentQuestionId');
  }
  if (Object.hasOwn(input, 'lastChangedQuestionId')) {
    output.lastChangedQuestionId = normalizeQuestionId(
      input.lastChangedQuestionId,
      'lastChangedQuestionId',
    );
  }
  return output;
};

export const createApplyFormMutationAction = (input) => ({
  type: APPLY_FORM_MUTATION_ACTION_TYPE,
  payload: prepareFormMutationPayload(input),
});

createApplyFormMutationAction.type = APPLY_FORM_MUTATION_ACTION_TYPE;

export const getSafeMutationDiagnostics = (value) => {
  const input = value?.payload || value;
  const count = (field) => (isPlainObject(input?.[field]) ? Object.keys(input[field]).length : 0);
  const listCount = (field) => (Array.isArray(input?.[field]) ? input[field].length : 0);
  return Object.freeze({
    valid: !(value instanceof Error),
    errorCode: value?.code || null,
    responseSetCount: count('setResponses'),
    responseDeleteCount: listCount('deleteResponseKeys'),
    validationSetCount: count('setValidationStatus'),
    uiDraftSetCount: count('setUiDraftState'),
    uiDraftDeleteCount: listCount('deleteUiDraftStateKeys'),
    hasCredentialsChange: Object.hasOwn(input || {}, 'setCredentials'),
    hasCurrentQuestionChange: Object.hasOwn(input || {}, 'currentQuestionId'),
    hasLastChangedQuestionChange: Object.hasOwn(input || {}, 'lastChangedQuestionId'),
    hasMutationId: typeof input?.mutationMetadata?.mutationId === 'string',
  });
};
