/** Injectable orchestration for the public recovery-code service. */

import {
  AUTHORIZATION_SECRET_NAMES,
  DEFAULT_RECOVERY_SESSION_TTL_SECONDS,
  MAX_RECOVERY_SESSION_TTL_SECONDS,
  SIGNED_TOKEN_SCOPES,
  type AuthorizationSecret,
  issueRecoverySessionToken,
} from '../proDraftAuthorization/entry.ts';
import { verifyRecoveryCaptcha } from '../proDraftCaptcha/entry.ts';
import { normalizeRecoveryCodeInput } from '../proDraftIdentity/entry.ts';
import {
  ProDraftPersistenceError,
  buildSafeJsonResponse,
  createServerRequestId,
  normalizeDraftLifecycleStatus,
  readBoundedJsonBody,
  selectCanonicalDuplicateDraft,
  validateJsonContentType,
  validateRequestMethod,
} from '../proDraftPersistence/entry.ts';
import {
  projectDraftRecoverySummaryForAuthorizedClient,
} from '../proDraftProjection/entry.ts';
import {
  PRO_FORM_ABUSE_HASH_SECRET_NAME,
  type AbuseHashSecret,
  type RecoveryAbuseHashes,
  type RecoveryAttemptEvaluation,
  type RecoveryAttemptOutcome,
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
  type DraftRecord,
  createDraftRepository,
  findDraftsByRecoveryCodeHash,
} from '../proDraftRepository/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  type PurposeBoundSecret,
  hashRecoveryCode,
  sha256Hex,
  timingSafeEqualStrings,
} from '../proDraftSecurity/entry.ts';
import {
  assertDurableDraftServerEnabled,
  getBackendRuntimeConfig,
} from '../proDraftRuntimeConfig/entry.ts';

export const PRO_DRAFT_CODE_RECOVERY_VERSION = 1;
export const MAX_CODE_RECOVERY_REQUEST_BYTES = 32 * 1024;
export const PRO_FORM_RECOVERY_SESSION_TTL_SECONDS =
  'PRO_FORM_RECOVERY_SESSION_TTL_SECONDS';

