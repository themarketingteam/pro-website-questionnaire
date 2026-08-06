/** Authorized, idempotent recovery-code email delivery orchestration. */

import {
  PRO_DRAFT_API_OPERATION_NAMES,
  PRO_DRAFT_API_VERSION,
  PRO_DRAFT_AUTHORIZATION_METHODS,
  type DraftAuthorizationInput,
  ProDraftApiError,
  validateDraftAuthorizationInput,
} from '../proDraftApi/entry.ts';
import {
  AUTHORIZATION_SECRET_NAMES,
  type AuthorizationSecret,
  ProDraftAuthorizationError,
} from '../proDraftAuthorization/entry.ts';
import {
  ProDraftAuthorizationResolverError,
  authorizeDraftWrite,
} from '../proDraftAuthorizationResolver/entry.ts';
import {
  getEmailTransportConfig,
  sendTransactionalEmail,
  type InternalEmailTransportResult,
} from '../proDraftEmailTransport/entry.ts';
import { renderRecoveryCodeEmail } from '../proDraftEmailTemplates/entry.ts';
import {
  RECOVERY_CODE_VERSION,
  normalizeRecoveryCodeInput,
  normalizeRecoveryEmail,
} from '../proDraftIdentity/entry.ts';
import {
  ProDraftPersistenceError,
  buildSafeJsonResponse,
  createServerRequestId,
  readBoundedJsonBody,
  validateIdempotencyKey,
  validateJsonContentType,
  validateRequestMethod,
} from '../proDraftPersistence/entry.ts';
import {
  PRO_DRAFT_REPOSITORY_ERROR_CODES,
  type DraftRecord,
  type DraftRepository,
  ProDraftRepositoryError,
  conditionalUpdateDraftDeliveryMetadata,
  createDraftEvents,
  createDraftRepository,
  getDraftById,
} from '../proDraftRepository/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  type PurposeBoundSecret,
  hashRecoveryCode,
  hmacSha256Hex,
  timingSafeEqualStrings,
} from '../proDraftSecurity/entry.ts';
import {
  assertDurableDraftServerEnabled,
  getBackendRuntimeConfig,
} from '../proDraftRuntimeConfig/entry.ts';
import { PRO_FORM_IDEMPOTENCY_SECRET } from '../proDraftBootstrapLoad/entry.ts';
import { deliverProDraftRecoveryEmail } from '../proDraftRecoveryEmailService/entry.ts';

export const PRO_DRAFT_RECOVERY_EMAIL_DELIVERY_VERSION = 1;
export const MAX_RECOVERY_EMAIL_REQUEST_BYTES = 32 * 1024;
export const PRO_DRAFT_RECOVERY_EMAIL_MAX_ATTEMPTS =
  'PRO_DRAFT_RECOVERY_EMAIL_MAX_ATTEMPTS';
export const PRO_DRAFT_RECOVERY_EMAIL_RETRY_SECONDS =
  'PRO_DRAFT_RECOVERY_EMAIL_RETRY_SECONDS';

export const RECOVERY_EMAIL_DELIVERY_PURPOSES = Object.freeze([
  'clear_all_replacement',
  'start_new_after_submission',
  'staging_self_check',
] as const);

export const RECOVERY_EMAIL_DELIVERY_ERROR_CODES = Object.freeze({
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  PURPOSE_NOT_ALLOWED: 'PURPOSE_NOT_ALLOWED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  DELIVERY_DENIED: 'RECOVERY_EMAIL_DELIVERY_DENIED',
  DRAFT_RELATIONSHIP_INVALID: 'DRAFT_RELATIONSHIP_INVALID',
  RECOVERY_EMAIL_UNAVAILABLE: 'RECOVERY_EMAIL_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  DELIVERY_IN_PROGRESS: 'DELIVERY_IN_PROGRESS',
  RETRY_BACKOFF: 'RETRY_BACKOFF',
  MAX_ATTEMPTS: 'MAX_ATTEMPTS',
  DELIVERY_FAILED: 'RECOVERY_EMAIL_DELIVERY_FAILED',
  DELIVERY_UNCERTAIN: 'RECOVERY_EMAIL_DELIVERY_UNCERTAIN',
} as const);

export type RecoveryEmailDeliveryPurpose =
  typeof RECOVERY_EMAIL_DELIVERY_PURPOSES[number];
type RecoveryEmailDeliveryErrorCode = typeof RECOVERY_EMAIL_DELIVERY_ERROR_CODES[
  keyof typeof RECOVERY_EMAIL_DELIVERY_ERROR_CODES
];

