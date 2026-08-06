/**
 * Endpoint-free abuse controls for future public draft recovery functions.
 *
 * Raw email, recovery code, IP address, device ID, CAPTCHA token, request body,
 * answer content, and recovery-session material are never persisted or logged.
 * Callers must hash trusted inputs before recording an event and must return the
 * generic public failure envelope rather than internal outcomes.
 */

import {
  MIN_HMAC_SECRET_BYTES,
  hmacSha256Hex,
} from '../proDraftSecurity/entry.ts';

export const PRO_DRAFT_RECOVERY_SECURITY_POLICY_VERSION = 1;
export const PRO_FORM_ABUSE_HASH_SECRET_NAME = 'PRO_FORM_ABUSE_HASH_SECRET';

export const RECOVERY_ATTEMPT_TYPES = Object.freeze([
  'email_recovery',
  'code_recovery',
  'list_choices',
  'select_choice',
  'captcha',
  'admin_review',
] as const);

export const RECOVERY_ATTEMPT_OUTCOMES = Object.freeze([
  'success',
  'not_found',
  'invalid_input',
  'rate_limited',
  'captcha_required',
  'captcha_failed',
  'locked',
  'superseded',
  'internal_error',
] as const);

export const RECOVERY_SECURITY_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: 'RECOVERY_SECURITY_INVALID_CONFIGURATION',
  INVALID_INPUT: 'RECOVERY_SECURITY_INVALID_INPUT',
  INVALID_SECRET: 'RECOVERY_SECURITY_INVALID_SECRET',
  INVALID_SECRET_PURPOSE: 'RECOVERY_SECURITY_INVALID_SECRET_PURPOSE',
  IP_RATE_LIMITED: 'RECOVERY_SECURITY_IP_RATE_LIMITED',
  SUBJECT_RATE_LIMITED: 'RECOVERY_SECURITY_SUBJECT_RATE_LIMITED',
  GLOBAL_RATE_LIMITED: 'RECOVERY_SECURITY_GLOBAL_RATE_LIMITED',
  CAPTCHA_REQUIRED: 'RECOVERY_SECURITY_CAPTCHA_REQUIRED',
  TEMPORARILY_LOCKED: 'RECOVERY_SECURITY_TEMPORARILY_LOCKED',
  EVENT_STORE_UNAVAILABLE: 'RECOVERY_SECURITY_EVENT_STORE_UNAVAILABLE',
  RECOVERY_NOT_COMPLETED: 'RECOVERY_NOT_COMPLETED',
} as const);

export type RecoveryAttemptType = typeof RECOVERY_ATTEMPT_TYPES[number];
export type RecoveryAttemptOutcome = typeof RECOVERY_ATTEMPT_OUTCOMES[number];
export type RecoveryEnvironment = 'local' | 'test' | 'staging' | 'production' | 'unknown';
export type RecoverySecurityErrorCode = typeof RECOVERY_SECURITY_ERROR_CODES[
  keyof typeof RECOVERY_SECURITY_ERROR_CODES
];

export type RecoverySecurityPolicy = Readonly<{
  version: 1;
  environment: RecoveryEnvironment;
  ipAttemptsPer15Min: number;
  subjectAttemptsPer15Min: number;
  failuresBeforeCaptcha: number;
  failuresBeforeLockout: number;
  lockoutSeconds: number;
  globalAttemptsPerMin: number;
  minResponseMs: number;
  maxJitterMs: number;
  attemptWindowSeconds: 900;
  globalWindowSeconds: 60;
}>;

type EnvSource = Readonly<Record<string, unknown>>
  | Readonly<{ get: (name: string) => unknown }>
  | ((name: string) => unknown);

export type AbuseHashSecret = Readonly<{
  name: typeof PRO_FORM_ABUSE_HASH_SECRET_NAME;
  value: Uint8Array | string;
}>;

export type RecoveryAbuseHashInput = Readonly<{
  trustedIpAddress?: string | null;
  deviceId?: string | null;
  normalizedEmail?: string | null;
  normalizedRecoveryCodeSubject?: string | null;
}>;

export type RecoveryAbuseHashes = Readonly<{
  ipHash: string;
  deviceHash: string | null;
  emailSubjectHash: string | null;
  codeSubjectHash: string | null;
}>;

export type TrustedClientNetworkContext = Readonly<{
  trustedAddress: string;
  source: 'cf-connecting-ip' | 'x-real-ip' | 'x-forwarded-for' | 'unknown';
  available: boolean;
}>;

