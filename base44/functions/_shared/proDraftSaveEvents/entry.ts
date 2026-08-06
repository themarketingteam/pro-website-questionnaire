/** Authoritative, injectable orchestration for draft saves and event appends. */

import {
  MAX_EVENT_BATCH_REQUEST_BYTES,
  PRO_DRAFT_API_OPERATION_NAMES,
  type AppendEventsRequest,
  type DraftEventInput,
  type SaveDraftRequest,
  ProDraftApiError,
  validateAppendEventsRequest,
  validateSaveDraftRequest,
} from '../proDraftApi/entry.ts';
import {
  AUTHORIZATION_SECRET_NAMES,
  type AuthorizationSecret,
  ProDraftAuthorizationError,
} from '../proDraftAuthorization/entry.ts';
import {
  ProDraftAuthorizationResolverError,
  authorizeDraftEvents,
  authorizeDraftWrite,
} from '../proDraftAuthorizationResolver/entry.ts';
import {
  DEFAULT_MAX_API_REQUEST_BYTES,
  PERSISTENCE_ERROR_CODES,
  ProDraftPersistenceError,
  buildDraftCompatibilityColumns,
  buildSafeConflictProjection,
  buildSafeJsonResponse,
  createServerRequestId,
  evaluateRevisionWrite,
  normalizeDraftLifecycleStatus,
  readBoundedJsonBody,
  validateJsonContentType,
  validateRequestMethod,
} from '../proDraftPersistence/entry.ts';
import {
  assertNoSensitiveDraftFields,
  projectActiveDraftForAuthorizedClient,
  projectSubmittedDraftForAuthorizedClient,
} from '../proDraftProjection/entry.ts';
import {
  PRO_DRAFT_REPOSITORY_ERROR_CODES,
  type DraftRecord,
  type DraftRepository,
  ProDraftRepositoryError,
  conditionalUpdateDraftRecord,
  createDraftEvents,
  createDraftRepository,
  findDraftEventsByEventIds,
  getDraftById,
  updateDraftRecord,
} from '../proDraftRepository/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  type PurposeBoundSecret,
  hmacSha256Hex,
  sha256Hex,
} from '../proDraftSecurity/entry.ts';
import {
  assertDurableDraftServerEnabled,
  getBackendRuntimeConfig,
} from '../proDraftRuntimeConfig/entry.ts';
import {
  PRO_FORM_IDEMPOTENCY_SECRET,
  calculateCanonicalDraftStateHash,
  reconstructCanonicalDraftRecord,
} from '../proDraftBootstrapLoad/entry.ts';

export const PRO_DRAFT_SAVE_EVENTS_VERSION = 1;

export const SAVE_EVENTS_ERROR_CODES = Object.freeze({
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_AUTHORIZATION: 'INVALID_AUTHORIZATION',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  DRAFT_SUPERSEDED: 'DRAFT_SUPERSEDED',
  DRAFT_EXPIRED: 'DRAFT_EXPIRED',
  DRAFT_DELETED: 'DRAFT_DELETED',
  WRITE_SCOPE_REQUIRED: 'WRITE_SCOPE_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  STATUS_TRANSITION_INVALID: 'STATUS_TRANSITION_INVALID',
  CANONICAL_STATE_ERROR: 'CANONICAL_STATE_ERROR',
  CONDITIONAL_UPDATE_UNSUPPORTED: 'CONDITIONAL_UPDATE_UNSUPPORTED',
  DRAFT_SAVE_FAILED: 'DRAFT_SAVE_FAILED',
  EVENT_BATCH_FAILED: 'EVENT_BATCH_FAILED',
} as const);

type ErrorCode = typeof SAVE_EVENTS_ERROR_CODES[keyof typeof SAVE_EVENTS_ERROR_CODES];
type Operation = 'save' | 'events';

export type SaveEventsFunctionDependencies = Readonly<{
  createClientFromRequest: (request: Request) => unknown;
  getEnvironmentValue: (name: string) => string | undefined;
  createRequestId?: () => string;
  now?: () => Date;
}>;

type Secrets = Readonly<{
  resume: PurposeBoundSecret;
  signedInvitation: AuthorizationSecret;
  recoverySession: AuthorizationSecret;
  idempotency: string;
}>;