export type RecoveryEmailDeliveryRequest = Readonly<{
  apiVersion: 1;
  authorization: DraftAuthorizationInput;
  draftId: string;
  recoveryCode: string;
  purpose: RecoveryEmailDeliveryPurpose;
  idempotencyKey: string;
  testRunId?: string;
}>;

export type RecoveryEmailDeliveryDependencies = Readonly<{
  createClientFromRequest: (request: Request) => unknown;
  getEnvironmentValue: (name: string) => string | undefined;
  createRequestId?: () => string;
  now?: () => Date;
  sendEmail?: (options: Parameters<typeof sendTransactionalEmail>[0]) =>
    Promise<InternalEmailTransportResult>;
  renderEmail?: typeof renderRecoveryCodeEmail;
}>;

type DeliverySecrets = Readonly<{
  resume: PurposeBoundSecret;
  recoveryCode: PurposeBoundSecret;
  signedInvitation: AuthorizationSecret;
  recoverySession: AuthorizationSecret;
  idempotency: string;
}>;

type RetryPolicy = Readonly<{ maxAttempts: number; retrySeconds: number }>;

const REQUEST_KEYS = new Set([
  'apiVersion',
  'authorization',
  'draftId',
  'recoveryCode',
  'purpose',
  'idempotencyKey',
  'testRunId',
]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_SECONDS = 30;
const MAX_CONFIGURED_ATTEMPTS = 10;
const MAX_CONFIGURED_RETRY_SECONDS = 3600;
const CLEAR_ALL_REASONS = new Set(['clear_all', 'clear_all_replacement']);

class RecoveryEmailDeliveryError extends Error {
  readonly code: RecoveryEmailDeliveryErrorCode;
  readonly status: number;
  readonly canRetry: boolean;
  readonly retryAfterSeconds: number;
  readonly deliveryUncertain: boolean;

  constructor(
    code: RecoveryEmailDeliveryErrorCode,
    status = 400,
    options: Readonly<{
      canRetry?: boolean;
      retryAfterSeconds?: number;
      deliveryUncertain?: boolean;
    }> = {},
  ) {
    super('Recovery email delivery could not be completed.');
    this.name = 'RecoveryEmailDeliveryError';
    this.code = code;
    this.status = status;
    this.canRetry = options.canRetry === true;
    this.retryAfterSeconds = options.retryAfterSeconds ?? 0;
    this.deliveryUncertain = options.deliveryUncertain === true;
  }
}

function fail(
  code: RecoveryEmailDeliveryErrorCode,
  status = 400,
  options: ConstructorParameters<typeof RecoveryEmailDeliveryError>[2] = {},
): never {
  throw new RecoveryEmailDeliveryError(code, status, options);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.INVALID_REQUEST);
  }
  return value;
}

function validateTestRunId(
  value: unknown,
  environment: string,
): string | undefined {
  if (value === undefined) return undefined;
  const id = requireId(value);
  if (environment === 'production') {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.INVALID_REQUEST);
  }
  return id;
}

export function validateRecoveryEmailDeliveryRequest(
  value: unknown,
  environment: string,
): RecoveryEmailDeliveryRequest {
  if (!isPlainObject(value)
    || Object.keys(value).some((key) => !REQUEST_KEYS.has(key))) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.INVALID_REQUEST);
  }
  if (value.apiVersion !== PRO_DRAFT_API_VERSION) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.INVALID_REQUEST);
  }
  if (typeof value.purpose !== 'string'
    || !RECOVERY_EMAIL_DELIVERY_PURPOSES.includes(
      value.purpose as RecoveryEmailDeliveryPurpose,
    )) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.PURPOSE_NOT_ALLOWED);
  }
  const normalizedCode = normalizeRecoveryCodeInput(value.recoveryCode);
  if (!normalizedCode.valid) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.INVALID_REQUEST);
  }
  let authorization: DraftAuthorizationInput;
  try {
    authorization = validateDraftAuthorizationInput(value.authorization);
  } catch {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  const purpose = value.purpose as RecoveryEmailDeliveryPurpose;
  if (purpose === 'staging_self_check') {
    if (environment !== 'staging'
      || authorization.method
        !== PRO_DRAFT_AUTHORIZATION_METHODS.NEW_ANONYMOUS_DRAFT) {
      return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED, 403);
    }
  } else if (authorization.method
    !== PRO_DRAFT_AUTHORIZATION_METHODS.RECOVERY_SESSION) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  return Object.freeze({
    apiVersion: PRO_DRAFT_API_VERSION,
    authorization,
    draftId: requireId(value.draftId),
    recoveryCode: normalizedCode.normalizedCode,
    purpose,
    idempotencyKey: validateIdempotencyKey(value.idempotencyKey),
    testRunId: validateTestRunId(value.testRunId, environment),
  });
}

