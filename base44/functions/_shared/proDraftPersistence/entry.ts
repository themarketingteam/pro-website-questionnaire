/**
 * Runtime-neutral draft persistence safety primitives.
 *
 * This shared module performs no Base44 calls, entity mutations, logging,
 * environment reads, or deployment work. Public backend functions can compose
 * these helpers later after authenticating and authorizing an exact operation.
 */

import {
  type RandomCryptoProvider,
  type SubtleCryptoProvider,
  generateOpaqueToken,
  sha256Hex,
  timingSafeEqualStrings,
  utf8Decode,
  utf8Encode,
} from '../proDraftSecurity/entry.ts';

export const PRO_DRAFT_PERSISTENCE_VERSION = 1;
export const DEFAULT_MAX_API_REQUEST_BYTES = 1024 * 1024;
export const DEFAULT_MAX_CANONICAL_STATE_BYTES = 750 * 1024;
export const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export const DRAFT_STATUS_VALUES = Object.freeze([
  'active',
  'submit_attempted',
  'submit_failed',
  'submitted',
  'cleared_superseded',
  'expired',
  'deleted',
] as const);

export const DRAFT_STATUS_TRANSITIONS = Object.freeze({
  new: Object.freeze(['active'] as const),
  active: Object.freeze([
    'active',
    'submit_attempted',
    'cleared_superseded',
    'expired',
  ] as const),
  submit_attempted: Object.freeze([
    'submit_attempted',
    'submitted',
    'submit_failed',
  ] as const),
  submit_failed: Object.freeze([
    'submit_failed',
    'submit_attempted',
    'cleared_superseded',
    'expired',
  ] as const),
  submitted: Object.freeze(['submitted'] as const),
  cleared_superseded: Object.freeze(['cleared_superseded'] as const),
  expired: Object.freeze(['expired'] as const),
  deleted: Object.freeze(['deleted'] as const),
} as const);

export const PERSISTENCE_ERROR_CODES = Object.freeze({
  INVALID_STATUS: 'PRO_DRAFT_PERSISTENCE_INVALID_STATUS',
  STATUS_TRANSITION_REJECTED: 'PRO_DRAFT_PERSISTENCE_STATUS_TRANSITION_REJECTED',
  INVALID_REVISION: 'PRO_DRAFT_PERSISTENCE_INVALID_REVISION',
  STALE_CLIENT_REVISION: 'PRO_DRAFT_PERSISTENCE_STALE_CLIENT_REVISION',
  SERVER_REVISION_MISMATCH: 'PRO_DRAFT_PERSISTENCE_SERVER_REVISION_MISMATCH',
  SAME_REVISION_DIFFERENT_HASH: 'PRO_DRAFT_PERSISTENCE_SAME_REVISION_DIFFERENT_HASH',
  IDEMPOTENCY_KEY_REUSED: 'PRO_DRAFT_PERSISTENCE_IDEMPOTENCY_KEY_REUSED',
  INVALID_STATE_HASH: 'PRO_DRAFT_PERSISTENCE_INVALID_STATE_HASH',
  INVALID_IDEMPOTENCY_KEY: 'PRO_DRAFT_PERSISTENCE_INVALID_IDEMPOTENCY_KEY',
  INVALID_MUTATION_ID: 'PRO_DRAFT_PERSISTENCE_INVALID_MUTATION_ID',
  METHOD_NOT_ALLOWED: 'PRO_DRAFT_PERSISTENCE_METHOD_NOT_ALLOWED',
  CONTENT_TYPE_UNSUPPORTED: 'PRO_DRAFT_PERSISTENCE_CONTENT_TYPE_UNSUPPORTED',
  INVALID_CONTENT_LENGTH: 'PRO_DRAFT_PERSISTENCE_INVALID_CONTENT_LENGTH',
  REQUEST_TOO_LARGE: 'PRO_DRAFT_PERSISTENCE_REQUEST_TOO_LARGE',
  JSON_MALFORMED: 'PRO_DRAFT_PERSISTENCE_JSON_MALFORMED',
  REQUEST_ABORTED: 'PRO_DRAFT_PERSISTENCE_REQUEST_ABORTED',
  CANONICAL_STATE_INVALID: 'PRO_DRAFT_PERSISTENCE_CANONICAL_STATE_INVALID',
  CANONICAL_STATE_TOO_LARGE: 'PRO_DRAFT_PERSISTENCE_CANONICAL_STATE_TOO_LARGE',
  SERIALIZATION_FAILED: 'PRO_DRAFT_PERSISTENCE_SERIALIZATION_FAILED',
  DUPLICATE_RECORD_INVALID: 'PRO_DRAFT_PERSISTENCE_DUPLICATE_RECORD_INVALID',
  CONFLICT_RECORD_INVALID: 'PRO_DRAFT_PERSISTENCE_CONFLICT_RECORD_INVALID',
  COMPATIBILITY_INPUT_INVALID: 'PRO_DRAFT_PERSISTENCE_COMPATIBILITY_INPUT_INVALID',
  RESPONSE_BODY_INVALID: 'PRO_DRAFT_PERSISTENCE_RESPONSE_BODY_INVALID',
  REQUEST_ID_INVALID: 'PRO_DRAFT_PERSISTENCE_REQUEST_ID_INVALID',
  INTERNAL_ERROR: 'PRO_DRAFT_PERSISTENCE_INTERNAL_ERROR',
  WRITE_ACCEPTED: 'PRO_DRAFT_PERSISTENCE_WRITE_ACCEPTED',
  WRITE_IDEMPOTENT: 'PRO_DRAFT_PERSISTENCE_WRITE_IDEMPOTENT',
} as const);

export type DraftLifecycleStatus = typeof DRAFT_STATUS_VALUES[number];
export type PersistenceErrorCode = typeof PERSISTENCE_ERROR_CODES[
  keyof typeof PERSISTENCE_ERROR_CODES
];
export type RevisionWriteDecision =
  | 'accept'
  | 'idempotent_success'
  | 'reject_stale_client_revision'
  | 'reject_server_revision_mismatch'
  | 'reject_same_revision_different_hash'
  | 'reject_status_transition'
  | 'reject_invalid_revision';

export type StatusTransitionOptions = Readonly<{
  idempotent?: boolean;
  preservesSubmissionIdentity?: boolean;
  metadataOnly?: boolean;
  migrationMode?: boolean;
}>;

