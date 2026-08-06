/** Injectable orchestration for unverified email recovery and associated choices. */

import {
  AUTHORIZATION_SECRET_NAMES,
  DEFAULT_RECOVERY_SESSION_TTL_SECONDS,
  MAX_RECOVERY_SESSION_TTL_SECONDS,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  type AuthorizationSecret,
  type RecoverySessionClaims,
  issueRecoverySessionToken,
  verifyRecoverySessionToken,
  verifyStructuredToken,
} from '../proDraftAuthorization/entry.ts';
import { verifyRecoveryCaptcha } from '../proDraftCaptcha/entry.ts';
import {
  RECOVERY_CODE_VERSION,
  isDraftEligibleForAutomaticEmailRecovery,
  normalizeLegacyDraftStatus,
  normalizeRecoveryEmail,
  selectNewestEligibleDraft,
  sortDraftsForEmailRecovery,
} from '../proDraftIdentity/entry.ts';
import {
  ProDraftPersistenceError,
  buildSafeJsonResponse,
  createServerRequestId,
  readBoundedJsonBody,
  validateJsonContentType,
  validateRequestMethod,
} from '../proDraftPersistence/entry.ts';
import {
  projectDraftRecoveryChoiceForAuthorizedClient,
  projectDraftRecoverySummaryForAuthorizedClient,
} from '../proDraftProjection/entry.ts';
import {
  PRO_FORM_ABUSE_HASH_SECRET_NAME,
  type AbuseHashSecret,
  type RecoveryAbuseHashes,
  type RecoveryAttemptEvaluation,
  type RecoveryAttemptOutcome,
  type RecoveryAttemptType,
  calculateLockoutUntil,
  calculateRecoveryDelay,
  createGenericPublicRecoveryFailure,
  deriveRecoveryAbuseHashes,
  evaluateRecoveryAttempt,
  getRecentRecoverySecurityEvents,
  getRecoverySecurityPolicy,
  readTrustedClientNetworkContext,
  recordRecoverySecurityEvent,
} from '../proDraftRecoverySecurity/entry.ts';
import {
  MAX_EMAIL_RECOVERY_QUERY_LIMIT,
  type DraftRecord,
  type DraftRepository,
  createDraftRepository,
  findDraftsByRecoveryEmailLookupHash,
  getDraftById,
} from '../proDraftRepository/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  type PurposeBoundSecret,
  hashNormalizedRecoveryEmail,
  sha256Hex,
  timingSafeEqualStrings,
} from '../proDraftSecurity/entry.ts';
import {
  assertDurableDraftServerEnabled,
  getBackendRuntimeConfig,
} from '../proDraftRuntimeConfig/entry.ts';

export const PRO_DRAFT_EMAIL_RECOVERY_VERSION = 1;
export const MAX_EMAIL_RECOVERY_REQUEST_BYTES = 32 * 1024;
export const MAX_RECOVERY_CHOICES = 25;
export const PRO_FORM_RECOVERY_SESSION_TTL_SECONDS =
  'PRO_FORM_RECOVERY_SESSION_TTL_SECONDS';

export const EMAIL_RECOVERY_ERROR_CODES = Object.freeze({
  EVENT_WRITE_FAILED: 'EMAIL_RECOVERY_EVENT_WRITE_FAILED',
  HASH_BINDING_INVALID: 'EMAIL_RECOVERY_HASH_BINDING_INVALID',
  INTERNAL_ERROR: 'EMAIL_RECOVERY_INTERNAL_ERROR',
  SESSION_BINDING_INVALID: 'EMAIL_RECOVERY_SESSION_BINDING_INVALID',
  STATUS_INVALID: 'EMAIL_RECOVERY_STATUS_INVALID',
} as const);

type Environment = 'local' | 'test' | 'staging' | 'production';
type SafeLogEvent = Readonly<{ requestId: string; errorCode: string }>;
type SecurityEntity = Readonly<{
  create: (data: Record<string, unknown>) => Promise<unknown>;
  filter: (
    query: Record<string, unknown>,
    sort?: string,
    limit?: number,
    skip?: number,
  ) => Promise<unknown[]>;
}>;

export type EmailRecoveryFunctionDependencies = Readonly<{
  createClientFromRequest: (request: Request) => unknown;
  getEnvironmentValue: (name: string) => string | undefined;
  createRequestId?: () => string;
  now?: () => Date;
  clockMs?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  cryptoProvider?: Pick<Crypto, 'getRandomValues' | 'subtle'>;
  fetchImpl?: typeof fetch;
  tokenIdGenerator?: () => string;
  safeLog?: (event: SafeLogEvent) => void;
}>;