function requireSecret(
  dependencies: RecoveryEmailDeliveryDependencies,
  name: string,
): string {
  const value = dependencies.getEnvironmentValue(name);
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength < 32) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.FEATURE_DISABLED, 503);
  }
  return value;
}

function resolveSecrets(
  dependencies: RecoveryEmailDeliveryDependencies,
): DeliverySecrets {
  return Object.freeze({
    resume: Object.freeze({
      name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
      value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RESUME_TOKEN),
    }),
    recoveryCode: Object.freeze({
      name: SECURITY_SECRET_NAMES.RECOVERY_CODE,
      value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RECOVERY_CODE),
    }),
    signedInvitation: Object.freeze({
      name: AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION,
      value: requireSecret(dependencies, AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION),
    }),
    recoverySession: Object.freeze({
      name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
      value: requireSecret(dependencies, AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION),
    }),
    idempotency: requireSecret(dependencies, PRO_FORM_IDEMPOTENCY_SECRET),
  });
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

function retryPolicy(
  dependencies: RecoveryEmailDeliveryDependencies,
): RetryPolicy {
  return Object.freeze({
    maxAttempts: boundedInteger(
      dependencies.getEnvironmentValue(PRO_DRAFT_RECOVERY_EMAIL_MAX_ATTEMPTS),
      DEFAULT_MAX_ATTEMPTS,
      1,
      MAX_CONFIGURED_ATTEMPTS,
    ),
    retrySeconds: boundedInteger(
      dependencies.getEnvironmentValue(PRO_DRAFT_RECOVERY_EMAIL_RETRY_SECONDS),
      DEFAULT_RETRY_SECONDS,
      1,
      MAX_CONFIGURED_RETRY_SECONDS,
    ),
  });
}

function requireRecordConcurrencyFields(record: DraftRecord): Readonly<{
  updatedDate: string;
  status: string;
  serverRevision: number;
}> {
  if (typeof record.updated_date !== 'string'
    || Number.isNaN(Date.parse(record.updated_date))
    || typeof record.status !== 'string'
    || !Number.isSafeInteger(record.server_revision)
    || Number(record.server_revision) < 0) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_FAILED, 500);
  }
  return Object.freeze({
    updatedDate: record.updated_date,
    status: record.status,
    serverRevision: Number(record.server_revision),
  });
}

function attemptCount(record: DraftRecord): number {
  return Number.isSafeInteger(record.recovery_email_delivery_attempt_count)
    && Number(record.recovery_email_delivery_attempt_count) >= 0
    ? Number(record.recovery_email_delivery_attempt_count)
    : 0;
}

async function authorizeAdmin(client: unknown): Promise<void> {
  if (!isPlainObject(client) || !isPlainObject(client.auth)
    || typeof client.auth.me !== 'function') {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  let user: unknown;
  try {
    user = await (client.auth.me as () => Promise<unknown>)();
  } catch {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  if (!isPlainObject(user)
    || !['admin', 'owner'].includes(String(user.role ?? ''))
    && user.isAppOwner !== true) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED, 403);
  }
}

async function authorizedDraft(
  request: RecoveryEmailDeliveryRequest,
  repository: DraftRepository,
  client: unknown,
  secrets: DeliverySecrets,
  environment: 'local' | 'test' | 'staging' | 'production',
  now: Date,
): Promise<DraftRecord> {
  if (request.purpose === 'staging_self_check') {
    await authorizeAdmin(client);
    return getDraftById(repository, request.draftId);
  }
  const resolved = await authorizeDraftWrite({
    operation: PRO_DRAFT_API_OPERATION_NAMES.SAVE_DRAFT,
    authorization: request.authorization,
    requestedDraftId: request.draftId,
  }, {
    repository,
    environment,
    formType: 'pro-questionnaire',
    grantVersion: 1,
    resumeTokenSecret: secrets.resume,
    signedInvitationSecret: secrets.signedInvitation,
    recoverySessionSecret: secrets.recoverySession,
    clock: () => Math.floor(now.getTime() / 1000),
  });
  if (!resolved.record || resolved.draftId !== request.draftId) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  return resolved.record;
}