export type RevisionWriteInput = Readonly<{
  storedClientRevision: unknown;
  storedServerRevision: unknown;
  storedStateHash: unknown;
  storedStatus: unknown;
  incomingClientRevision: unknown;
  expectedServerRevision: unknown;
  incomingStateHash: unknown;
  incomingStatus: unknown;
  idempotencyKey: unknown;
  storedIdempotencyKey: unknown;
}>;

export type RevisionWriteEvaluation = Readonly<{
  decision: RevisionWriteDecision;
  reasonCode: PersistenceErrorCode;
  idempotent: boolean;
  conflict: boolean;
  nextServerRevision: number | null;
  statusTransitionAllowed: boolean;
}>;

export type BoundedJsonBodyOptions = Readonly<{
  method?: string;
  maxBytes?: number;
}>;

export type DuplicateDraftRecord = Readonly<Record<string, unknown>>;

export type DuplicateDraftSelection = Readonly<{
  selected: DuplicateDraftRecord | null;
  supersededCandidates: readonly DuplicateDraftRecord[];
  warnings: readonly string[];
}>;

export type SafeConflictProjectionOptions = Readonly<{
  includeAuthorizedCanonicalState?: boolean;
}>;

export type DraftCompatibilityOptions = Readonly<{
  stateHash: string;
  clientRevision?: number;
  serverRevision?: number;
  sourceTabId?: string | null;
  lastSyncReason?: string;
  maxCanonicalStateBytes?: number;
}>;

export type DraftCompatibilityColumns = Readonly<{
  responses_json: string;
  validation_status_json: string;
  touched_questions_json: string;
  expanded_questions_json: string;
  text_validation_meta_json: string;
  ui_draft_state_json: string;
  field_change_metadata_json: string;
  credentials_json: string;
  draft_state_json: string;
  metadata_json: string;
  userdata_json: string;
  mapped_payload_json: string;
  current_question_id: string | null;
  last_changed_question_id: string | null;
  draft_schema_version: number;
  client_revision: number;
  server_revision: number;
  state_hash: string;
  source_tab_id: string | null;
  last_sync_reason: string;
}>;

export type SafeJsonResponseOptions = Readonly<{
  status?: number;
  headers?: HeadersInit;
}>;

export type SafeErrorResponseOptions = Readonly<{
  requestId?: string;
  status?: number;
  retryable?: boolean;
  cryptoProvider?: RandomCryptoProvider;
}>;

export type ServerRequestIdOptions = Readonly<{
  generator?: () => string;
  cryptoProvider?: RandomCryptoProvider;
}>;

export type PersistenceDiagnosticsInput = Readonly<{
  error?: unknown;
  decision?: RevisionWriteDecision | null;
  status?: unknown;
  clientRevision?: unknown;
  serverRevision?: unknown;
  requestId?: unknown;
  idempotencyKey?: unknown;
  recordCount?: unknown;
  selectedPresent?: unknown;
}>;

export type SafePersistenceDiagnostics = Readonly<{
  version: number;
  maximumApiRequestBytes: number;
  maximumCanonicalStateBytes: number;
  status: DraftLifecycleStatus | null;
  clientRevision: number | null;
  serverRevision: number | null;
  decision: RevisionWriteDecision | null;
  errorCode: PersistenceErrorCode | null;
  requestId: string | null;
  idempotencyKeyFingerprint: string | null;
  recordCount: number | null;
  selectedPresent: boolean;
}>;

const STATUS_SET = new Set<DraftLifecycleStatus>(DRAFT_STATUS_VALUES);
const REVISION_DECISION_SET = new Set<RevisionWriteDecision>([
  'accept',
  'idempotent_success',
  'reject_stale_client_revision',
  'reject_server_revision_mismatch',
  'reject_same_revision_different_hash',
  'reject_status_transition',
  'reject_invalid_revision',
]);
const STATE_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const OPAQUE_MUTATION_KEY_PATTERN = /^[A-Za-z0-9_.:-]+$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/u;
const REQUEST_ID_PATTERN = /^pdrq_[A-Za-z0-9_-]{43,123}$/u;
const SAFE_REASON_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const JSON_MEDIA_TYPE_PATTERN = /^application\/(?:json|[A-Za-z0-9!#$&^_.+-]+\+json)$/iu;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const AUTHORIZATION_FIELD_NAMES = new Set([
  'recoverycode',
  'recoverycodehash',
  'recoverysession',
  'recoverysessiontoken',
  'resumetoken',
  'resumetokenhash',
  'adminrecoverygrant',
  'admingrant',
  'identitykeyhash',
  'recoveryemaillookuphash',
  'emaillookuphash',
  'draftaccesstoken',
  'accesstoken',
  'authtoken',
  'authorization',
  'password',
  'secret',
  'privatekey',
  'clientsecret',
  'devicebindinghash',
  'sessionidhash',
]);
const CANONICAL_TOP_LEVEL_FIELDS = Object.freeze([
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
] as const);
const CANONICAL_TOP_LEVEL_SET = new Set<string>(CANONICAL_TOP_LEVEL_FIELDS);
const CANONICAL_CREDENTIAL_FIELDS = new Set([
  'userId',
  'userEmail',
  'userName',
  'businessName',
  'domain',
  'domainName',
  'recoveryEmail',
]);
const CANONICAL_SUBMISSION_FIELDS = Object.freeze([
  'finalSubmissionId',
  'submittedAt',
  'submittedStateHash',
  'pdfSourceStateHash',
  'lastSubmissionErrorCode',
]);

const ERROR_STATUS: Readonly<Partial<Record<PersistenceErrorCode, number>>> =
  Object.freeze({
    [PERSISTENCE_ERROR_CODES.METHOD_NOT_ALLOWED]: 405,
    [PERSISTENCE_ERROR_CODES.CONTENT_TYPE_UNSUPPORTED]: 415,
    [PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE]: 413,
    [PERSISTENCE_ERROR_CODES.CANONICAL_STATE_TOO_LARGE]: 413,
    [PERSISTENCE_ERROR_CODES.JSON_MALFORMED]: 400,
    [PERSISTENCE_ERROR_CODES.REQUEST_ABORTED]: 400,
    [PERSISTENCE_ERROR_CODES.INVALID_CONTENT_LENGTH]: 400,
    [PERSISTENCE_ERROR_CODES.INVALID_IDEMPOTENCY_KEY]: 400,
    [PERSISTENCE_ERROR_CODES.INVALID_MUTATION_ID]: 400,
    [PERSISTENCE_ERROR_CODES.INVALID_REVISION]: 400,
    [PERSISTENCE_ERROR_CODES.INVALID_STATUS]: 400,
    [PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID]: 400,
    [PERSISTENCE_ERROR_CODES.COMPATIBILITY_INPUT_INVALID]: 400,
    [PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED]: 409,
    [PERSISTENCE_ERROR_CODES.STALE_CLIENT_REVISION]: 409,
    [PERSISTENCE_ERROR_CODES.SERVER_REVISION_MISMATCH]: 409,
    [PERSISTENCE_ERROR_CODES.SAME_REVISION_DIFFERENT_HASH]: 409,
  });

