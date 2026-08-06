/** Password-only admin recovery authorization with persistent, revocable grants. */

import {
  AUTHORIZATION_ERROR_CODES,
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  type AdminRecoveryGrantClaims,
  type AuthorizationSecret,
  type DraftTokenEnvironment,
  issueAdminRecoveryGrant,
  verifyAdminRecoveryGrant,
} from '../proDraftAuthorization/entry.ts';
import {
  ProDraftPersistenceError,
  buildSafeJsonResponse,
  createServerRequestId,
  readBoundedJsonBody,
} from '../proDraftPersistence/entry.ts';
import {
  hmacSha256Bytes,
  hmacSha256Hex,
  timingSafeEqualBytes,
} from '../proDraftSecurity/entry.ts';
import { readTrustedClientNetworkContext } from '../proDraftRecoverySecurity/entry.ts';

export const PRO_DRAFT_ADMIN_AUTH_VERSION = 1;
export const MAX_ADMIN_AUTH_REQUEST_BYTES = 16 * 1024;
export const ADMIN_AUTH_SCOPES = Object.freeze({
  DRAFT_RECOVERY: SIGNED_TOKEN_SCOPES.ADMIN_DRAFT_RECOVERY,
} as const);

export const ADMIN_AUTH_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'ADMIN_AUTH_INVALID_CONFIGURATION',
  INVALID_INPUT: 'ADMIN_AUTH_INVALID_INPUT',
  INVALID_PASSWORD: 'ADMIN_AUTH_INVALID_PASSWORD',
  INVALID_GRANT: 'ADMIN_AUTH_INVALID_GRANT',
  GRANT_VERSION_MISMATCH: 'ADMIN_AUTH_GRANT_VERSION_MISMATCH',
  PASSWORD_VERSION_MISMATCH: 'ADMIN_AUTH_PASSWORD_VERSION_MISMATCH',
  POLICY_VERSION_MISMATCH: 'ADMIN_AUTH_POLICY_VERSION_MISMATCH',
  DEVICE_MISMATCH: 'ADMIN_AUTH_DEVICE_MISMATCH',
  ENVIRONMENT_MISMATCH: 'ADMIN_AUTH_ENVIRONMENT_MISMATCH',
  RATE_LIMITED: 'ADMIN_AUTH_RATE_LIMITED',
  LOCKED: 'ADMIN_AUTH_LOCKED',
  EVENT_STORE_UNAVAILABLE: 'ADMIN_AUTH_EVENT_STORE_UNAVAILABLE',
  INTERNAL_ERROR: 'ADMIN_AUTH_INTERNAL_ERROR',
} as const);

export const ADMIN_AUTH_ATTEMPT_TYPES = Object.freeze([
  'admin_password_authentication',
  'admin_grant_validation',
  'admin_grant_revocation',
  'admin_draft_list',
  'admin_draft_detail',
  'admin_draft_update',
  'admin_event_list',
  'admin_retry_submission',
  'admin_repair_submission',
  'admin_migration_analyze',
  'admin_migration_apply',
  'admin_migration_duplicate_resolution',
  'admin_migration_rollback',
  'admin_retention_analyze',
  'admin_retention_apply',
] as const);

export const ADMIN_AUTH_OUTCOMES = Object.freeze([
  'authorized',
  'invalid_password',
  'invalid_grant',
  'grant_version_mismatch',
  'password_version_mismatch',
  'device_mismatch',
  'environment_mismatch',
  'rate_limited',
  'locked',
  'revoked',
  'internal_error',
] as const);

export type AdminAuthErrorCode = typeof ADMIN_AUTH_ERROR_CODES[
  keyof typeof ADMIN_AUTH_ERROR_CODES
];
export type AdminAuthAttemptType = typeof ADMIN_AUTH_ATTEMPT_TYPES[number];
export type AdminAuthOutcome = typeof ADMIN_AUTH_OUTCOMES[number];
export type AdminAuthEnvironment = DraftTokenEnvironment | 'unknown';

type EnvSource = Readonly<Record<string, unknown>>
  | Readonly<{ get: (name: string) => unknown }>
  | ((name: string) => unknown);

export type AdminRecoveryPolicy = Readonly<{
  version: 1;
  environment: AdminAuthEnvironment;
  grantVersion: number;
  passwordVersion: number;
  recoveryPolicyVersion: number;
  ipAttemptsPer15Min: number;
  deviceAttemptsPer15Min: number;
  failuresBeforeLockout: number;
  lockoutSeconds: number;
  minResponseMs: number;
  maxJitterMs: number;
  attemptWindowSeconds: 900;
}>;

