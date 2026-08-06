/** Idempotent Clear All and Start New replacement transactions. */

import {
  PRO_DRAFT_ACCESS_SCOPES,
  PRO_DRAFT_API_OPERATION_NAMES,
  PRO_DRAFT_API_VERSION,
  type DraftAuthorizationInput,
  ProDraftApiError,
  validateDraftAuthorizationInput,
} from '../proDraftApi/entry.ts';
import {
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  type AuthorizationSecret,
  issueRecoverySessionToken,
} from '../proDraftAuthorization/entry.ts';
import {
  authorizeDraftRead,
  authorizeDraftWrite,
} from '../proDraftAuthorizationResolver/entry.ts';
import {
  DEFAULT_MAX_API_REQUEST_BYTES,
  ProDraftPersistenceError,
  buildDraftCompatibilityColumns,
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
  conditionalUpdateDraftRecord,
  conditionalUpdateDraftReplacementMetadata,
  createDraftEvents,
  createDraftRecord,
  createDraftRepository,
  findReplacementDrafts,
  getDraftById,
} from '../proDraftRepository/entry.ts';
import {
  type InternalRecoveryEmailResult,
  deliverProDraftRecoveryEmail,
} from '../proDraftRecoveryEmailService/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  type PurposeBoundSecret,
  generateOpaqueToken,
  generateSecureRecoveryCode,
  hashRecoveryCode,
  hashResumeToken,
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
} from '../proDraftBootstrapLoad/entry.ts';

