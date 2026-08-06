/** Runtime-neutral, fail-closed contracts for the future authoritative draft API. */

import {
  DEFAULT_MAX_API_REQUEST_BYTES,
  validateCanonicalPayloadSize,
  validateIdempotencyKey,
} from '../proDraftPersistence/entry.ts';
import { assertNoSensitiveDraftFields } from '../proDraftProjection/entry.ts';

export const PRO_DRAFT_API_VERSION = 1;
export const MAX_EVENT_BATCH_REQUEST_BYTES = 256 * 1024;
export const MAX_EVENT_BYTES = 32 * 1024;
export const MAX_EVENT_BATCH_SIZE = 50;

export const PRO_DRAFT_API_OPERATION_NAMES = Object.freeze({
  BOOTSTRAP_DRAFT: 'bootstrap_draft',
  LOAD_DRAFT: 'load_draft',
  SAVE_DRAFT: 'save_draft',
  APPEND_EVENTS: 'append_events',
} as const);

export const PRO_DRAFT_AUTHORIZATION_METHODS = Object.freeze({
  RESUME_TOKEN: 'resume_token',
  SIGNED_INVITATION: 'signed_invitation',
  RECOVERY_SESSION: 'recovery_session',
  NEW_ANONYMOUS_DRAFT: 'new_anonymous_draft',
} as const);

export const PRO_DRAFT_ACCESS_SCOPES = Object.freeze({
  READ: 'draft:read',
  WRITE: 'draft:write',
  SUBMITTED_READ: 'draft:submitted-read',
  CREATE: 'draft:create',
  EVENTS: 'draft:events',
} as const);

export const PRO_DRAFT_API_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'PRO_DRAFT_API_INVALID_REQUEST',
  UNSUPPORTED_VERSION: 'PRO_DRAFT_API_UNSUPPORTED_VERSION',
  UNKNOWN_FIELD: 'PRO_DRAFT_API_UNKNOWN_FIELD',
  AUTHORIZATION_INVALID: 'PRO_DRAFT_API_AUTHORIZATION_INVALID',
  ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED:
    'PRO_DRAFT_API_ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED',
  ASSOCIATION_INVALID: 'PRO_DRAFT_API_ASSOCIATION_INVALID',
  TEST_RUN_ID_FORBIDDEN: 'PRO_DRAFT_API_TEST_RUN_ID_FORBIDDEN',
  IDENTIFIER_INVALID: 'PRO_DRAFT_API_IDENTIFIER_INVALID',
  REVISION_INVALID: 'PRO_DRAFT_API_REVISION_INVALID',
  STATUS_INVALID: 'PRO_DRAFT_API_STATUS_INVALID',
  SYNC_REASON_INVALID: 'PRO_DRAFT_API_SYNC_REASON_INVALID',
  CANONICAL_STATE_INVALID: 'PRO_DRAFT_API_CANONICAL_STATE_INVALID',
  AUTHORIZATION_FIELD_FORBIDDEN: 'PRO_DRAFT_API_AUTHORIZATION_FIELD_FORBIDDEN',
  PAYLOAD_TOO_LARGE: 'PRO_DRAFT_API_PAYLOAD_TOO_LARGE',
  EVENT_BATCH_INVALID: 'PRO_DRAFT_API_EVENT_BATCH_INVALID',
  REQUEST_ID_INVALID: 'PRO_DRAFT_API_REQUEST_ID_INVALID',
  INTERNAL_ERROR: 'PRO_DRAFT_API_INTERNAL_ERROR',
} as const);

export type DraftApiOperation = typeof PRO_DRAFT_API_OPERATION_NAMES[
  keyof typeof PRO_DRAFT_API_OPERATION_NAMES
];
export type DraftAuthorizationMethod = typeof PRO_DRAFT_AUTHORIZATION_METHODS[
  keyof typeof PRO_DRAFT_AUTHORIZATION_METHODS
];
export type DraftAccessScope = typeof PRO_DRAFT_ACCESS_SCOPES[
  keyof typeof PRO_DRAFT_ACCESS_SCOPES
];
export type DraftApiErrorCode = typeof PRO_DRAFT_API_ERROR_CODES[
  keyof typeof PRO_DRAFT_API_ERROR_CODES
];

