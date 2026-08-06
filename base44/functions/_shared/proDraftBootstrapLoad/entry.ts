/** Shared, injectable orchestration for bootstrapProFormDraft/loadProFormDraft. */

import {
  PRO_DRAFT_ACCESS_SCOPES,
  PRO_DRAFT_API_OPERATION_NAMES,
  PRO_DRAFT_AUTHORIZATION_METHODS,
  type BootstrapDraftRequest,
  type DraftClientContext,
  type LoadDraftRequest,
  ProDraftApiError,
  validateBootstrapDraftRequest,
  validateLoadDraftRequest,
} from '../proDraftApi/entry.ts';
import {
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  type AuthorizationSecret,
  type SignedInvitationClaims,
  ProDraftAuthorizationError,
  validateSignedInvitationClaims,
  verifyStructuredToken,
} from '../proDraftAuthorization/entry.ts';
import {
  ProDraftAuthorizationResolverError,
  authorizeDraftRead,
  resolveDraftAuthorization,
} from '../proDraftAuthorizationResolver/entry.ts';
import {
  DEFAULT_MAX_API_REQUEST_BYTES,
  ProDraftPersistenceError,
  buildDraftCompatibilityColumns,
  buildSafeJsonResponse,
  createServerRequestId,
  normalizeDraftLifecycleStatus,
  readBoundedJsonBody,
  selectCanonicalDuplicateDraft,
  validateCanonicalPayloadSize,
  validateJsonContentType,
  validateRequestMethod,
} from '../proDraftPersistence/entry.ts';
import {
  assertNoSensitiveDraftFields,
  projectActiveDraftForAuthorizedClient,
  projectSubmittedDraftForAuthorizedClient,
} from '../proDraftProjection/entry.ts';
import {
  type DraftRecord,
  type DraftRepository,
  ProDraftRepositoryError,
  createDraftRecord,
  createDraftRepository,
  findDraftByBootstrapIdempotencyHash,
  findDraftsByIdentityKeyHash,
  findDraftsByResumeTokenHash,
  updateDraftRecord,
} from '../proDraftRepository/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  type PurposeBoundSecret,
  generateOpaqueToken,
  generateSecureRecoveryCode,
  hashNormalizedRecoveryEmail,
  hashRecoveryCode,
  hashResumeToken,
  hmacSha256Hex,
  sha256Hex,
} from '../proDraftSecurity/entry.ts';
import {
  assertDurableDraftServerEnabled,
  getBackendRuntimeConfig,
} from '../proDraftRuntimeConfig/entry.ts';

export const PRO_DRAFT_BOOTSTRAP_LOAD_VERSION = 1;
export const PRO_FORM_IDEMPOTENCY_SECRET = 'PRO_FORM_IDEMPOTENCY_SECRET';

export const BOOTSTRAP_LOAD_ERROR_CODES = Object.freeze({
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_AUTHORIZATION: 'INVALID_AUTHORIZATION',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  DRAFT_SUPERSEDED: 'DRAFT_SUPERSEDED',
  DRAFT_EXPIRED: 'DRAFT_EXPIRED',
  DRAFT_DELETED: 'DRAFT_DELETED',
  SUBMITTED_SCOPE_REQUIRED: 'SUBMITTED_SCOPE_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  CANONICAL_STATE_ERROR: 'CANONICAL_STATE_ERROR',
  DRAFT_CREATE_FAILED: 'DRAFT_CREATE_FAILED',
  DRAFT_LOAD_FAILED: 'DRAFT_LOAD_FAILED',
} as const);

type PublicErrorCode = typeof BOOTSTRAP_LOAD_ERROR_CODES[
  keyof typeof BOOTSTRAP_LOAD_ERROR_CODES
];
type Operation = 'bootstrap' | 'load';

export type DraftFunctionDependencies = Readonly<{
  createClientFromRequest: (request: Request) => unknown;
  getEnvironmentValue: (name: string) => string | undefined;
  createRequestId?: () => string;
  now?: () => Date;
  generateSessionId?: () => string;
  generateResumeToken?: () => string;
}>;

type Secrets = Readonly<{
  resume: PurposeBoundSecret;
  recoveryCode: PurposeBoundSecret;
  recoveryEmail: PurposeBoundSecret;
  signedInvitation: AuthorizationSecret;
  recoverySession: AuthorizationSecret;
  idempotency: string;
}>;