const ERROR_MESSAGES: Readonly<Record<number, string>> = Object.freeze({
  400: 'The request could not be processed.',
  405: 'The request method is not allowed.',
  409: 'The draft could not be updated because it changed.',
  413: 'The request is too large.',
  415: 'The request content type is not supported.',
  500: 'The request could not be completed.',
});

export class ProDraftPersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: PersistenceErrorCode,
    options: Readonly<{ status?: number; retryable?: boolean }> = {},
  ) {
    super('The draft persistence operation failed.');
    this.name = 'ProDraftPersistenceError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code] ?? 500;
    this.retryable = options.retryable ?? (
      code === PERSISTENCE_ERROR_CODES.REQUEST_ABORTED
      || code === PERSISTENCE_ERROR_CODES.INTERNAL_ERROR
    );
  }
}

function persistenceError(
  code: PersistenceErrorCode,
  options?: Readonly<{ status?: number; retryable?: boolean }>,
): never {
  throw new ProDraftPersistenceError(code, options);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safePropertyPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  const safe = /^[A-Za-z0-9_.-]{1,80}$/u.test(key) ? key : '<redacted>';
  return `${path}.${safe}`;
}

function normalizedFieldName(value: string): string {
  return value.replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
}

function isAuthorizationField(value: string): boolean {
  return AUTHORIZATION_FIELD_NAMES.has(normalizedFieldName(value));
}

function stableJsonValue(
  value: unknown,
  options: Readonly<{
    rejectAuthorizationFields?: boolean;
    maxDepth?: number;
    maxProperties?: number;
  }> = {},
): unknown {
  const maxDepth = options.maxDepth ?? 64;
  const maxProperties = options.maxProperties ?? 50_000;
  const ancestors = new WeakSet<object>();
  let propertyCount = 0;

  const visit = (candidate: unknown, path: string, depth: number): unknown => {
    if (depth > maxDepth) {
      return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
    }
    if (
      candidate === null
      || typeof candidate === 'string'
      || typeof candidate === 'boolean'
    ) {
      return candidate;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
      }
      return candidate;
    }
    if (typeof candidate !== 'object') {
      return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
    }
    if (ancestors.has(candidate)) {
      return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
    }
    const tag = Object.prototype.toString.call(candidate);
    if (tag !== '[object Object]' && tag !== '[object Array]') {
      return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
    }
    if (Object.getOwnPropertySymbols(candidate).length > 0) {
      return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
    }
    ancestors.add(candidate);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(candidate);
      if (Array.isArray(candidate)) {
        const extraKeys = Object.keys(candidate).filter((key) => !/^\d+$/u.test(key));
        if (extraKeys.length > 0) {
          return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
        }
        const output: unknown[] = [];
        for (let index = 0; index < candidate.length; index += 1) {
          propertyCount += 1;
          if (propertyCount > maxProperties) {
            return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
          }
          const descriptor = descriptors[index];
          if (!descriptor || descriptor.get || descriptor.set) {
            return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
          }
          output.push(visit(
            descriptor.value,
            safePropertyPath(path, index),
            depth + 1,
          ));
        }
        return output;
      }

      const output: Record<string, unknown> = {};
      const keys = Object.keys(candidate as Record<string, unknown>).sort();
      for (const key of keys) {
        propertyCount += 1;
        if (
          propertyCount > maxProperties
          || UNSAFE_OBJECT_KEYS.has(key)
          || (options.rejectAuthorizationFields && isAuthorizationField(key))
        ) {
          return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
        }
        const descriptor = descriptors[key];
        if (!descriptor || descriptor.get || descriptor.set) {
          return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
        }
        output[key] = visit(
          descriptor.value,
          safePropertyPath(path, key),
          depth + 1,
        );
      }
      return output;
    } finally {
      ancestors.delete(candidate);
    }
  };

  return visit(value, '$', 0);
}