export interface DraftAuthorizationInput {
  readonly method: DraftAuthorizationMethod;
  readonly resumeToken?: string;
  readonly signedDraftAccessToken?: string;
  readonly recoverySessionToken?: string;
}

export interface DraftClientContext {
  readonly formType: string;
  readonly identityContextVersion: number;
  readonly associationIntent: string;
  readonly invitationId?: string;
  readonly userId?: string;
  readonly userName?: string;
  readonly businessName?: string;
  readonly domainName?: string;
  readonly recoveryEmail?: string;
  readonly recoveryEmailSource?: string;
  readonly recoveryEmailVerificationStatus?: string;
  readonly anonymousRecoveryAcknowledged: boolean;
  readonly sourceTabId?: string;
  readonly browserNamespaceFingerprint?: string;
  readonly appBuildSha?: string;
  readonly environment: string;
}

export interface BootstrapDraftRequest {
  readonly apiVersion: 1;
  readonly idempotencyKey: string;
  readonly authorization: DraftAuthorizationInput;
  readonly clientContext: DraftClientContext;
  readonly localStateSummary?: Readonly<Record<string, unknown>>;
  readonly testRunId?: string;
}

export interface LoadDraftRequest {
  readonly apiVersion: 1;
  readonly authorization: DraftAuthorizationInput;
  readonly requestedDraftId: string;
  readonly includeCanonicalState: boolean;
  readonly clientContext: DraftClientContext;
  readonly testRunId?: string;
}

export interface SaveDraftRequest {
  readonly apiVersion: 1;
  readonly authorization: DraftAuthorizationInput;
  readonly draftId: string;
  readonly expectedServerRevision: number;
  readonly idempotencyKey: string;
  readonly canonicalState: Readonly<Record<string, unknown>>;
  readonly mappedPayload?: Readonly<Record<string, unknown>>;
  readonly syncReason: string;
  readonly requestedStatus: string;
  readonly testRunId?: string;
}

export interface DraftEventInput extends Readonly<Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
}

export interface AppendEventsRequest {
  readonly apiVersion: 1;
  readonly authorization: DraftAuthorizationInput;
  readonly draftId: string;
  readonly idempotencyKey: string;
  readonly clientRevision: number;
  readonly sourceTabId?: string;
  readonly events: readonly DraftEventInput[];
  readonly testRunId?: string;
}

export interface DraftApiValidationOptions {
  readonly environment?: 'local' | 'test' | 'staging' | 'production' | 'unknown';
}

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_TEXT_PATTERN = /^[A-Za-z0-9 ._:/@+-]{1,256}$/u;
const REQUEST_ID_PATTERN = /^pdrq_[A-Za-z0-9_-]{20,123}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const ENVIRONMENTS = new Set(['local', 'test', 'staging', 'production']);
const ASSOCIATION_INTENTS = new Set([
  'new_invitation',
  'resume_current_draft',
  'changed_signed_email',
  'clear_all_replacement',
  'start_new_after_submission',
  'anonymous_start',
]);
const RECOVERY_EMAIL_SOURCES = new Set([
  'signed_invitation',
  'client_entered',
  'anonymous',
]);
const VERIFICATION_STATUSES = new Set([
  'unverified',
  'verified_signed_invitation',
]);
const SYNC_REASONS = new Set([
  'autosave',
  'manual_save',
  'bootstrap_upload',
  'submit_attempt',
  'submit_failed',
  'submitted',
  'clear_all',
  'restore',
]);
const DRAFT_STATUSES = new Set([
  'active',
  'submit_attempted',
  'submit_failed',
  'submitted',
  'cleared_superseded',
  'expired',
  'deleted',
]);
const AUTHORIZATION_KEYS = [
  'resumeToken',
  'signedDraftAccessToken',
  'recoverySessionToken',
] as const;
const FORBIDDEN_AUTHORIZATION_FIELD = /(?:recovery.?code|resume.?token|recovery.?session.?token|signed.?draft.?access.?token|signed.?invitation.?token|admin.?grant|authorization|access.?token|private.?key|client.?secret|password)/iu;