class DraftFunctionError extends Error {
  readonly code: PublicErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: PublicErrorCode, status = 400, retryable = false) {
    super('The draft request could not be completed.');
    this.name = 'DraftFunctionError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function fail(code: PublicErrorCode, status = 400, retryable = false): never {
  throw new DraftFunctionError(code, status, retryable);
}

function requireSecret(
  dependencies: DraftFunctionDependencies,
  name: string,
): string {
  const value = dependencies.getEnvironmentValue(name);
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength < 32) {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.FEATURE_DISABLED, 503, true);
  }
  return value;
}

function resolveSecrets(dependencies: DraftFunctionDependencies): Secrets {
  return Object.freeze({
    resume: Object.freeze({
      name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
      value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RESUME_TOKEN),
    }),
    recoveryCode: Object.freeze({
      name: SECURITY_SECRET_NAMES.RECOVERY_CODE,
      value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RECOVERY_CODE),
    }),
    recoveryEmail: Object.freeze({
      name: SECURITY_SECRET_NAMES.RECOVERY_EMAIL,
      value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RECOVERY_EMAIL),
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

function normalizeEmail(value: string): string {
  const normalized = value.trim().normalize('NFKC').toLowerCase();
  if (normalized.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)) {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.INVALID_REQUEST);
  }
  return normalized;
}

function normalizeIdentityValue(value: string | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().normalize('NFKC').toLowerCase();
}

function expiryOneYear(now: Date): string {
  const expiry = new Date(now.getTime());
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry.toISOString();
}

function emptyCanonicalState(
  context: DraftClientContext,
  sessionId: string,
  draftId: string | null,
  now: string,
): Record<string, unknown> {
  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    userId: context.userId,
    userName: context.userName,
    businessName: context.businessName,
    domainName: context.domainName,
    recoveryEmail: context.recoveryEmail,
  })) {
    if (typeof value === 'string' && value.length > 0) credentials[key] = value;
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
    savedAtServer: now,
    sourceTabId: context.sourceTabId ?? null,
    responses: {},
    validationStatus: {},
    touchedQuestions: {},
    expandedQuestions: {},
    textValidationMeta: {},
    credentials,
    identityContext: {
      identityContextVersion: context.identityContextVersion,
      recoveryEmailSource: context.recoveryEmailSource ?? 'anonymous',
      recoveryEmailVerificationStatus:
        context.recoveryEmailVerificationStatus ?? 'unverified',
      identityAssociationIntent: context.associationIntent,
      anonymousRecoveryAcknowledged: context.anonymousRecoveryAcknowledged,
      signedInvitationEmailChanged: context.associationIntent === 'changed_signed_email',
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
      sourceType: 'canonical',
      sourceVersion: 4,
      migratedAtClient: null,
      migrationWarnings: [],
    },
  };
}

async function canonicalStateHash(state: Record<string, unknown>): Promise<string> {
  const normalized = JSON.parse(
    validateCanonicalPayloadSize(state).serialized,
  ) as Record<string, unknown>;
  normalized.savedAtClient = null;
  normalized.savedAtServer = null;
  normalized.compatibility = {
    sourceType: 'canonical',
    sourceVersion: 4,
    migratedAtClient: null,
    migrationWarnings: [],
  };
  normalized.submission = {
    ...(normalized.submission as Record<string, unknown>),
    submittedStateHash: null,
    pdfSourceStateHash: null,
  };
  return sha256Hex(validateCanonicalPayloadSize(normalized).serialized);
}

function safeJsonObject(
  source: unknown,
  warning: string,
  warnings: string[],
): Record<string, unknown> {
  if (source === undefined || source === null || source === '') return {};
  try {
    const parsed = typeof source === 'string' ? JSON.parse(source) : source;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The per-column warning preserves other valid legacy columns.
  }
  warnings.push(warning);
  return {};
}