async function requirePurposeRelationship(
  request: RecoveryEmailDeliveryRequest,
  draft: DraftRecord,
  repository: DraftRepository,
): Promise<void> {
  if (draft.id !== request.draftId || draft.status !== 'active') {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DRAFT_RELATIONSHIP_INVALID, 409);
  }
  if (request.purpose === 'staging_self_check') return;
  if (typeof draft.previous_draft_id !== 'string'
    || !ID_PATTERN.test(draft.previous_draft_id)) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DRAFT_RELATIONSHIP_INVALID, 409);
  }
  const previous = await getDraftById(repository, draft.previous_draft_id);
  if (previous.replacement_draft_id !== request.draftId) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DRAFT_RELATIONSHIP_INVALID, 409);
  }
  if (request.purpose === 'clear_all_replacement') {
    if (!Number.isSafeInteger(draft.draft_generation)
      || Number(draft.draft_generation) <= 1
      || previous.status !== 'cleared_superseded'
      || typeof previous.superseded_reason !== 'string'
      || !CLEAR_ALL_REASONS.has(previous.superseded_reason)) {
      return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DRAFT_RELATIONSHIP_INVALID, 409);
    }
  } else if (previous.status !== 'submitted') {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DRAFT_RELATIONSHIP_INVALID, 409);
  }
}

async function idempotencyHash(
  draftId: string,
  purpose: RecoveryEmailDeliveryPurpose,
  idempotencyKey: string,
  secret: string,
): Promise<string> {
  return hmacSha256Hex(
    `pro-draft:recovery-email-idempotency:v1:${draftId}:${purpose}:${idempotencyKey}`,
    secret,
  );
}

async function purposeHashConflict(
  request: RecoveryEmailDeliveryRequest,
  storedHash: unknown,
  secret: string,
): Promise<boolean> {
  if (typeof storedHash !== 'string' || !HASH_PATTERN.test(storedHash)) return false;
  for (const purpose of RECOVERY_EMAIL_DELIVERY_PURPOSES) {
    if (purpose === request.purpose) continue;
    const otherHash = await idempotencyHash(
      request.draftId,
      purpose,
      request.idempotencyKey,
      secret,
    );
    if (timingSafeEqualStrings(storedHash, otherHash)) return true;
  }
  return false;
}

function secondsUntilRetry(record: DraftRecord, now: Date, retrySeconds: number): number {
  const updated = Date.parse(String(record.updated_date ?? ''));
  if (!Number.isFinite(updated)) return retrySeconds;
  const elapsed = Math.max(0, Math.floor((now.getTime() - updated) / 1000));
  return Math.max(0, retrySeconds - elapsed);
}

function safeProviderStatus(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= 599
    ? Number(value)
    : null;
}

async function appendDeliveryEvent(
  repository: DraftRepository,
  draft: DraftRecord,
  request: RecoveryEmailDeliveryRequest,
  requestId: string,
  now: Date,
  eventType: 'recovery_email_attempted' | 'recovery_email_sent'
    | 'recovery_email_failed' | 'recovery_email_delivery_uncertain',
  metadata: Readonly<{
    attemptNumber: number;
    redirected: boolean;
    providerStatus: number | null;
    errorCode?: string;
  }>,
  environment: string,
): Promise<void> {
  const eventMetadata = Object.freeze({
    purpose: request.purpose,
    attemptNumber: metadata.attemptNumber,
    redirected: metadata.redirected,
    providerStatus: metadata.providerStatus,
    requestId,
    testRunId: request.testRunId ?? null,
    errorCode: metadata.errorCode ?? null,
  });
  await createDraftEvents(repository, [{
    session_id: draft.session_id,
    event_type: eventType,
    created_at_iso: now.toISOString(),
    draft_id: request.draftId,
    event_id: `${requestId}:${eventType}`,
    server_revision: draft.server_revision,
    event_metadata_json: JSON.stringify(eventMetadata),
    redaction_level: 'omitted',
    environment,
    ...(request.testRunId ? { test_run_id: request.testRunId } : {}),
  }]);
}

async function updateDeliveryMetadata(
  repository: DraftRepository,
  current: DraftRecord,
  changes: Readonly<Record<string, unknown>>,
): Promise<DraftRecord> {
  const concurrency = requireRecordConcurrencyFields(current);
  return conditionalUpdateDraftDeliveryMetadata(repository, {
    draftId: String(current.id),
    expectedUpdatedDate: concurrency.updatedDate,
    expectedStatus: concurrency.status,
    expectedServerRevision: concurrency.serverRevision,
    changes,
  });
}

function successResponse(
  requestId: string,
  input: Readonly<{
    delivered: boolean;
    redirected: boolean;
    suppressed: boolean;
    idempotent: boolean;
    deliveryUncertain: boolean;
    status: string;
    canRetry: boolean;
    retryAfterSeconds: number;
  }>,
): Response {
  return buildSafeJsonResponse({ success: true, requestId, ...input });
}