const BOOTSTRAP_KEYS = new Set([
  'apiVersion', 'idempotencyKey', 'authorization', 'clientContext',
  'localStateSummary', 'testRunId',
]);
const LOAD_KEYS = new Set([
  'apiVersion', 'authorization', 'requestedDraftId',
  'includeCanonicalState', 'clientContext', 'testRunId',
]);
const SAVE_KEYS = new Set([
  'apiVersion', 'authorization', 'draftId', 'expectedServerRevision',
  'idempotencyKey', 'canonicalState', 'mappedPayload', 'syncReason',
  'requestedStatus', 'testRunId',
]);
const APPEND_KEYS = new Set([
  'apiVersion', 'authorization', 'draftId', 'idempotencyKey',
  'clientRevision', 'sourceTabId', 'events', 'testRunId',
]);
const CLIENT_CONTEXT_KEYS = new Set([
  'formType', 'identityContextVersion', 'associationIntent', 'invitationId',
  'userId', 'userName', 'businessName', 'domainName', 'recoveryEmail',
  'recoveryEmailSource', 'recoveryEmailVerificationStatus',
  'anonymousRecoveryAcknowledged', 'sourceTabId',
  'browserNamespaceFingerprint', 'appBuildSha', 'environment',
]);
const SUMMARY_KEYS = new Set([
  'schemaVersion', 'clientRevision', 'stateHash', 'byteSize',
  'hasRecoverableState',
]);
const EVENT_KEYS = new Set([
  'eventId', 'eventType', 'questionId', 'questionType', 'mutationId',
  'value', 'valueSummary', 'valueLength', 'selectedOptionCount',
  'occurredAtClient', 'metadata',
]);

export class ProDraftApiError extends Error {
  readonly code: DraftApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: DraftApiErrorCode, status = 400, retryable = false) {
    super('The draft API request could not be processed.');
    this.name = 'ProDraftApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function apiError(
  code: DraftApiErrorCode,
  status = 400,
  retryable = false,
): never {
  throw new ProDraftApiError(code, status, retryable);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value: unknown, keys: Set<string>): Record<string, unknown> {
  if (!isPlainObject(value)) return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.UNKNOWN_FIELD);
  }
  return value;
}

function assertVersion(input: Record<string, unknown>): void {
  if (input.apiVersion !== PRO_DRAFT_API_VERSION) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.UNSUPPORTED_VERSION);
  }
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.IDENTIFIER_INVALID);
  }
  return value;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !SAFE_TEXT_PATTERN.test(value)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  return value;
}

function serializedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
}

function assertRequestSize(value: unknown, maxBytes: number): void {
  if (serializedBytes(value) > maxBytes) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.PAYLOAD_TOO_LARGE, 413);
  }
}

function assertNoAuthorizationFields(value: unknown): void {
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (visited.has(current)) return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (FORBIDDEN_AUTHORIZATION_FIELD.test(key)) {
        return apiError(PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_FIELD_FORBIDDEN);
      }
      pending.push(nested);
    }
  }
}

function validateTestRunId(
  value: unknown,
  environment: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const testRunId = requireId(value);
  if (environment !== 'test' && environment !== 'staging') {
    return apiError(PRO_DRAFT_API_ERROR_CODES.TEST_RUN_ID_FORBIDDEN);
  }
  return testRunId;
}

export function validateDraftAuthorizationInput(
  value: unknown,
): DraftAuthorizationInput {
  const input = assertExactKeys(value ?? {}, new Set(AUTHORIZATION_KEYS));
  const present = AUTHORIZATION_KEYS.filter((key) => input[key] !== undefined);
  if (present.length > 1) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID, 401);
  }
  if (present.length === 0) {
    return Object.freeze({
      method: PRO_DRAFT_AUTHORIZATION_METHODS.NEW_ANONYMOUS_DRAFT,
    });
  }
  const field = present[0];
  const token = input[field];
  if (typeof token !== 'string' || token.length < 43 || token.length > 8192) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID, 401);
  }
  const methods = {
    resumeToken: PRO_DRAFT_AUTHORIZATION_METHODS.RESUME_TOKEN,
    signedDraftAccessToken: PRO_DRAFT_AUTHORIZATION_METHODS.SIGNED_INVITATION,
    recoverySessionToken: PRO_DRAFT_AUTHORIZATION_METHODS.RECOVERY_SESSION,
  } as const;
  return Object.freeze({ method: methods[field], [field]: token });
}