function canonicalRecord(
  record: DraftRecord,
): Readonly<{ record: DraftRecord; warnings: readonly string[] }> {
  if (typeof record.draft_state_json === 'string' && record.draft_state_json.length > 0) {
    try {
      const parsed = JSON.parse(record.draft_state_json);
      validateCanonicalPayloadSize(parsed);
      return Object.freeze({ record, warnings: Object.freeze([]) });
    } catch {
      return fail(BOOTSTRAP_LOAD_ERROR_CODES.CANONICAL_STATE_ERROR, 500);
    }
  }
  const warnings: string[] = ['LEGACY_DRAFT_RECONSTRUCTED'];
  const normalizedStatus = normalizeDraftLifecycleStatus(record.status);
  if (record.status === '' || record.status === 'draft' || record.status == null) {
    warnings.push('LEGACY_STATUS_NORMALIZED');
  }
  const responses = safeJsonObject(
    record.responses_json,
    'LEGACY_RESPONSES_MALFORMED',
    warnings,
  );
  const mapped = safeJsonObject(
    record.mapped_payload_json,
    'LEGACY_MAPPED_PAYLOAD_MALFORMED',
    warnings,
  );
  safeJsonObject(
    record.metadata_json,
    'LEGACY_METADATA_MALFORMED',
    warnings,
  );
  const mappedUserdata = mapped.userdata !== null
    && typeof mapped.userdata === 'object'
    && !Array.isArray(mapped.userdata)
    ? mapped.userdata as Record<string, unknown>
    : {};
  const state: Record<string, unknown> = {
    schemaVersion: 4,
    formType: 'pro-questionnaire',
    draftId: typeof record.id === 'string' ? record.id : null,
    sessionId: typeof record.session_id === 'string' ? record.session_id : null,
    draftStatus: normalizedStatus,
    clientRevision: Number.isSafeInteger(record.client_revision) ? record.client_revision : 0,
    serverRevision: Number.isSafeInteger(record.server_revision) ? record.server_revision : 0,
    savedAtClient: null,
    savedAtServer: typeof record.last_saved_at === 'string' ? record.last_saved_at : null,
    sourceTabId: typeof record.source_tab_id === 'string' ? record.source_tab_id : null,
    responses: Object.keys(responses).length > 0 ? responses : mappedUserdata,
    validationStatus: safeJsonObject(record.validation_status_json, 'LEGACY_VALIDATION_MALFORMED', warnings),
    touchedQuestions: safeJsonObject(record.touched_questions_json, 'LEGACY_TOUCHED_MALFORMED', warnings),
    expandedQuestions: safeJsonObject(record.expanded_questions_json, 'LEGACY_EXPANDED_MALFORMED', warnings),
    textValidationMeta: safeJsonObject(record.text_validation_meta_json, 'LEGACY_TEXT_META_MALFORMED', warnings),
    credentials: safeJsonObject(record.credentials_json, 'LEGACY_CREDENTIALS_MALFORMED', warnings),
    identityContext: {},
    uiDraftState: safeJsonObject(record.ui_draft_state_json, 'LEGACY_UI_STATE_MALFORMED', warnings),
    fieldChangeMetadata: safeJsonObject(record.field_change_metadata_json, 'LEGACY_FIELD_META_MALFORMED', warnings),
    currentQuestionId: typeof record.current_question_id === 'string' && record.current_question_id ? record.current_question_id : null,
    lastChangedQuestionId: typeof record.last_changed_question_id === 'string' && record.last_changed_question_id ? record.last_changed_question_id : null,
    lastMutation: null,
    submission: {
      finalSubmissionId: typeof record.final_submission_id === 'string' ? record.final_submission_id : null,
      submittedAt: typeof record.submitted_at === 'string' ? record.submitted_at : null,
      submittedStateHash: typeof record.submitted_state_hash === 'string' ? record.submitted_state_hash : null,
      pdfSourceStateHash: typeof record.pdf_source_state_hash === 'string' ? record.pdf_source_state_hash : null,
      lastSubmissionErrorCode: typeof record.last_submission_error_code === 'string' ? record.last_submission_error_code : null,
    },
    compatibility: {
      sourceType: 'legacy-compatibility-columns',
      sourceVersion: Number.isSafeInteger(record.draft_schema_version) ? record.draft_schema_version : 1,
      migratedAtClient: null,
      migrationWarnings: [...new Set(warnings)],
    },
  };
  try {
    const canonical = validateCanonicalPayloadSize(state);
    const stateHash = typeof record.state_hash === 'string'
      ? record.state_hash
      : undefined;
    return Object.freeze({
      record: Object.freeze({
        ...record,
        status: normalizedStatus,
        draft_state_json: canonical.serialized,
        ...(stateHash ? {} : {}),
      }),
      warnings: Object.freeze([...new Set(warnings)]),
    });
  } catch {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.CANONICAL_STATE_ERROR, 500);
  }
}