type ClientContext = Readonly<{
  formType?: string;
  sourceTabId?: string;
  appBuildSha?: string;
  environment?: Environment;
}>;

export type EmailRecoveryRequest = Readonly<{
  apiVersion: 1;
  email: string;
  deviceId?: string;
  captchaToken?: string;
  clientContext: ClientContext;
  testRunId?: string;
}>;

export type ListRecoveryChoicesRequest = Readonly<{
  apiVersion: 1;
  recoverySessionToken: string;
  testRunId?: string;
}>;

export type SelectRecoveryChoiceRequest = Readonly<{
  apiVersion: 1;
  recoverySessionToken: string;
  selectedDraftId: string;
  testRunId?: string;
}>;

const EMAIL_REQUEST_KEYS = new Set([
  'apiVersion', 'email', 'deviceId', 'captchaToken', 'clientContext', 'testRunId',
]);
const LIST_REQUEST_KEYS = new Set([
  'apiVersion', 'recoverySessionToken', 'testRunId', 'email',
]);
const SELECT_REQUEST_KEYS = new Set([
  'apiVersion', 'recoverySessionToken', 'selectedDraftId', 'testRunId',
]);
const CONTEXT_KEYS = new Set([
  'formType', 'sourceTabId', 'appBuildSha', 'environment',
]);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const DEVICE_ID = /^pdd_[A-Za-z0-9_-]{22}$/u;
const BUILD_ID = /^[A-Za-z0-9._:+-]{1,128}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const ACTIVE_STATUSES = new Set(['active', 'submit_attempted', 'submit_failed']);

class EmailRecoveryError extends Error {
  readonly status: number;

  constructor(status = 400) {
    super('Recovery could not be completed.');
    this.name = 'EmailRecoveryError';
    this.status = status;
  }
}

function fail(status = 400): never {
  throw new EmailRecoveryError(status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: unknown, allowed: Set<string>): Record<string, unknown> {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    return fail();
  }
  return value;
}

function optionalSafeText(value: unknown, pattern: RegExp): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !pattern.test(value)) return fail();
  return value;
}

function requireToken(value: unknown): string {
  if (typeof value !== 'string' || value.length < 43 || value.length > 8192
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) return fail();
  return value;
}

function testRunId(value: unknown, environment: Environment): string | undefined {
  const output = optionalSafeText(value, SAFE_ID);
  if (output && environment === 'production') return fail();
  return output;
}

function context(value: unknown, environment: Environment): ClientContext {
  const input = exactKeys(value ?? {}, CONTEXT_KEYS);
  const formType = optionalSafeText(input.formType, /^pro-questionnaire$/u);
  const sourceTabId = optionalSafeText(input.sourceTabId, SAFE_ID);
  const appBuildSha = optionalSafeText(input.appBuildSha, BUILD_ID);
  if (input.environment !== undefined && input.environment !== environment) return fail();
  return Object.freeze({
    ...(formType ? { formType } : {}),
    ...(sourceTabId ? { sourceTabId } : {}),
    ...(appBuildSha ? { appBuildSha } : {}),
    ...(input.environment ? { environment: input.environment as Environment } : {}),
  });
}

export function validateEmailRecoveryRequest(
  value: unknown,
  environment: Environment,
): EmailRecoveryRequest {
  const input = exactKeys(value, EMAIL_REQUEST_KEYS);
  if (input.apiVersion !== PRO_DRAFT_EMAIL_RECOVERY_VERSION
    || typeof input.email !== 'string' || input.email.length === 0
    || input.email.length > 1024) return fail();
  const deviceId = optionalSafeText(input.deviceId, DEVICE_ID);
  const captchaToken = input.captchaToken === undefined ? undefined
    : typeof input.captchaToken === 'string' && input.captchaToken.length > 0
      && input.captchaToken.length <= 4096 ? input.captchaToken : fail();
  const marker = testRunId(input.testRunId, environment);
  return Object.freeze({
    apiVersion: 1,
    email: input.email,
    ...(deviceId ? { deviceId } : {}),
    ...(captchaToken ? { captchaToken } : {}),
    clientContext: context(input.clientContext, environment),
    ...(marker ? { testRunId: marker } : {}),
  });
}

export function validateListRecoveryChoicesRequest(
  value: unknown,
  environment: Environment,
): ListRecoveryChoicesRequest {
  const input = exactKeys(value, LIST_REQUEST_KEYS);
  if (input.apiVersion !== PRO_DRAFT_EMAIL_RECOVERY_VERSION) return fail();
  const marker = testRunId(input.testRunId, environment);
  return Object.freeze({
    apiVersion: 1,
    recoverySessionToken: requireToken(input.recoverySessionToken),
    ...(marker ? { testRunId: marker } : {}),
  });
}