export type RecoverySecurityEvent = Readonly<{
  id?: string;
  request_id: string;
  environment: string;
  attempt_type?: RecoveryAttemptType;
  outcome?: RecoveryAttemptOutcome;
  subject_hash?: string;
  ip_hash?: string;
  device_hash?: string;
  recovery_email_lookup_hash?: string;
  draft_id?: string;
  captcha_required?: boolean;
  captcha_verified?: boolean;
  failure_count_window?: number;
  attempt_count_window?: number;
  lockout_until?: string;
  window_started_at?: string;
  created_at_server?: string;
  policy_version?: number;
  test_run_id?: string;
}>;

export type RecoveryAttemptEvaluation = Readonly<{
  allowed: boolean;
  locked: boolean;
  rateLimited: boolean;
  captchaRequired: boolean;
  errorCode: RecoverySecurityErrorCode | null;
  retryAfterSeconds: number;
  failureCountWindow: number;
  ipAttemptCountWindow: number;
  subjectAttemptCountWindow: number;
  globalAttemptCountWindow: number;
  lockoutUntil: string | null;
  recordGlobalCircuitBreakerEvent: boolean;
}>;

type EntityHandler = Readonly<{
  create: (data: Record<string, unknown>) => Promise<unknown>;
  filter: (
    query: Record<string, unknown>,
    sort?: string,
    limit?: number,
    skip?: number,
  ) => Promise<unknown[]>;
}>;

const POLICY_SPECS = Object.freeze({
  ipAttemptsPer15Min: Object.freeze({
    name: 'PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN', defaultValue: 10, max: 100,
  }),
  subjectAttemptsPer15Min: Object.freeze({
    name: 'PRO_DRAFT_RECOVERY_SUBJECT_ATTEMPTS_PER_15_MIN', defaultValue: 5, max: 50,
  }),
  failuresBeforeCaptcha: Object.freeze({
    name: 'PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA', defaultValue: 3, max: 20,
  }),
  failuresBeforeLockout: Object.freeze({
    name: 'PRO_DRAFT_RECOVERY_FAILURES_BEFORE_LOCKOUT', defaultValue: 10, max: 50,
  }),
  lockoutSeconds: Object.freeze({
    name: 'PRO_DRAFT_RECOVERY_LOCKOUT_SECONDS', defaultValue: 1800, max: 86400,
  }),
  globalAttemptsPerMin: Object.freeze({
    name: 'PRO_DRAFT_RECOVERY_GLOBAL_ATTEMPTS_PER_MIN', defaultValue: 300, max: 5000,
  }),
  minResponseMs: Object.freeze({
    name: 'PRO_DRAFT_RECOVERY_MIN_RESPONSE_MS', defaultValue: 400, max: 2000,
  }),
  maxJitterMs: Object.freeze({
    name: 'PRO_DRAFT_RECOVERY_MAX_JITTER_MS', defaultValue: 200, max: 1000,
  }),
});

const PRODUCTION_MINIMUMS = Object.freeze({
  ipAttemptsPer15Min: 2,
  subjectAttemptsPer15Min: 2,
  failuresBeforeCaptcha: 2,
  failuresBeforeLockout: 5,
  lockoutSeconds: 60,
  globalAttemptsPerMin: 50,
  minResponseMs: 200,
  maxJitterMs: 1,
});

const HMAC_DOMAINS = Object.freeze({
  ip: 'pro-draft:abuse:ip:v1:',
  device: 'pro-draft:abuse:device:v1:',
  email: 'pro-draft:abuse:email-subject:v1:',
  code: 'pro-draft:abuse:code-subject:v1:',
});

const SAFE_HASH = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_DEVICE_ID = /^pdd_[A-Za-z0-9_-]{22}$/u;
const FAILED_OUTCOMES = new Set<RecoveryAttemptOutcome>([
  'not_found', 'invalid_input', 'captcha_failed', 'internal_error',
]);
const GENERIC_RECOVERY_MESSAGE =
  'We could not recover a questionnaire with the information provided.';

export class RecoverySecurityError extends Error {
  readonly code: RecoverySecurityErrorCode;

  constructor(code: RecoverySecurityErrorCode) {
    super(code);
    this.name = 'RecoverySecurityError';
    this.code = code;
  }
}