export const PRO_DRAFT_REPLACEMENT_VERSION = 1;
export const REPLACEMENT_OPERATION_TYPES = Object.freeze({
  CLEAR_ALL: 'clear_all',
  START_NEW_AFTER_SUBMISSION: 'start_new_after_submission',
} as const);
export const REPLACEMENT_TRANSACTION_STATUSES = Object.freeze({
  PENDING: 'pending',
  COMMITTED: 'committed',
  ORPHANED: 'orphaned',
  FAILED: 'failed',
} as const);
export const REPLACEMENT_ERROR_CODES = Object.freeze({
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  SOURCE_STATUS_INVALID: 'SOURCE_STATUS_INVALID',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REPLACEMENT_CREATE_FAILED: 'REPLACEMENT_CREATE_FAILED',
  SOURCE_UPDATE_CONFLICT: 'SOURCE_UPDATE_CONFLICT',
  REPLACEMENT_COMMIT_FAILED: 'REPLACEMENT_COMMIT_FAILED',
  TRANSACTION_RECOVERY_FAILED: 'TRANSACTION_RECOVERY_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const);

type Operation = typeof REPLACEMENT_OPERATION_TYPES[keyof typeof REPLACEMENT_OPERATION_TYPES];
type Environment = 'local' | 'test' | 'staging' | 'production';

export type ReplacementRequest = Readonly<{
  apiVersion: 1;
  authorization: DraftAuthorizationInput;
  sourceDraftId: string;
  expectedServerRevision: number;
  idempotencyKey: string;
  clientReplacementResumeToken?: string;
  testRunId?: string;
}>;

export type ReplacementFunctionDependencies = Readonly<{
  createClientFromRequest: (request: Request) => unknown;
  getEnvironmentValue: (name: string) => string | undefined;
  createRequestId?: () => string;
  now?: () => Date;
  generateSessionId?: () => string;
  generateResumeToken?: () => string;
  generateTransactionId?: () => string;
  tokenIdGenerator?: () => string;
  sendEmail?: Parameters<typeof deliverProDraftRecoveryEmail>[1]['sendEmail'];
  renderEmail?: Parameters<typeof deliverProDraftRecoveryEmail>[1]['renderEmail'];
}>;

type Secrets = Readonly<{
  resume: PurposeBoundSecret;
  recoveryCode: PurposeBoundSecret;
  signedInvitation: AuthorizationSecret;
  recoverySession: AuthorizationSecret;
  idempotency: string;
}>;

export class ProDraftReplacementError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly replacementRecoveryRequired: boolean;

  constructor(
    code: string,
    status = 400,
    options: Readonly<{ retryable?: boolean; replacementRecoveryRequired?: boolean }> = {},
  ) {
    super('The replacement transaction could not be completed.');
    this.name = 'ProDraftReplacementError';
    this.code = code;
    this.status = status;
    this.retryable = options.retryable === true;
    this.replacementRecoveryRequired = options.replacementRecoveryRequired === true;
  }
}

function fail(
  code: string,
  status = 400,
  options: ConstructorParameters<typeof ProDraftReplacementError>[2] = {},
): never {
  throw new ProDraftReplacementError(code, status, options);
}

const REQUEST_KEYS = new Set([
  'apiVersion', 'authorization', 'sourceDraftId', 'expectedServerRevision',
  'idempotencyKey', 'clientReplacementResumeToken', 'testRunId',
]);
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/u;
const HASH = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRequest(value: unknown, environment: Environment): ReplacementRequest {
  if (!isRecord(value) || Object.keys(value).some((key) => !REQUEST_KEYS.has(key))
    || value.apiVersion !== PRO_DRAFT_API_VERSION
    || typeof value.sourceDraftId !== 'string' || !ID.test(value.sourceDraftId)
    || !Number.isSafeInteger(value.expectedServerRevision)
    || Number(value.expectedServerRevision) < 0) {
    return fail(REPLACEMENT_ERROR_CODES.INVALID_REQUEST);
  }
  let authorization: DraftAuthorizationInput;
  try {
    authorization = validateDraftAuthorizationInput(value.authorization);
  } catch {
    return fail(REPLACEMENT_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  if (authorization.method === 'new_anonymous_draft') {
    return fail(REPLACEMENT_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  const clientToken = typeof value.clientReplacementResumeToken === 'string'
    ? value.clientReplacementResumeToken
    : undefined;
  if (value.clientReplacementResumeToken !== undefined
    && (!clientToken || !TOKEN.test(clientToken))) {
    return fail(REPLACEMENT_ERROR_CODES.INVALID_REQUEST);
  }
  if (value.testRunId !== undefined
    && (environment === 'production'
      || typeof value.testRunId !== 'string'
      || !ID.test(value.testRunId))) {
    return fail(REPLACEMENT_ERROR_CODES.INVALID_REQUEST);
  }
  return Object.freeze({
    apiVersion: 1,
    authorization,
    sourceDraftId: value.sourceDraftId,
    expectedServerRevision: Number(value.expectedServerRevision),
    idempotencyKey: validateIdempotencyKey(value.idempotencyKey),
    ...(clientToken ? { clientReplacementResumeToken: clientToken } : {}),
    ...(typeof value.testRunId === 'string' ? { testRunId: value.testRunId } : {}),
  });
}

function requireSecret(
  dependencies: ReplacementFunctionDependencies,
  name: string,
): string {
  const value = dependencies.getEnvironmentValue(name);
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength < 32) {
    return fail(REPLACEMENT_ERROR_CODES.FEATURE_DISABLED, 503, { retryable: true });
  }
  return value;
}

function secrets(dependencies: ReplacementFunctionDependencies): Secrets {
  return Object.freeze({
    resume: {
      name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
      value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RESUME_TOKEN),
    },
    recoveryCode: {
      name: SECURITY_SECRET_NAMES.RECOVERY_CODE,
      value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RECOVERY_CODE),
    },
    signedInvitation: {
      name: AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION,
      value: requireSecret(dependencies, AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION),
    },
    recoverySession: {
      name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
      value: requireSecret(dependencies, AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION),
    },
    idempotency: requireSecret(dependencies, PRO_FORM_IDEMPOTENCY_SECRET),
  });
}

function emptyCanonicalState(
  source: DraftRecord,
  sessionId: string,
  draftId: string | null,
  timestamp: string,
  operation: Operation,
): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  for (const [target, field] of Object.entries({
    userId: 'user_id', userName: 'user_name', businessName: 'business_name',
    domainName: 'domain', recoveryEmail: 'recovery_email',
  })) {
    const value = source[field];
    if (typeof value === 'string' && value.length > 0) credentials[target] = value;
  }
  return {
    schemaVersion: 4,
    formType: 'pro-questionnaire',
    draftId,
    sessionId,
    draftStatus: 'active',
    clientRevision: 0,
    serverRevision: 0,
    savedAtClient: null,
    savedAtServer: timestamp,
    sourceTabId: null,
    responses: {},
    validationStatus: {},
    touchedQuestions: {},
    expandedQuestions: {},
    textValidationMeta: {},
    credentials,
    identityContext: {
      identityContextVersion: 1,
      recoveryEmailSource: source.recovery_email_source ?? 'anonymous',
      recoveryEmailVerificationStatus:
        source.recovery_email_verification_status ?? 'unverified',
      identityAssociationIntent: operation,
      anonymousRecoveryAcknowledged: !source.recovery_email,
      signedInvitationEmailChanged: false,
    },
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
      sourceType: 'canonical', sourceVersion: 4,
      migratedAtClient: null, migrationWarnings: [],
    },
  };
}