export type AdminRecoverySecurityEvent = Readonly<{
  request_id: string;
  environment: string;
  attempt_type?: AdminAuthAttemptType;
  outcome?: AdminAuthOutcome;
  ip_hash?: string;
  device_hash?: string;
  failure_count_window?: number;
  attempt_count_window?: number;
  lockout_until?: string;
  window_started_at?: string;
  created_at_server?: string;
  policy_version?: number;
  test_run_id?: string;
}>;

export type AdminRecoveryAttemptEvaluation = Readonly<{
  allowed: boolean;
  locked: boolean;
  rateLimited: boolean;
  retryAfterSeconds: number;
  failureCountWindow: number;
  ipAttemptCountWindow: number;
  deviceAttemptCountWindow: number;
  lockoutUntil: string | null;
}>;

type SecurityEntity = Readonly<{
  create: (data: Record<string, unknown>) => Promise<unknown>;
  filter: (
    query: Record<string, unknown>,
    sort?: string,
    limit?: number,
    skip?: number,
  ) => Promise<unknown[]>;
}>;

export type AdminAuthorizationFunctionDependencies = Readonly<{
  createClientFromRequest: (request: Request) => unknown;
  getEnvironmentValue: (name: string) => string | undefined;
  createRequestId?: () => string;
  now?: () => Date;
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  cryptoProvider?: Pick<Crypto, 'getRandomValues' | 'subtle'>;
}>;

const CONFIG_NAMES = Object.freeze({
  password: 'DRAFT_RECOVERY_PASSWORD',
  grantSecret: 'PRO_FORM_ADMIN_GRANT_SECRET',
  grantVersion: 'PRO_FORM_ADMIN_GRANT_VERSION',
  passwordVersion: 'PRO_FORM_ADMIN_PASSWORD_VERSION',
  policyVersion: 'PRO_FORM_ADMIN_RECOVERY_POLICY_VERSION',
  ipAttempts: 'PRO_FORM_ADMIN_RECOVERY_IP_ATTEMPTS_PER_15_MIN',
  deviceAttempts: 'PRO_FORM_ADMIN_RECOVERY_DEVICE_ATTEMPTS_PER_15_MIN',
  failuresBeforeLockout: 'PRO_FORM_ADMIN_RECOVERY_FAILURES_BEFORE_LOCKOUT',
  lockoutSeconds: 'PRO_FORM_ADMIN_RECOVERY_LOCKOUT_SECONDS',
  minResponseMs: 'PRO_FORM_ADMIN_RECOVERY_MIN_RESPONSE_MS',
  maxJitterMs: 'PRO_FORM_ADMIN_RECOVERY_MAX_JITTER_MS',
});

const POLICY_SPECS = Object.freeze({
  grantVersion: { name: CONFIG_NAMES.grantVersion, defaultValue: 1, min: 1, max: 1_000_000 },
  passwordVersion: { name: CONFIG_NAMES.passwordVersion, defaultValue: 1, min: 1, max: 1_000_000 },
  recoveryPolicyVersion: { name: CONFIG_NAMES.policyVersion, defaultValue: 1, min: 1, max: 1_000_000 },
  ipAttemptsPer15Min: { name: CONFIG_NAMES.ipAttempts, defaultValue: 10, min: 1, max: 100 },
  deviceAttemptsPer15Min: { name: CONFIG_NAMES.deviceAttempts, defaultValue: 10, min: 1, max: 100 },
  failuresBeforeLockout: { name: CONFIG_NAMES.failuresBeforeLockout, defaultValue: 10, min: 2, max: 100 },
  lockoutSeconds: { name: CONFIG_NAMES.lockoutSeconds, defaultValue: 1800, min: 60, max: 86_400 },
  minResponseMs: { name: CONFIG_NAMES.minResponseMs, defaultValue: 400, min: 200, max: 2_000 },
  maxJitterMs: { name: CONFIG_NAMES.maxJitterMs, defaultValue: 200, min: 0, max: 1_000 },
});

const PASSWORD_COMPARE_DOMAIN = 'pro-draft:admin-password-compare:v1:';
const DEVICE_BINDING_DOMAIN = 'pro-draft:admin-device-binding:v1:';
const IP_HASH_DOMAIN = 'pro-draft:admin-ip:v1:';
const DEVICE_ID_PATTERN = /^pdd_[A-Za-z0-9_-]{22}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const ENVIRONMENTS = new Set<AdminAuthEnvironment>([
  'local', 'test', 'staging', 'production',
]);
const FAILURE_OUTCOMES = new Set<AdminAuthOutcome>([
  'invalid_password', 'invalid_grant', 'grant_version_mismatch',
  'password_version_mismatch', 'device_mismatch', 'environment_mismatch',
  'internal_error',
]);