function fail(code: RecoverySecurityErrorCode): never {
  throw new RecoverySecurityError(code);
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

function normalizeEnvironment(value: unknown): RecoveryEnvironment {
  return value === 'local' || value === 'test' || value === 'staging'
    || value === 'production' ? value : 'unknown';
}

function boundedPolicyValue(
  source: EnvSource,
  key: keyof typeof POLICY_SPECS,
  environment: RecoveryEnvironment,
): number {
  const spec = POLICY_SPECS[key];
  const raw = readEnv(source, spec.name);
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return spec.defaultValue;
  const minimum = environment === 'production' ? PRODUCTION_MINIMUMS[key] : 1;
  return Math.min(spec.max, Math.max(minimum, parsed));
}

export function getRecoverySecurityPolicy(
  envSource: EnvSource = defaultEnv,
  environmentInput?: RecoveryEnvironment,
): RecoverySecurityPolicy {
  const environment = normalizeEnvironment(
    environmentInput ?? readEnv(envSource, 'PRO_DRAFT_ENVIRONMENT'),
  );
  const values = Object.fromEntries(
    Object.keys(POLICY_SPECS).map((key) => [
      key,
      boundedPolicyValue(envSource, key as keyof typeof POLICY_SPECS, environment),
    ]),
  ) as unknown as Omit<RecoverySecurityPolicy, 'version' | 'environment'
    | 'attemptWindowSeconds' | 'globalWindowSeconds'>;
  const failuresBeforeLockout = Math.max(
    values.failuresBeforeLockout,
    values.failuresBeforeCaptcha + 1,
  );
  return Object.freeze({
    version: PRO_DRAFT_RECOVERY_SECURITY_POLICY_VERSION,
    environment,
    ...values,
    failuresBeforeLockout,
    attemptWindowSeconds: 900,
    globalWindowSeconds: 60,
  });
}

function secretValue(secret: AbuseHashSecret): Uint8Array | string {
  if (!secret || secret.name !== PRO_FORM_ABUSE_HASH_SECRET_NAME) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_SECRET_PURPOSE);
  }
  const value = secret.value;
  const length = typeof value === 'string'
    ? new TextEncoder().encode(value).length
    : value instanceof Uint8Array ? value.length : 0;
  if (length < MIN_HMAC_SECRET_BYTES) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_SECRET);
  }
  return value;
}

function normalizedEmail(value: string): string {
  if (
    value.length < 3 || value.length > 254 || value !== value.trim()
    || value !== value.toLowerCase() || value.split('@').length !== 2
  ) return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  return value;
}

function normalizedCodeSubject(value: string): string {
  const normalized = value.normalize('NFKC').toUpperCase().replace(/[\s-]+/gu, '');
  if (!/^[A-Z0-9]{1,128}$/u.test(normalized)) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  return normalized;
}

export async function deriveRecoveryAbuseHashes(
  input: RecoveryAbuseHashInput,
  secret: AbuseHashSecret,
): Promise<RecoveryAbuseHashes> {
  const key = secretValue(secret);
  const ip = input.trustedIpAddress && input.trustedIpAddress !== ''
    ? input.trustedIpAddress : 'unknown';
  const device = input.deviceId == null ? null : input.deviceId;
  if (device !== null && !SAFE_DEVICE_ID.test(device)) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  return Object.freeze({
    ipHash: await hmacSha256Hex(key, `${HMAC_DOMAINS.ip}${ip}`),
    deviceHash: device === null ? null
      : await hmacSha256Hex(key, `${HMAC_DOMAINS.device}${device}`),
    emailSubjectHash: input.normalizedEmail == null ? null
      : await hmacSha256Hex(
        key,
        `${HMAC_DOMAINS.email}${normalizedEmail(input.normalizedEmail)}`,
      ),
    codeSubjectHash: input.normalizedRecoveryCodeSubject == null ? null
      : await hmacSha256Hex(
        key,
        `${HMAC_DOMAINS.code}${normalizedCodeSubject(
          input.normalizedRecoveryCodeSubject,
        )}`,
      ),
  });
}