function statusOrFail(record: DraftRecord): string {
  let status: string;
  try {
    status = normalizeDraftLifecycleStatus(record.status);
  } catch {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_LOAD_FAILED, 500);
  }
  if (status === 'cleared_superseded') {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_SUPERSEDED, 409);
  }
  if (status === 'expired') return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_EXPIRED, 410);
  if (status === 'deleted') return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_DELETED, 410);
  return status;
}

function project(
  recordInput: DraftRecord,
  scopes: readonly string[],
  includeCanonicalState = true,
): Readonly<{ draft: Readonly<Record<string, unknown>>; readOnly: boolean; canWrite: boolean; warnings: readonly string[] }> {
  const normalized = canonicalRecord(recordInput);
  const status = statusOrFail(normalized.record);
  const submitted = status === 'submitted';
  const canWrite = !submitted && scopes.includes(PRO_DRAFT_ACCESS_SCOPES.WRITE);
  if (submitted && !scopes.includes(PRO_DRAFT_ACCESS_SCOPES.SUBMITTED_READ)) {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.SUBMITTED_SCOPE_REQUIRED, 403);
  }
  if (!submitted && !scopes.includes(PRO_DRAFT_ACCESS_SCOPES.READ)
    && !scopes.includes(PRO_DRAFT_ACCESS_SCOPES.CREATE)) {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.INVALID_AUTHORIZATION, 403);
  }
  const base = submitted
    ? projectSubmittedDraftForAuthorizedClient(normalized.record, { includeCanonicalState })
    : projectActiveDraftForAuthorizedClient(normalized.record, { includeCanonicalState });
  const draft = Object.freeze({ ...base, readOnly: !canWrite });
  assertNoSensitiveDraftFields(draft);
  return Object.freeze({
    draft,
    readOnly: !canWrite,
    canWrite,
    warnings: normalized.warnings,
  });
}

async function signedClaims(
  token: string,
  context: DraftClientContext,
  environment: 'local' | 'test' | 'staging' | 'production',
  secrets: Secrets,
  now: Date,
): Promise<SignedInvitationClaims> {
  const raw = await verifyStructuredToken(token, {
    expectedType: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
    expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
    expectedEnvironment: environment,
    expectedGrantVersion: 1,
    secret: secrets.signedInvitation,
    clock: () => Math.floor(now.getTime() / 1000),
  }) as SignedInvitationClaims;
  const email = context.recoveryEmail ? normalizeEmail(context.recoveryEmail) : '';
  const userId = normalizeIdentityValue(context.userId);
  const domain = normalizeIdentityValue(context.domainName);
  if (!email || !userId || !domain) {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.INVALID_AUTHORIZATION, 401);
  }
  const expectedEmail = await hashNormalizedRecoveryEmail(email, secrets.recoveryEmail);
  const expectedUser = await hmacSha256Hex(
    `pro-draft:signed-visible-user:v1:${userId}`,
    secrets.signedInvitation.value,
  );
  const expectedDomain = await hmacSha256Hex(
    `pro-draft:signed-visible-domain:v1:${domain}`,
    secrets.signedInvitation.value,
  );
  return validateSignedInvitationClaims(raw, {
    expectedEnvironment: environment,
    expectedFormType: context.formType,
    expectedRecoveryEmailLookupHash:
      context.associationIntent === 'changed_signed_email'
        ? undefined
        : expectedEmail,
    expectedUserIdHash: expectedUser,
    expectedDomainIdentityHash: expectedDomain,
    clock: () => Math.floor(now.getTime() / 1000),
  });
}

async function identityKeyHash(claims: SignedInvitationClaims): Promise<string> {
  return sha256Hex([
    'pro-draft:verified-invitation-identity:v1',
    claims.formType,
    claims.invitationId,
    claims.userIdHash,
    claims.recoveryEmailLookupHash,
    claims.domainIdentityHash,
  ].join(':'));
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

async function restored(
  repository: DraftRepository,
  record: DraftRecord,
  timestamp: string,
): Promise<DraftRecord> {
  if (typeof record.id !== 'string') {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_LOAD_FAILED, 500);
  }
  try {
    return await updateDraftRecord(repository, record.id, { last_restored_at: timestamp });
  } catch {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_LOAD_FAILED, 500, true);
  }
}