export function validateSelectRecoveryChoiceRequest(
  value: unknown,
  environment: Environment,
): SelectRecoveryChoiceRequest {
  const input = exactKeys(value, SELECT_REQUEST_KEYS);
  if (input.apiVersion !== PRO_DRAFT_EMAIL_RECOVERY_VERSION) return fail();
  const marker = testRunId(input.testRunId, environment);
  return Object.freeze({
    apiVersion: 1,
    recoverySessionToken: requireToken(input.recoverySessionToken),
    selectedDraftId: optionalSafeText(input.selectedDraftId, SAFE_ID) ?? fail(),
    ...(marker ? { testRunId: marker } : {}),
  });
}

function requireSecret(
  dependencies: EmailRecoveryFunctionDependencies,
  name: string,
): string {
  const value = dependencies.getEnvironmentValue(name);
  if (typeof value !== 'string'
    || new TextEncoder().encode(value).byteLength < 32) return fail(503);
  return value;
}

function emailSecret(
  dependencies: EmailRecoveryFunctionDependencies,
): PurposeBoundSecret {
  return Object.freeze({
    name: SECURITY_SECRET_NAMES.RECOVERY_EMAIL,
    value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RECOVERY_EMAIL),
  });
}

function abuseSecret(
  dependencies: EmailRecoveryFunctionDependencies,
): AbuseHashSecret {
  return Object.freeze({
    name: PRO_FORM_ABUSE_HASH_SECRET_NAME,
    value: requireSecret(dependencies, PRO_FORM_ABUSE_HASH_SECRET_NAME),
  });
}

function recoverySessionSecret(
  dependencies: EmailRecoveryFunctionDependencies,
): AuthorizationSecret {
  return Object.freeze({
    name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
    value: requireSecret(dependencies, AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION),
  });
}

function sessionTtlSeconds(dependencies: EmailRecoveryFunctionDependencies): number {
  const raw = dependencies.getEnvironmentValue(PRO_FORM_RECOVERY_SESSION_TTL_SECONDS);
  if (raw === undefined || raw === '') return DEFAULT_RECOVERY_SESSION_TTL_SECONDS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0
    || value > MAX_RECOVERY_SESSION_TTL_SECONDS) return fail(503);
  return value;
}

function getSecurityEntity(client: unknown): SecurityEntity {
  if (!isPlainObject(client) || !isPlainObject(client.asServiceRole)
    || !isPlainObject(client.asServiceRole.entities)) return fail(503);
  const entity = client.asServiceRole.entities.ProFormRecoverySecurityEvent;
  if (!isPlainObject(entity) || typeof entity.create !== 'function'
    || typeof entity.filter !== 'function') return fail(503);
  return entity as unknown as SecurityEntity;
}

function safeLog(
  dependencies: EmailRecoveryFunctionDependencies,
  requestId: string,
  errorCode: string,
): void {
  try {
    dependencies.safeLog?.(Object.freeze({ requestId, errorCode }));
  } catch {
    // Safe logging cannot change the authorization decision.
  }
}

function safeErrorCode(error: unknown): string {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/u.test(code)
    ? code : EMAIL_RECOVERY_ERROR_CODES.INTERNAL_ERROR;
}

type AuditContext = Readonly<{
  entity: SecurityEntity;
  requestId: string;
  environment: Environment;
  hashes: RecoveryAbuseHashes;
  evaluation: RecoveryAttemptEvaluation;
  now: Date;
  attemptType: RecoveryAttemptType;
  testRunId?: string;
  recoveryEmailLookupHash?: string;
}>;

const ZERO_EVALUATION: RecoveryAttemptEvaluation = Object.freeze({
  allowed: true,
  locked: false,
  rateLimited: false,
  captchaRequired: false,
  errorCode: null,
  retryAfterSeconds: 0,
  failureCountWindow: 0,
  ipAttemptCountWindow: 0,
  subjectAttemptCountWindow: 0,
  globalAttemptCountWindow: 0,
  lockoutUntil: null,
  recordGlobalCircuitBreakerEvent: false,
});

function failureOutcome(outcome: RecoveryAttemptOutcome): boolean {
  return ['not_found', 'invalid_input', 'captcha_failed', 'internal_error']
    .includes(outcome);
}