function compatibility(
  state: Record<string, unknown>,
  stateHash: string,
  reason: string,
) {
  return buildDraftCompatibilityColumns(state, { metadata: {}, userdata: {} }, {
    stateHash,
    clientRevision: 0,
    serverRevision: 0,
    sourceTabId: null,
    lastSyncReason: reason,
  });
}

export type CreatedReplacement = Readonly<{
  record: DraftRecord;
  recoveryCode: string;
  resumeToken: string;
}>;

export async function createReplacementDraftRecord(input: Readonly<{
  repository: DraftRepository;
  sourceDraft: DraftRecord;
  operation: Operation;
  operationIdempotencyHash: string;
  transactionId: string;
  environment: Environment;
  now: Date;
  secrets: Pick<Secrets, 'resume' | 'recoveryCode'>;
  resumeToken?: string;
  sessionId?: string;
  testRunId?: string;
}>): Promise<CreatedReplacement> {
  const timestamp = input.now.toISOString();
  const sessionId = input.sessionId ?? generateOpaqueToken({ prefix: 'pds_' });
  const recovery = generateSecureRecoveryCode();
  const resumeToken = input.resumeToken ?? generateOpaqueToken();
  const [recoveryCodeHash, resumeTokenHash] = await Promise.all([
    hashRecoveryCode(recovery.normalizedCode, input.secrets.recoveryCode),
    hashResumeToken(resumeToken, input.secrets.resume),
  ]);
  const unboundState = emptyCanonicalState(
    input.sourceDraft, sessionId, null, timestamp, input.operation,
  );
  const unboundHash = await calculateCanonicalDraftStateHash(unboundState);
  const origin = input.operation === REPLACEMENT_OPERATION_TYPES.CLEAR_ALL
    ? 'clear_all_replacement'
    : 'start_new_after_submission';
  const data: Record<string, unknown> = {
    ...compatibility(unboundState, unboundHash, origin),
    session_id: sessionId,
    form_type: 'pro-questionnaire',
    status: 'active',
    status_version: 1,
    draft_generation: (Number.isSafeInteger(input.sourceDraft.draft_generation)
      ? Number(input.sourceDraft.draft_generation) : 1) + 1,
    previous_draft_id: input.sourceDraft.id,
    draft_origin: origin,
    replacement_transaction_id: input.transactionId,
    replacement_transaction_status: REPLACEMENT_TRANSACTION_STATUSES.PENDING,
    replacement_transaction_started_at: timestamp,
    replacement_transaction_error_code: '',
    replacement_operation_idempotency_hash: input.operationIdempotencyHash,
    recovery_code_hash: recoveryCodeHash,
    recovery_code_version: recovery.version,
    recovery_code_hint: recovery.hint,
    resume_token_hash: resumeTokenHash,
    recovery_session_version: 1,
    recovery_email_delivery_attempt_count: 0,
    environment: input.environment,
    last_saved_at: timestamp,
    business_name: input.sourceDraft.business_name ?? '',
    domain: input.sourceDraft.domain ?? '',
    user_id: input.sourceDraft.user_id ?? '',
    user_name: input.sourceDraft.user_name ?? '',
    ...(input.testRunId ? { test_run_id: input.testRunId } : {}),
  };
  for (const field of [
    'recovery_email', 'recovery_email_lookup_hash', 'recovery_email_source',
    'recovery_email_verification_status', 'recovery_email_verified_at',
  ]) {
    if (input.sourceDraft[field] !== undefined) data[field] = input.sourceDraft[field];
  }
  let created: DraftRecord;
  try {
    created = await createDraftRecord(input.repository, data);
    if (typeof created.id !== 'string') throw new Error('missing replacement id');
    const boundState = emptyCanonicalState(
      input.sourceDraft, sessionId, created.id, timestamp, input.operation,
    );
    const boundHash = await calculateCanonicalDraftStateHash(boundState);
    const columns = compatibility(boundState, boundHash, origin);
    const { server_revision: _serverRevision, state_hash: _stateHash, ...changes } = columns;
    created = await conditionalUpdateDraftRecord(input.repository, {
      draftId: created.id,
      expectedServerRevision: 0,
      expectedStatus: 'active',
      acceptedStateHash: boundHash,
      acceptedStatus: 'active',
      changes,
    });
  } catch {
    return fail(REPLACEMENT_ERROR_CODES.REPLACEMENT_CREATE_FAILED, 500, {
      retryable: true,
    });
  }
  return Object.freeze({
    record: created,
    recoveryCode: recovery.formattedCode,
    resumeToken,
  });
}