async function createNewDraft(
  request: BootstrapDraftRequest,
  repository: DraftRepository,
  secrets: Secrets,
  now: Date,
  environment: 'local' | 'test' | 'staging' | 'production',
  dependencies: DraftFunctionDependencies,
  signedIdentityKeyHash?: string,
): Promise<Readonly<Record<string, unknown>>> {
  if (environment === 'production' && !request.clientBootstrapToken) {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.INVALID_REQUEST);
  }
  const idempotencyHash = await hmacSha256Hex(
    `pro-draft:bootstrap-idempotency:v1:${request.idempotencyKey}`,
    secrets.idempotency,
  );
  let existing: DraftRecord | null;
  try {
    existing = await findDraftByBootstrapIdempotencyHash(repository, idempotencyHash);
  } catch {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.IDEMPOTENCY_CONFLICT, 409);
  }
  if (existing) {
    if (request.clientBootstrapToken) {
      const replayTokenHash = await hashResumeToken(
        request.clientBootstrapToken,
        secrets.resume,
      );
      if (existing.resume_token_hash !== replayTokenHash) {
        return fail(BOOTSTRAP_LOAD_ERROR_CODES.INVALID_AUTHORIZATION, 401);
      }
    }
    const projected = project(existing, [
      PRO_DRAFT_ACCESS_SCOPES.READ,
      PRO_DRAFT_ACCESS_SCOPES.WRITE,
      ...(existing.status === 'submitted' ? [PRO_DRAFT_ACCESS_SCOPES.SUBMITTED_READ] : []),
    ]);
    return Object.freeze({
      success: true,
      apiVersion: 1,
      created: false,
      resumed: true,
      draft: projected.draft,
      recoveryCodeIssued: false,
      resumeTokenIssued: false,
      credentialsReissueRequired: true,
      recoveryCodeReissueRequired: true,
      authorizationMethod: request.authorization.method,
      readOnly: projected.readOnly,
      warnings: Object.freeze(['IDEMPOTENT_BOOTSTRAP_REPLAY']),
    });
  }

  const timestamp = now.toISOString();
  const sessionId = dependencies.generateSessionId?.()
    ?? generateOpaqueToken({ prefix: 'pds_' });
  const recovery = generateSecureRecoveryCode();
  const resumeToken = request.clientBootstrapToken
    ?? dependencies.generateResumeToken?.()
    ?? generateOpaqueToken();
  const [recoveryCodeHash, resumeTokenHash, recoveryEmailLookupHash] = await Promise.all([
    hashRecoveryCode(recovery.normalizedCode, secrets.recoveryCode),
    hashResumeToken(resumeToken, secrets.resume),
    request.clientContext.recoveryEmail
      ? hashNormalizedRecoveryEmail(
        normalizeEmail(request.clientContext.recoveryEmail),
        secrets.recoveryEmail,
      )
      : Promise.resolve(undefined),
  ]);
  const state = emptyCanonicalState(request.clientContext, sessionId, null, timestamp);
  const stateHash = await canonicalStateHash(state);
  const compatibility = buildDraftCompatibilityColumns(
    state,
    { metadata: {}, userdata: {} },
    {
      stateHash,
      clientRevision: 0,
      serverRevision: 0,
      sourceTabId: request.clientContext.sourceTabId ?? null,
      lastSyncReason: 'bootstrap_upload',
    },
  );
  const data: Record<string, unknown> = {
    ...compatibility,
    current_question_id: '',
    last_changed_question_id: '',
    session_id: sessionId,
    form_type: 'pro-questionnaire',
    status: 'active',
    status_version: 1,
    draft_generation: 1,
    recovery_code_hash: recoveryCodeHash,
    recovery_code_version: recovery.version,
    recovery_code_hint: recovery.hint,
    resume_token_hash: resumeTokenHash,
    recovery_session_version: 1,
    bootstrap_idempotency_key_hash: idempotencyHash,
    retention_expires_at: expiryOneYear(now),
    retention_hold: false,
    retention_policy_version: 1,
    environment,
    last_saved_at: timestamp,
    business_name: request.clientContext.businessName ?? '',
    domain: request.clientContext.domainName ?? '',
    user_id: request.clientContext.userId ?? '',
    user_name: request.clientContext.userName ?? '',
    ...(request.testRunId ? { test_run_id: request.testRunId } : {}),
    ...(signedIdentityKeyHash ? { identity_key_hash: signedIdentityKeyHash } : {}),
  };
  if (request.clientContext.recoveryEmail && recoveryEmailLookupHash) {
    data.recovery_email = normalizeEmail(request.clientContext.recoveryEmail);
    data.recovery_email_lookup_hash = recoveryEmailLookupHash;
    data.recovery_email_source = request.clientContext.recoveryEmailSource
      ?? 'client_entered';
    data.recovery_email_verification_status = signedIdentityKeyHash
      ? 'verified_signed_invitation'
      : 'unverified';
    if (signedIdentityKeyHash) data.recovery_email_verified_at = timestamp;
  }
  let created: DraftRecord;
  try {
    created = await createDraftRecord(repository, data);
    if (typeof created.id !== 'string') throw new Error('missing id');
    const boundState = emptyCanonicalState(
      request.clientContext,
      sessionId,
      created.id,
      timestamp,
    );
    const boundHash = await canonicalStateHash(boundState);
    const boundCompatibility = buildDraftCompatibilityColumns(
      boundState,
      { metadata: {}, userdata: {} },
      {
        stateHash: boundHash,
        clientRevision: 0,
        serverRevision: 0,
        sourceTabId: request.clientContext.sourceTabId ?? null,
        lastSyncReason: 'bootstrap_upload',
      },
    );
    created = await updateDraftRecord(repository, created.id, {
      ...boundCompatibility,
      current_question_id: '',
      last_changed_question_id: '',
    });
  } catch {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_CREATE_FAILED, 500, true);
  }
  const projected = project(created, [
    PRO_DRAFT_ACCESS_SCOPES.READ,
    PRO_DRAFT_ACCESS_SCOPES.WRITE,
  ]);
  return Object.freeze({
    success: true,
    apiVersion: 1,
    created: true,
    resumed: false,
    draft: projected.draft,
    recoveryCode: recovery.formattedCode,
    ...(request.clientBootstrapToken === undefined ? { resumeToken } : {}),
    recoveryCodeIssued: true,
    resumeTokenIssued: request.clientBootstrapToken === undefined,
    credentialsReissueRequired: false,
    recoveryCodeReissueRequired: false,
    authorizationMethod: request.authorization.method,
    readOnly: false,
    warnings: Object.freeze([]),
  });
}