async function audit(
  contextInput: AuditContext,
  outcome: RecoveryAttemptOutcome,
  options: Readonly<{
    captchaRequired?: boolean;
    captchaVerified?: boolean;
    draftId?: string;
    lockoutUntil?: string | null;
  }> = {},
): Promise<void> {
  const failureCount = contextInput.evaluation.failureCountWindow
    + (failureOutcome(outcome) ? 1 : 0);
  await recordRecoverySecurityEvent(contextInput.entity, {
    request_id: contextInput.requestId,
    environment: contextInput.environment,
    attempt_type: contextInput.attemptType,
    outcome,
    subject_hash: contextInput.hashes.emailSubjectHash ?? undefined,
    ip_hash: contextInput.hashes.ipHash,
    device_hash: contextInput.hashes.deviceHash ?? undefined,
    recovery_email_lookup_hash: contextInput.recoveryEmailLookupHash,
    captcha_required: options.captchaRequired === true,
    captcha_verified: options.captchaVerified === true,
    failure_count_window: failureCount,
    attempt_count_window: Math.max(
      contextInput.evaluation.ipAttemptCountWindow,
      contextInput.evaluation.subjectAttemptCountWindow,
    ) + 1,
    lockout_until: options.lockoutUntil ?? undefined,
    window_started_at: new Date(
      contextInput.now.getTime() - 15 * 60 * 1000,
    ).toISOString(),
    created_at_server: contextInput.now.toISOString(),
    draft_id: options.draftId,
    test_run_id: contextInput.testRunId,
  });
}

async function auditOnce(
  dependencies: EmailRecoveryFunctionDependencies,
  contextInput: AuditContext,
  outcome: RecoveryAttemptOutcome,
  options: Parameters<typeof audit>[2] = {},
): Promise<boolean> {
  try {
    await audit(contextInput, outcome, options);
    return true;
  } catch {
    safeLog(dependencies, contextInput.requestId, EMAIL_RECOVERY_ERROR_CODES.EVENT_WRITE_FAILED);
    return false;
  }
}

function genericFailure(
  requestId: string,
  options: Readonly<{
    status?: number;
    retryAfterSeconds?: number;
    captchaRequired?: boolean;
    allowPost?: boolean;
  }> = {},
): Response {
  const retryAfterSeconds = options.retryAfterSeconds ?? 0;
  const headers: Record<string, string> = {};
  if (retryAfterSeconds > 0) headers['Retry-After'] = String(retryAfterSeconds);
  if (options.allowPost) headers.Allow = 'POST';
  return buildSafeJsonResponse(createGenericPublicRecoveryFailure({
    requestId,
    retryAfterSeconds,
    captchaRequired: options.captchaRequired,
  }), { status: options.status ?? 200, headers });
}

function runtime(
  dependencies: EmailRecoveryFunctionDependencies,
): Readonly<{ environment: Environment }> {
  const config = assertDurableDraftServerEnabled(
    getBackendRuntimeConfig(dependencies.getEnvironmentValue),
  );
  if (config.environment === 'unknown' || !config.publicEmailRecoveryEnabled) {
    return fail(503);
  }
  return Object.freeze({ environment: config.environment as Environment });
}

function nowOrFail(dependencies: EmailRecoveryFunctionDependencies): Date {
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) return fail(503);
  return now;
}

function normalizedStatus(record: DraftRecord): string {
  return normalizeLegacyDraftStatus(record.status, {
    isValidLegacyDraft: typeof record.id === 'string'
      && (typeof record.created_date === 'string'
        || typeof record.created_at_server === 'string'),
  });
}

function scopesFor(record: DraftRecord): RecoverySessionClaims['authorizedScopes'] {
  const status = normalizedStatus(record);
  if (ACTIVE_STATUSES.has(status)) {
    return Object.freeze([
      SIGNED_TOKEN_SCOPES.DRAFT_READ,
      SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
      SIGNED_TOKEN_SCOPES.DRAFT_EVENTS,
      SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED,
    ]);
  }
  if (status === 'submitted') {
    return Object.freeze([
      SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ,
      SIGNED_TOKEN_SCOPES.DRAFT_READ,
      SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED,
    ]);
  }
  return fail(403);
}

function requireSessionRecord(record: DraftRecord): Readonly<{
  draftId: string;
  sessionId: string;
  recoveryCodeVersion: number;
  recoverySessionVersion: number;
}> {
  if (typeof record.id !== 'string' || !SAFE_ID.test(record.id)
    || typeof record.session_id !== 'string' || !SAFE_ID.test(record.session_id)
    || !Number.isSafeInteger(record.recovery_code_version)
    || Number(record.recovery_code_version) < 1
    || !Number.isSafeInteger(record.recovery_session_version)
    || Number(record.recovery_session_version) < 1) return fail(403);
  return Object.freeze({
    draftId: record.id,
    sessionId: record.session_id,
    recoveryCodeVersion: Number(record.recovery_code_version),
    recoverySessionVersion: Number(record.recovery_session_version),
  });
}