function safeFailure(error: unknown, requestId: string): Response {
  let failure: RecoveryEmailDeliveryError;
  if (error instanceof RecoveryEmailDeliveryError) {
    failure = error;
  } else if (error instanceof ProDraftApiError
    || error instanceof ProDraftPersistenceError) {
    failure = new RecoveryEmailDeliveryError(
      RECOVERY_EMAIL_DELIVERY_ERROR_CODES.INVALID_REQUEST,
      error.status,
    );
  } else if (error instanceof ProDraftAuthorizationResolverError
    || error instanceof ProDraftAuthorizationError) {
    failure = new RecoveryEmailDeliveryError(
      RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED,
      error instanceof ProDraftAuthorizationResolverError ? error.status : 401,
    );
  } else if (error instanceof ProDraftRepositoryError) {
    failure = new RecoveryEmailDeliveryError(
      error.code === PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_CONFLICT
        ? RECOVERY_EMAIL_DELIVERY_ERROR_CODES.IDEMPOTENCY_CONFLICT
        : RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_FAILED,
      error.code === PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_CONFLICT ? 409 : 500,
      { canRetry: error.retryable },
    );
  } else if (error instanceof Error && error.name === 'ProDraftRuntimeConfigError') {
    failure = new RecoveryEmailDeliveryError(
      RECOVERY_EMAIL_DELIVERY_ERROR_CODES.FEATURE_DISABLED,
      503,
    );
  } else {
    failure = new RecoveryEmailDeliveryError(
      RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_FAILED,
      500,
    );
  }
  const message = failure.code === RECOVERY_EMAIL_DELIVERY_ERROR_CODES.AUTHORIZATION_DENIED
    || failure.code === RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_DENIED
    ? 'Recovery email delivery could not be authorized.'
    : failure.code === RECOVERY_EMAIL_DELIVERY_ERROR_CODES.RECOVERY_EMAIL_UNAVAILABLE
      ? 'A recovery email address is unavailable for this draft.'
      : failure.status === 405
        ? 'The request method is not allowed.'
        : failure.status === 415
          ? 'The request content type is not supported.'
          : failure.status === 413
            ? 'The request is too large.'
            : 'Recovery email delivery could not be completed.';
  return buildSafeJsonResponse({
    success: false,
    requestId,
    errorCode: failure.code,
    message,
    delivered: false,
    canRetry: failure.canRetry,
    retryAfterSeconds: failure.retryAfterSeconds,
    ...(failure.deliveryUncertain ? { deliveryUncertain: true } : {}),
  }, {
    status: failure.status,
    headers: failure.status === 405 ? { Allow: 'POST' } : {},
  });
}

async function recordPreflightFailure(
  repository: DraftRepository,
  draft: DraftRecord,
  request: RecoveryEmailDeliveryRequest,
  idempotencyKeyHash: string,
  requestId: string,
  now: Date,
  environment: string,
  errorCode: string,
): Promise<void> {
  try {
    const updated = await updateDeliveryMetadata(repository, draft, {
      recovery_email_delivery_status: 'failed',
      recovery_email_delivery_error_code: errorCode,
      recovery_email_delivery_attempt_count: attemptCount(draft),
      recovery_email_delivery_idempotency_hash: idempotencyKeyHash,
      recovery_email_delivery_purpose: request.purpose,
      recovery_email_provider_message_id: '',
      recovery_email_last_request_id: requestId,
    });
    await appendDeliveryEvent(
      repository,
      updated,
      request,
      requestId,
      now,
      'recovery_email_failed',
      {
        attemptNumber: attemptCount(draft),
        redirected: false,
        providerStatus: null,
        errorCode,
      },
      environment,
    );
  } catch {
    // The original safe denial remains authoritative; no raw input is logged.
  }
}