async function bootstrap(
  request: BootstrapDraftRequest,
  repository: DraftRepository,
  secrets: Secrets,
  now: Date,
  environment: 'local' | 'test' | 'staging' | 'production',
  dependencies: DraftFunctionDependencies,
): Promise<Readonly<Record<string, unknown>>> {
  const method = request.authorization.method;
  if (method === PRO_DRAFT_AUTHORIZATION_METHODS.RESUME_TOKEN) {
    const hash = await hashResumeToken(request.authorization.resumeToken, secrets.resume);
    const matches = await findDraftsByResumeTokenHash(repository, hash, 25);
    if (matches.length === 0) return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_NOT_FOUND, 404);
    const selected = selectCanonicalDuplicateDraft(matches);
    if (!selected.selected) return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_NOT_FOUND, 404);
    const updated = await restored(repository, selected.selected, now.toISOString());
    const projected = project(updated, [
      PRO_DRAFT_ACCESS_SCOPES.READ,
      PRO_DRAFT_ACCESS_SCOPES.WRITE,
      ...(updated.status === 'submitted' ? [PRO_DRAFT_ACCESS_SCOPES.SUBMITTED_READ] : []),
    ]);
    return Object.freeze({
      success: true, apiVersion: 1, created: false, resumed: true,
      draft: projected.draft, recoveryCodeIssued: false, resumeTokenIssued: false,
      authorizationMethod: method, readOnly: projected.readOnly,
      warnings: Object.freeze([...selected.warnings, ...projected.warnings]),
    });
  }

  let verifiedIdentityKeyHash: string | undefined;
  if (method === PRO_DRAFT_AUTHORIZATION_METHODS.SIGNED_INVITATION) {
    const claims = await signedClaims(
      request.authorization.signedDraftAccessToken,
      request.clientContext,
      environment,
      secrets,
      now,
    );
    verifiedIdentityKeyHash = await identityKeyHash(claims);
    const mustCreate = request.clientContext.associationIntent === 'changed_signed_email'
      || claims.allowedAssociation === 'new_draft';
    if (!mustCreate) {
      const matches = await findDraftsByIdentityKeyHash(repository, verifiedIdentityKeyHash, 25);
      const selected = selectCanonicalDuplicateDraft(matches);
      if (selected.selected) {
        const updated = await restored(repository, selected.selected, now.toISOString());
        const projected = project(updated, [
          PRO_DRAFT_ACCESS_SCOPES.READ,
          PRO_DRAFT_ACCESS_SCOPES.WRITE,
          ...(updated.status === 'submitted' ? [PRO_DRAFT_ACCESS_SCOPES.SUBMITTED_READ] : []),
        ]);
        return Object.freeze({
          success: true, apiVersion: 1, created: false, resumed: true,
          draft: projected.draft, recoveryCodeIssued: false, resumeTokenIssued: false,
          authorizationMethod: method, readOnly: projected.readOnly,
          warnings: Object.freeze([...selected.warnings, ...projected.warnings]),
        });
      }
    }
    return createNewDraft(
      request,
      repository,
      secrets,
      now,
      environment,
      dependencies,
      request.clientContext.associationIntent === 'changed_signed_email'
        ? undefined
        : verifiedIdentityKeyHash,
    );
  }

  if (method === PRO_DRAFT_AUTHORIZATION_METHODS.RECOVERY_SESSION) {
    const resolved = await resolveDraftAuthorization({
      operation: PRO_DRAFT_API_OPERATION_NAMES.BOOTSTRAP_DRAFT,
      authorization: request.authorization,
    }, resolverOptions(repository, environment, secrets, now));
    if (!resolved.record) return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_NOT_FOUND, 404);
    const updated = await restored(repository, resolved.record, now.toISOString());
    const projected = project(updated, resolved.scopes);
    return Object.freeze({
      success: true, apiVersion: 1, created: false, resumed: true,
      draft: projected.draft, recoveryCodeIssued: false, resumeTokenIssued: false,
      authorizationMethod: method, readOnly: projected.readOnly,
      warnings: projected.warnings,
    });
  }
  return createNewDraft(
    request,
    repository,
    secrets,
    now,
    environment,
    dependencies,
  );
}