async function issueEmailSession(
  record: DraftRecord,
  recoveryEmailLookupHash: string,
  environment: Environment,
  now: Date,
  dependencies: EmailRecoveryFunctionDependencies,
): Promise<Readonly<{ token: string; expiresAt: string }>> {
  const session = requireSessionRecord(record);
  const ttlSeconds = sessionTtlSeconds(dependencies);
  const issuedAt = Math.floor(now.getTime() / 1000);
  const sessionIdHash = await sha256Hex(
    `pro-draft:session-id:v1:${session.sessionId}`,
    dependencies.cryptoProvider,
  );
  const token = await issueRecoverySessionToken({
    environment,
    draftId: session.draftId,
    sessionIdHash,
    authorizationMethod: 'email',
    authorizedScopes: scopesFor(record),
    recoveryEmailLookupHash,
    recoveryCodeVersion: session.recoveryCodeVersion,
    recoverySessionVersion: session.recoverySessionVersion,
    grantVersion: 1,
  }, {
    secret: recoverySessionSecret(dependencies),
    ttlSeconds,
    clock: () => issuedAt,
    tokenIdGenerator: dependencies.tokenIdGenerator,
    cryptoProvider: dependencies.cryptoProvider,
  });
  return Object.freeze({
    token,
    expiresAt: new Date((issuedAt + ttlSeconds) * 1000).toISOString(),
  });
}

async function verifyEmailSession(
  token: string,
  repository: DraftRepository,
  environment: Environment,
  now: Date,
  dependencies: EmailRecoveryFunctionDependencies,
): Promise<Readonly<{
  claims: RecoverySessionClaims;
  currentRecord: DraftRecord;
  recoveryEmailLookupHash: string;
}>> {
  const secret = recoverySessionSecret(dependencies);
  const clock = () => Math.floor(now.getTime() / 1000);
  const initial = await verifyStructuredToken(token, {
    expectedType: SIGNED_TOKEN_TYPES.RECOVERY_SESSION,
    expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_RECOVER,
    expectedEnvironment: environment,
    expectedGrantVersion: 1,
    secret,
    clock,
    cryptoProvider: dependencies.cryptoProvider,
  }) as RecoverySessionClaims;
  if (initial.authorizationMethod !== 'email'
    || !initial.authorizedScopes.includes(SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED)
    || typeof initial.recoveryEmailLookupHash !== 'string'
    || !HASH.test(initial.recoveryEmailLookupHash)) return fail(403);
  const currentRecord = await getDraftById(repository, initial.draftId);
  const session = requireSessionRecord(currentRecord);
  const expectedSessionHash = await sha256Hex(
    `pro-draft:session-id:v1:${session.sessionId}`,
    dependencies.cryptoProvider,
  );
  if (!timingSafeEqualStrings(expectedSessionHash, initial.sessionIdHash)) return fail(403);
  const claims = await verifyRecoverySessionToken(token, {
    secret,
    expectedEnvironment: environment,
    expectedDraftId: session.draftId,
    expectedAuthorizationMethod: 'email',
    expectedRecoverySessionVersion: session.recoverySessionVersion,
    expectedGrantVersion: 1,
    requiredScopes: [SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED],
    clock,
    cryptoProvider: dependencies.cryptoProvider,
  });
  if (claims.recoveryCodeVersion !== session.recoveryCodeVersion
    || typeof currentRecord.recovery_email_lookup_hash !== 'string'
    || !timingSafeEqualStrings(
      currentRecord.recovery_email_lookup_hash,
      initial.recoveryEmailLookupHash,
    )
    || !isDraftEligibleForAutomaticEmailRecovery(currentRecord, {
      expectedEnvironment: environment,
      now,
    })) return fail(403);
  return Object.freeze({
    claims,
    currentRecord,
    recoveryEmailLookupHash: initial.recoveryEmailLookupHash,
  });
}

function safeRecord(record: DraftRecord): DraftRecord {
  return Object.freeze({ ...record, status: normalizedStatus(record) });
}