function normalizeIpCandidate(raw: string): string | null {
  let value = raw.trim();
  if (value.length === 0 || value.length > 128 || /[\s"'<>]/u.test(value)) return null;
  if (value.startsWith('[')) {
    const closing = value.indexOf(']');
    if (closing < 0) return null;
    value = value.slice(1, closing);
  } else if (value.includes('.') && value.split(':').length === 2) {
    value = value.split(':')[0];
  }
  value = value.split('%')[0].toLowerCase();
  if (value.includes('.')) {
    const octets = value.split('.');
    if (octets.length !== 4 || octets.some((octet) => (
      !/^\d{1,3}$/u.test(octet) || Number(octet) > 255
    ))) return null;
    return octets.map((octet) => String(Number(octet))).join('.');
  }
  if (!value.includes(':') || !/^[0-9a-f:]+$/u.test(value)) return null;
  if ((value.match(/::/gu) ?? []).length > 1) return null;
  const parts = value.split(':');
  const nonEmptyParts = parts.filter(Boolean).length;
  const hasCompression = value.includes('::');
  if (parts.some((part) => part.length > 4)
    || (!hasCompression && parts.length !== 8)
    || (hasCompression && nonEmptyParts >= 8)) return null;
  return parts.map((part) => part.replace(/^0+(?=[0-9a-f])/u, '')).join(':');
}

export function readTrustedClientNetworkContext(req: Request): TrustedClientNetworkContext {
  const headers = req?.headers;
  const candidates = [
    ['cf-connecting-ip', headers?.get?.('cf-connecting-ip')],
    ['x-real-ip', headers?.get?.('x-real-ip')],
    ['x-forwarded-for', headers?.get?.('x-forwarded-for')?.split(',')[0]],
  ] as const;
  for (const [source, raw] of candidates) {
    if (typeof raw !== 'string') continue;
    const trustedAddress = normalizeIpCandidate(raw);
    if (trustedAddress) return Object.freeze({ trustedAddress, source, available: true });
  }
  return Object.freeze({ trustedAddress: 'unknown', source: 'unknown', available: false });
}

function eventTime(event: RecoverySecurityEvent): number {
  const value = Date.parse(event.created_at_server ?? '');
  return Number.isFinite(value) ? value : 0;
}

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(5000, Math.trunc(value));
}

function validatedIsoDate(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  return value;
}

export function calculateLockoutUntil(
  nowInput: Date | number | string,
  failureCount: number,
  policy: RecoverySecurityPolicy,
): string | null {
  const now = nowInput instanceof Date ? nowInput.getTime()
    : typeof nowInput === 'number' ? nowInput : Date.parse(nowInput);
  if (!Number.isFinite(now) || !Number.isSafeInteger(failureCount) || failureCount < 0) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  if (failureCount < policy.failuresBeforeLockout) return null;
  return new Date(now + policy.lockoutSeconds * 1000).toISOString();
}

export function evaluateRecoveryAttempt(options: Readonly<{
  policy: RecoverySecurityPolicy;
  events: readonly RecoverySecurityEvent[];
  now?: Date | number;
  ipHash: string;
  subjectHash?: string | null;
  explicitRiskSignal?: boolean;
}>): RecoveryAttemptEvaluation {
  const nowMs = options.now instanceof Date ? options.now.getTime()
    : options.now ?? Date.now();
  if (!Number.isFinite(nowMs) || !SAFE_HASH.test(options.ipHash)
    || (options.subjectHash != null && !SAFE_HASH.test(options.subjectHash))) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  const attemptStart = nowMs - options.policy.attemptWindowSeconds * 1000;
  const globalStart = nowMs - options.policy.globalWindowSeconds * 1000;
  const recent = options.events.filter((event) => eventTime(event) >= attemptStart);
  const globalAttemptCountWindow = safeCount(
    recent.filter((event) => eventTime(event) >= globalStart).length,
  );
  const ipAttemptCountWindow = safeCount(
    recent.filter((event) => event.ip_hash === options.ipHash).length,
  );
  const subjectAttemptCountWindow = options.subjectHash == null ? 0 : safeCount(
    recent.filter((event) => event.subject_hash === options.subjectHash).length,
  );
  const failureCountWindow = options.subjectHash == null ? 0 : safeCount(
    recent.filter((event) => (
      event.subject_hash === options.subjectHash
      && event.outcome != null
      && FAILED_OUTCOMES.has(event.outcome)
    )).length,
  );
  const activeLockout = recent
    .map((event) => Date.parse(event.lockout_until ?? ''))
    .filter((value) => Number.isFinite(value) && value > nowMs)
    .sort((left, right) => right - left)[0];
  const calculatedLockout = calculateLockoutUntil(
    nowMs,
    failureCountWindow,
    options.policy,
  );
  const lockoutUntil = activeLockout
    ? new Date(activeLockout).toISOString()
    : calculatedLockout;
  const locked = lockoutUntil !== null;
  const globalLimited = globalAttemptCountWindow >= options.policy.globalAttemptsPerMin;
  const ipLimited = ipAttemptCountWindow >= options.policy.ipAttemptsPer15Min;
  const subjectLimited = options.subjectHash != null
    && subjectAttemptCountWindow >= options.policy.subjectAttemptsPer15Min;
  const rateLimited = globalLimited || ipLimited || subjectLimited;
  const captchaRequired = options.explicitRiskSignal === true
    || failureCountWindow >= options.policy.failuresBeforeCaptcha
    || rateLimited;
  let errorCode: RecoverySecurityErrorCode | null = null;
  if (locked) errorCode = RECOVERY_SECURITY_ERROR_CODES.TEMPORARILY_LOCKED;
  else if (globalLimited) errorCode = RECOVERY_SECURITY_ERROR_CODES.GLOBAL_RATE_LIMITED;
  else if (ipLimited) errorCode = RECOVERY_SECURITY_ERROR_CODES.IP_RATE_LIMITED;
  else if (subjectLimited) errorCode = RECOVERY_SECURITY_ERROR_CODES.SUBJECT_RATE_LIMITED;
  else if (captchaRequired) errorCode = RECOVERY_SECURITY_ERROR_CODES.CAPTCHA_REQUIRED;
  const retryAfterSeconds = locked
    ? Math.max(1, Math.ceil((Date.parse(lockoutUntil as string) - nowMs) / 1000))
    : rateLimited ? options.policy.attemptWindowSeconds : 0;
  return Object.freeze({
    allowed: !locked && !rateLimited,
    locked,
    rateLimited,
    captchaRequired,
    errorCode,
    retryAfterSeconds,
    failureCountWindow,
    ipAttemptCountWindow,
    subjectAttemptCountWindow,
    globalAttemptCountWindow,
    lockoutUntil,
    recordGlobalCircuitBreakerEvent: globalLimited,
  });
}

export function calculateRecoveryDelay(options: Readonly<{
  requestStartedAtMs: number;
  nowMs?: number;
  policy: RecoverySecurityPolicy;
  cryptoProvider?: Pick<Crypto, 'getRandomValues'>;
}>): number {
  const now = options.nowMs ?? Date.now();
  if (!Number.isFinite(options.requestStartedAtMs) || !Number.isFinite(now)) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  const provider = options.cryptoProvider ?? globalThis.crypto;
  if (!provider || typeof provider.getRandomValues !== 'function') {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_CONFIGURATION);
  }
  const random = new Uint32Array(1);
  provider.getRandomValues(random);
  const jitter = random[0] % (options.policy.maxJitterMs + 1);
  const target = options.requestStartedAtMs + options.policy.minResponseMs + jitter;
  return Math.min(
    options.policy.minResponseMs + options.policy.maxJitterMs,
    Math.max(0, Math.ceil(target - now)),
  );
}