export const CODE_RECOVERY_ERROR_CODES = Object.freeze({
  FEATURE_DISABLED: 'RECOVERY_CODE_FEATURE_DISABLED',
  INVALID_REQUEST: 'RECOVERY_CODE_INVALID_REQUEST',
  SECURITY_STORE_UNAVAILABLE: 'RECOVERY_CODE_SECURITY_STORE_UNAVAILABLE',
  DUPLICATE_HASH: 'RECOVERY_CODE_DUPLICATE_HASH',
  UNKNOWN_STATUS: 'RECOVERY_CODE_UNKNOWN_STATUS',
  EVENT_WRITE_FAILED: 'RECOVERY_CODE_EVENT_WRITE_FAILED',
  INTERNAL_ERROR: 'RECOVERY_CODE_INTERNAL_ERROR',
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

export type CodeRecoveryFunctionDependencies = Readonly<{
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

export type CodeRecoveryRequest = Readonly<{
  apiVersion: 1;
  recoveryCode: string;
  deviceId?: string;
  captchaToken?: string;
  clientContext: Readonly<{
    formType?: string;
    sourceTabId?: string;
    appBuildSha?: string;
    environment?: Environment;
  }>;
  testRunId?: string;
}>;

const REQUEST_KEYS = new Set([
  'apiVersion', 'recoveryCode', 'deviceId', 'captchaToken', 'clientContext',
  'testRunId',
]);
const CONTEXT_KEYS = new Set([
  'formType', 'sourceTabId', 'appBuildSha', 'environment',
]);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const DEVICE_ID = /^pdd_[A-Za-z0-9_-]{22}$/u;
const BUILD_ID = /^[A-Za-z0-9._:+-]{1,128}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const ACTIVE_STATUSES = new Set(['active', 'submit_attempted', 'submit_failed']);

class CodeRecoveryError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status = 400, retryable = false) {
    super('Recovery could not be completed.');
    this.name = 'CodeRecoveryError';
    this.status = status;
    this.retryable = retryable;
  }
}

function fail(status = 400, retryable = false): never {
  throw new CodeRecoveryError(status, retryable);
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

export function validateCodeRecoveryRequest(
  value: unknown,
  environment: Environment,
): CodeRecoveryRequest {
  const input = exactKeys(value, REQUEST_KEYS);
  if (input.apiVersion !== PRO_DRAFT_CODE_RECOVERY_VERSION
    || typeof input.recoveryCode !== 'string'
    || input.recoveryCode.length === 0
    || input.recoveryCode.length > 128) return fail();
  const context = exactKeys(input.clientContext ?? {}, CONTEXT_KEYS);
  const formType = optionalSafeText(context.formType, /^pro-questionnaire$/u);
  const sourceTabId = optionalSafeText(context.sourceTabId, SAFE_ID);
  const appBuildSha = optionalSafeText(context.appBuildSha, BUILD_ID);
  if (context.environment !== undefined && context.environment !== environment) return fail();
  const deviceId = optionalSafeText(input.deviceId, DEVICE_ID);
  const captchaToken = input.captchaToken === undefined
    ? undefined
    : typeof input.captchaToken === 'string'
      && input.captchaToken.length > 0
      && input.captchaToken.length <= 4096
      ? input.captchaToken
      : fail();
  const testRunId = optionalSafeText(input.testRunId, SAFE_ID);
  if (testRunId && environment === 'production') return fail();
  return Object.freeze({
    apiVersion: 1,
    recoveryCode: input.recoveryCode,
    ...(deviceId ? { deviceId } : {}),
    ...(captchaToken ? { captchaToken } : {}),
    clientContext: Object.freeze({
      ...(formType ? { formType } : {}),
      ...(sourceTabId ? { sourceTabId } : {}),
      ...(appBuildSha ? { appBuildSha } : {}),
      ...(context.environment ? { environment } : {}),
    }),
    ...(testRunId ? { testRunId } : {}),
  });
}

function requireSecret(
  dependencies: CodeRecoveryFunctionDependencies,
  name: string,
): string {
  const value = dependencies.getEnvironmentValue(name);
  if (typeof value !== 'string'
    || new TextEncoder().encode(value).byteLength < 32) return fail(503, true);
  return value;
}

function recoveryCodeSecret(
  dependencies: CodeRecoveryFunctionDependencies,
): PurposeBoundSecret {
  return Object.freeze({
    name: SECURITY_SECRET_NAMES.RECOVERY_CODE,
    value: requireSecret(dependencies, SECURITY_SECRET_NAMES.RECOVERY_CODE),
  });
}

function abuseSecret(
  dependencies: CodeRecoveryFunctionDependencies,
): AbuseHashSecret {
  return Object.freeze({
    name: PRO_FORM_ABUSE_HASH_SECRET_NAME,
    value: requireSecret(dependencies, PRO_FORM_ABUSE_HASH_SECRET_NAME),
  });
}

function recoverySessionSecret(
  dependencies: CodeRecoveryFunctionDependencies,
): AuthorizationSecret {
  return Object.freeze({
    name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
    value: requireSecret(dependencies, AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION),
  });
}

function sessionTtlSeconds(dependencies: CodeRecoveryFunctionDependencies): number {
  const raw = dependencies.getEnvironmentValue(PRO_FORM_RECOVERY_SESSION_TTL_SECONDS);
  if (raw === undefined || raw === '') return DEFAULT_RECOVERY_SESSION_TTL_SECONDS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0
    || value > MAX_RECOVERY_SESSION_TTL_SECONDS) return fail(503, true);
  return value;
}

function getSecurityEntity(client: unknown): SecurityEntity {
  if (!isPlainObject(client) || !isPlainObject(client.asServiceRole)
    || !isPlainObject(client.asServiceRole.entities)) return fail(503, true);
  const entity = client.asServiceRole.entities.ProFormRecoverySecurityEvent;
  if (!isPlainObject(entity) || typeof entity.create !== 'function'
    || typeof entity.filter !== 'function') return fail(503, true);
  return entity as unknown as SecurityEntity;
}

function safeLog(
  dependencies: CodeRecoveryFunctionDependencies,
  requestId: string,
  errorCode: string,
): void {
  try {
    dependencies.safeLog?.(Object.freeze({ requestId, errorCode }));
  } catch {
    // Safe logging cannot change the public recovery decision.
  }
}

function safeErrorCode(error: unknown): string {
  const code = error !== null && typeof error === 'object'
    && 'code' in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/u.test(code)
    ? code
    : CODE_RECOVERY_ERROR_CODES.INTERNAL_ERROR;
}

type AuditContext = Readonly<{
  entity: SecurityEntity;
  requestId: string;
  environment: Environment;
  hashes: RecoveryAbuseHashes;
  evaluation: RecoveryAttemptEvaluation;
  now: Date;
  testRunId?: string;
}>;

function failureOutcome(outcome: RecoveryAttemptOutcome): boolean {
  return ['not_found', 'invalid_input', 'captcha_failed', 'internal_error']
    .includes(outcome);
}

async function audit(
  context: AuditContext,
  outcome: RecoveryAttemptOutcome,
  options: Readonly<{
    captchaRequired?: boolean;
    captchaVerified?: boolean;
    draftId?: string;
    lockoutUntil?: string | null;
  }> = {},
): Promise<void> {
  const failureCount = context.evaluation.failureCountWindow
    + (failureOutcome(outcome) ? 1 : 0);
  const attemptCount = Math.max(
    context.evaluation.ipAttemptCountWindow,
    context.evaluation.subjectAttemptCountWindow,
  ) + 1;
  await recordRecoverySecurityEvent(context.entity, {
    request_id: context.requestId,
    environment: context.environment,
    attempt_type: 'code_recovery',
    outcome,
    subject_hash: context.hashes.codeSubjectHash ?? undefined,
    ip_hash: context.hashes.ipHash,
    device_hash: context.hashes.deviceHash ?? undefined,
    captcha_required: options.captchaRequired === true,
    captcha_verified: options.captchaVerified === true,
    failure_count_window: failureCount,
    attempt_count_window: attemptCount,
    lockout_until: options.lockoutUntil ?? undefined,
    window_started_at: new Date(
      context.now.getTime() - 15 * 60 * 1000,
    ).toISOString(),
    created_at_server: context.now.toISOString(),
    draft_id: options.draftId,
    test_run_id: context.testRunId,
  });
}

async function auditOnce(
  dependencies: CodeRecoveryFunctionDependencies,
  context: AuditContext,
  outcome: RecoveryAttemptOutcome,
  options: Parameters<typeof audit>[2] = {},
): Promise<boolean> {
  try {
    await audit(context, outcome, options);
    return true;
  } catch {
    safeLog(dependencies, context.requestId, CODE_RECOVERY_ERROR_CODES.EVENT_WRITE_FAILED);
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

function nowOrFail(dependencies: CodeRecoveryFunctionDependencies): Date {
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) return fail(503, true);
  return now;
}

function statusAndScopes(record: DraftRecord, now: Date): Readonly<{
  status: string;
  scopes: readonly ('draft:read' | 'draft:write' | 'draft:events'
    | 'draft:submitted-read')[];
}> | null {
  let status: string;
  try {
    status = normalizeDraftLifecycleStatus(record.status);
  } catch {
    return null;
  }
  if (typeof record.retention_expires_at === 'string') {
    const expiresAt = Date.parse(record.retention_expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
      return Object.freeze({ status: 'expired', scopes: Object.freeze([]) });
    }
  }
  if (ACTIVE_STATUSES.has(status)) {
    return Object.freeze({
      status,
      scopes: Object.freeze([
        SIGNED_TOKEN_SCOPES.DRAFT_READ,
        SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
        SIGNED_TOKEN_SCOPES.DRAFT_EVENTS,
      ]),
    });
  }
  if (status === 'submitted') {
    return Object.freeze({
      status,
      scopes: Object.freeze([
        SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ,
        SIGNED_TOKEN_SCOPES.DRAFT_READ,
      ]),
    });
  }
  return Object.freeze({ status, scopes: Object.freeze([]) });
}

async function executeRecovery(
  request: Request,
  requestId: string,
  dependencies: CodeRecoveryFunctionDependencies,
): Promise<Response> {
  const runtime = assertDurableDraftServerEnabled(
    getBackendRuntimeConfig(dependencies.getEnvironmentValue),
  );
  if (runtime.environment === 'unknown' || !runtime.publicEmailRecoveryEnabled) {
    return fail(503, true);
  }
  const environment = runtime.environment as Environment;
  validateRequestMethod(request, 'POST');
  validateJsonContentType(request);
  const body = await readBoundedJsonBody(request, {
    method: 'POST',
    maxBytes: MAX_CODE_RECOVERY_REQUEST_BYTES,
  });
  const input = validateCodeRecoveryRequest(body, environment);
  const now = nowOrFail(dependencies);
  const network = readTrustedClientNetworkContext(request);
  const normalized = normalizeRecoveryCodeInput(input.recoveryCode);
  const hashes = await deriveRecoveryAbuseHashes({
    trustedIpAddress: network.trustedAddress,
    deviceId: input.deviceId,
    normalizedRecoveryCodeSubject: normalized.valid
      ? normalized.normalizedCode
      : undefined,
  }, abuseSecret(dependencies));
  const client = dependencies.createClientFromRequest(request);
  const entity = getSecurityEntity(client);
  const repository = createDraftRepository(client);
  const policy = getRecoverySecurityPolicy(
    dependencies.getEnvironmentValue,
    environment,
  );
  const recent = await getRecentRecoverySecurityEvents(entity, {
    environment,
    since: new Date(now.getTime() - policy.attemptWindowSeconds * 1000),
    limit: 500,
  });
  const evaluation = evaluateRecoveryAttempt({
    policy,
    events: recent,
    now,
    ipHash: hashes.ipHash,
    subjectHash: hashes.codeSubjectHash,
  });
  const auditContext: AuditContext = Object.freeze({
    entity, requestId, environment, hashes, evaluation, now,
    testRunId: input.testRunId,
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
      action: 'recover_pro_form_draft_by_code',
      envSource: dependencies.getEnvironmentValue,
      environment,
      fetchImpl: dependencies.fetchImpl,
    });
    if (!captcha.success || !captcha.captchaVerified) {
      const failureCount = evaluation.failureCountWindow + 1;
      await auditOnce(dependencies, auditContext, 'captcha_failed', {
        captchaRequired: true,
        lockoutUntil: calculateLockoutUntil(now, failureCount, policy),
      });
      return genericFailure(requestId, { captchaRequired: true });
    }
    captchaVerified = true;
  }
  if (!normalized.valid) {
    await auditOnce(dependencies, auditContext, 'invalid_input', {
      captchaRequired: evaluation.captchaRequired,
      captchaVerified,
    });
    return genericFailure(requestId);
  }

  try {
    const codeHash = await hashRecoveryCode(
      normalized.normalizedCode,
      recoveryCodeSecret(dependencies),
      dependencies.cryptoProvider,
    );
    const matches = await findDraftsByRecoveryCodeHash(repository, codeHash, 25);
    if (matches.length === 0) {
      const failureCount = evaluation.failureCountWindow + 1;
      await auditOnce(dependencies, auditContext, 'not_found', {
        captchaRequired: evaluation.captchaRequired,
        captchaVerified,
        lockoutUntil: calculateLockoutUntil(now, failureCount, policy),
      });
      return genericFailure(requestId);
    }
    if (matches.length > 1) {
      safeLog(dependencies, requestId, CODE_RECOVERY_ERROR_CODES.DUPLICATE_HASH);
    }
    const selection = selectCanonicalDuplicateDraft(matches);
    const record = selection.selected;
    if (!record) {
      safeLog(dependencies, requestId, CODE_RECOVERY_ERROR_CODES.UNKNOWN_STATUS);
      await auditOnce(dependencies, auditContext, 'internal_error');
      return genericFailure(requestId, { status: 500 });
    }
    if (typeof record.id !== 'string'
      || !HASH.test(String(record.recovery_code_hash ?? ''))
      || !timingSafeEqualStrings(String(record.recovery_code_hash), codeHash)) {
      await auditOnce(dependencies, auditContext, 'internal_error');
      return genericFailure(requestId, { status: 500 });
    }
    const access = statusAndScopes(record, now);
    if (!access) {
      safeLog(dependencies, requestId, CODE_RECOVERY_ERROR_CODES.UNKNOWN_STATUS);
      await auditOnce(dependencies, auditContext, 'internal_error', {
        draftId: record.id,
      });
      return genericFailure(requestId, { status: 500 });
    }
    if (access.status === 'cleared_superseded') {
      await auditOnce(dependencies, auditContext, 'superseded', {
        draftId: record.id,
      });
      return genericFailure(requestId);
    }
    if (access.status === 'expired' || access.status === 'deleted') {
      await auditOnce(dependencies, auditContext, 'not_found');
      return genericFailure(requestId);
    }
    if (!ACTIVE_STATUSES.has(access.status) && access.status !== 'submitted') {
      safeLog(dependencies, requestId, CODE_RECOVERY_ERROR_CODES.UNKNOWN_STATUS);
      await auditOnce(dependencies, auditContext, 'internal_error', {
        draftId: record.id,
      });
      return genericFailure(requestId, { status: 500 });
    }
    if (typeof record.session_id !== 'string' || !SAFE_ID.test(record.session_id)
      || !Number.isSafeInteger(record.recovery_code_version)
      || Number(record.recovery_code_version) < 1
      || !Number.isSafeInteger(record.recovery_session_version)
      || Number(record.recovery_session_version) < 1) {
      await auditOnce(dependencies, auditContext, 'internal_error', {
        draftId: record.id,
      });
      return genericFailure(requestId, { status: 500 });
    }
    const ttlSeconds = sessionTtlSeconds(dependencies);
    const issuedAt = Math.floor(now.getTime() / 1000);
    const sessionIdHash = await sha256Hex(
      `pro-draft:session-id:v1:${record.session_id}`,
      dependencies.cryptoProvider,
    );
    const token = await issueRecoverySessionToken({
      environment,
      draftId: record.id,
      sessionIdHash,
      authorizationMethod: 'recovery_code',
      authorizedScopes: access.scopes,
      recoveryCodeVersion: Number(record.recovery_code_version),
      recoverySessionVersion: Number(record.recovery_session_version),
      grantVersion: 1,
    }, {
      secret: recoverySessionSecret(dependencies),
      ttlSeconds,
      clock: () => issuedAt,
      tokenIdGenerator: dependencies.tokenIdGenerator,
      cryptoProvider: dependencies.cryptoProvider,
    });
    const draft = projectDraftRecoverySummaryForAuthorizedClient({
      ...record,
      status: access.status,
    });
    const successAudited = await auditOnce(dependencies, auditContext, 'success', {
      captchaRequired: evaluation.captchaRequired,
      captchaVerified,
      draftId: record.id,
    });
    if (!successAudited) {
      return genericFailure(requestId, { status: 503 });
    }
    return buildSafeJsonResponse({
      success: true,
      recoveryCompleted: true,
      requestId,
      recoverySessionToken: token,
      recoverySessionExpiresAt: new Date((issuedAt + ttlSeconds) * 1000).toISOString(),
      draft,
    });
  } catch (error) {
    if (error instanceof CodeRecoveryError) throw error;
    await auditOnce(dependencies, auditContext, 'internal_error');
    safeLog(dependencies, requestId, safeErrorCode(error));
    return genericFailure(requestId, { status: 500 });
  }
}

async function applyResponseDelay(
  response: Response,
  requestStartedAtMs: number,
  dependencies: CodeRecoveryFunctionDependencies,
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
    // Timing is supplementary; the primary security controls remain enforced.
  }
  return response;
}

export function createRecoverProFormDraftByCodeHandler(
  dependencies: CodeRecoveryFunctionDependencies,
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
      response = await executeRecovery(request, requestId, dependencies);
    } catch (error) {
      safeLog(dependencies, requestId, safeErrorCode(error));
      if (error instanceof ProDraftPersistenceError) {
        response = genericFailure(requestId, {
          status: error.status,
          allowPost: error.status === 405,
        });
      } else if (error instanceof CodeRecoveryError) {
        response = genericFailure(requestId, { status: error.status });
      } else {
        response = genericFailure(requestId, { status: 503 });
      }
    }
    return applyResponseDelay(response, requestStartedAtMs, dependencies);
  };
}

export function getSafeCodeRecoveryDiagnostics(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: PRO_DRAFT_CODE_RECOVERY_VERSION,
    maxRequestBytes: MAX_CODE_RECOVERY_REQUEST_BYTES,
    requestMethod: 'POST',
    contentType: 'application/json',
    storesRawRecoveryCode: false,
    logsRawRecoveryCode: false,
    returnsCanonicalState: false,
    requiresServerFeatureFlag: true,
  });
}