async function commitReplacementMarker(
  repository: DraftRepository,
  record: DraftRecord,
  now: Date,
): Promise<DraftRecord> {
  if (typeof record.id !== 'string'
    || typeof record.updated_date !== 'string'
    || typeof record.status !== 'string'
    || !Number.isSafeInteger(record.server_revision)) {
    return fail(REPLACEMENT_ERROR_CODES.REPLACEMENT_COMMIT_FAILED, 500, {
      retryable: true, replacementRecoveryRequired: true,
    });
  }
  try {
    return await conditionalUpdateDraftReplacementMetadata(repository, {
      draftId: record.id,
      expectedUpdatedDate: record.updated_date,
      expectedStatus: record.status,
      expectedServerRevision: Number(record.server_revision),
      expectedTransactionStatus: String(record.replacement_transaction_status),
      changes: {
        replacement_transaction_status: REPLACEMENT_TRANSACTION_STATUSES.COMMITTED,
        replacement_transaction_completed_at: now.toISOString(),
        replacement_transaction_error_code: '',
      },
    });
  } catch {
    return fail(REPLACEMENT_ERROR_CODES.REPLACEMENT_COMMIT_FAILED, 500, {
      retryable: true, replacementRecoveryRequired: true,
    });
  }
}

export async function commitClearAllReplacement(input: Readonly<{
  repository: DraftRepository;
  sourceDraft: DraftRecord;
  replacementDraft: DraftRecord;
  expectedServerRevision: number;
  transactionId: string;
  now: Date;
}>): Promise<Readonly<{ sourceDraft: DraftRecord; replacementDraft: DraftRecord }>> {
  if (!['active', 'submit_failed'].includes(String(input.sourceDraft.status))
    || input.sourceDraft.server_revision !== input.expectedServerRevision
    || typeof input.sourceDraft.id !== 'string'
    || typeof input.replacementDraft.id !== 'string'
    || typeof input.sourceDraft.state_hash !== 'string'
    || !HASH.test(input.sourceDraft.state_hash)) {
    return fail(REPLACEMENT_ERROR_CODES.REVISION_CONFLICT, 409);
  }
  let source: DraftRecord;
  try {
    source = await conditionalUpdateDraftRecord(input.repository, {
      draftId: input.sourceDraft.id,
      expectedServerRevision: input.expectedServerRevision,
      expectedStatus: String(input.sourceDraft.status),
      acceptedStateHash: input.sourceDraft.state_hash,
      acceptedStatus: 'cleared_superseded',
      changes: {
        replacement_draft_id: input.replacementDraft.id,
        replacement_transaction_id: input.transactionId,
        superseded_at: input.now.toISOString(),
        superseded_reason: 'clear_all',
        last_sync_reason: 'clear_all',
      },
    });
  } catch (error) {
    if (error instanceof ProDraftRepositoryError
      && error.code === PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_CONFLICT) {
      return fail(REPLACEMENT_ERROR_CODES.SOURCE_UPDATE_CONFLICT, 409, {
        retryable: true,
      });
    }
    return fail(REPLACEMENT_ERROR_CODES.SOURCE_UPDATE_CONFLICT, 500, {
      retryable: true,
    });
  }
  const replacement = await commitReplacementMarker(
    input.repository, input.replacementDraft, input.now,
  );
  return Object.freeze({ sourceDraft: source, replacementDraft: replacement });
}