export class AdminAuthorizationError extends Error {
  readonly code: AdminAuthErrorCode;
  readonly status: number;

  constructor(code: AdminAuthErrorCode, status = 400) {
    super(code);
    this.name = 'AdminAuthorizationError';
    this.code = code;
    this.status = status;
  }
}

function fail(code: AdminAuthErrorCode, status = 400): never {
  throw new AdminAuthorizationError(code, status);
}

function readEnv(source: EnvSource, name: string): unknown {
  try {
    if (typeof source === 'function') return source(name);
    if ('get' in source && typeof source.get === 'function') return source.get(name);
    return source[name];
  } catch {
    return undefined;
  }
}

function defaultEnv(name: string): unknown {
  try {
    return (globalThis as typeof globalThis & {
      Deno?: { env?: { get?: (key: string) => string | undefined } };
    }).Deno?.env?.get?.(name);
  } catch {
    return undefined;
  }
}

function normalizeEnvironment(value: unknown): AdminAuthEnvironment {
  return ENVIRONMENTS.has(value as AdminAuthEnvironment)
    ? value as AdminAuthEnvironment : 'unknown';
}

function boundedValue(source: EnvSource, key: keyof typeof POLICY_SPECS): number {
  const spec = POLICY_SPECS[key];
  const raw = readEnv(source, spec.name);
  if (raw === undefined || raw === '') return spec.defaultValue;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed)) return spec.defaultValue;
  return Math.min(spec.max, Math.max(spec.min, parsed));
}

export function getAdminRecoveryPolicy(
  envSource: EnvSource = defaultEnv,
  environmentInput?: AdminAuthEnvironment,
): AdminRecoveryPolicy {
  const environment = normalizeEnvironment(
    environmentInput ?? readEnv(envSource, 'PRO_DRAFT_ENVIRONMENT'),
  );
  return Object.freeze({
    version: PRO_DRAFT_ADMIN_AUTH_VERSION,
    environment,
    grantVersion: boundedValue(envSource, 'grantVersion'),
    passwordVersion: boundedValue(envSource, 'passwordVersion'),
    recoveryPolicyVersion: boundedValue(envSource, 'recoveryPolicyVersion'),
    ipAttemptsPer15Min: boundedValue(envSource, 'ipAttemptsPer15Min'),
    deviceAttemptsPer15Min: boundedValue(envSource, 'deviceAttemptsPer15Min'),
    failuresBeforeLockout: boundedValue(envSource, 'failuresBeforeLockout'),
    lockoutSeconds: boundedValue(envSource, 'lockoutSeconds'),
    minResponseMs: boundedValue(envSource, 'minResponseMs'),
    maxJitterMs: boundedValue(envSource, 'maxJitterMs'),
    attemptWindowSeconds: 900,
  });
}

function requireSecret(value: unknown): string {
  if (typeof value !== 'string'
    || new TextEncoder().encode(value).byteLength < 32) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_CONFIGURATION, 503);
  }
  return value;
}

export function normalizeSubmittedRecoveryPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  }
  return value;
}

export async function derivePasswordComparisonValue(
  password: unknown,
  adminGrantSecret: unknown,
  cryptoProvider?: Pick<Crypto, 'subtle'>,
): Promise<Uint8Array> {
  const normalized = normalizeSubmittedRecoveryPassword(password);
  return hmacSha256Bytes(
    requireSecret(adminGrantSecret),
    `${PASSWORD_COMPARE_DOMAIN}${normalized}`,
    cryptoProvider,
  );
}

export async function verifyRecoveryPassword(options: Readonly<{
  submittedPassword: unknown;
  configuredPassword: unknown;
  adminGrantSecret: unknown;
  cryptoProvider?: Pick<Crypto, 'subtle'>;
}>): Promise<boolean> {
  const configured = normalizeSubmittedRecoveryPassword(options.configuredPassword);
  const submitted = normalizeSubmittedRecoveryPassword(options.submittedPassword);
  const [configuredValue, submittedValue] = await Promise.all([
    derivePasswordComparisonValue(configured, options.adminGrantSecret, options.cryptoProvider),
    derivePasswordComparisonValue(submitted, options.adminGrantSecret, options.cryptoProvider),
  ]);
  return timingSafeEqualBytes(configuredValue, submittedValue);
}