async function load(
  request: LoadDraftRequest,
  repository: DraftRepository,
  secrets: Secrets,
  now: Date,
  environment: 'local' | 'test' | 'staging' | 'production',
): Promise<Readonly<Record<string, unknown>>> {
  if (request.upgradeLegacyOnLoad) {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.INVALID_REQUEST);
  }
  if (request.authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.SIGNED_INVITATION) {
    await signedClaims(
      request.authorization.signedDraftAccessToken,
      request.clientContext,
      environment,
      secrets,
      now,
    );
  }
  const resolved = await authorizeDraftRead({
    operation: PRO_DRAFT_API_OPERATION_NAMES.LOAD_DRAFT,
    authorization: request.authorization,
    requestedDraftId: request.requestedDraftId,
  }, resolverOptions(repository, environment, secrets, now));
  if (!resolved.record || resolved.draftId !== request.requestedDraftId) {
    return fail(BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_NOT_FOUND, 404);
  }
  statusOrFail(resolved.record);
  const updated = await restored(repository, resolved.record, now.toISOString());
  const projected = project(updated, resolved.scopes, request.includeCanonicalState);
  return Object.freeze({
    success: true,
    apiVersion: 1,
    authorizationMethod: resolved.method,
    draft: projected.draft,
    readOnly: projected.readOnly,
    canWrite: projected.canWrite,
    warnings: projected.warnings,
  });
}