async function executeDelivery(
  request: Request,
  requestId: string,
  dependencies: RecoveryEmailDeliveryDependencies,
): Promise<Response> {
  const runtime = assertDurableDraftServerEnabled(
    getBackendRuntimeConfig(dependencies.getEnvironmentValue),
  );
  if (runtime.environment === 'unknown') {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.FEATURE_DISABLED, 503);
  }
  const emailConfig = getEmailTransportConfig({
    envSource: dependencies.getEnvironmentValue,
    environment: runtime.environment,
  });
  if (emailConfig.mode === 'disabled'
    || !emailConfig.modeRecognized
    || emailConfig.environment !== runtime.environment
    || emailConfig.mode !== runtime.externalSideEffectsMode) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.FEATURE_DISABLED, 503);
  }
  validateRequestMethod(request, 'POST');
  validateJsonContentType(request);
  const body = await readBoundedJsonBody(request, {
    method: 'POST',
    maxBytes: MAX_RECOVERY_EMAIL_REQUEST_BYTES,
  });
  const validated = validateRecoveryEmailDeliveryRequest(body, runtime.environment);
  const client = dependencies.createClientFromRequest(request);
  const repository = createDraftRepository(client);
  const secrets = resolveSecrets(dependencies);
  const now = dependencies.now?.() ?? new Date();
  const policy = retryPolicy(dependencies);
  const draft = await authorizedDraft(
    validated,
    repository,
    client,
    secrets,
    runtime.environment,
    now,
  );
  await requirePurposeRelationship(validated, draft, repository);

  // Locally created replacement transactions use the same internal service as
  // Clear All/Start New. Legacy records retain the prior delivery path until
  // their transaction marker is migrated.
  if (draft.replacement_transaction_status === 'committed'
    && validated.purpose !== 'staging_self_check') {
    const delivered = await deliverProDraftRecoveryEmail({
      repository,
      draft,
      recoveryCode: validated.recoveryCode,
      purpose: validated.purpose,
      operationIdempotencyKey: validated.idempotencyKey,
      requestId,
      environment: runtime.environment,
      now,
      testRunId: validated.testRunId,
    }, {
      getEnvironmentValue: dependencies.getEnvironmentValue,
      sendEmail: dependencies.sendEmail,
      renderEmail: dependencies.renderEmail,
    });
    if (!delivered.attempted && !delivered.delivered) {
      return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.RECOVERY_EMAIL_UNAVAILABLE, 422);
    }
    if (delivered.delivered) {
      return successResponse(requestId, {
        delivered: true,
        redirected: delivered.redirected,
        suppressed: false,
        idempotent: delivered.idempotent,
        deliveryUncertain: delivered.deliveryUncertain,
        status: delivered.deliveryUncertain ? 'delivery_uncertain' : 'sent',
        canRetry: false,
        retryAfterSeconds: 0,
      });
    }
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_FAILED, 502, {
      canRetry: delivered.canRetry,
      deliveryUncertain: delivered.deliveryUncertain,
    });
  }

  const keyHash = await idempotencyHash(
    validated.draftId,
    validated.purpose,
    validated.idempotencyKey,
    secrets.idempotency,
  );
  const sameKey = typeof draft.recovery_email_delivery_idempotency_hash === 'string'
    && HASH_PATTERN.test(draft.recovery_email_delivery_idempotency_hash)
    && timingSafeEqualStrings(draft.recovery_email_delivery_idempotency_hash, keyHash);
  if (await purposeHashConflict(
    validated,
    draft.recovery_email_delivery_idempotency_hash,
    secrets.idempotency,
  ) || (sameKey && draft.recovery_email_delivery_purpose !== validated.purpose)) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.IDEMPOTENCY_CONFLICT, 409);
  }
  if (sameKey && draft.recovery_email_delivery_status === 'sent') {
    return successResponse(requestId, {
      delivered: true,
      redirected: runtime.environment === 'staging',
      suppressed: false,
      idempotent: true,
      deliveryUncertain: false,
      status: 'sent',
      canRetry: false,
      retryAfterSeconds: 0,
    });
  }
  if (sameKey && ['attempting', 'delivery_uncertain']
    .includes(String(draft.recovery_email_delivery_status ?? ''))) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_IN_PROGRESS, 409, {
      deliveryUncertain: true,
    });
  }
  const priorAttempts = attemptCount(draft);
  if (priorAttempts >= policy.maxAttempts) {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.MAX_ATTEMPTS, 429);
  }
  if (sameKey && draft.recovery_email_delivery_status === 'failed') {
    const retryAfterSeconds = secondsUntilRetry(draft, now, policy.retrySeconds);
    if (retryAfterSeconds > 0) {
      return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.RETRY_BACKOFF, 429, {
        canRetry: true,
        retryAfterSeconds,
      });
    }
  }

  const expectedRecoveryHash = await hashRecoveryCode(
    validated.recoveryCode,
    secrets.recoveryCode,
  );
  if (draft.id !== validated.draftId
    || draft.recovery_code_version !== RECOVERY_CODE_VERSION
    || typeof draft.recovery_code_hash !== 'string'
    || !HASH_PATTERN.test(draft.recovery_code_hash)
    || !timingSafeEqualStrings(draft.recovery_code_hash, expectedRecoveryHash)) {
    await recordPreflightFailure(
      repository,
      draft,
      validated,
      keyHash,
      requestId,
      now,
      runtime.environment,
      RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_DENIED,
    );
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_DENIED, 403);
  }
  const normalizedEmail = normalizeRecoveryEmail(draft.recovery_email);
  if (!normalizedEmail.valid) {
    await recordPreflightFailure(
      repository,
      draft,
      validated,
      keyHash,
      requestId,
      now,
      runtime.environment,
      RECOVERY_EMAIL_DELIVERY_ERROR_CODES.RECOVERY_EMAIL_UNAVAILABLE,
    );
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.RECOVERY_EMAIL_UNAVAILABLE, 422);
  }

  const currentAttempt = priorAttempts + 1;
  let attempting: DraftRecord;
  try {
    attempting = await updateDeliveryMetadata(repository, draft, {
      recovery_email_delivery_status: 'attempting',
      recovery_email_delivery_error_code: '',
      recovery_email_delivery_attempt_count: currentAttempt,
      recovery_email_delivery_idempotency_hash: keyHash,
      recovery_email_delivery_purpose: validated.purpose,
      recovery_email_provider_message_id: '',
      recovery_email_last_request_id: requestId,
    });
  } catch (error) {
    if (error instanceof ProDraftRepositoryError
      && error.code === PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_CONFLICT) {
      return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.IDEMPOTENCY_CONFLICT, 409);
    }
    throw error;
  }
  try {
    await appendDeliveryEvent(
      repository,
      attempting,
      validated,
      requestId,
      now,
      'recovery_email_attempted',
      {
        attemptNumber: currentAttempt,
        redirected: runtime.environment === 'staging',
        providerStatus: null,
      },
      runtime.environment,
    );
  } catch {
    await updateDeliveryMetadata(repository, attempting, {
      recovery_email_delivery_status: 'failed',
      recovery_email_delivery_error_code: 'RECOVERY_EMAIL_EVENT_WRITE_FAILED',
      recovery_email_delivery_attempt_count: currentAttempt,
      recovery_email_delivery_idempotency_hash: keyHash,
      recovery_email_delivery_purpose: validated.purpose,
      recovery_email_provider_message_id: '',
      recovery_email_last_request_id: requestId,
    });
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_FAILED, 500, {
      canRetry: currentAttempt < policy.maxAttempts,
      retryAfterSeconds: policy.retrySeconds,
    });
  }

  let rendered: ReturnType<typeof renderRecoveryCodeEmail>;
  try {
    rendered = (dependencies.renderEmail ?? renderRecoveryCodeEmail)({
      recoveryCode: validated.recoveryCode,
      businessDisplayName: draft.business_name,
      recoveryBaseUrl: emailConfig.recoveryBaseUrl,
      environment: runtime.environment === 'production' ? 'production' : 'staging',
      purpose: validated.purpose,
    });
  } catch {
    const failed = await updateDeliveryMetadata(repository, attempting, {
      recovery_email_delivery_status: 'failed',
      recovery_email_delivery_error_code: 'RECOVERY_EMAIL_TEMPLATE_INVALID',
      recovery_email_delivery_attempt_count: currentAttempt,
      recovery_email_delivery_idempotency_hash: keyHash,
      recovery_email_delivery_purpose: validated.purpose,
      recovery_email_provider_message_id: '',
      recovery_email_last_request_id: requestId,
    });
    await appendDeliveryEvent(
      repository,
      failed,
      validated,
      requestId,
      now,
      'recovery_email_failed',
      {
        attemptNumber: currentAttempt,
        redirected: runtime.environment === 'staging',
        providerStatus: null,
        errorCode: 'RECOVERY_EMAIL_TEMPLATE_INVALID',
      },
      runtime.environment,
    );
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_FAILED, 500, {
      canRetry: currentAttempt < policy.maxAttempts,
      retryAfterSeconds: policy.retrySeconds,
    });
  }

  const transport = await (dependencies.sendEmail ?? sendTransactionalEmail)({
    intendedRecipient: normalizedEmail.normalizedEmail,
    recipientAuthorized: true,
    subject: rendered.subject,
    textBody: rendered.textBody,
    htmlBody: rendered.htmlBody,
    requestId,
    environment: runtime.environment,
    envSource: dependencies.getEnvironmentValue,
  });
  const providerStatus = safeProviderStatus(transport.providerStatus);
  if (transport.delivered === true && transport.success === true) {
    let sent: DraftRecord;
    try {
      sent = await updateDeliveryMetadata(repository, attempting, {
        recovery_email_delivery_status: 'sent',
        last_recovery_email_sent_at: now.toISOString(),
        recovery_email_delivery_error_code: '',
        recovery_email_delivery_attempt_count: currentAttempt,
        recovery_email_delivery_idempotency_hash: keyHash,
        recovery_email_delivery_purpose: validated.purpose,
        recovery_email_provider_message_id: transport.providerMessageId ?? '',
        recovery_email_last_request_id: requestId,
      });
    } catch {
      try {
        await appendDeliveryEvent(
          repository,
          attempting,
          validated,
          requestId,
          now,
          'recovery_email_delivery_uncertain',
          {
            attemptNumber: currentAttempt,
            redirected: transport.redirected,
            providerStatus,
            errorCode: 'RECOVERY_EMAIL_SENT_METADATA_WRITE_FAILED',
          },
          runtime.environment,
        );
      } catch {
        // The public result remains value-free even if the operational event fails.
      }
      return successResponse(requestId, {
        delivered: true,
        redirected: transport.redirected,
        suppressed: false,
        idempotent: false,
        deliveryUncertain: true,
        status: 'delivery_uncertain',
        canRetry: false,
        retryAfterSeconds: 0,
      });
    }
    let eventUncertain = false;
    try {
      await appendDeliveryEvent(
        repository,
        sent,
        validated,
        requestId,
        now,
        'recovery_email_sent',
        {
          attemptNumber: currentAttempt,
          redirected: transport.redirected,
          providerStatus,
        },
        runtime.environment,
      );
    } catch {
      eventUncertain = true;
    }
    return successResponse(requestId, {
      delivered: true,
      redirected: transport.redirected,
      suppressed: false,
      idempotent: false,
      deliveryUncertain: eventUncertain,
      status: eventUncertain ? 'delivery_uncertain' : 'sent',
      canRetry: false,
      retryAfterSeconds: 0,
    });
  }

  const safeTransportCode = transport.errorCode ?? 'RECOVERY_EMAIL_PROVIDER_FAILED';
  let failed: DraftRecord;
  try {
    failed = await updateDeliveryMetadata(repository, attempting, {
      recovery_email_delivery_status: 'failed',
      recovery_email_delivery_error_code: safeTransportCode,
      recovery_email_delivery_attempt_count: currentAttempt,
      recovery_email_delivery_idempotency_hash: keyHash,
      recovery_email_delivery_purpose: validated.purpose,
      recovery_email_provider_message_id: '',
      recovery_email_last_request_id: requestId,
    });
  } catch {
    return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_FAILED, 500);
  }
  await appendDeliveryEvent(
    repository,
    failed,
    validated,
    requestId,
    now,
    'recovery_email_failed',
    {
      attemptNumber: currentAttempt,
      redirected: transport.redirected,
      providerStatus,
      errorCode: safeTransportCode,
    },
    runtime.environment,
  );
  return fail(RECOVERY_EMAIL_DELIVERY_ERROR_CODES.DELIVERY_FAILED, 502, {
    canRetry: currentAttempt < policy.maxAttempts,
    retryAfterSeconds: currentAttempt < policy.maxAttempts ? policy.retrySeconds : 0,
  });
}