async function executeEmailRecovery(
  request: Request,
  requestId: string,
  dependencies: EmailRecoveryFunctionDependencies,
): Promise<Response> {
  const { environment } = runtime(dependencies);
  validateRequestMethod(request, 'POST');
  validateJsonContentType(request);
  const body = await readBoundedJsonBody(request, {
    method: 'POST', maxBytes: MAX_EMAIL_RECOVERY_REQUEST_BYTES,
  });
  const input = validateEmailRecoveryRequest(body, environment);
  const now = nowOrFail(dependencies);
  const network = readTrustedClientNetworkContext(request);
  const email = normalizeRecoveryEmail(input.email);
  const hashes = await deriveRecoveryAbuseHashes({
    trustedIpAddress: network.trustedAddress,
    deviceId: input.deviceId,
    normalizedEmail: email.valid ? email.normalizedEmail : undefined,
  }, abuseSecret(dependencies));
  const client = dependencies.createClientFromRequest(request);
  const entity = getSecurityEntity(client);
  const repository = createDraftRepository(client);
  const policy = getRecoverySecurityPolicy(dependencies.getEnvironmentValue, environment);
  const events = await getRecentRecoverySecurityEvents(entity, {
    environment,
    since: new Date(now.getTime() - policy.attemptWindowSeconds * 1000),
    limit: 500,
  });
  const evaluation = evaluateRecoveryAttempt({
    policy,
    events,
    now,
    ipHash: hashes.ipHash,
    subjectHash: hashes.emailSubjectHash,
  });
  let auditContext: AuditContext = Object.freeze({
    entity, requestId, environment, hashes, evaluation, now,
    attemptType: 'email_recovery', testRunId: input.testRunId,
  });
  if (evaluation.locked) {
    await auditOnce(dependencies, auditContext, 'locked', {
      captchaRequired: evaluation.captchaRequired,
      lockoutUntil: evaluation.lockoutUntil,
    });
    return genericFailure(requestId, {
      status: 429,
      retryAfterSeconds: evaluation.retryAfterSeconds,
      captchaRequired: evaluation.captchaRequired,
    });
  }
  if (evaluation.rateLimited) {
    await auditOnce(dependencies, auditContext, 'rate_limited', {
      captchaRequired: evaluation.captchaRequired,
    });
    return genericFailure(requestId, {
      status: 429,
      retryAfterSeconds: evaluation.retryAfterSeconds,
      captchaRequired: evaluation.captchaRequired,
    });
  }
  let captchaVerified = false;
  if (evaluation.captchaRequired) {
    if (!input.captchaToken) {
      await auditOnce(dependencies, auditContext, 'captcha_required', {
        captchaRequired: true,
      });
      return genericFailure(requestId, { captchaRequired: true });
    }
    const captcha = await verifyRecoveryCaptcha({
      required: true,
      token: input.captchaToken,
      remoteIp: network.available ? network.trustedAddress : undefined,
      action: 'recover_pro_form_draft_by_email',
      envSource: dependencies.getEnvironmentValue,
      environment,
      fetchImpl: dependencies.fetchImpl,
    });
    if (!captcha.success || !captcha.captchaVerified) {
      await auditOnce(dependencies, auditContext, 'captcha_failed', {
        captchaRequired: true,
        lockoutUntil: calculateLockoutUntil(
          now, evaluation.failureCountWindow + 1, policy,
        ),
      });
      return genericFailure(requestId, { captchaRequired: true });
    }
    captchaVerified = true;
  }
  if (!email.valid) {
    await auditOnce(dependencies, auditContext, 'invalid_input', {
      captchaRequired: evaluation.captchaRequired,
      captchaVerified,
    });
    return genericFailure(requestId);
  }
  try {
    const lookupHash = await hashNormalizedRecoveryEmail(
      email.normalizedEmail,
      emailSecret(dependencies),
      dependencies.cryptoProvider,
    );
    auditContext = Object.freeze({ ...auditContext, recoveryEmailLookupHash: lookupHash });
    const matches = await findDraftsByRecoveryEmailLookupHash(
      repository,
      lookupHash,
      MAX_EMAIL_RECOVERY_QUERY_LIMIT,
    );
    const selection = selectNewestEligibleDraft(matches, {
      expectedEnvironment: environment,
      now,
    });
    const selected = selection.selected;
    if (!selected) {
      await auditOnce(dependencies, auditContext, 'not_found', {
        captchaRequired: evaluation.captchaRequired,
        captchaVerified,
        lockoutUntil: calculateLockoutUntil(
          now, evaluation.failureCountWindow + 1, policy,
        ),
      });
      return genericFailure(requestId);
    }
    if (typeof selected.recovery_email_lookup_hash !== 'string'
      || !timingSafeEqualStrings(selected.recovery_email_lookup_hash, lookupHash)) {
      safeLog(dependencies, requestId, EMAIL_RECOVERY_ERROR_CODES.HASH_BINDING_INVALID);
      await auditOnce(dependencies, auditContext, 'internal_error');
      return genericFailure(requestId, { status: 500 });
    }
    const record = safeRecord(selected);
    const session = await issueEmailSession(
      record, lookupHash, environment, now, dependencies,
    );
    const audited = await auditOnce(dependencies, auditContext, 'success', {
      captchaRequired: evaluation.captchaRequired,
      captchaVerified,
      draftId: String(record.id),
    });
    if (!audited) return genericFailure(requestId, { status: 503 });
    return buildSafeJsonResponse({
      success: true,
      recoveryCompleted: true,
      requestId,
      recoverySessionToken: session.token,
      recoverySessionExpiresAt: session.expiresAt,
      draft: projectDraftRecoverySummaryForAuthorizedClient(record),
      otherEligibleDraftsAvailable: selection.eligibleCount > 1,
    });
  } catch (error) {
    if (error instanceof EmailRecoveryError) throw error;
    await auditOnce(dependencies, auditContext, 'internal_error');
    safeLog(dependencies, requestId, safeErrorCode(error));
    return genericFailure(requestId, { status: 500 });
  }
}

