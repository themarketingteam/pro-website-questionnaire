/** Shared authorization and response boundary for backend-only draft administration. */

import {
  ADMIN_AUTH_ERROR_CODES,
  type AdminAuthAttemptType,
  type AdminAuthOutcome,
  getAdminRecoveryPolicy,
  recordAdminRecoverySecurityEvent,
  validateAdminDeviceBinding,
  verifyPersistentAdminRecoveryGrant,
} from '../proDraftAdminAuthorization/entry.ts';
import {
  ProDraftPersistenceError,
  buildSafeJsonResponse,
  createServerRequestId,
  readBoundedJsonBody,
} from '../proDraftPersistence/entry.ts';
import { hmacSha256Hex } from '../proDraftSecurity/entry.ts';

export const PRO_DRAFT_ADMIN_API_VERSION = 1;
export const ADMIN_API_OPERATION_NAMES = Object.freeze({
  LIST_DRAFTS: 'list_drafts',
  GET_DRAFT: 'get_draft',
  LIST_EVENTS: 'list_events',
  UPDATE_DRAFT: 'update_draft',
  GET_LINEAGE: 'get_lineage',
  LIST_INTAKES: 'list_intakes',
  GET_INTAKE: 'get_intake',
  RETRY_SUBMISSION: 'retry_submission',
  REPAIR_SUBMISSION: 'repair_submission',
  ANALYZE_MIGRATION: 'analyze_migration',
  APPLY_MIGRATION: 'apply_migration',
  RESOLVE_MIGRATION_DUPLICATE: 'resolve_migration_duplicate',
  ROLLBACK_MIGRATION: 'rollback_migration',
  ANALYZE_RETENTION: 'analyze_retention',
  APPLY_RETENTION: 'apply_retention',
} as const);

export const ADMIN_API_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'ADMIN_API_INVALID_REQUEST',
  INVALID_API_VERSION: 'ADMIN_API_INVALID_API_VERSION',
  MISSING_GRANT: 'ADMIN_API_MISSING_GRANT',
  CONFLICTING_GRANT: 'ADMIN_API_CONFLICTING_GRANT',
  AUTHORIZATION_DENIED: 'ADMIN_API_AUTHORIZATION_DENIED',
  OPERATION_NOT_ALLOWED: 'ADMIN_API_OPERATION_NOT_ALLOWED',
  NOT_FOUND: 'ADMIN_API_NOT_FOUND',
  CONFLICT: 'ADMIN_API_CONFLICT',
  RESPONSE_TOO_LARGE: 'ADMIN_API_RESPONSE_TOO_LARGE',
  EVENT_WRITE_FAILED: 'ADMIN_API_EVENT_WRITE_FAILED',
  INTERNAL_ERROR: 'ADMIN_API_INTERNAL_ERROR',
} as const);

export type AdminApiOperationName = typeof ADMIN_API_OPERATION_NAMES[
  keyof typeof ADMIN_API_OPERATION_NAMES
];
export type AdminApiErrorCode = typeof ADMIN_API_ERROR_CODES[
  keyof typeof ADMIN_API_ERROR_CODES
];

type EnvGetter = (name: string) => string | undefined;
type AdminApiEntity = Readonly<{
  create: (data: Record<string, unknown>) => Promise<unknown>;
}>;

export type AdminApiAuthorization = Readonly<{
  requestId: string;
  operation: AdminApiOperationName;
  environment: string;
  deviceBindingHash: string;
  actorHash: string;
  tokenId: string;
  payload: Readonly<Record<string, unknown>>;
  claims: Readonly<Record<string, unknown>>;
}>;

export class AdminApiRequestError extends Error {
  readonly code: AdminApiErrorCode;
  readonly status: number;

  constructor(code: AdminApiErrorCode, status = 400) {
    super('The administrative recovery request could not be completed.');
    this.name = 'AdminApiRequestError';
    this.code = code;
    this.status = status;
  }
}