export function createSendProFormDraftRecoveryCodeEmailHandler(
  dependencies: RecoveryEmailDeliveryDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestId = createServerRequestId(
      dependencies.createRequestId ? { generator: dependencies.createRequestId } : {},
    );
    try {
      return await executeDelivery(request, requestId, dependencies);
    } catch (error) {
      return safeFailure(error, requestId);
    }
  };
}

export function getSafeRecoveryEmailDeliveryDiagnostics(
  dependencies?: Pick<RecoveryEmailDeliveryDependencies, 'getEnvironmentValue'>,
): Readonly<Record<string, unknown>> {
  const policy = dependencies
    ? retryPolicy({
      createClientFromRequest: () => ({}),
      getEnvironmentValue: dependencies.getEnvironmentValue,
    })
    : { maxAttempts: DEFAULT_MAX_ATTEMPTS, retrySeconds: DEFAULT_RETRY_SECONDS };
  return Object.freeze({
    version: PRO_DRAFT_RECOVERY_EMAIL_DELIVERY_VERSION,
    maxRequestBytes: MAX_RECOVERY_EMAIL_REQUEST_BYTES,
    purposes: RECOVERY_EMAIL_DELIVERY_PURPOSES,
    manualResendEnabled: false,
    maxAttempts: policy.maxAttempts,
    retrySeconds: policy.retrySeconds,
    storesRawCode: false,
    logsRawCode: false,
    acceptsRecipientOverride: false,
    acceptsSenderOverride: false,
    changesCanonicalRevision: false,
    cachePolicy: 'no-store',
  });
}