export async function validateAdminDeviceBinding(options: Readonly<{
  deviceId: unknown;
  adminGrantSecret: unknown;
  cryptoProvider?: Pick<Crypto, 'subtle'>;
}>): Promise<string> {
  if (typeof options.deviceId !== 'string'
    || !DEVICE_ID_PATTERN.test(options.deviceId)) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  }
  return hmacSha256Hex(
    requireSecret(options.adminGrantSecret),
    `${DEVICE_BINDING_DOMAIN}${options.deviceId}`,
    options.cryptoProvider,
  );
}

async function hashTrustedIp(
  trustedIp: string,
  secret: string,
  cryptoProvider?: Pick<Crypto, 'subtle'>,
): Promise<string> {
  return hmacSha256Hex(secret, `${IP_HASH_DOMAIN}${trustedIp || 'unknown'}`, cryptoProvider);
}

function authorizationSecret(value: string): AuthorizationSecret {
  return Object.freeze({
    name: AUTHORIZATION_SECRET_NAMES.ADMIN_RECOVERY_GRANT,
    value,
  });
}

export async function issuePersistentAdminRecoveryGrant(options: Readonly<{
  policy: AdminRecoveryPolicy;
  deviceBindingHash: string;
  adminGrantSecret: unknown;
  clock?: () => number;
  tokenIdGenerator?: () => string;
  cryptoProvider?: Pick<Crypto, 'subtle'>;
}>): Promise<string> {
  if (!ENVIRONMENTS.has(options.policy.environment)
    || !HASH_PATTERN.test(options.deviceBindingHash)) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_CONFIGURATION, 503);
  }
  const secret = requireSecret(options.adminGrantSecret);
  return issueAdminRecoveryGrant({
    environment: options.policy.environment,
    grantVersion: options.policy.grantVersion,
    passwordVersion: options.policy.passwordVersion,
    recoveryPolicyVersion: options.policy.recoveryPolicyVersion,
    deviceBindingHash: options.deviceBindingHash,
  }, {
    secret: authorizationSecret(secret),
    clock: options.clock,
    tokenIdGenerator: options.tokenIdGenerator,
    cryptoProvider: options.cryptoProvider,
  });
}

function mapGrantError(error: unknown): AdminAuthorizationError {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code : null;
  if (code === AUTHORIZATION_ERROR_CODES.TOKEN_GRANT_VERSION_INVALID) {
    return new AdminAuthorizationError(ADMIN_AUTH_ERROR_CODES.GRANT_VERSION_MISMATCH, 401);
  }
  if (code === AUTHORIZATION_ERROR_CODES.TOKEN_PASSWORD_VERSION_INVALID) {
    return new AdminAuthorizationError(ADMIN_AUTH_ERROR_CODES.PASSWORD_VERSION_MISMATCH, 401);
  }
  if (code === AUTHORIZATION_ERROR_CODES.TOKEN_POLICY_VERSION_INVALID) {
    return new AdminAuthorizationError(ADMIN_AUTH_ERROR_CODES.POLICY_VERSION_MISMATCH, 401);
  }
  if (code === AUTHORIZATION_ERROR_CODES.TOKEN_DEVICE_BINDING_INVALID) {
    return new AdminAuthorizationError(ADMIN_AUTH_ERROR_CODES.DEVICE_MISMATCH, 401);
  }
  if (code === AUTHORIZATION_ERROR_CODES.TOKEN_ENVIRONMENT_INVALID) {
    return new AdminAuthorizationError(ADMIN_AUTH_ERROR_CODES.ENVIRONMENT_MISMATCH, 401);
  }
  return new AdminAuthorizationError(ADMIN_AUTH_ERROR_CODES.INVALID_GRANT, 401);
}

export async function verifyPersistentAdminRecoveryGrant(options: Readonly<{
  grant: unknown;
  policy: AdminRecoveryPolicy;
  deviceBindingHash: string;
  adminGrantSecret: unknown;
  clock?: () => number;
  cryptoProvider?: Pick<Crypto, 'subtle'>;
}>): Promise<AdminRecoveryGrantClaims> {
  if (typeof options.grant !== 'string' || options.grant.length > 8192
    || !TOKEN_PATTERN.test(options.grant)
    || !ENVIRONMENTS.has(options.policy.environment)
    || !HASH_PATTERN.test(options.deviceBindingHash)) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_GRANT, 401);
  }
  try {
    return await verifyAdminRecoveryGrant(options.grant, {
      secret: authorizationSecret(requireSecret(options.adminGrantSecret)),
      expectedEnvironment: options.policy.environment,
      expectedGrantVersion: options.policy.grantVersion,
      expectedPasswordVersion: options.policy.passwordVersion,
      expectedRecoveryPolicyVersion: options.policy.recoveryPolicyVersion,
      expectedDeviceBindingHash: options.deviceBindingHash,
      clock: options.clock,
      cryptoProvider: options.cryptoProvider,
    });
  } catch (error) {
    throw mapGrantError(error);
  }
}