export function validateDraftClientContext(value: unknown): DraftClientContext {
  const input = assertExactKeys(value, CLIENT_CONTEXT_KEYS);
  const formType = requireId(input.formType);
  if (!Number.isSafeInteger(input.identityContextVersion)
    || Number(input.identityContextVersion) < 1) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  if (typeof input.associationIntent !== 'string'
    || !ASSOCIATION_INTENTS.has(input.associationIntent)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.ASSOCIATION_INVALID);
  }
  if (typeof input.environment !== 'string'
    || !ENVIRONMENTS.has(input.environment)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  const recoveryEmail = input.recoveryEmail;
  if (recoveryEmail !== undefined
    && (typeof recoveryEmail !== 'string' || !EMAIL_PATTERN.test(recoveryEmail))) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  if (input.recoveryEmailSource !== undefined
    && (typeof input.recoveryEmailSource !== 'string'
      || !RECOVERY_EMAIL_SOURCES.has(input.recoveryEmailSource))) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.ASSOCIATION_INVALID);
  }
  if (input.recoveryEmailVerificationStatus !== undefined
    && (typeof input.recoveryEmailVerificationStatus !== 'string'
      || !VERIFICATION_STATUSES.has(input.recoveryEmailVerificationStatus))) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.ASSOCIATION_INVALID);
  }
  return Object.freeze({
    formType,
    identityContextVersion: Number(input.identityContextVersion),
    associationIntent: input.associationIntent,
    invitationId: optionalText(input.invitationId),
    userId: optionalText(input.userId),
    userName: optionalText(input.userName),
    businessName: optionalText(input.businessName),
    domainName: optionalText(input.domainName),
    recoveryEmail: recoveryEmail as string | undefined,
    recoveryEmailSource: input.recoveryEmailSource as string | undefined,
    recoveryEmailVerificationStatus:
      input.recoveryEmailVerificationStatus as string | undefined,
    anonymousRecoveryAcknowledged: input.anonymousRecoveryAcknowledged === true,
    sourceTabId: optionalText(input.sourceTabId),
    browserNamespaceFingerprint: optionalText(input.browserNamespaceFingerprint),
    appBuildSha: optionalText(input.appBuildSha),
    environment: input.environment,
  });
}

function validateLocalStateSummary(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  const input = assertExactKeys(value, SUMMARY_KEYS);
  for (const field of ['schemaVersion', 'clientRevision', 'byteSize']) {
    if (!Number.isSafeInteger(input[field]) || Number(input[field]) < 0) {
      return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
    }
  }
  if (typeof input.stateHash !== 'string' || !HASH_PATTERN.test(input.stateHash)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  if (typeof input.hasRecoverableState !== 'boolean') {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  return Object.freeze({ ...input });
}

function assertBootstrapAssociation(
  authorization: DraftAuthorizationInput,
  context: DraftClientContext,
): void {
  if (authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.NEW_ANONYMOUS_DRAFT) {
    if (!['anonymous_start', 'new_invitation'].includes(context.associationIntent)) {
      return apiError(PRO_DRAFT_API_ERROR_CODES.ASSOCIATION_INVALID);
    }
    if (!context.recoveryEmail && context.anonymousRecoveryAcknowledged !== true) {
      return apiError(
        PRO_DRAFT_API_ERROR_CODES.ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED,
      );
    }
    if (context.recoveryEmail
      && context.recoveryEmailSource !== 'client_entered') {
      return apiError(PRO_DRAFT_API_ERROR_CODES.ASSOCIATION_INVALID);
    }
  }
  if (authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.SIGNED_INVITATION
    && context.recoveryEmailSource === 'client_entered') {
    if (context.associationIntent !== 'changed_signed_email'
      || context.recoveryEmailVerificationStatus !== 'unverified') {
      return apiError(PRO_DRAFT_API_ERROR_CODES.ASSOCIATION_INVALID);
    }
  }
}

export function validateBootstrapDraftRequest(
  value: unknown,
  options: DraftApiValidationOptions = {},
): BootstrapDraftRequest {
  const input = assertExactKeys(value, BOOTSTRAP_KEYS);
  assertVersion(input);
  assertRequestSize(input, DEFAULT_MAX_API_REQUEST_BYTES);
  const authorization = validateDraftAuthorizationInput(input.authorization);
  const clientContext = validateDraftClientContext(input.clientContext);
  assertBootstrapAssociation(authorization, clientContext);
  const environment = options.environment ?? clientContext.environment;
  if (environment !== clientContext.environment) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  return Object.freeze({
    apiVersion: PRO_DRAFT_API_VERSION,
    idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
    authorization,
    clientContext,
    localStateSummary: validateLocalStateSummary(input.localStateSummary),
    testRunId: validateTestRunId(input.testRunId, environment),
  });
}

export function validateLoadDraftRequest(
  value: unknown,
  options: DraftApiValidationOptions = {},
): LoadDraftRequest {
  const input = assertExactKeys(value, LOAD_KEYS);
  assertVersion(input);
  assertRequestSize(input, DEFAULT_MAX_API_REQUEST_BYTES);
  const authorization = validateDraftAuthorizationInput(input.authorization);
  if (authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.NEW_ANONYMOUS_DRAFT) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID, 401);
  }
  const clientContext = validateDraftClientContext(input.clientContext);
  const environment = options.environment ?? clientContext.environment;
  if (environment !== clientContext.environment) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  if (input.includeCanonicalState !== undefined
    && typeof input.includeCanonicalState !== 'boolean') {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
  }
  return Object.freeze({
    apiVersion: PRO_DRAFT_API_VERSION,
    authorization,
    requestedDraftId: requireId(input.requestedDraftId),
    includeCanonicalState: input.includeCanonicalState !== false,
    clientContext,
    testRunId: validateTestRunId(input.testRunId, environment),
  });
}