function safeError(error: unknown, requestId: string): Response {
  let failure: DraftFunctionError;
  if (error instanceof DraftFunctionError) {
    failure = error;
  } else if (error instanceof ProDraftPersistenceError) {
    failure = new DraftFunctionError(
      BOOTSTRAP_LOAD_ERROR_CODES.INVALID_REQUEST,
      error.status,
      error.retryable,
    );
  } else if (error instanceof ProDraftApiError) {
    failure = new DraftFunctionError(
      error.status === 401
        ? BOOTSTRAP_LOAD_ERROR_CODES.INVALID_AUTHORIZATION
        : BOOTSTRAP_LOAD_ERROR_CODES.INVALID_REQUEST,
      error.status,
      error.retryable,
    );
  } else if (error instanceof ProDraftAuthorizationResolverError) {
    const submitted = error.code.includes('SCOPE_MISSING');
    failure = new DraftFunctionError(
      submitted
        ? BOOTSTRAP_LOAD_ERROR_CODES.SUBMITTED_SCOPE_REQUIRED
        : BOOTSTRAP_LOAD_ERROR_CODES.INVALID_AUTHORIZATION,
      error.status,
    );
  } else if (error instanceof ProDraftAuthorizationError) {
    failure = new DraftFunctionError(
      BOOTSTRAP_LOAD_ERROR_CODES.INVALID_AUTHORIZATION,
      401,
    );
  } else if (error instanceof ProDraftRepositoryError) {
    failure = new DraftFunctionError(
      BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_LOAD_FAILED,
      500,
      error.retryable,
    );
  } else {
    failure = new DraftFunctionError(
      BOOTSTRAP_LOAD_ERROR_CODES.DRAFT_LOAD_FAILED,
      500,
      true,
    );
  }
  return buildSafeJsonResponse({
    success: false,
    errorCode: failure.code,
    message: failure.status === 405
      ? 'The request method is not allowed.'
      : failure.status === 415
        ? 'The request content type is not supported.'
        : failure.status === 413
          ? 'The request is too large.'
          : failure.status >= 500
            ? 'The draft request could not be completed.'
            : 'Draft access or request validation failed.',
    requestId,
    retryable: failure.retryable,
  }, {
    status: failure.status,
    headers: failure.status === 405 ? { Allow: 'POST' } : {},
  });
}

export function createDraftFunctionHandler(
  operation: Operation,
  dependencies: DraftFunctionDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestId = createServerRequestId(
      dependencies.createRequestId
        ? { generator: dependencies.createRequestId }
        : {},
    );
    try {
      const runtime = assertDurableDraftServerEnabled(
        getBackendRuntimeConfig(dependencies.getEnvironmentValue),
      );
      if (runtime.environment === 'unknown') {
        return fail(BOOTSTRAP_LOAD_ERROR_CODES.FEATURE_DISABLED, 503, true);
      }
      validateRequestMethod(request, 'POST');
      validateJsonContentType(request);
      const body = await readBoundedJsonBody(request, {
        method: 'POST',
        maxBytes: DEFAULT_MAX_API_REQUEST_BYTES,
      });
      const environment = runtime.environment;
      const validated = operation === 'bootstrap'
        ? validateBootstrapDraftRequest(body, { environment })
        : validateLoadDraftRequest(body, { environment });
      const client = dependencies.createClientFromRequest(request);
      const repository = createDraftRepository(client);
      const secrets = resolveSecrets(dependencies);
      const now = dependencies.now?.() ?? new Date();
      const result = operation === 'bootstrap'
        ? await bootstrap(
          validated as BootstrapDraftRequest,
          repository,
          secrets,
          now,
          environment,
          dependencies,
        )
        : await load(
          validated as LoadDraftRequest,
          repository,
          secrets,
          now,
          environment,
        );
      return buildSafeJsonResponse({ ...result, requestId });
    } catch (error) {
      if (error instanceof Error && error.name === 'ProDraftRuntimeConfigError') {
        return safeError(
          new DraftFunctionError(
            BOOTSTRAP_LOAD_ERROR_CODES.FEATURE_DISABLED,
            503,
            true,
          ),
          requestId,
        );
      }
      return safeError(error, requestId);
    }
  };
}

export function createBootstrapProFormDraftHandler(
  dependencies: DraftFunctionDependencies,
): (request: Request) => Promise<Response> {
  return createDraftFunctionHandler('bootstrap', dependencies);
}

export function createLoadProFormDraftHandler(
  dependencies: DraftFunctionDependencies,
): (request: Request) => Promise<Response> {
  return createDraftFunctionHandler('load', dependencies);
}