function eventTime(event: AdminRecoverySecurityEvent): number {
  const parsed = Date.parse(event.created_at_server ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.min(5000, Math.max(0, Math.trunc(value))) : 0;
}

export function evaluateAdminRecoveryAttempt(options: Readonly<{
  policy: AdminRecoveryPolicy;
  events: readonly AdminRecoverySecurityEvent[];
  ipHash: string;
  deviceHash: string;
  mode?: 'password' | 'grant' | 'forget_device';
  now?: Date | number;
}>): AdminRecoveryAttemptEvaluation {
  const nowMs = options.now instanceof Date ? options.now.getTime()
    : options.now ?? Date.now();
  if (!Number.isFinite(nowMs) || !HASH_PATTERN.test(options.ipHash)
    || !HASH_PATTERN.test(options.deviceHash)) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  }
  const recent = options.events.filter((event) => (
    eventTime(event) >= nowMs - options.policy.attemptWindowSeconds * 1000
  ));
  const multiplier = options.mode === 'password' ? 1 : 4;
  const ipAttemptCountWindow = safeCount(recent.filter(
    (event) => event.ip_hash === options.ipHash,
  ).length);
  const deviceAttemptCountWindow = safeCount(recent.filter(
    (event) => event.device_hash === options.deviceHash,
  ).length);
  const failureCountWindow = safeCount(recent.filter((event) => (
    event.device_hash === options.deviceHash
    && event.outcome != null
    && FAILURE_OUTCOMES.has(event.outcome)
  )).length);
  const activeLockout = recent
    .filter((event) => event.device_hash === options.deviceHash)
    .map((event) => Date.parse(event.lockout_until ?? ''))
    .filter((value) => Number.isFinite(value) && value > nowMs)
    .sort((left, right) => right - left)[0];
  const locked = Number.isFinite(activeLockout);
  const rateLimited = ipAttemptCountWindow >= options.policy.ipAttemptsPer15Min * multiplier
    || deviceAttemptCountWindow >= options.policy.deviceAttemptsPer15Min * multiplier;
  const lockoutUntil = locked ? new Date(activeLockout).toISOString() : null;
  return Object.freeze({
    allowed: !locked && !rateLimited,
    locked,
    rateLimited,
    retryAfterSeconds: locked
      ? Math.max(1, Math.ceil((activeLockout - nowMs) / 1000))
      : rateLimited ? options.policy.attemptWindowSeconds : 0,
    failureCountWindow,
    ipAttemptCountWindow,
    deviceAttemptCountWindow,
    lockoutUntil,
  });
}

function optionalSafeId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value) ? value : undefined;
}

export async function recordAdminRecoverySecurityEvent(
  entity: SecurityEntity,
  input: AdminRecoverySecurityEvent,
): Promise<unknown> {
  if (!entity || typeof entity.create !== 'function'
    || !SAFE_ID_PATTERN.test(input.request_id)
    || !SAFE_ID_PATTERN.test(input.environment)
    || (input.attempt_type != null && !ADMIN_AUTH_ATTEMPT_TYPES.includes(input.attempt_type))
    || (input.outcome != null && !ADMIN_AUTH_OUTCOMES.includes(input.outcome))
    || (input.ip_hash != null && !HASH_PATTERN.test(input.ip_hash))
    || (input.device_hash != null && !HASH_PATTERN.test(input.device_hash))) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  }
  const record = {
    request_id: input.request_id,
    environment: input.environment,
    ...(input.attempt_type ? { attempt_type: input.attempt_type } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.ip_hash ? { ip_hash: input.ip_hash } : {}),
    ...(input.device_hash ? { device_hash: input.device_hash } : {}),
    failure_count_window: safeCount(input.failure_count_window ?? 0),
    attempt_count_window: safeCount(input.attempt_count_window ?? 0),
    ...(input.lockout_until ? { lockout_until: input.lockout_until } : {}),
    ...(input.window_started_at ? { window_started_at: input.window_started_at } : {}),
    created_at_server: input.created_at_server ?? new Date().toISOString(),
    policy_version: input.policy_version ?? PRO_DRAFT_ADMIN_AUTH_VERSION,
    ...(optionalSafeId(input.test_run_id) ? { test_run_id: input.test_run_id } : {}),
  };
  try {
    return await entity.create(record);
  } catch {
    return fail(ADMIN_AUTH_ERROR_CODES.EVENT_STORE_UNAVAILABLE, 503);
  }
}