function optionalSafeString(value: unknown, pattern = SAFE_ID): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

export async function recordRecoverySecurityEvent(
  entity: EntityHandler,
  input: RecoverySecurityEvent,
): Promise<unknown> {
  if (!entity || typeof entity.create !== 'function'
    || !SAFE_ID.test(input.request_id) || !SAFE_ID.test(input.environment)
    || (input.attempt_type != null && !RECOVERY_ATTEMPT_TYPES.includes(input.attempt_type))
    || (input.outcome != null && !RECOVERY_ATTEMPT_OUTCOMES.includes(input.outcome))) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  for (const hash of [input.subject_hash, input.ip_hash, input.device_hash]) {
    if (hash != null && !SAFE_HASH.test(hash)) {
      return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
    }
  }
  const lockoutUntil = input.lockout_until == null
    ? undefined : validatedIsoDate(input.lockout_until);
  const windowStartedAt = input.window_started_at == null
    ? undefined : validatedIsoDate(input.window_started_at);
  const createdAtServer = validatedIsoDate(
    input.created_at_server ?? new Date().toISOString(),
  );
  const record = {
    request_id: input.request_id,
    environment: input.environment,
    ...(input.attempt_type ? { attempt_type: input.attempt_type } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.subject_hash ? { subject_hash: input.subject_hash } : {}),
    ...(input.ip_hash ? { ip_hash: input.ip_hash } : {}),
    ...(input.device_hash ? { device_hash: input.device_hash } : {}),
    ...(optionalSafeString(input.recovery_email_lookup_hash, SAFE_HASH)
      ? { recovery_email_lookup_hash: input.recovery_email_lookup_hash } : {}),
    ...(optionalSafeString(input.draft_id) ? { draft_id: input.draft_id } : {}),
    captcha_required: input.captcha_required === true,
    captcha_verified: input.captcha_verified === true,
    failure_count_window: safeCount(input.failure_count_window ?? 0),
    attempt_count_window: safeCount(input.attempt_count_window ?? 0),
    ...(lockoutUntil ? { lockout_until: lockoutUntil } : {}),
    ...(windowStartedAt ? { window_started_at: windowStartedAt } : {}),
    created_at_server: createdAtServer,
    policy_version: PRO_DRAFT_RECOVERY_SECURITY_POLICY_VERSION,
    ...(optionalSafeString(input.test_run_id) ? { test_run_id: input.test_run_id } : {}),
  };
  try {
    return await entity.create(record);
  } catch {
    return fail(RECOVERY_SECURITY_ERROR_CODES.EVENT_STORE_UNAVAILABLE);
  }
}