function stableSerialize(
  value: unknown,
  options?: Readonly<{ rejectAuthorizationFields?: boolean }>,
): string {
  try {
    const result = JSON.stringify(stableJsonValue(value, options));
    if (typeof result !== 'string') {
      return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
    }
    return result;
  } catch (error) {
    if (error instanceof ProDraftPersistenceError) throw error;
    return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function assertCanonicalStateShape(
  input: unknown,
): asserts input is Record<string, unknown> {
  if (!isPlainObject(input)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  const actualKeys = Object.keys(input).sort();
  const expectedKeys = [...CANONICAL_TOP_LEVEL_FIELDS].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || !actualKeys.every((key, index) => key === expectedKeys[index])
    || input.schemaVersion !== 4
    || input.formType !== 'pro-questionnaire'
    || !STATUS_SET.has(input.draftStatus as DraftLifecycleStatus)
    || !Number.isSafeInteger(input.clientRevision)
    || (input.clientRevision as number) < 0
    || !Number.isSafeInteger(input.serverRevision)
    || (input.serverRevision as number) < 0
    || !nullableString(input.draftId)
    || !nullableString(input.sessionId)
    || !nullableString(input.currentQuestionId)
    || !nullableString(input.lastChangedQuestionId)
    || (input.savedAtClient !== null && !validTimestamp(input.savedAtClient))
    || (input.savedAtServer !== null && !validTimestamp(input.savedAtServer))
    || (
      input.sourceTabId !== null
      && (
        typeof input.sourceTabId !== 'string'
        || !OPAQUE_ID_PATTERN.test(input.sourceTabId)
      )
    )
  ) {
    return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  for (const field of [
    'responses',
    'validationStatus',
    'touchedQuestions',
    'expandedQuestions',
    'textValidationMeta',
    'credentials',
    'identityContext',
    'uiDraftState',
    'fieldChangeMetadata',
    'submission',
    'compatibility',
  ]) {
    if (!isPlainObject(input[field])) {
      return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID);
    }
  }
  if (input.lastMutation !== null && !isPlainObject(input.lastMutation)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  if (
    Object.values(input.validationStatus as Record<string, unknown>)
      .some((value) => typeof value !== 'string')
    || Object.values(input.touchedQuestions as Record<string, unknown>)
      .some((value) => typeof value !== 'boolean')
    || Object.values(input.expandedQuestions as Record<string, unknown>)
      .some((value) => typeof value !== 'boolean')
    || Object.entries(input.credentials as Record<string, unknown>)
      .some(([key, value]) => (
        !CANONICAL_CREDENTIAL_FIELDS.has(key)
        || typeof value !== 'string'
      ))
  ) {
    return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  const submissionKeys = Object.keys(input.submission as Record<string, unknown>).sort();
  const expectedSubmissionKeys = [...CANONICAL_SUBMISSION_FIELDS].sort();
  if (
    submissionKeys.length !== expectedSubmissionKeys.length
    || !submissionKeys.every((key, index) => key === expectedSubmissionKeys[index])
    || Object.values(input.submission as Record<string, unknown>)
      .some((value) => value !== null && typeof value !== 'string')
  ) {
    return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  for (const key of actualKeys) {
    if (!CANONICAL_TOP_LEVEL_SET.has(key) || isAuthorizationField(key)) {
      return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID);
    }
  }
  try {
    stableSerialize(input, { rejectAuthorizationFields: true });
  } catch {
    return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
}

function cloneRecord(record: DuplicateDraftRecord): DuplicateDraftRecord {
  return stableJsonValue(record) as DuplicateDraftRecord;
}

function recordValue(
  record: DuplicateDraftRecord,
  ...keys: readonly string[]
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) return record[key];
  }
  return undefined;
}

function recordId(record: DuplicateDraftRecord): string | null {
  const value = recordValue(record, 'id', 'draft_id', 'draftId', 'source_record_id');
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    ? value
    : null;
}

function sortableRevision(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : -1;
}

function recordRevision(
  record: DuplicateDraftRecord,
  ...keys: readonly string[]
): number {
  for (const key of keys) {
    const value = record[key];
    const revision = sortableRevision(value);
    if (revision >= 0) return revision;
  }
  return -1;
}

function sortableTimestamp(value: unknown): number {
  if (typeof value !== 'string') return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function recordTimestamp(
  record: DuplicateDraftRecord,
  ...keys: readonly string[]
): Readonly<{ value: string | null; sortable: number }> {
  for (const key of keys) {
    const value = record[key];
    const sortable = sortableTimestamp(value);
    if (sortable !== Number.NEGATIVE_INFINITY) {
      return Object.freeze({ value: value as string, sortable });
    }
  }
  return Object.freeze({ value: null, sortable: Number.NEGATIVE_INFINITY });
}

function frozenEvaluation(
  decision: RevisionWriteDecision,
  reasonCode: PersistenceErrorCode,
  storedServerRevision: number | null,
  options: Readonly<{
    idempotent?: boolean;
    conflict?: boolean;
    increment?: boolean;
    statusTransitionAllowed?: boolean;
  }> = {},
): RevisionWriteEvaluation {
  return Object.freeze({
    decision,
    reasonCode,
    idempotent: options.idempotent ?? false,
    conflict: options.conflict ?? false,
    nextServerRevision: storedServerRevision === null
      ? null
      : options.increment
        ? storedServerRevision + 1
        : storedServerRevision,
    statusTransitionAllowed: options.statusTransitionAllowed ?? false,
  });
}

export function normalizeDraftLifecycleStatus(value: unknown): DraftLifecycleStatus {
  if (value === null || value === undefined) return 'active';
  if (typeof value !== 'string') {
    return persistenceError(PERSISTENCE_ERROR_CODES.INVALID_STATUS);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized === 'draft') return 'active';
  if (!STATUS_SET.has(normalized as DraftLifecycleStatus)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.INVALID_STATUS);
  }
  return normalized as DraftLifecycleStatus;
}

export function isDraftStatusTransitionAllowed(
  fromStatus: unknown,
  toStatus: unknown,
  options: StatusTransitionOptions = {},
): boolean {
  let to: DraftLifecycleStatus;
  try {
    to = normalizeDraftLifecycleStatus(toStatus);
  } catch {
    return false;
  }
  if (fromStatus === null || fromStatus === undefined) return to === 'active';

  let from: DraftLifecycleStatus;
  try {
    from = normalizeDraftLifecycleStatus(fromStatus);
  } catch {
    // Migration mode is deliberately reserved. It grants no undocumented edge.
    return false;
  }
  if (from === 'submitted' && to === 'submitted') {
    return options.idempotent === true
      && options.preservesSubmissionIdentity === true;
  }
  if (from === 'cleared_superseded' && to === 'cleared_superseded') {
    return options.idempotent === true && options.metadataOnly === true;
  }
  return (DRAFT_STATUS_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function assertDraftStatusTransitionAllowed(
  fromStatus: unknown,
  toStatus: unknown,
  options: StatusTransitionOptions = {},
): Readonly<{ fromStatus: DraftLifecycleStatus | null; toStatus: DraftLifecycleStatus }> {
  if (!isDraftStatusTransitionAllowed(fromStatus, toStatus, options)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED);
  }
  return Object.freeze({
    fromStatus: fromStatus === null || fromStatus === undefined
      ? null
      : normalizeDraftLifecycleStatus(fromStatus),
    toStatus: normalizeDraftLifecycleStatus(toStatus),
  });
}

export function normalizeRevision(
  value: unknown,
  options: Readonly<{ defaultValue?: number }> = {},
): number {
  if (value === null || value === undefined) {
    if (
      Number.isSafeInteger(options.defaultValue)
      && (options.defaultValue as number) >= 0
    ) {
      return options.defaultValue as number;
    }
    return persistenceError(PERSISTENCE_ERROR_CODES.INVALID_REVISION);
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return persistenceError(PERSISTENCE_ERROR_CODES.INVALID_REVISION);
  }
  return value as number;
}

export function validateIdempotencyKey(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < MIN_IDEMPOTENCY_KEY_LENGTH
    || value.length > MAX_IDEMPOTENCY_KEY_LENGTH
    || !OPAQUE_MUTATION_KEY_PATTERN.test(value)
  ) {
    return persistenceError(PERSISTENCE_ERROR_CODES.INVALID_IDEMPOTENCY_KEY);
  }
  return value;
}

export function validateMutationId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < MIN_IDEMPOTENCY_KEY_LENGTH
    || value.length > MAX_IDEMPOTENCY_KEY_LENGTH
    || !OPAQUE_MUTATION_KEY_PATTERN.test(value)
  ) {
    return persistenceError(PERSISTENCE_ERROR_CODES.INVALID_MUTATION_ID);
  }
  return value;
}

export function evaluateRevisionWrite(
  input: RevisionWriteInput,
): RevisionWriteEvaluation {
  let storedClientRevision: number;
  let storedServerRevision: number;
  let incomingClientRevision: number;
  let expectedServerRevision: number;
  try {
    storedClientRevision = normalizeRevision(input.storedClientRevision);
    storedServerRevision = normalizeRevision(input.storedServerRevision);
    incomingClientRevision = normalizeRevision(input.incomingClientRevision);
    expectedServerRevision = normalizeRevision(input.expectedServerRevision);
  } catch {
    return frozenEvaluation(
      'reject_invalid_revision',
      PERSISTENCE_ERROR_CODES.INVALID_REVISION,
      null,
    );
  }
  if (
    typeof input.incomingStateHash !== 'string'
    || !STATE_HASH_PATTERN.test(input.incomingStateHash)
    || (
      input.storedStateHash !== null
      && input.storedStateHash !== undefined
      && (
        typeof input.storedStateHash !== 'string'
        || !STATE_HASH_PATTERN.test(input.storedStateHash)
      )
    )
  ) {
    return frozenEvaluation(
      'reject_invalid_revision',
      PERSISTENCE_ERROR_CODES.INVALID_STATE_HASH,
      storedServerRevision,
    );
  }
  validateIdempotencyKey(input.idempotencyKey);
  if (input.storedIdempotencyKey !== null && input.storedIdempotencyKey !== undefined) {
    validateIdempotencyKey(input.storedIdempotencyKey);
  }

  const isNewDraft = input.storedStateHash === null || input.storedStateHash === undefined;
  if (
    isNewDraft
    && (
      storedClientRevision !== 0
      || storedServerRevision !== 0
      || (
        input.storedStatus !== null
        && input.storedStatus !== undefined
        && input.storedStatus !== ''
      )
    )
  ) {
    return frozenEvaluation(
      'reject_invalid_revision',
      PERSISTENCE_ERROR_CODES.INVALID_REVISION,
      storedServerRevision,
    );
  }
  if (isNewDraft && ![0, 1].includes(incomingClientRevision)) {
    return frozenEvaluation(
      'reject_invalid_revision',
      PERSISTENCE_ERROR_CODES.INVALID_REVISION,
      storedServerRevision,
    );
  }

  let incomingStatus: DraftLifecycleStatus;
  let storedStatus: DraftLifecycleStatus | null;
  try {
    incomingStatus = normalizeDraftLifecycleStatus(input.incomingStatus);
    storedStatus = isNewDraft ? null : normalizeDraftLifecycleStatus(input.storedStatus);
  } catch {
    return frozenEvaluation(
      'reject_status_transition',
      PERSISTENCE_ERROR_CODES.INVALID_STATUS,
      storedServerRevision,
      { conflict: true },
    );
  }

  const sameRevision = incomingClientRevision === storedClientRevision;
  const sameHash = typeof input.storedStateHash === 'string'
    && timingSafeEqualStrings(input.storedStateHash, input.incomingStateHash);
  const sameIdempotencyKey = typeof input.storedIdempotencyKey === 'string'
    && timingSafeEqualStrings(input.storedIdempotencyKey, input.idempotencyKey as string);
  const exactRepeat = sameHash && (sameRevision || sameIdempotencyKey);
  const statusTransitionAllowed = isDraftStatusTransitionAllowed(
    storedStatus,
    incomingStatus,
    {
      idempotent: exactRepeat,
      preservesSubmissionIdentity: exactRepeat,
      metadataOnly: exactRepeat,
    },
  );

  // Terminal-state protection is evaluated before ordinary revision conflicts.
  if (!statusTransitionAllowed && (
    storedStatus === 'submitted'
    || storedStatus === 'cleared_superseded'
    || storedStatus === 'expired'
    || storedStatus === 'deleted'
  )) {
    return frozenEvaluation(
      'reject_status_transition',
      PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED,
      storedServerRevision,
      { conflict: true },
    );
  }
  if (incomingClientRevision < storedClientRevision) {
    return frozenEvaluation(
      'reject_stale_client_revision',
      PERSISTENCE_ERROR_CODES.STALE_CLIENT_REVISION,
      storedServerRevision,
      { conflict: true, statusTransitionAllowed },
    );
  }
  if (sameIdempotencyKey && !sameHash) {
    return frozenEvaluation(
      'reject_same_revision_different_hash',
      PERSISTENCE_ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      storedServerRevision,
      { conflict: true, statusTransitionAllowed },
    );
  }
  if (isNewDraft) {
    if (!statusTransitionAllowed) {
      return frozenEvaluation(
        'reject_status_transition',
        PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED,
        storedServerRevision,
        { conflict: true },
      );
    }
    if (expectedServerRevision !== storedServerRevision) {
      return frozenEvaluation(
        'reject_server_revision_mismatch',
        PERSISTENCE_ERROR_CODES.SERVER_REVISION_MISMATCH,
        storedServerRevision,
        { conflict: true, statusTransitionAllowed: true },
      );
    }
    return frozenEvaluation(
      'accept',
      PERSISTENCE_ERROR_CODES.WRITE_ACCEPTED,
      storedServerRevision,
      { increment: true, statusTransitionAllowed: true },
    );
  }
  if (exactRepeat) {
    if (!statusTransitionAllowed) {
      return frozenEvaluation(
        'reject_status_transition',
        PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED,
        storedServerRevision,
        { conflict: true },
      );
    }
    return frozenEvaluation(
      'idempotent_success',
      PERSISTENCE_ERROR_CODES.WRITE_IDEMPOTENT,
      storedServerRevision,
      { idempotent: true, statusTransitionAllowed: true },
    );
  }
  if (sameRevision) {
    return frozenEvaluation(
      'reject_same_revision_different_hash',
      PERSISTENCE_ERROR_CODES.SAME_REVISION_DIFFERENT_HASH,
      storedServerRevision,
      { conflict: true, statusTransitionAllowed },
    );
  }
  if (!statusTransitionAllowed) {
    return frozenEvaluation(
      'reject_status_transition',
      PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED,
      storedServerRevision,
      { conflict: true },
    );
  }
  if (expectedServerRevision !== storedServerRevision) {
    return frozenEvaluation(
      'reject_server_revision_mismatch',
      PERSISTENCE_ERROR_CODES.SERVER_REVISION_MISMATCH,
      storedServerRevision,
      { conflict: true, statusTransitionAllowed: true },
    );
  }
  return frozenEvaluation(
    'accept',
    PERSISTENCE_ERROR_CODES.WRITE_ACCEPTED,
    storedServerRevision,
    { increment: true, statusTransitionAllowed: true },
  );
}

export function validateRequestMethod(
  requestOrMethod: Request | Readonly<{ method: string }> | string,
  expectedMethod = 'POST',
): string {
  const method = typeof requestOrMethod === 'string'
    ? requestOrMethod
    : requestOrMethod?.method;
  if (
    typeof method !== 'string'
    || method.toUpperCase() !== expectedMethod.toUpperCase()
  ) {
    return persistenceError(PERSISTENCE_ERROR_CODES.METHOD_NOT_ALLOWED);
  }
  return method.toUpperCase();
}

export function validateJsonContentType(
  requestOrContentType: Request | Readonly<{ headers: Headers }> | string,
): string {
  const raw = typeof requestOrContentType === 'string'
    ? requestOrContentType
    : requestOrContentType.headers.get('content-type') ?? '';
  const mediaType = raw.split(';', 1)[0].trim();
  if (!JSON_MEDIA_TYPE_PATTERN.test(mediaType)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.CONTENT_TYPE_UNSUPPORTED);
  }
  return mediaType.toLowerCase();
}