export function validateSaveDraftRequest(
  value: unknown,
  options: DraftApiValidationOptions = {},
): SaveDraftRequest {
  const input = assertExactKeys(value, SAVE_KEYS);
  assertVersion(input);
  assertRequestSize(input, DEFAULT_MAX_API_REQUEST_BYTES);
  const authorization = validateDraftAuthorizationInput(input.authorization);
  if (authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.NEW_ANONYMOUS_DRAFT) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID, 401);
  }
  const draftId = requireId(input.draftId);
  if (!Number.isSafeInteger(input.expectedServerRevision)
    || Number(input.expectedServerRevision) < 0) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.REVISION_INVALID);
  }
  if (!isPlainObject(input.canonicalState)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  assertNoAuthorizationFields(input.canonicalState);
  try {
    validateCanonicalPayloadSize(input.canonicalState);
  } catch {
    return apiError(PRO_DRAFT_API_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  if (input.canonicalState.draftId !== undefined
    && input.canonicalState.draftId !== draftId) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  if (typeof input.canonicalState.sessionId !== 'string'
    || !ID_PATTERN.test(input.canonicalState.sessionId)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.CANONICAL_STATE_INVALID);
  }
  if (typeof input.syncReason !== 'string' || !SYNC_REASONS.has(input.syncReason)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.SYNC_REASON_INVALID);
  }
  if (typeof input.requestedStatus !== 'string'
    || !DRAFT_STATUSES.has(input.requestedStatus)
    || input.canonicalState.draftStatus !== input.requestedStatus) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.STATUS_INVALID);
  }
  if (input.mappedPayload !== undefined) {
    if (!isPlainObject(input.mappedPayload)) {
      return apiError(PRO_DRAFT_API_ERROR_CODES.INVALID_REQUEST);
    }
    assertNoAuthorizationFields(input.mappedPayload);
  }
  return Object.freeze({
    apiVersion: PRO_DRAFT_API_VERSION,
    authorization,
    draftId,
    expectedServerRevision: Number(input.expectedServerRevision),
    idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
    canonicalState: input.canonicalState,
    mappedPayload: input.mappedPayload as Readonly<Record<string, unknown>> | undefined,
    syncReason: input.syncReason,
    requestedStatus: input.requestedStatus,
    testRunId: validateTestRunId(input.testRunId, options.environment),
  });
}