const OPERATION_SET = new Set(Object.values(ADMIN_API_OPERATION_NAMES));
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const GRANT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const TEST_RUN_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const FORBIDDEN_INPUT_KEYS = new Set([
  'password', 'recoveryPassword', 'isAdmin', 'admin', 'role', 'roleOverride',
]);
const ATTEMPT_TYPES: Readonly<Record<AdminApiOperationName, AdminAuthAttemptType>> = {
  list_drafts: 'admin_draft_list',
  get_draft: 'admin_draft_detail',
  list_events: 'admin_event_list',
  update_draft: 'admin_draft_update',
  get_lineage: 'admin_draft_detail',
  list_intakes: 'admin_draft_list',
  get_intake: 'admin_draft_detail',
  retry_submission: 'admin_retry_submission',
  repair_submission: 'admin_repair_submission',
  analyze_migration: 'admin_migration_analyze',
  apply_migration: 'admin_migration_apply',
  resolve_migration_duplicate: 'admin_migration_duplicate_resolution',
  rollback_migration: 'admin_migration_rollback',
  analyze_retention: 'admin_retention_analyze',
  apply_retention: 'admin_retention_apply',
};

function fail(code: AdminApiErrorCode, status = 400): never {
  throw new AdminApiRequestError(code, status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireOperation(value: unknown): AdminApiOperationName {
  if (typeof value !== 'string' || !OPERATION_SET.has(value as AdminApiOperationName)) {
    return fail(ADMIN_API_ERROR_CODES.OPERATION_NOT_ALLOWED);
  }
  return value as AdminApiOperationName;
}

function requireSecret(getEnvironmentValue: EnvGetter): string {
  const secret = getEnvironmentValue('PRO_FORM_ADMIN_GRANT_SECRET');
  if (typeof secret !== 'string' || new TextEncoder().encode(secret).byteLength < 32) {
    return fail(ADMIN_API_ERROR_CODES.AUTHORIZATION_DENIED, 503);
  }
  return secret;
}

export function readAdminGrantFromRequest(
  request: Request,
  body: unknown,
): string {
  const bodyGrant = isPlainObject(body) ? body.adminGrant : undefined;
  const authorization = request.headers.get('authorization') ?? '';
  const headerMatch = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(authorization);
  const headerGrant = headerMatch?.[1];
  if (bodyGrant !== undefined && (typeof bodyGrant !== 'string'
    || bodyGrant.length > 8192 || !GRANT_PATTERN.test(bodyGrant))) {
    return fail(ADMIN_API_ERROR_CODES.MISSING_GRANT, 401);
  }
  if (bodyGrant && headerGrant && bodyGrant !== headerGrant) {
    return fail(ADMIN_API_ERROR_CODES.CONFLICTING_GRANT, 400);
  }
  const grant = typeof bodyGrant === 'string' && bodyGrant ? bodyGrant : headerGrant;
  if (!grant) return fail(ADMIN_API_ERROR_CODES.MISSING_GRANT, 401);
  return grant;
}

export function validateAdminApiRequest(
  value: unknown,
  options: Readonly<{ grant: string }>,
): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)
    || value.apiVersion !== PRO_DRAFT_ADMIN_API_VERSION
    || typeof options.grant !== 'string'
    || Object.keys(value).some((key) => FORBIDDEN_INPUT_KEYS.has(key))
    || typeof value.deviceId !== 'string') {
    if (isPlainObject(value) && value.apiVersion !== PRO_DRAFT_ADMIN_API_VERSION) {
      return fail(ADMIN_API_ERROR_CODES.INVALID_API_VERSION);
    }
    return fail(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  }
  const { adminGrant: _adminGrant, apiVersion: _apiVersion, deviceId: _deviceId, ...payload } = value;
  return Object.freeze({ ...payload });
}