export async function getRecentRecoverySecurityEvents(
  entity: EntityHandler,
  options: Readonly<{
    environment: string;
    since: Date | string;
    limit?: number;
  }>,
): Promise<readonly RecoverySecurityEvent[]> {
  if (!entity || typeof entity.filter !== 'function' || !SAFE_ID.test(options.environment)) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  const sinceMs = options.since instanceof Date
    ? options.since.getTime() : Date.parse(options.since);
  if (!Number.isFinite(sinceMs)) return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  const limit = Number.isSafeInteger(options.limit)
    ? Math.min(500, Math.max(1, options.limit as number)) : 500;
  try {
    const rows = await entity.filter(
      { environment: options.environment },
      '-created_at_server',
      limit,
      0,
    );
    return Object.freeze(rows.filter((row): row is RecoverySecurityEvent => (
      row != null && typeof row === 'object'
      && eventTime(row as RecoverySecurityEvent) >= sinceMs
    )));
  } catch {
    return fail(RECOVERY_SECURITY_ERROR_CODES.EVENT_STORE_UNAVAILABLE);
  }
}

export function createGenericPublicRecoveryFailure(options: Readonly<{
  captchaRequired?: boolean;
  retryAfterSeconds?: number;
  requestId: string;
}>): Readonly<{
  success: false;
  recoveryCompleted: false;
  errorCode: 'RECOVERY_NOT_COMPLETED';
  message: string;
  captchaRequired: boolean;
  retryAfterSeconds: number;
  requestId: string;
}> {
  if (!SAFE_ID.test(options.requestId)) {
    return fail(RECOVERY_SECURITY_ERROR_CODES.INVALID_INPUT);
  }
  const retryAfterSeconds = Number.isSafeInteger(options.retryAfterSeconds)
    ? Math.min(86400, Math.max(0, options.retryAfterSeconds as number)) : 0;
  return Object.freeze({
    success: false,
    recoveryCompleted: false,
    errorCode: 'RECOVERY_NOT_COMPLETED',
    message: GENERIC_RECOVERY_MESSAGE,
    captchaRequired: options.captchaRequired === true,
    retryAfterSeconds,
    requestId: options.requestId,
  });
}

export function getSafeRecoverySecurityDiagnostics(
  policy: RecoverySecurityPolicy,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    policyVersion: policy.version,
    environment: policy.environment,
    ipAttemptsPer15Min: policy.ipAttemptsPer15Min,
    subjectAttemptsPer15Min: policy.subjectAttemptsPer15Min,
    failuresBeforeCaptcha: policy.failuresBeforeCaptcha,
    failuresBeforeLockout: policy.failuresBeforeLockout,
    lockoutSeconds: policy.lockoutSeconds,
    globalAttemptsPerMin: policy.globalAttemptsPerMin,
    minResponseMs: policy.minResponseMs,
    maxJitterMs: policy.maxJitterMs,
    storesRawNetworkAddress: false,
    storesRawDeviceId: false,
    storesRawRecoverySubject: false,
    deviceIdIsAuthorization: false,
  });
}