export async function commitStartNewReplacement(input: Readonly<{
  repository: DraftRepository;
  sourceDraft: DraftRecord;
  replacementDraft: DraftRecord;
  now: Date;
}>): Promise<Readonly<{ sourceDraft: DraftRecord; replacementDraft: DraftRecord }>> {
  if (input.sourceDraft.status !== 'submitted') {
    return fail(REPLACEMENT_ERROR_CODES.SOURCE_STATUS_INVALID, 409);
  }
  const replacement = await commitReplacementMarker(
    input.repository, input.replacementDraft, input.now,
  );
  return Object.freeze({ sourceDraft: input.sourceDraft, replacementDraft: replacement });
}

export async function recoverPendingReplacement(input: Readonly<{
  repository: DraftRepository;
  sourceDraft: DraftRecord;
  replacementDraft: DraftRecord;
  operation: Operation;
  expectedServerRevision: number;
  transactionId: string;
  now: Date;
}>): Promise<Readonly<{ sourceDraft: DraftRecord; replacementDraft: DraftRecord }>> {
  if (!['pending', 'orphaned'].includes(
    String(input.replacementDraft.replacement_transaction_status),
  )) return fail(REPLACEMENT_ERROR_CODES.TRANSACTION_RECOVERY_FAILED, 409);
  if (input.operation === REPLACEMENT_OPERATION_TYPES.START_NEW_AFTER_SUBMISSION) {
    return commitStartNewReplacement(input);
  }
  if (input.sourceDraft.status === 'cleared_superseded'
    && input.sourceDraft.replacement_draft_id === input.replacementDraft.id) {
    const replacement = await commitReplacementMarker(
      input.repository, input.replacementDraft, input.now,
    );
    return Object.freeze({ sourceDraft: input.sourceDraft, replacementDraft: replacement });
  }
  return commitClearAllReplacement(input);
}

function summary(record: DraftRecord) {
  return Object.freeze({
    draftId: record.id,
    status: record.status,
    serverRevision: record.server_revision,
  });
}

function replacementSummary(record: DraftRecord) {
  return Object.freeze({
    draftId: record.id,
    sessionId: record.session_id,
    status: record.status,
    serverRevision: record.server_revision,
    draftGeneration: record.draft_generation,
    recoveryCodeHint: record.recovery_code_hint,
  });
}

function operationHash(
  operation: Operation,
  sourceDraftId: string,
  key: string,
  secret: string,
) {
  return hmacSha256Hex(
    `pro-draft:replacement-idempotency:v1:${operation}:${sourceDraftId}:${key}`,
    secret,
  );
}