export function getSafeAdminAuthorizationDiagnostics(value: Readonly<{
  errorCode?: unknown;
  policy?: AdminRecoveryPolicy;
}> = {}): Readonly<Record<string, unknown>> {
  const errorCode = typeof value.errorCode === 'string'
    && Object.values(ADMIN_AUTH_ERROR_CODES).includes(value.errorCode as AdminAuthErrorCode)
    ? value.errorCode : null;
  return Object.freeze({
    version: PRO_DRAFT_ADMIN_AUTH_VERSION,
    scope: ADMIN_AUTH_SCOPES.DRAFT_RECOVERY,
    environment: value.policy?.environment ?? 'unknown',
    grantVersion: value.policy?.grantVersion ?? null,
    passwordVersion: value.policy?.passwordVersion ?? null,
    recoveryPolicyVersion: value.policy?.recoveryPolicyVersion ?? null,
    fixedExpiration: false,
    deviceBinding: 'random-device-hmac',
    passwordComparison: 'purpose-separated-hmac',
    errorCode,
    exposesPassword: false,
    exposesGrant: false,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type AdminAuthRequest = Readonly<{
  mode: 'password' | 'grant' | 'forget_device';
  password?: unknown;
  grant?: string;
  deviceId: string;
  testRunId?: string;
}>;

function validateRequest(value: unknown, environment: AdminAuthEnvironment): AdminAuthRequest {
  if (!isPlainObject(value)) return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  const mode = value.mode;
  if (!['password', 'grant', 'forget_device'].includes(String(mode))) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  }
  const allowed = new Set(['mode', 'deviceId', 'testRunId', mode === 'password' ? 'password' : 'grant']);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || typeof value.deviceId !== 'string' || !DEVICE_ID_PATTERN.test(value.deviceId)) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  }
  const testRunId = optionalSafeId(value.testRunId);
  if (value.testRunId !== undefined && !testRunId) return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  if (testRunId && environment === 'production') return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  if (mode === 'password') {
    return Object.freeze({
      mode,
      password: value.password,
      deviceId: value.deviceId,
      ...(testRunId ? { testRunId } : {}),
    });
  }
  if (typeof value.grant !== 'string' || value.grant.length === 0 || value.grant.length > 8192) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_INPUT);
  }
  return Object.freeze({
    mode: mode as 'grant' | 'forget_device',
    grant: value.grant,
    deviceId: value.deviceId,
    ...(testRunId ? { testRunId } : {}),
  });
}

function getSecurityEntity(client: unknown): SecurityEntity {
  if (!isPlainObject(client) || !isPlainObject(client.asServiceRole)
    || !isPlainObject(client.asServiceRole.entities)) {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_CONFIGURATION, 503);
  }
  const entity = client.asServiceRole.entities.ProFormRecoverySecurityEvent;
  if (!isPlainObject(entity) || typeof entity.create !== 'function'
    || typeof entity.filter !== 'function') {
    return fail(ADMIN_AUTH_ERROR_CODES.INVALID_CONFIGURATION, 503);
  }
  return entity as unknown as SecurityEntity;
}

async function recentEvents(
  entity: SecurityEntity,
  policy: AdminRecoveryPolicy,
  now: Date,
): Promise<readonly AdminRecoverySecurityEvent[]> {
  try {
    const rows = await entity.filter(
      { environment: policy.environment },
      '-created_at_server',
      500,
      0,
    );
    const cutoff = now.getTime() - policy.attemptWindowSeconds * 1000;
    return Object.freeze(rows.filter((row): row is AdminRecoverySecurityEvent => (
      isPlainObject(row)
      && eventTime(row as AdminRecoverySecurityEvent) >= cutoff
    )));
  } catch {
    return fail(ADMIN_AUTH_ERROR_CODES.EVENT_STORE_UNAVAILABLE, 503);
  }
}