function boundedByteLimit(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    return persistenceError(PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE);
  }
  return value as number;
}

export async function readBoundedJsonBody(
  request: Request,
  options: BoundedJsonBodyOptions = {},
): Promise<unknown> {
  validateRequestMethod(request, options.method ?? 'POST');
  validateJsonContentType(request);
  const maxBytes = boundedByteLimit(
    options.maxBytes ?? DEFAULT_MAX_API_REQUEST_BYTES,
    DEFAULT_MAX_API_REQUEST_BYTES,
  );
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      return persistenceError(PERSISTENCE_ERROR_CODES.INVALID_CONTENT_LENGTH);
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length)) {
      return persistenceError(PERSISTENCE_ERROR_CODES.INVALID_CONTENT_LENGTH);
    }
    if (length > maxBytes) {
      return persistenceError(PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE);
    }
  }
  if (request.signal.aborted) {
    return persistenceError(PERSISTENCE_ERROR_CODES.REQUEST_ABORTED);
  }
  if (!request.body) {
    return persistenceError(PERSISTENCE_ERROR_CODES.JSON_MALFORMED);
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return persistenceError(
      request.signal.aborted
        ? PERSISTENCE_ERROR_CODES.REQUEST_ABORTED
        : PERSISTENCE_ERROR_CODES.JSON_MALFORMED,
    );
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      if (request.signal.aborted) {
        return persistenceError(PERSISTENCE_ERROR_CODES.REQUEST_ABORTED);
      }
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size rejection remains authoritative if cancellation also fails.
        }
        return persistenceError(PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ProDraftPersistenceError) throw error;
    return persistenceError(PERSISTENCE_ERROR_CODES.REQUEST_ABORTED);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The typed parse/limit result remains authoritative.
    }
  }
  if (totalBytes === 0) {
    return persistenceError(PERSISTENCE_ERROR_CODES.JSON_MALFORMED);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = utf8Decode(bytes);
  } catch {
    return persistenceError(PERSISTENCE_ERROR_CODES.JSON_MALFORMED);
  }
  try {
    return JSON.parse(text);
  } catch {
    return persistenceError(PERSISTENCE_ERROR_CODES.JSON_MALFORMED);
  }
}