async function authenticatedAuditContext(
  request: Request,
  requestId: string,
  environment: Environment,
  now: Date,
  attemptType: 'list_choices' | 'select_choice',
  testRunIdInput: string | undefined,
  client: unknown,
  dependencies: EmailRecoveryFunctionDependencies,
): Promise<AuditContext> {
  const network = readTrustedClientNetworkContext(request);
  const hashes = await deriveRecoveryAbuseHashes({
    trustedIpAddress: network.trustedAddress,
  }, abuseSecret(dependencies));
  return Object.freeze({
    entity: getSecurityEntity(client),
    requestId,
    environment,
    hashes,
    evaluation: ZERO_EVALUATION,
    now,
    attemptType,
    testRunId: testRunIdInput,
  });
}

async function executeListChoices(
  request: Request,
  requestId: string,
  dependencies: EmailRecoveryFunctionDependencies,
): Promise<Response> {
  const { environment } = runtime(dependencies);
  validateRequestMethod(request, 'POST');
  validateJsonContentType(request);
  const input = validateListRecoveryChoicesRequest(await readBoundedJsonBody(request, {
    method: 'POST', maxBytes: MAX_EMAIL_RECOVERY_REQUEST_BYTES,
  }), environment);
  const now = nowOrFail(dependencies);
  const client = dependencies.createClientFromRequest(request);
  const repository = createDraftRepository(client);
  let auditContext = await authenticatedAuditContext(
    request, requestId, environment, now, 'list_choices', input.testRunId,
    client, dependencies,
  );
  try {
    const authorization = await verifyEmailSession(
      input.recoverySessionToken, repository, environment, now, dependencies,
    );
    auditContext = Object.freeze({
      ...auditContext,
      recoveryEmailLookupHash: authorization.recoveryEmailLookupHash,
    });
    const matches = await findDraftsByRecoveryEmailLookupHash(
      repository,
      authorization.recoveryEmailLookupHash,
      MAX_EMAIL_RECOVERY_QUERY_LIMIT,
    );
    const eligible = sortDraftsForEmailRecovery(matches.filter((record) => (
      isDraftEligibleForAutomaticEmailRecovery(record, {
        expectedEnvironment: environment,
        now,
      })
    ))).slice(0, MAX_RECOVERY_CHOICES);
    const choices = eligible.map((record) => (
      projectDraftRecoveryChoiceForAuthorizedClient(
        safeRecord(record),
        authorization.claims.draftId,
      )
    ));
    const audited = await auditOnce(dependencies, auditContext, 'success', {
      draftId: authorization.claims.draftId,
    });
    if (!audited) return genericFailure(requestId, { status: 503 });
    return buildSafeJsonResponse({ success: true, requestId, choices });
  } catch (error) {
    await auditOnce(dependencies, auditContext, 'invalid_input');
    safeLog(dependencies, requestId, safeErrorCode(error));
    return genericFailure(requestId, { status: 403 });
  }
}