async function recoverySession(
  record: DraftRecord,
  authorizationMethod: string,
  environment: Environment,
  secret: AuthorizationSecret,
  now: Date,
  tokenIdGenerator?: () => string,
): Promise<string> {
  const sessionIdHash = await sha256Hex(
    `pro-draft:session-id:v1:${record.session_id}`,
  );
  const tokenAuthorizationMethod = authorizationMethod === 'signed_invitation'
    ? 'signed_invitation'
    : 'recovery_code';
  const verificationStatus = record.recovery_email_verification_status;
  return issueRecoverySessionToken({
    environment,
    draftId: String(record.id),
    sessionIdHash,
    authorizationMethod: tokenAuthorizationMethod,
    authorizedScopes: [
      SIGNED_TOKEN_SCOPES.DRAFT_READ,
      SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
      SIGNED_TOKEN_SCOPES.DRAFT_EVENTS,
    ],
    recoveryEmailLookupHash: typeof record.recovery_email_lookup_hash === 'string'
      ? record.recovery_email_lookup_hash : undefined,
    recoveryEmailVerificationStatus: verificationStatus === 'verified_otp'
      || verificationStatus === 'verified_magic_link'
      ? verificationStatus : undefined,
    recoveryCodeVersion: Number(record.recovery_code_version),
    recoverySessionVersion: Number(record.recovery_session_version),
    grantVersion: 1,
  }, {
    secret,
    clock: () => Math.floor(now.getTime() / 1000),
    tokenIdGenerator,
  });
}

const noEmail = (): InternalRecoveryEmailResult => Object.freeze({
  attempted: false, delivered: false, redirected: false, failed: false,
  canRetry: false, deliveryUncertain: false, idempotent: false, errorCode: null,
});

async function appendReplacementEvent(
  repository: DraftRepository,
  record: DraftRecord,
  operation: Operation,
  requestId: string,
  now: Date,
  environment: Environment,
  testRunId?: string,
): Promise<void> {
  try {
    await createDraftEvents(repository, [{
      session_id: record.session_id,
      event_type: 'draft_replacement_committed',
      created_at_iso: now.toISOString(),
      draft_id: record.id,
      event_id: `${requestId}:draft_replacement_committed`,
      server_revision: record.server_revision,
      event_metadata_json: JSON.stringify({ operation, requestId }),
      redaction_level: 'omitted',
      environment,
      ...(testRunId ? { test_run_id: testRunId } : {}),
    }]);
  } catch {
    // The committed records are authoritative; missing diagnostics do not roll back.
  }
}