export function validateCanonicalPayloadSize(
  canonicalState: unknown,
  options: Readonly<{ maxBytes?: number }> = {},
): Readonly<{ bytes: number; maxBytes: number; serialized: string }> {
  assertCanonicalStateShape(canonicalState);
  const maxBytes = boundedByteLimit(
    options.maxBytes ?? DEFAULT_MAX_CANONICAL_STATE_BYTES,
    DEFAULT_MAX_CANONICAL_STATE_BYTES,
  );
  const serialized = stableSerialize(canonicalState, {
    rejectAuthorizationFields: true,
  });
  const bytes = utf8Encode(serialized).byteLength;
  if (bytes > maxBytes) {
    return persistenceError(PERSISTENCE_ERROR_CODES.CANONICAL_STATE_TOO_LARGE);
  }
  return Object.freeze({ bytes, maxBytes, serialized });
}

export function selectCanonicalDuplicateDraft(
  records: unknown,
): DuplicateDraftSelection {
  if (!Array.isArray(records)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.DUPLICATE_RECORD_INVALID);
  }
  const warnings: string[] = [];
  const candidates: Array<{
    record: DuplicateDraftRecord;
    status: DraftLifecycleStatus;
    id: string;
  }> = [];

  for (const value of records) {
    if (!isPlainObject(value)) {
      if (!warnings.includes('INVALID_RECORD_EXCLUDED')) {
        warnings.push('INVALID_RECORD_EXCLUDED');
      }
      continue;
    }
    const id = recordId(value);
    let status: DraftLifecycleStatus;
    try {
      status = normalizeDraftLifecycleStatus(recordValue(value, 'status', 'draftStatus'));
    } catch {
      if (!warnings.includes('UNKNOWN_STATUS_EXCLUDED')) {
        warnings.push('UNKNOWN_STATUS_EXCLUDED');
      }
      continue;
    }
    if (!id) {
      if (!warnings.includes('MISSING_STABLE_ID_EXCLUDED')) {
        warnings.push('MISSING_STABLE_ID_EXCLUDED');
      }
      continue;
    }
    if (
      recordRevision(value, 'server_revision', 'serverRevision') < 0
      || recordRevision(value, 'client_revision', 'clientRevision') < 0
    ) {
      if (!warnings.includes('INVALID_REVISION_SORTED_LAST')) {
        warnings.push('INVALID_REVISION_SORTED_LAST');
      }
    }
    candidates.push({ record: cloneRecord(value), status, id });
  }

  const submitted = candidates.filter(({ status }) => status === 'submitted');
  const active = candidates.filter(({ status }) => (
    status === 'active'
    || status === 'submit_attempted'
    || status === 'submit_failed'
  ));
  const terminal = candidates.filter(({ status }) => (
    status === 'cleared_superseded'
    || status === 'expired'
    || status === 'deleted'
  ));
  if (submitted.length > 0 && active.length > 0) {
    warnings.push('SUBMITTED_AND_UNSUBMITTED_PARTITIONED');
  }
  if (terminal.length > 0 && (submitted.length > 0 || active.length > 0)) {
    warnings.push('SUPERSEDED_OR_TERMINAL_EXCLUDED');
  }
  const partition = submitted.length > 0
    ? submitted
    : active.length > 0
      ? active
      : terminal;

  partition.sort((left, right) => {
    const comparisons: Array<[number, number]> = [
      [
        recordRevision(left.record, 'server_revision', 'serverRevision'),
        recordRevision(right.record, 'server_revision', 'serverRevision'),
      ],
      [
        recordRevision(left.record, 'client_revision', 'clientRevision'),
        recordRevision(right.record, 'client_revision', 'clientRevision'),
      ],
      [
        recordTimestamp(left.record, 'last_saved_at', 'saved_at_server').sortable,
        recordTimestamp(right.record, 'last_saved_at', 'saved_at_server').sortable,
      ],
      [
        recordTimestamp(left.record, 'updated_date', 'source_updated_date').sortable,
        recordTimestamp(right.record, 'updated_date', 'source_updated_date').sortable,
      ],
      [
        recordTimestamp(left.record, 'created_date', 'source_created_date').sortable,
        recordTimestamp(right.record, 'created_date', 'source_created_date').sortable,
      ],
    ];
    for (const [leftValue, rightValue] of comparisons) {
      if (leftValue !== rightValue) return rightValue - leftValue;
    }
    if (left.id === right.id) return 0;
    return left.id < right.id ? 1 : -1;
  });

  const selectedEntry = partition[0] ?? null;
  const selected = selectedEntry?.record ?? null;
  const supersededCandidates = candidates
    .filter((candidate) => candidate !== selectedEntry)
    .map(({ record }) => record);
  return Object.freeze({
    selected,
    supersededCandidates: Object.freeze(supersededCandidates),
    warnings: Object.freeze([...new Set(warnings)]),
  });
}