async function executeSelectChoice(
  request: Request,
  requestId: string,
  dependencies: EmailRecoveryFunctionDependencies,
): Promise<Response> {
  const { environment } = runtime(dependencies);
  validateRequestMethod(request, 'POST');
  validateJsonContentType(request);
  const input = validateSelectRecoveryChoiceRequest(await readBoundedJsonBody(request, {
    method: 'POST', maxBytes: MAX_EMAIL_RECOVERY_REQUEST_BYTES,
  }), environment);
  const now = nowOrFail(dependencies);
  const client = dependencies.createClientFromRequest(request);
  const repository = createDraftRepository(client);
  let auditContext = await authenticatedAuditContext(
    request, requestId, environment, now, 'select_choice', input.testRunId,
    client, dependencies,
  );
  try {
    const authorization = await verifyEmailSession(
      input.recoverySessionToken, repository, environment, now, dependencies,
    );
    auditContext = Object.freeze({
      ...auditContext,
      recoveryEmailLookupHash: authorization.recoveryEmailLookupHash,
    });
    const selected = await getDraftById(repository, input.selectedDraftId);
    if (typeof selected.recovery_email_lookup_hash !== 'string'
      || !timingSafeEqualStrings(
        selected.recovery_email_lookup_hash,
        authorization.recoveryEmailLookupHash,
      )
      || !isDraftEligibleForAutomaticEmailRecovery(selected, {
        expectedEnvironment: environment,
        now,
      })) {
      await auditOnce(dependencies, auditContext, 'not_found');
      return genericFailure(requestId, { status: 403 });
    }
    const record = safeRecord(selected);
    const session = await issueEmailSession(
      record,
      authorization.recoveryEmailLookupHash,
      environment,
      now,
      dependencies,
    );
    const audited = await auditOnce(dependencies, auditContext, 'success', {
      draftId: input.selectedDraftId,
    });
    if (!audited) return genericFailure(requestId, { status: 503 });
    return buildSafeJsonResponse({
      success: true,
      recoveryCompleted: true,
      requestId,
      recoverySessionToken: session.token,
      recoverySessionExpiresAt: session.expiresAt,
      draft: projectDraftRecoverySummaryForAuthorizedClient(record),
    });
  } catch (error) {
    await auditOnce(dependencies, auditContext, 'invalid_input');
    safeLog(dependencies, requestId, safeErrorCode(error));
    return genericFailure(requestId, { status: 403 });
  }
}

async function applyResponseDelay(
  response: Response,
  requestStartedAtMs: number,
  dependencies: EmailRecoveryFunctionDependencies,
): Promise<Response> {
  try {
    const environment = getBackendRuntimeConfig(
      dependencies.getEnvironmentValue,
    ).environment;
    const policy = getRecoverySecurityPolicy(
      dependencies.getEnvironmentValue,
      environment,
    );
    const delay = calculateRecoveryDelay({
      requestStartedAtMs,
      nowMs: dependencies.clockMs?.() ?? Date.now(),
      policy,
      cryptoProvider: dependencies.cryptoProvider,
    });
    if (delay > 0) {
      await (dependencies.sleep ?? ((milliseconds) => new Promise(
        (resolve) => setTimeout(resolve, milliseconds),
      )))(delay);
    }
  } catch {
    // Timing is supplementary; primary authorization controls remain enforced.
  }
  return response;
}

type Executor = (
  request: Request,
  requestId: string,
  dependencies: EmailRecoveryFunctionDependencies,
) => Promise<Response>;

function createHandler(
  dependencies: EmailRecoveryFunctionDependencies,
  executor: Executor,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestStartedAtMs = dependencies.clockMs?.() ?? Date.now();
    const requestId = createServerRequestId(
      dependencies.createRequestId
        ? { generator: dependencies.createRequestId }
        : { cryptoProvider: dependencies.cryptoProvider },
    );
    let response: Response;
    try {
      response = await executor(request, requestId, dependencies);
    } catch (error) {
      safeLog(dependencies, requestId, safeErrorCode(error));
      if (error instanceof ProDraftPersistenceError) {
        response = genericFailure(requestId, {
          status: error.status,
          allowPost: error.status === 405,
        });
      } else if (error instanceof EmailRecoveryError) {
        response = genericFailure(requestId, { status: error.status });
      } else {
        response = genericFailure(requestId, { status: 503 });
      }
    }
    return applyResponseDelay(response, requestStartedAtMs, dependencies);
  };
}

export function createRecoverProFormDraftByEmailHandler(
  dependencies: EmailRecoveryFunctionDependencies,
): (request: Request) => Promise<Response> {
  return createHandler(dependencies, executeEmailRecovery);
}

export function createListProFormDraftRecoveryChoicesHandler(
  dependencies: EmailRecoveryFunctionDependencies,
): (request: Request) => Promise<Response> {
  return createHandler(dependencies, executeListChoices);
}

export function createSelectProFormDraftRecoveryChoiceHandler(
  dependencies: EmailRecoveryFunctionDependencies,
): (request: Request) => Promise<Response> {
  return createHandler(dependencies, executeSelectChoice);
}

export function getSafeEmailRecoveryDiagnostics(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: PRO_DRAFT_EMAIL_RECOVERY_VERSION,
    emailOwnershipVerified: false,
    sendsEmail: false,
    maxRequestBytes: MAX_EMAIL_RECOVERY_REQUEST_BYTES,
    maxChoices: MAX_RECOVERY_CHOICES,
    selectionOrder: 'server-created-descending-id-descending',
    storesRawEmail: false,
    logsRawEmail: false,
    returnsCanonicalState: false,
  });
}