class SaveEventsFunctionError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, status = 400, retryable = false) {
    super('The draft operation could not be completed.');
    this.name = 'SaveEventsFunctionError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function fail(code: ErrorCode, status = 400, retryable = false): never {
  throw new SaveEventsFunctionError(code, status, retryable);
}

function requireSecret(
  dependencies: SaveEventsFunctionDependencies,
  name: string,
): string {
  const value = dependencies.getEnvironmentValue(name);
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength < 32) {
    return fail(SAVE_EVENTS_ERROR_CODES.FEATURE_DISABLED, 503, true);
  }
  return value;
}

function resolveSecrets(dependencies: SaveEventsFunctionDependencies): Secrets {
  return Object.freeze({
    resume: Object.freeze({
      name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
      value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RESUME_TOKEN),
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

function resolverOptions(
  repository: DraftRepository,
  environment: 'local' | 'test' | 'staging' | 'production',
  secrets: Secrets,
  now: Date,
) {
  return {
    repository,
    environment,
    formType: 'pro-questionnaire',
    grantVersion: 1,
    resumeTokenSecret: secrets.resume,
    signedInvitationSecret: secrets.signedInvitation,
    recoverySessionSecret: secrets.recoverySession,
    clock: () => Math.floor(now.getTime() / 1000),
  } as const;
}

function recordStatus(record: DraftRecord): string {
  let status: string;
  try {
    status = normalizeDraftLifecycleStatus(record.status);
  } catch {
    return fail(SAVE_EVENTS_ERROR_CODES.DRAFT_SAVE_FAILED, 500, true);
  }
  if (status === 'cleared_superseded') {
    return fail(SAVE_EVENTS_ERROR_CODES.DRAFT_SUPERSEDED, 409);
  }
  if (status === 'expired') return fail(SAVE_EVENTS_ERROR_CODES.DRAFT_EXPIRED, 410);
  if (status === 'deleted') return fail(SAVE_EVENTS_ERROR_CODES.DRAFT_DELETED, 410);
  return status;
}

function normalizedRecord(record: DraftRecord): DraftRecord {
  try {
    return reconstructCanonicalDraftRecord(record).record;
  } catch {
    return fail(SAVE_EVENTS_ERROR_CODES.CANONICAL_STATE_ERROR, 500, true);
  }
}

async function storedStateHash(record: DraftRecord): Promise<string> {
  if (typeof record.state_hash === 'string' && /^[0-9a-f]{64}$/u.test(record.state_hash)) {
    return record.state_hash;
  }
  const normalized = normalizedRecord(record);
  try {
    return await calculateCanonicalDraftStateHash(
      JSON.parse(normalized.draft_state_json as string) as Record<string, unknown>,
    );
  } catch {
    return fail(SAVE_EVENTS_ERROR_CODES.CANONICAL_STATE_ERROR, 500, true);
  }
}

function projected(recordInput: DraftRecord): Readonly<Record<string, unknown>> {
  const record = normalizedRecord(recordInput);
  const projection = recordStatus(record) === 'submitted'
    ? projectSubmittedDraftForAuthorizedClient(record, { includeCanonicalState: true })
    : projectActiveDraftForAuthorizedClient(record, { includeCanonicalState: true });
  assertNoSensitiveDraftFields(projection);
  return projection;
}

function requireCanonicalIdentity(request: SaveDraftRequest, record: DraftRecord): number {
  const state = request.canonicalState;
  if (state.draftId !== request.draftId
    || state.sessionId !== record.session_id
    || state.formType !== (record.form_type ?? 'pro-questionnaire')
    || state.serverRevision !== request.expectedServerRevision
    || !Number.isSafeInteger(state.clientRevision)
    || Number(state.clientRevision) < 0) {
    return fail(SAVE_EVENTS_ERROR_CODES.CANONICAL_STATE_ERROR);
  }
  return Number(state.clientRevision);
}

function submissionColumns(
  state: Readonly<Record<string, unknown>>,
  stateHash: string,
  current: DraftRecord,
): Readonly<Record<string, unknown>> {
  if (state.draftStatus !== 'submitted') return Object.freeze({});
  const submission = state.submission;
  if (submission === null || typeof submission !== 'object' || Array.isArray(submission)) {
    return fail(SAVE_EVENTS_ERROR_CODES.STATUS_TRANSITION_INVALID, 409);
  }
  const values = submission as Record<string, unknown>;
  const finalId = values.finalSubmissionId;
  const submittedAt = values.submittedAt;
  if (typeof finalId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(finalId)
    || typeof submittedAt !== 'string' || Number.isNaN(Date.parse(submittedAt))
    || values.submittedStateHash !== stateHash
    || values.pdfSourceStateHash !== stateHash
    || (typeof current.final_submission_id === 'string'
      && current.final_submission_id !== finalId)
    || (typeof current.submitted_at === 'string'
      && current.submitted_at !== submittedAt)) {
    return fail(SAVE_EVENTS_ERROR_CODES.STATUS_TRANSITION_INVALID, 409);
  }
  return Object.freeze({
    final_submission_id: finalId,
    submitted_at: submittedAt,
    submitted_state_hash: stateHash,
    pdf_source_state_hash: stateHash,
    status_locked_at: current.status === 'submitted'
      ? current.status_locked_at
      : submittedAt,
  });
}

function conflictResponse(
  recordInput: DraftRecord,
  requestId: string,
  code: ErrorCode = SAVE_EVENTS_ERROR_CODES.REVISION_CONFLICT,
): Response {
  const record = normalizedRecord(recordInput);
  const conflict = buildSafeConflictProjection(record, {
    includeAuthorizedCanonicalState: true,
  });
  assertNoSensitiveDraftFields(conflict);
  return buildSafeJsonResponse({
    success: false,
    apiVersion: 1,
    errorCode: code,
    message: 'The draft changed and must be merged before retrying.',
    requestId,
    retryable: false,
    mergeRequired: true,
    conflict,
  }, { status: 409 });
}

async function saveDraft(
  request: SaveDraftRequest,
  repository: DraftRepository,
  secrets: Secrets,
  now: Date,
  environment: 'local' | 'test' | 'staging' | 'production',
  requestId: string,
): Promise<Response | Readonly<Record<string, unknown>>> {
  const resolved = await authorizeDraftWrite({
    operation: PRO_DRAFT_API_OPERATION_NAMES.SAVE_DRAFT,
    authorization: request.authorization,
    requestedDraftId: request.draftId,
  }, resolverOptions(repository, environment, secrets, now));
  if (!resolved.record || resolved.draftId !== request.draftId) {
    return fail(SAVE_EVENTS_ERROR_CODES.DRAFT_NOT_FOUND, 404);
  }
  const normalizedCurrent = normalizedRecord(resolved.record);
  const currentHash = await storedStateHash(normalizedCurrent);
  const current: DraftRecord = typeof normalizedCurrent.state_hash === 'string'
    && /^[0-9a-f]{64}$/u.test(normalizedCurrent.state_hash)
    ? normalizedCurrent
    : Object.freeze({ ...normalizedCurrent, state_hash: currentHash }) as DraftRecord;
  const currentStatus = recordStatus(current);
  const incomingClientRevision = requireCanonicalIdentity(request, current);
  const incomingStateHash = await calculateCanonicalDraftStateHash(
    request.canonicalState as Record<string, unknown>,
  );
  const saveKeyHash = await hmacSha256Hex(
    `pro-draft:save-idempotency:v1:${request.draftId}:${request.idempotencyKey}`,
    secrets.idempotency,
  );
  const evaluation = evaluateRevisionWrite({
    storedClientRevision: current.client_revision,
    storedServerRevision: current.server_revision,
    storedStateHash: currentHash,
    storedStatus: currentStatus,
    incomingClientRevision,
    expectedServerRevision: request.expectedServerRevision,
    incomingStateHash,
    incomingStatus: request.requestedStatus,
    idempotencyKey: saveKeyHash,
    storedIdempotencyKey: current.last_save_idempotency_key_hash,
  });
  const submissions = submissionColumns(request.canonicalState, incomingStateHash, current);
  if (evaluation.decision === 'idempotent_success') {
    return Object.freeze({
      success: true,
      apiVersion: 1,
      operation: PRO_DRAFT_API_OPERATION_NAMES.SAVE_DRAFT,
      authorizationMethod: resolved.method,
      idempotent: true,
      acceptedClientRevision: current.client_revision,
      acceptedServerRevision: current.server_revision,
      acceptedStatus: currentStatus,
      stateHash: current.state_hash ?? incomingStateHash,
      draft: projected(current),
    });
  }
  if (evaluation.decision !== 'accept') {
    const code = evaluation.reasonCode === PERSISTENCE_ERROR_CODES.IDEMPOTENCY_KEY_REUSED
      ? SAVE_EVENTS_ERROR_CODES.IDEMPOTENCY_CONFLICT
      : evaluation.decision === 'reject_status_transition'
        ? SAVE_EVENTS_ERROR_CODES.STATUS_TRANSITION_INVALID
        : SAVE_EVENTS_ERROR_CODES.REVISION_CONFLICT;
    return conflictResponse(current, requestId, code);
  }
  const mapped = request.mappedPayload ?? { metadata: {}, userdata: {} };
  const compatibility = buildDraftCompatibilityColumns(
    request.canonicalState,
    mapped,
    {
      stateHash: incomingStateHash,
      clientRevision: incomingClientRevision,
      serverRevision: request.expectedServerRevision + 1,
      sourceTabId: request.canonicalState.sourceTabId as string | null,
      lastSyncReason: request.syncReason,
    },
  );
  const { server_revision: _serverRevision, state_hash: _stateHash, ...columns } = compatibility;
  const timestamp = now.toISOString();
  let accepted: DraftRecord;
  try {
    accepted = await conditionalUpdateDraftRecord(repository, {
      draftId: request.draftId,
      expectedServerRevision: request.expectedServerRevision,
      expectedStatus: currentStatus,
      acceptedStateHash: incomingStateHash,
      acceptedStatus: request.requestedStatus,
      changes: {
        ...columns,
        ...submissions,
        last_save_idempotency_key_hash: saveKeyHash,
        last_save_request_id: requestId,
        last_saved_at: timestamp,
        last_changed_at: timestamp,
      },
    });
  } catch (error) {
    if (error instanceof ProDraftRepositoryError
      && error.code === PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_CONFLICT) {
      return conflictResponse(await getDraftById(repository, request.draftId), requestId);
    }
    throw error;
  }
  return Object.freeze({
    success: true,
    apiVersion: 1,
    operation: PRO_DRAFT_API_OPERATION_NAMES.SAVE_DRAFT,
    authorizationMethod: resolved.method,
    idempotent: false,
    acceptedClientRevision: accepted.client_revision,
    acceptedServerRevision: accepted.server_revision,
    acceptedStatus: accepted.status,
    stateHash: accepted.state_hash,
    draft: projected(accepted),
  });
}

const SENSITIVE_EVENT_KEY = /(?:email|recovery|authorization|token|password|secret|private.?key|base64|bytes|file.?data|raw.?data|binary.?data)/iu;
const EMAIL_VALUE = /[^@\s]+@[^@\s]+\.[^@\s]+/u;

function safeEventJson(value: unknown, rejectEmailValues: boolean): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))) {
    if (rejectEmailValues && typeof value === 'string' && EMAIL_VALUE.test(value)) {
      return fail(SAVE_EVENTS_ERROR_CODES.INVALID_REQUEST);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => safeEventJson(item, rejectEmailValues));
  if (value === null || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return fail(SAVE_EVENTS_ERROR_CODES.INVALID_REQUEST);
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (SENSITIVE_EVENT_KEY.test(key)) return fail(SAVE_EVENTS_ERROR_CODES.INVALID_REQUEST);
    output[key] = safeEventJson((value as Record<string, unknown>)[key], rejectEmailValues);
  }
  return output;
}

function stableEventJson(value: unknown, rejectEmailValues = false): string {
  const serialized = JSON.stringify(safeEventJson(value, rejectEmailValues));
  if (typeof serialized !== 'string') return fail(SAVE_EVENTS_ERROR_CODES.INVALID_REQUEST);
  return serialized;
}

async function eventRecord(
  event: DraftEventInput,
  request: AppendEventsRequest,
  draft: DraftRecord,
  createdAt: string,
): Promise<Record<string, unknown>> {
  const valueJson = Object.hasOwn(event, 'value')
    ? stableEventJson(event.value)
    : null;
  const metadata = {
    ...((event.metadata ?? {}) as Record<string, unknown>),
    ...(event.occurredAtClient ? { occurredAtClient: event.occurredAtClient } : {}),
  };
  const metadataJson = stableEventJson(metadata, true);
  return {
    session_id: draft.session_id,
    event_type: event.eventType,
    question_id: event.questionId ?? null,
    question_type: event.questionType ?? null,
    value_json: valueJson,
    value_summary: event.valueSummary ?? null,
    value_length: event.valueLength ?? null,
    selected_option_count: event.selectedOptionCount ?? null,
    business_name: draft.business_name ?? null,
    domain: draft.domain ?? draft.domain_name ?? null,
    user_id: draft.user_id ?? null,
    created_at_iso: createdAt,
    draft_id: request.draftId,
    event_id: event.eventId,
    client_revision: request.clientRevision,
    server_revision: draft.server_revision,
    source_tab_id: request.sourceTabId ?? null,
    mutation_id: event.mutationId ?? null,
    event_metadata_json: metadataJson,
    value_hash: valueJson === null ? null : await sha256Hex(valueJson),
    redaction_level: valueJson === null ? 'omitted' : 'full',
    environment: draft.environment ?? null,
    test_run_id: request.testRunId ?? null,
  };
}

async function appendEvents(
  request: AppendEventsRequest,
  repository: DraftRepository,
  secrets: Secrets,
  now: Date,
  environment: 'local' | 'test' | 'staging' | 'production',
  requestId: string,
): Promise<Readonly<Record<string, unknown>>> {
  const resolved = await authorizeDraftEvents({
    operation: PRO_DRAFT_API_OPERATION_NAMES.APPEND_EVENTS,
    authorization: request.authorization,
    requestedDraftId: request.draftId,
  }, resolverOptions(repository, environment, secrets, now));
  if (!resolved.record || resolved.draftId !== request.draftId) {
    return fail(SAVE_EVENTS_ERROR_CODES.DRAFT_NOT_FOUND, 404);
  }
  const draft = resolved.record;
  recordStatus(draft);
  const ids = request.events.map((event) => event.eventId);
  const existing = await findDraftEventsByEventIds(repository, request.draftId, ids);
  const existingIds = new Set(existing.map((record) => record.event_id));
  const missing = request.events.filter((event) => !existingIds.has(event.eventId));
  const records = await Promise.all(missing.map((event) => eventRecord(
    event,
    request,
    draft,
    now.toISOString(),
  )));
  if (records.length > 0) {
    const created = await createDraftEvents(repository, records);
    if (created.length !== records.length) {
      return fail(SAVE_EVENTS_ERROR_CODES.EVENT_BATCH_FAILED, 500, true);
    }
  }
  const batchHash = await hmacSha256Hex(
    `pro-draft:event-batch-idempotency:v1:${request.draftId}:${request.idempotencyKey}`,
    secrets.idempotency,
  );
  await updateDraftRecord(repository, request.draftId, {
    last_event_batch_idempotency_key_hash: batchHash,
    last_event_batch_request_id: requestId,
  });
  return Object.freeze({
    success: true,
    apiVersion: 1,
    operation: PRO_DRAFT_API_OPERATION_NAMES.APPEND_EVENTS,
    authorizationMethod: resolved.method,
    draftId: request.draftId,
    acceptedCount: records.length,
    duplicateCount: request.events.length - records.length,
    rejectedCount: 0,
    batchReplay: records.length === 0,
    serverRevision: draft.server_revision,
  });
}

function safeError(error: unknown, requestId: string, operation: Operation): Response {
  let failure: SaveEventsFunctionError;
  if (error instanceof SaveEventsFunctionError) {
    failure = error;
  } else if (error instanceof ProDraftApiError || error instanceof ProDraftPersistenceError) {
    failure = new SaveEventsFunctionError(
      error.status === 401
        ? SAVE_EVENTS_ERROR_CODES.INVALID_AUTHORIZATION
        : SAVE_EVENTS_ERROR_CODES.INVALID_REQUEST,
      error.status,
      error.retryable,
    );
  } else if (error instanceof ProDraftAuthorizationResolverError
    || error instanceof ProDraftAuthorizationError) {
    failure = new SaveEventsFunctionError(
      error instanceof ProDraftAuthorizationResolverError && error.code.includes('SCOPE_MISSING')
        ? SAVE_EVENTS_ERROR_CODES.WRITE_SCOPE_REQUIRED
        : SAVE_EVENTS_ERROR_CODES.INVALID_AUTHORIZATION,
      error instanceof ProDraftAuthorizationResolverError ? error.status : 401,
    );
  } else if (error instanceof ProDraftRepositoryError) {
    failure = new SaveEventsFunctionError(
      error.code === PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_UPDATE_UNSUPPORTED
        || error.code === PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_POST_READ_MISMATCH
        ? SAVE_EVENTS_ERROR_CODES.CONDITIONAL_UPDATE_UNSUPPORTED
        : operation === 'save'
          ? SAVE_EVENTS_ERROR_CODES.DRAFT_SAVE_FAILED
          : SAVE_EVENTS_ERROR_CODES.EVENT_BATCH_FAILED,
      500,
      error.retryable,
    );
  } else {
    failure = new SaveEventsFunctionError(
      operation === 'save'
        ? SAVE_EVENTS_ERROR_CODES.DRAFT_SAVE_FAILED
        : SAVE_EVENTS_ERROR_CODES.EVENT_BATCH_FAILED,
      500,
      true,
    );
  }
  return buildSafeJsonResponse({
    success: false,
    apiVersion: 1,
    errorCode: failure.code,
    message: failure.status === 405
      ? 'The request method is not allowed.'
      : failure.status === 415
        ? 'The request content type is not supported.'
        : failure.status === 413
          ? 'The request is too large.'
          : failure.status >= 500
            ? 'The draft operation could not be completed.'
            : 'Draft access or request validation failed.',
    requestId,
    retryable: failure.retryable,
  }, {
    status: failure.status,
    headers: failure.status === 405 ? { Allow: 'POST' } : {},
  });
}

export function createSaveEventsFunctionHandler(
  operation: Operation,
  dependencies: SaveEventsFunctionDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestId = createServerRequestId(
      dependencies.createRequestId ? { generator: dependencies.createRequestId } : {},
    );
    try {
      const runtime = assertDurableDraftServerEnabled(
        getBackendRuntimeConfig(dependencies.getEnvironmentValue),
      );
      if (runtime.environment === 'unknown') {
        return fail(SAVE_EVENTS_ERROR_CODES.FEATURE_DISABLED, 503, true);
      }
      validateRequestMethod(request, 'POST');
      validateJsonContentType(request);
      const body = await readBoundedJsonBody(request, {
        method: 'POST',
        maxBytes: operation === 'save'
          ? DEFAULT_MAX_API_REQUEST_BYTES
          : MAX_EVENT_BATCH_REQUEST_BYTES,
      });
      const validated = operation === 'save'
        ? validateSaveDraftRequest(body, { environment: runtime.environment })
        : validateAppendEventsRequest(body, { environment: runtime.environment });
      const repository = createDraftRepository(dependencies.createClientFromRequest(request));
      const secrets = resolveSecrets(dependencies);
      const now = dependencies.now?.() ?? new Date();
      const result = operation === 'save'
        ? await saveDraft(
          validated as SaveDraftRequest,
          repository,
          secrets,
          now,
          runtime.environment,
          requestId,
        )
        : await appendEvents(
          validated as AppendEventsRequest,
          repository,
          secrets,
          now,
          runtime.environment,
          requestId,
        );
      if (result instanceof Response) return result;
      return buildSafeJsonResponse({ ...result, requestId });
    } catch (error) {
      if (error instanceof Error && error.name === 'ProDraftRuntimeConfigError') {
        return safeError(
          new SaveEventsFunctionError(
            SAVE_EVENTS_ERROR_CODES.FEATURE_DISABLED,
            503,
            true,
          ),
          requestId,
          operation,
        );
      }
      return safeError(error, requestId, operation);
    }
  };
}

export function createSaveProFormDraftHandler(
  dependencies: SaveEventsFunctionDependencies,
): (request: Request) => Promise<Response> {
  return createSaveEventsFunctionHandler('save', dependencies);
}

export function createAppendProFormDraftEventsHandler(
  dependencies: SaveEventsFunctionDependencies,
): (request: Request) => Promise<Response> {
  return createSaveEventsFunctionHandler('events', dependencies);
}