export function buildSafeConflictProjection(
  record: unknown,
  options: SafeConflictProjectionOptions = {},
): Readonly<Record<string, unknown>> {
  if (!isPlainObject(record)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.CONFLICT_RECORD_INVALID);
  }
  let status: DraftLifecycleStatus | null = null;
  try {
    status = normalizeDraftLifecycleStatus(recordValue(record, 'status', 'draftStatus'));
  } catch {
    // Invalid status remains null in a safe projection.
  }
  const draftIdValue = recordValue(record, 'id', 'draft_id', 'draftId');
  const sessionHashValue = recordValue(record, 'session_id_hash', 'sessionIdHash');
  const stateHashValue = recordValue(record, 'state_hash', 'stateHash');
  const savedAtServer = recordTimestamp(
    record,
    'saved_at_server',
    'savedAtServer',
    'last_saved_at',
  ).value;
  const projection: Record<string, unknown> = {
    draftId: typeof draftIdValue === 'string' && OPAQUE_ID_PATTERN.test(draftIdValue)
      ? draftIdValue
      : null,
    sessionIdFingerprint: typeof sessionHashValue === 'string'
      && STATE_HASH_PATTERN.test(sessionHashValue)
      ? sessionHashValue.slice(0, 12)
      : null,
    status,
    clientRevision: recordRevision(record, 'client_revision', 'clientRevision') >= 0
      ? recordRevision(record, 'client_revision', 'clientRevision')
      : null,
    serverRevision: recordRevision(record, 'server_revision', 'serverRevision') >= 0
      ? recordRevision(record, 'server_revision', 'serverRevision')
      : null,
    stateHash: typeof stateHashValue === 'string' && STATE_HASH_PATTERN.test(stateHashValue)
      ? stateHashValue
      : null,
    savedAtServer,
  };

  if (options.includeAuthorizedCanonicalState === true) {
    const source = recordValue(record, 'canonicalState', 'draft_state_json');
    let canonicalState: unknown = source;
    if (typeof source === 'string') {
      try {
        canonicalState = JSON.parse(source);
      } catch {
        return persistenceError(PERSISTENCE_ERROR_CODES.CONFLICT_RECORD_INVALID);
      }
    }
    assertCanonicalStateShape(canonicalState);
    projection.canonicalState = stableJsonValue(canonicalState, {
      rejectAuthorizationFields: true,
    });
  }
  return Object.freeze(projection);
}