function validateDraftEvent(value: unknown): DraftEventInput {
  const input = assertExactKeys(value, EVENT_KEYS);
  const eventId = requireId(input.eventId);
  const eventType = requireId(input.eventType);
  for (const field of ['questionId', 'questionType', 'mutationId', 'sourceTabId']) {
    if (input[field] !== undefined) optionalText(input[field]);
  }
  if (input.valueSummary !== undefined
    && (typeof input.valueSummary !== 'string'
      || input.valueSummary.length > 1024
      || /[\u0000-\u001f\u007f]/u.test(input.valueSummary))) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID);
  }
  for (const field of ['valueLength', 'selectedOptionCount']) {
    if (input[field] !== undefined
      && (!Number.isSafeInteger(input[field]) || Number(input[field]) < 0)) {
      return apiError(PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID);
    }
  }
  if (input.occurredAtClient !== undefined
    && (typeof input.occurredAtClient !== 'string'
      || Number.isNaN(Date.parse(input.occurredAtClient)))) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID);
  }
  if (input.metadata !== undefined && !isPlainObject(input.metadata)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID);
  }
  assertNoAuthorizationFields(input.metadata);
  if (serializedBytes(input) > MAX_EVENT_BYTES) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.PAYLOAD_TOO_LARGE, 413);
  }
  return Object.freeze({ ...input, eventId, eventType }) as DraftEventInput;
}

export function validateAppendEventsRequest(
  value: unknown,
  options: DraftApiValidationOptions = {},
): AppendEventsRequest {
  const input = assertExactKeys(value, APPEND_KEYS);
  assertVersion(input);
  assertRequestSize(input, MAX_EVENT_BATCH_REQUEST_BYTES);
  const authorization = validateDraftAuthorizationInput(input.authorization);
  if (authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.NEW_ANONYMOUS_DRAFT) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID, 401);
  }
  if (!Number.isSafeInteger(input.clientRevision) || Number(input.clientRevision) < 0) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.REVISION_INVALID);
  }
  if (!Array.isArray(input.events)
    || input.events.length < 1
    || input.events.length > MAX_EVENT_BATCH_SIZE) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID);
  }
  const events = Object.freeze(input.events.map(validateDraftEvent));
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID);
  }
  return Object.freeze({
    apiVersion: PRO_DRAFT_API_VERSION,
    authorization,
    draftId: requireId(input.draftId),
    idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
    clientRevision: Number(input.clientRevision),
    sourceTabId: optionalText(input.sourceTabId),
    events,
    testRunId: validateTestRunId(input.testRunId, options.environment),
  });
}

export function buildDraftApiSuccessResponse(
  operation: DraftApiOperation,
  data: unknown,
  requestId: string,
  status = 200,
): Response {
  if (!Object.values(PRO_DRAFT_API_OPERATION_NAMES).includes(operation)
    || !REQUEST_ID_PATTERN.test(requestId)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.REQUEST_ID_INVALID, 500);
  }
  try {
    assertNoSensitiveDraftFields(data);
  } catch {
    return apiError(PRO_DRAFT_API_ERROR_CODES.INTERNAL_ERROR, 500);
  }
  return new Response(JSON.stringify({
    success: true,
    apiVersion: PRO_DRAFT_API_VERSION,
    operation,
    requestId,
    data,
  }), {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'Content-Type': 'application/json',
    },
  });
}

export function buildDraftApiErrorResponse(
  error: unknown,
  requestId: string,
): Response {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return apiError(PRO_DRAFT_API_ERROR_CODES.REQUEST_ID_INVALID, 500);
  }
  const failure = error instanceof ProDraftApiError
    ? error
    : new ProDraftApiError(PRO_DRAFT_API_ERROR_CODES.INTERNAL_ERROR, 500, true);
  return new Response(JSON.stringify({
    success: false,
    apiVersion: PRO_DRAFT_API_VERSION,
    errorCode: failure.code,
    message: failure.status === 401 || failure.status === 403
      ? 'Authorization could not be verified.'
      : 'The draft request could not be processed.',
    requestId,
    retryable: failure.retryable,
  }), {
    status: failure.status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'Content-Type': 'application/json',
    },
  });
}

export function getSafeDraftApiDiagnostics(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: PRO_DRAFT_API_VERSION,
    operations: Object.freeze(Object.values(PRO_DRAFT_API_OPERATION_NAMES)),
    authorizationMethods: Object.freeze(Object.values(PRO_DRAFT_AUTHORIZATION_METHODS)),
    accessScopes: Object.freeze(Object.values(PRO_DRAFT_ACCESS_SCOPES)),
    maxRequestBytes: DEFAULT_MAX_API_REQUEST_BYTES,
    maxEventBatchRequestBytes: MAX_EVENT_BATCH_REQUEST_BYTES,
    maxEventBytes: MAX_EVENT_BYTES,
    maxEventBatchSize: MAX_EVENT_BATCH_SIZE,
    cachePolicy: 'no-store',
  });
}