function publicFailure(
  requestId: string,
  status: number,
  options: Readonly<{ locked?: boolean; retryAfterSeconds?: number }> = {},
): Response {
  return buildSafeJsonResponse({
    success: false,
    authorized: false,
    error: 'Authorization could not be completed.',
    ...(options.locked ? { locked: true } : {}),
    ...(options.retryAfterSeconds
      ? { retryAfterSeconds: options.retryAfterSeconds } : {}),
    requestId,
  }, { status });
}

function lockoutForFailure(
  evaluation: AdminRecoveryAttemptEvaluation,
  policy: AdminRecoveryPolicy,
  now: Date,
): string | undefined {
  return evaluation.failureCountWindow + 1 >= policy.failuresBeforeLockout
    ? new Date(now.getTime() + policy.lockoutSeconds * 1000).toISOString()
    : undefined;
}

async function delayResponse(
  dependencies: AdminAuthorizationFunctionDependencies,
  policy: AdminRecoveryPolicy,
  startedAt: number,
): Promise<void> {
  const provider = dependencies.cryptoProvider ?? globalThis.crypto;
  let jitter = 0;
  try {
    const random = new Uint32Array(1);
    provider.getRandomValues(random);
    jitter = random[0] % (policy.maxJitterMs + 1);
  } catch {
    jitter = policy.maxJitterMs;
  }
  const wait = Math.max(0, policy.minResponseMs + jitter - (Date.now() - startedAt));
  await (dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  })))(wait);
}

function errorOutcome(error: unknown): AdminAuthOutcome {
  const code = error instanceof AdminAuthorizationError ? error.code : '';
  const outcomes: Partial<Record<AdminAuthErrorCode, AdminAuthOutcome>> = {
    [ADMIN_AUTH_ERROR_CODES.GRANT_VERSION_MISMATCH]: 'grant_version_mismatch',
    [ADMIN_AUTH_ERROR_CODES.PASSWORD_VERSION_MISMATCH]: 'password_version_mismatch',
    [ADMIN_AUTH_ERROR_CODES.POLICY_VERSION_MISMATCH]: 'invalid_grant',
    [ADMIN_AUTH_ERROR_CODES.DEVICE_MISMATCH]: 'device_mismatch',
    [ADMIN_AUTH_ERROR_CODES.ENVIRONMENT_MISMATCH]: 'environment_mismatch',
    [ADMIN_AUTH_ERROR_CODES.INVALID_GRANT]: 'invalid_grant',
  };
  return outcomes[code as AdminAuthErrorCode] ?? 'invalid_grant';
}