export async function authorizeAdminRecoveryRequest(options: Readonly<{
  request: Request;
  body: unknown;
  operation: AdminApiOperationName;
  getEnvironmentValue: EnvGetter;
  requestId?: string;
  clock?: () => number;
  cryptoProvider?: Pick<Crypto, 'subtle'>;
}>): Promise<AdminApiAuthorization> {
  const operation = requireOperation(options.operation);
  const requestId = options.requestId ?? createServerRequestId();
  const grant = readAdminGrantFromRequest(options.request, options.body);
  const payload = validateAdminApiRequest(options.body, { grant });
  const deviceId = isPlainObject(options.body) ? options.body.deviceId : null;
  const secret = requireSecret(options.getEnvironmentValue);
  const policy = getAdminRecoveryPolicy(options.getEnvironmentValue);
  if (policy.environment === 'unknown') {
    return fail(ADMIN_API_ERROR_CODES.AUTHORIZATION_DENIED, 503);
  }
  if (payload.testRunId !== undefined && (typeof payload.testRunId !== 'string'
    || !TEST_RUN_ID_PATTERN.test(payload.testRunId) || policy.environment === 'production')) {
    return fail(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  }
  let deviceBindingHash: string;
  try {
    deviceBindingHash = await validateAdminDeviceBinding({
      deviceId,
      adminGrantSecret: secret,
      cryptoProvider: options.cryptoProvider,
    });
  } catch {
    return fail(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  }
  let claims;
  try {
    claims = await verifyPersistentAdminRecoveryGrant({
      grant,
      policy,
      deviceBindingHash,
      adminGrantSecret: secret,
      clock: options.clock,
      cryptoProvider: options.cryptoProvider,
    });
  } catch {
    return fail(ADMIN_API_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
  const actorHash = await hmacSha256Hex(
    secret,
    `pro-draft:admin-actor:v1:${claims.tokenId}`,
    options.cryptoProvider,
  );
  return Object.freeze({
    requestId,
    operation,
    environment: policy.environment,
    deviceBindingHash,
    actorHash,
    tokenId: claims.tokenId,
    payload,
    claims,
  });
}

export function buildAdminSuccessResponse(
  data: Readonly<Record<string, unknown>>,
  options: Readonly<{ status?: number; requestId?: string }> = {},
): Response {
  if (!isPlainObject(data) || Object.hasOwn(data, 'adminGrant')) {
    return fail(ADMIN_API_ERROR_CODES.INVALID_REQUEST, 500);
  }
  return buildSafeJsonResponse({
    success: true,
    ...data,
    ...(options.requestId ? { requestId: options.requestId } : {}),
  }, { status: options.status ?? 200 });
}

export function buildAdminErrorResponse(
  error: unknown,
  requestId: string,
): Response {
  const status = error instanceof AdminApiRequestError
    ? error.status
    : error instanceof ProDraftPersistenceError
      ? error.status : 500;
  const code = status === 401 || status === 403
    ? ADMIN_API_ERROR_CODES.AUTHORIZATION_DENIED
    : status === 404
      ? ADMIN_API_ERROR_CODES.NOT_FOUND
      : status === 409
        ? ADMIN_API_ERROR_CODES.CONFLICT
        : status >= 500
          ? ADMIN_API_ERROR_CODES.INTERNAL_ERROR
          : error instanceof AdminApiRequestError
            ? error.code : ADMIN_API_ERROR_CODES.INVALID_REQUEST;
  return buildSafeJsonResponse({
    success: false,
    authorized: false,
    errorCode: code,
    message: 'The administrative recovery request could not be completed.',
    requestId,
  }, { status });
}

export async function recordAdminOperationEvent(
  entity: AdminApiEntity,
  input: Readonly<{
    authorization?: AdminApiAuthorization;
    requestId: string;
    operation: AdminApiOperationName;
    environment: string;
    outcome: AdminAuthOutcome;
    deviceHash?: string;
    testRunId?: unknown;
    now?: Date;
  }>,
): Promise<unknown> {
  return recordAdminRecoverySecurityEvent(entity as never, {
    request_id: input.requestId,
    environment: input.environment,
    attempt_type: ATTEMPT_TYPES[input.operation],
    outcome: input.outcome,
    device_hash: input.authorization?.deviceBindingHash ?? input.deviceHash,
    created_at_server: (input.now ?? new Date()).toISOString(),
    policy_version: Number(input.authorization?.claims.recoveryPolicyVersion ?? 1),
    test_run_id: typeof input.testRunId === 'string' ? input.testRunId : undefined,
  });
}

/** Sole pre-authorization service-role exception: write a credential-free denied audit. */
export async function recordDeniedAdminOperation(
  entity: AdminApiEntity,
  input: Readonly<{
    body: unknown;
    error: unknown;
    requestId: string;
    operation: AdminApiOperationName;
    getEnvironmentValue: EnvGetter;
    now?: Date;
  }>,
): Promise<unknown> {
  const environment = getAdminRecoveryPolicy(input.getEnvironmentValue).environment;
  const deviceHash = await validateAdminDeviceBinding({
    deviceId: isPlainObject(input.body) ? input.body.deviceId : null,
    adminGrantSecret: requireSecret(input.getEnvironmentValue),
  });
  return recordAdminOperationEvent(entity, {
    requestId: input.requestId,
    operation: input.operation,
    environment,
    outcome: input.error instanceof AdminApiRequestError
      && (input.error.status === 401 || input.error.status === 403)
      ? 'invalid_grant' : 'internal_error',
    deviceHash,
    testRunId: isPlainObject(input.body) ? input.body.testRunId : undefined,
    now: input.now,
  });
}

export function getSafeAdminRequestDiagnostics(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: PRO_DRAFT_ADMIN_API_VERSION,
    operations: Object.values(ADMIN_API_OPERATION_NAMES),
    preferredGrantTransport: 'json_body_adminGrant',
    alternateGrantTransport: 'authorization_bearer',
    noStoreResponses: true,
    removesGrantBeforeBusinessLogic: true,
    acceptsPassword: false,
    acceptsRoleOverride: false,
    logsRequestBody: false,
  });
}

type HandlerClient = Readonly<{
  asServiceRole?: Readonly<{ entities?: Readonly<Record<string, unknown>> }>;
}>;

export function createAdminFunctionHandler(options: Readonly<{
  operation: AdminApiOperationName;
  maxBytes: number;
  createClientFromRequest: (request: Request) => HandlerClient;
  getEnvironmentValue: EnvGetter;
  execute: (context: Readonly<{
    request: Request;
    client: HandlerClient;
    authorization: AdminApiAuthorization;
    payload: Readonly<Record<string, unknown>>;
  }>) => Promise<Readonly<Record<string, unknown>>>;
  createRequestId?: () => string;
  clock?: () => number;
  now?: () => Date;
}>): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = createServerRequestId({ generator: options.createRequestId });
    let body: unknown = null;
    let client: HandlerClient | null = null;
    try {
      body = await readBoundedJsonBody(request, { method: 'POST', maxBytes: options.maxBytes });
      client = options.createClientFromRequest(request);
      const authorization = await authorizeAdminRecoveryRequest({
        request,
        body,
        operation: options.operation,
        getEnvironmentValue: options.getEnvironmentValue,
        requestId,
        clock: options.clock,
      });
      const securityEntity = client.asServiceRole?.entities?.ProFormRecoverySecurityEvent;
      if (!isPlainObject(securityEntity) || typeof securityEntity.create !== 'function') {
        return fail(ADMIN_API_ERROR_CODES.EVENT_WRITE_FAILED, 503);
      }
      await recordAdminOperationEvent(securityEntity as unknown as AdminApiEntity, {
        authorization,
        requestId,
        operation: options.operation,
        environment: authorization.environment,
        outcome: 'authorized',
        testRunId: authorization.payload.testRunId,
        now: options.now?.(),
      });
      const result = await options.execute({
        request, client, authorization, payload: authorization.payload,
      });
      return buildAdminSuccessResponse(result, { requestId });
    } catch (error) {
      // The security-event entity is the sole service-role exception for denied audits.
      try {
        const securityEntity = client?.asServiceRole?.entities?.ProFormRecoverySecurityEvent;
        if (isPlainObject(securityEntity) && typeof securityEntity.create === 'function') {
          await recordDeniedAdminOperation(securityEntity as unknown as AdminApiEntity, {
            body, error, requestId, operation: options.operation,
            getEnvironmentValue: options.getEnvironmentValue, now: options.now?.(),
          });
        }
      } catch {
        // An invalid request may not contain enough safe context to audit.
      }
      return buildAdminErrorResponse(error, requestId);
    }
  };
}

export function adminApiError(code: AdminApiErrorCode, status = 400): never {
  return fail(code, status);
}

export function isSafeAdminIdentifier(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export { ADMIN_AUTH_ERROR_CODES };