async function execute(
  operation: Operation,
  request: Request,
  dependencies: ReplacementFunctionDependencies,
  requestId: string,
): Promise<Response> {
  const runtime = assertDurableDraftServerEnabled(
    getBackendRuntimeConfig(dependencies.getEnvironmentValue),
  );
  if (runtime.environment === 'unknown') {
    return fail(REPLACEMENT_ERROR_CODES.FEATURE_DISABLED, 503);
  }
  validateRequestMethod(request, 'POST');
  validateJsonContentType(request);
  const body = await readBoundedJsonBody(request, {
    method: 'POST', maxBytes: DEFAULT_MAX_API_REQUEST_BYTES,
  });
  const validated = validateRequest(body, runtime.environment);
  const now = dependencies.now?.() ?? new Date();
  const resolvedSecrets = secrets(dependencies);
  const repository = createDraftRepository(
    dependencies.createClientFromRequest(request),
  );
  const authInput = {
    operation: operation === REPLACEMENT_OPERATION_TYPES.CLEAR_ALL
      ? PRO_DRAFT_API_OPERATION_NAMES.CLEAR_AND_REPLACE_DRAFT
      : PRO_DRAFT_API_OPERATION_NAMES.START_NEW_DRAFT,
    authorization: validated.authorization,
    requestedDraftId: validated.sourceDraftId,
  } as const;
  const authOptions = {
    repository,
    environment: runtime.environment,
    formType: 'pro-questionnaire',
    grantVersion: 1,
    resumeTokenSecret: resolvedSecrets.resume,
    signedInvitationSecret: resolvedSecrets.signedInvitation,
    recoverySessionSecret: resolvedSecrets.recoverySession,
    clock: () => Math.floor(now.getTime() / 1000),
  } as const;
  let resolved;
  try {
    resolved = operation === REPLACEMENT_OPERATION_TYPES.CLEAR_ALL
      ? await authorizeDraftWrite(authInput, authOptions)
      : await authorizeDraftRead(authInput, authOptions, true);
  } catch {
    return fail(REPLACEMENT_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  if (!resolved.record || resolved.draftId !== validated.sourceDraftId) {
    return fail(REPLACEMENT_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  let source = resolved.record;
  const allowed = operation === REPLACEMENT_OPERATION_TYPES.CLEAR_ALL
    ? ['active', 'submit_failed'] : ['submitted'];
  const idempotencyHash = await operationHash(
    operation, validated.sourceDraftId, validated.idempotencyKey,
    resolvedSecrets.idempotency,
  );
  const matches = await findReplacementDrafts(
    repository, validated.sourceDraftId, idempotencyHash,
  );
  if (matches.length > 1) return fail(REPLACEMENT_ERROR_CODES.IDEMPOTENCY_CONFLICT, 409);
  if (matches.length === 1
    && matches[0].draft_origin !== (operation === REPLACEMENT_OPERATION_TYPES.CLEAR_ALL
      ? 'clear_all_replacement' : 'start_new_after_submission')) {
    return fail(REPLACEMENT_ERROR_CODES.IDEMPOTENCY_CONFLICT, 409);
  }
  if (matches[0]?.replacement_transaction_status === 'committed') {
    return buildSafeJsonResponse({
      success: true,
      requestId,
      operation,
      idempotent: true,
      sourceDraft: summary(source),
      replacementDraft: replacementSummary(matches[0]),
      recoveryCode: null,
      resumeToken: null,
      recoverySessionToken: null,
      credentialsReissueRequired: true,
      emailDelivery: noEmail(),
      warnings: ['IDEMPOTENT_REPLAY_CREDENTIALS_NOT_REISSUED'],
    });
  }
  if (!matches[0]
    && (!allowed.includes(String(source.status))
      || source.server_revision !== validated.expectedServerRevision)) {
    return fail(
      allowed.includes(String(source.status))
        ? REPLACEMENT_ERROR_CODES.REVISION_CONFLICT
        : REPLACEMENT_ERROR_CODES.SOURCE_STATUS_INVALID,
      409,
    );
  }
  let created: CreatedReplacement | null = null;
  let replacement = matches[0] ?? null;
  const transactionId = String(
    replacement?.replacement_transaction_id
      ?? dependencies.generateTransactionId?.()
      ?? generateOpaqueToken({ prefix: 'pdrt_' }),
  );
  if (!replacement) {
    created = await createReplacementDraftRecord({
      repository,
      sourceDraft: source,
      operation,
      operationIdempotencyHash: idempotencyHash,
      transactionId,
      environment: runtime.environment,
      now,
      secrets: resolvedSecrets,
      resumeToken: validated.clientReplacementResumeToken
        ?? dependencies.generateResumeToken?.(),
      sessionId: dependencies.generateSessionId?.(),
      testRunId: validated.testRunId,
    });
    replacement = created.record;
  } else {
    source = await getDraftById(repository, validated.sourceDraftId);
  }
  let committed;
  try {
    committed = matches[0]
      ? await recoverPendingReplacement({
        repository, sourceDraft: source, replacementDraft: replacement,
        operation, expectedServerRevision: validated.expectedServerRevision,
        transactionId, now,
      })
      : operation === REPLACEMENT_OPERATION_TYPES.CLEAR_ALL
        ? await commitClearAllReplacement({
          repository, sourceDraft: source, replacementDraft: replacement,
          expectedServerRevision: validated.expectedServerRevision,
          transactionId, now,
        })
        : await commitStartNewReplacement({
          repository, sourceDraft: source, replacementDraft: replacement, now,
        });
  } catch (error) {
    if (error instanceof ProDraftReplacementError
      && error.code === REPLACEMENT_ERROR_CODES.SOURCE_UPDATE_CONFLICT) {
      try {
        await conditionalUpdateDraftReplacementMetadata(repository, {
          draftId: String(replacement.id),
          expectedUpdatedDate: String(replacement.updated_date),
          expectedStatus: String(replacement.status),
          expectedServerRevision: Number(replacement.server_revision),
          expectedTransactionStatus: String(replacement.replacement_transaction_status),
          changes: {
            replacement_transaction_status: 'orphaned',
            replacement_transaction_error_code: error.code,
          },
        });
      } catch {
        // Pending remains safely excluded from email recovery.
      }
    }
    if (error instanceof ProDraftReplacementError
      && error.replacementRecoveryRequired) {
      return buildSafeJsonResponse({
        success: false,
        requestId,
        operation,
        errorCode: error.code,
        replacementRecoveryRequired: true,
        sourceDraft: summary(await getDraftById(repository, validated.sourceDraftId)),
        replacementDraft: replacementSummary(replacement),
        recoveryCode: created?.recoveryCode ?? null,
        resumeToken: created?.resumeToken ?? null,
        recoverySessionToken: null,
        emailDelivery: noEmail(),
        warnings: ['REPLACEMENT_COMMIT_RECOVERY_REQUIRED', 'EMAIL_WAITING_FOR_COMMIT'],
      }, { status: 202 });
    }
    throw error;
  }
  await appendReplacementEvent(
    repository, committed.replacementDraft, operation, requestId,
    now, runtime.environment, validated.testRunId,
  );
  let emailDelivery = noEmail();
  if (created) {
    emailDelivery = await deliverProDraftRecoveryEmail({
      repository,
      draft: committed.replacementDraft,
      recoveryCode: created.recoveryCode,
      purpose: operation === REPLACEMENT_OPERATION_TYPES.CLEAR_ALL
        ? 'clear_all_replacement' : 'start_new_after_submission',
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
  }
  const sessionToken = created
    ? await recoverySession(
      committed.replacementDraft, resolved.method, runtime.environment,
      resolvedSecrets.recoverySession, now, dependencies.tokenIdGenerator,
    )
    : null;
  const warnings: string[] = [];
  if (emailDelivery.failed) warnings.push('RECOVERY_EMAIL_FAILED_COPY_CREDENTIALS');
  if (!emailDelivery.attempted) warnings.push('RECOVERY_EMAIL_NOT_AVAILABLE');
  return buildSafeJsonResponse({
    success: true,
    requestId,
    operation,
    idempotent: matches.length === 1,
    sourceDraft: summary(committed.sourceDraft),
    replacementDraft: replacementSummary(committed.replacementDraft),
    recoveryCode: created?.recoveryCode ?? null,
    resumeToken: created?.resumeToken ?? null,
    recoverySessionToken: sessionToken,
    credentialsReissueRequired: created === null,
    emailDelivery,
    warnings,
  });
}

function safeFailure(error: unknown, requestId: string): Response {
  const failure = error instanceof ProDraftReplacementError
    ? error
    : error instanceof ProDraftPersistenceError || error instanceof ProDraftApiError
      ? new ProDraftReplacementError(
        REPLACEMENT_ERROR_CODES.INVALID_REQUEST,
        error.status,
      )
      : new ProDraftReplacementError(REPLACEMENT_ERROR_CODES.INTERNAL_ERROR, 500, {
        retryable: true,
      });
  return buildSafeJsonResponse({
    success: false,
    requestId,
    errorCode: failure.code,
    message: failure.status === 401
      ? 'The replacement transaction could not be authorized.'
      : 'The replacement transaction could not be completed.',
    retryable: failure.retryable,
    replacementRecoveryRequired: failure.replacementRecoveryRequired,
  }, {
    status: failure.status,
    headers: failure.status === 405 ? { Allow: 'POST' } : {},
  });
}

export function createReplacementFunctionHandler(
  operation: Operation,
  dependencies: ReplacementFunctionDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = createServerRequestId(
      dependencies.createRequestId ? { generator: dependencies.createRequestId } : {},
    );
    try {
      return await execute(operation, request, dependencies, requestId);
    } catch (error) {
      return safeFailure(error, requestId);
    }
  };
}

export function getSafeReplacementDiagnostics(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: PRO_DRAFT_REPLACEMENT_VERSION,
    operations: REPLACEMENT_OPERATION_TYPES,
    transactionStatuses: REPLACEMENT_TRANSACTION_STATUSES,
    deletesSourceDraft: false,
    mutatesSubmittedCanonicalState: false,
    storesRawRecoveryCode: false,
    storesRawResumeToken: false,
    pendingEmailRecoverable: false,
    responsesCacheable: false,
  });
}