export function createVerifyDraftRecoveryAccessHandler(
  dependencies: AdminAuthorizationFunctionDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const startedAt = Date.now();
    const requestId = createServerRequestId({ generator: dependencies.createRequestId });
    const policy = getAdminRecoveryPolicy(dependencies.getEnvironmentValue);
    try {
      if (!ENVIRONMENTS.has(policy.environment)) {
        return publicFailure(requestId, 503);
      }
      const body = await readBoundedJsonBody(request, {
        method: 'POST',
        maxBytes: MAX_ADMIN_AUTH_REQUEST_BYTES,
      });
      const input = validateRequest(body, policy.environment);
      const adminGrantSecret = requireSecret(
        dependencies.getEnvironmentValue(CONFIG_NAMES.grantSecret),
      );
      const configuredPassword = dependencies.getEnvironmentValue(CONFIG_NAMES.password);
      if (typeof configuredPassword !== 'string' || configuredPassword.length === 0
        || configuredPassword.length > 1024) {
        return publicFailure(requestId, 503);
      }
      const now = dependencies.now?.() ?? new Date();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        return publicFailure(requestId, 503);
      }
      const client = dependencies.createClientFromRequest(request);
      const entity = getSecurityEntity(client);
      const deviceHash = await validateAdminDeviceBinding({
        deviceId: input.deviceId,
        adminGrantSecret,
        cryptoProvider: dependencies.cryptoProvider,
      });
      const network = readTrustedClientNetworkContext(request);
      const ipHash = await hashTrustedIp(
        network.trustedAddress,
        adminGrantSecret,
        dependencies.cryptoProvider,
      );
      const events = await recentEvents(entity, policy, now);
      const evaluation = evaluateAdminRecoveryAttempt({
        policy,
        events,
        ipHash,
        deviceHash,
        mode: input.mode,
        now,
      });
      const attemptType: AdminAuthAttemptType = input.mode === 'password'
        ? 'admin_password_authentication'
        : input.mode === 'grant'
          ? 'admin_grant_validation' : 'admin_grant_revocation';
      const audit = async (outcome: AdminAuthOutcome, lockoutUntil?: string) => (
        recordAdminRecoverySecurityEvent(entity, {
          request_id: requestId,
          environment: policy.environment,
          attempt_type: attemptType,
          outcome,
          ip_hash: ipHash,
          device_hash: deviceHash,
          failure_count_window: evaluation.failureCountWindow
            + (FAILURE_OUTCOMES.has(outcome) ? 1 : 0),
          attempt_count_window: Math.max(
            evaluation.ipAttemptCountWindow,
            evaluation.deviceAttemptCountWindow,
          ) + 1,
          ...(lockoutUntil ? { lockout_until: lockoutUntil } : {}),
          window_started_at: new Date(
            now.getTime() - policy.attemptWindowSeconds * 1000,
          ).toISOString(),
          created_at_server: now.toISOString(),
          policy_version: policy.recoveryPolicyVersion,
          test_run_id: input.testRunId,
        })
      );

      if (!evaluation.allowed) {
        await audit(evaluation.locked ? 'locked' : 'rate_limited');
        await delayResponse(dependencies, policy, startedAt);
        return publicFailure(requestId, 429, {
          locked: evaluation.locked,
          retryAfterSeconds: evaluation.retryAfterSeconds,
        });
      }

      if (input.mode === 'password') {
        let matches = false;
        try {
          matches = await verifyRecoveryPassword({
            submittedPassword: input.password,
            configuredPassword,
            adminGrantSecret,
            cryptoProvider: dependencies.cryptoProvider,
          });
        } catch (error) {
          if (error instanceof AdminAuthorizationError
            && error.code === ADMIN_AUTH_ERROR_CODES.INVALID_INPUT) {
            matches = false;
          } else {
            throw error;
          }
        }
        if (!matches) {
          const lockoutUntil = lockoutForFailure(evaluation, policy, now);
          await audit('invalid_password', lockoutUntil);
          await delayResponse(dependencies, policy, startedAt);
          return publicFailure(requestId, 401, {
            locked: Boolean(lockoutUntil),
            retryAfterSeconds: lockoutUntil ? policy.lockoutSeconds : undefined,
          });
        }
        const grant = await issuePersistentAdminRecoveryGrant({
          policy,
          deviceBindingHash: deviceHash,
          adminGrantSecret,
          clock: dependencies.clock,
          cryptoProvider: dependencies.cryptoProvider,
        });
        await audit('authorized');
        await delayResponse(dependencies, policy, startedAt);
        return buildSafeJsonResponse({
          success: true,
          authorized: true,
          grant,
          grantVersion: policy.grantVersion,
          passwordVersion: policy.passwordVersion,
          recoveryPolicyVersion: policy.recoveryPolicyVersion,
          persistent: true,
          storageNotice: 'Authorization persists only while this browser storage and device binding remain available.',
          requestId,
        });
      }

      let claims: AdminRecoveryGrantClaims | null = null;
      try {
        claims = await verifyPersistentAdminRecoveryGrant({
          grant: input.grant,
          policy,
          deviceBindingHash: deviceHash,
          adminGrantSecret,
          clock: dependencies.clock,
          cryptoProvider: dependencies.cryptoProvider,
        });
      } catch (error) {
        await audit(errorOutcome(error));
        await delayResponse(dependencies, policy, startedAt);
        if (input.mode === 'forget_device') {
          return buildSafeJsonResponse({
            success: true,
            authorized: false,
            forgotten: true,
            requestId,
          });
        }
        return publicFailure(requestId, 401);
      }

      if (input.mode === 'forget_device') {
        await audit('revoked');
        await delayResponse(dependencies, policy, startedAt);
        return buildSafeJsonResponse({
          success: true,
          authorized: false,
          forgotten: true,
          requestId,
        });
      }

      await audit('authorized');
      await delayResponse(dependencies, policy, startedAt);
      return buildSafeJsonResponse({
        success: true,
        authorized: true,
        grantVersion: claims.grantVersion,
        passwordVersion: claims.passwordVersion,
        recoveryPolicyVersion: claims.recoveryPolicyVersion,
        persistent: true,
        storageNotice: 'Authorization remains bound to this environment and browser device.',
        requestId,
      });
    } catch (error) {
      await delayResponse(dependencies, policy, startedAt);
      if (error instanceof ProDraftPersistenceError) {
        return publicFailure(requestId, error.status);
      }
      const status = error instanceof AdminAuthorizationError ? error.status : 500;
      return publicFailure(requestId, status);
    }
  };
}