export function buildDraftCompatibilityColumns(
  canonicalState: unknown,
  mappedPayload: unknown,
  options: DraftCompatibilityOptions,
): DraftCompatibilityColumns {
  assertCanonicalStateShape(canonicalState);
  if (
    !isPlainObject(mappedPayload)
    || !isPlainObject(mappedPayload.metadata)
    || !isPlainObject(mappedPayload.userdata)
    || !options
    || typeof options.stateHash !== 'string'
    || !STATE_HASH_PATTERN.test(options.stateHash)
  ) {
    return persistenceError(PERSISTENCE_ERROR_CODES.COMPATIBILITY_INPUT_INVALID);
  }
  const clientRevision = normalizeRevision(
    options.clientRevision ?? canonicalState.clientRevision,
  );
  const serverRevision = normalizeRevision(
    options.serverRevision ?? canonicalState.serverRevision,
  );
  const sourceTabIdValue = options.sourceTabId ?? canonicalState.sourceTabId;
  if (
    sourceTabIdValue !== null
    && (
      typeof sourceTabIdValue !== 'string'
      || !OPAQUE_ID_PATTERN.test(sourceTabIdValue)
    )
  ) {
    return persistenceError(PERSISTENCE_ERROR_CODES.COMPATIBILITY_INPUT_INVALID);
  }
  const sourceTabId = sourceTabIdValue as string | null;
  const lastSyncReason = options.lastSyncReason ?? 'canonical_projection';
  if (!SAFE_REASON_PATTERN.test(lastSyncReason)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.COMPATIBILITY_INPUT_INVALID);
  }

  const canonical = validateCanonicalPayloadSize(canonicalState, {
    maxBytes: options.maxCanonicalStateBytes,
  });
  try {
    return Object.freeze({
      responses_json: stableSerialize(canonicalState.responses),
      validation_status_json: stableSerialize(canonicalState.validationStatus),
      touched_questions_json: stableSerialize(canonicalState.touchedQuestions),
      expanded_questions_json: stableSerialize(canonicalState.expandedQuestions),
      text_validation_meta_json: stableSerialize(canonicalState.textValidationMeta),
      ui_draft_state_json: stableSerialize(canonicalState.uiDraftState),
      field_change_metadata_json: stableSerialize(canonicalState.fieldChangeMetadata),
      credentials_json: stableSerialize(canonicalState.credentials, {
        rejectAuthorizationFields: true,
      }),
      draft_state_json: canonical.serialized,
      metadata_json: stableSerialize(mappedPayload.metadata, {
        rejectAuthorizationFields: true,
      }),
      userdata_json: stableSerialize(mappedPayload.userdata, {
        rejectAuthorizationFields: true,
      }),
      mapped_payload_json: stableSerialize(mappedPayload, {
        rejectAuthorizationFields: true,
      }),
      current_question_id: canonicalState.currentQuestionId as string | null,
      last_changed_question_id: canonicalState.lastChangedQuestionId as string | null,
      draft_schema_version: canonicalState.schemaVersion as number,
      client_revision: clientRevision,
      server_revision: serverRevision,
      state_hash: options.stateHash,
      source_tab_id: sourceTabId,
      last_sync_reason: lastSyncReason,
    });
  } catch (error) {
    if (error instanceof ProDraftPersistenceError) throw error;
    return persistenceError(PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED);
  }
}

export function buildSafeJsonResponse(
  body: unknown,
  options: SafeJsonResponseOptions | number = {},
): Response {
  const normalizedOptions = typeof options === 'number'
    ? { status: options }
    : options;
  const status = normalizedOptions.status ?? 200;
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    return persistenceError(PERSISTENCE_ERROR_CODES.RESPONSE_BODY_INVALID);
  }
  let serialized: string;
  try {
    serialized = stableSerialize(body);
  } catch {
    return persistenceError(PERSISTENCE_ERROR_CODES.RESPONSE_BODY_INVALID);
  }
  const headers = new Headers(normalizedOptions.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Content-Type', 'application/json');
  return new Response(serialized, {
    status,
    headers,
  });
}

export function createServerRequestId(
  options: ServerRequestIdOptions = {},
): string {
  const requestId = options.generator
    ? options.generator()
    : generateOpaqueToken({
      prefix: 'pdrq_',
      cryptoProvider: options.cryptoProvider,
    });
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.REQUEST_ID_INVALID);
  }
  return requestId;
}

export function buildSafeErrorResponse(
  error: unknown,
  options: SafeErrorResponseOptions = {},
): Response {
  const persistenceFailure = error instanceof ProDraftPersistenceError
    ? error
    : new ProDraftPersistenceError(PERSISTENCE_ERROR_CODES.INTERNAL_ERROR, {
      status: 500,
      retryable: true,
    });
  const requestedStatus = options.status ?? persistenceFailure.status;
  const status = Number.isSafeInteger(requestedStatus)
    && requestedStatus >= 400
    && requestedStatus <= 599
    ? requestedStatus
    : 500;
  const requestId = options.requestId ?? createServerRequestId({
    cryptoProvider: options.cryptoProvider,
  });
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return persistenceError(PERSISTENCE_ERROR_CODES.REQUEST_ID_INVALID);
  }
  return buildSafeJsonResponse({
    success: false,
    errorCode: persistenceFailure.code,
    message: ERROR_MESSAGES[status] ?? ERROR_MESSAGES[500],
    requestId,
    retryable: options.retryable ?? persistenceFailure.retryable,
  }, { status });
}

export async function getSafePersistenceDiagnostics(
  input: PersistenceDiagnosticsInput = {},
  options: Readonly<{ cryptoProvider?: SubtleCryptoProvider }> = {},
): Promise<SafePersistenceDiagnostics> {
  let status: DraftLifecycleStatus | null = null;
  try {
    if (input.status !== undefined) status = normalizeDraftLifecycleStatus(input.status);
  } catch {
    status = null;
  }
  const clientRevision = Number.isSafeInteger(input.clientRevision)
    && (input.clientRevision as number) >= 0
    ? input.clientRevision as number
    : null;
  const serverRevision = Number.isSafeInteger(input.serverRevision)
    && (input.serverRevision as number) >= 0
    ? input.serverRevision as number
    : null;
  const requestId = typeof input.requestId === 'string'
    && REQUEST_ID_PATTERN.test(input.requestId)
    ? input.requestId
    : null;
  const errorCode = input.error instanceof ProDraftPersistenceError
    ? input.error.code
    : null;
  let idempotencyKeyFingerprint: string | null = null;
  if (input.idempotencyKey !== undefined) {
    const key = validateIdempotencyKey(input.idempotencyKey);
    idempotencyKeyFingerprint = (await sha256Hex(
      key,
      options.cryptoProvider,
    )).slice(0, 12);
  }
  return Object.freeze({
    version: PRO_DRAFT_PERSISTENCE_VERSION,
    maximumApiRequestBytes: DEFAULT_MAX_API_REQUEST_BYTES,
    maximumCanonicalStateBytes: DEFAULT_MAX_CANONICAL_STATE_BYTES,
    status,
    clientRevision,
    serverRevision,
    decision: REVISION_DECISION_SET.has(input.decision as RevisionWriteDecision)
      ? input.decision as RevisionWriteDecision
      : null,
    errorCode,
    requestId,
    idempotencyKeyFingerprint,
    recordCount: Number.isSafeInteger(input.recordCount)
      && (input.recordCount as number) >= 0
      ? input.recordCount as number
      : null,
    selectedPresent: input.selectedPresent === true,
  });
}
