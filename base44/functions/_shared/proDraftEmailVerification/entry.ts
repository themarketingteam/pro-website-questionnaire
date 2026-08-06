/** Disabled-by-default future OTP and magic-link verification framework. */

import {
  AUTHORIZATION_SECRET_NAMES,
  type AuthorizationSecret,
  type RecoverySessionClaims,
  issueRecoverySessionToken,
} from '../proDraftAuthorization/entry.ts';
import {
  buildSafeJsonResponse,
  createServerRequestId,
} from '../proDraftPersistence/entry.ts';
import {
  generateOpaqueToken,
  generateSecureRandomBytes,
  hmacSha256Hex,
  sha256Hex,
  timingSafeEqualStrings,
  type RandomCryptoProvider,
  type SubtleCryptoProvider,
} from '../proDraftSecurity/entry.ts';
import {
  getBackendRuntimeConfig,
  type BackendRuntimeConfig,
} from '../proDraftRuntimeConfig/entry.ts';

export const EMAIL_VERIFICATION_FRAMEWORK_VERSION = 1;
export const EMAIL_VERIFICATION_OTP_DIGITS = 6;
export const EMAIL_VERIFICATION_DEFAULT_OTP_TTL_SECONDS = 10 * 60;
export const EMAIL_VERIFICATION_MAX_OTP_TTL_SECONDS = 15 * 60;
export const EMAIL_VERIFICATION_DEFAULT_OTP_ATTEMPTS = 5;
export const EMAIL_VERIFICATION_MAGIC_LINK_TTL_SECONDS = 30 * 60;
export const EMAIL_VERIFICATION_MAX_REQUEST_BYTES = 32 * 1024;

export const EMAIL_VERIFICATION_METHODS = Object.freeze([
  'otp',
  'magic_link',
] as const);

export const EMAIL_VERIFICATION_STATUSES = Object.freeze([
  'pending',
  'verified',
  'expired',
  'locked',
  'consumed',
  'cancelled',
] as const);

export const EMAIL_VERIFICATION_REDIRECT_PATHS = Object.freeze([
  '/',
  '/ProQuestionnaire',
] as const);

export const EMAIL_VERIFICATION_ERROR_CODES = Object.freeze({
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INVALID_REQUEST: 'EMAIL_VERIFICATION_INVALID_REQUEST',
  REQUEST_TOO_LARGE: 'EMAIL_VERIFICATION_REQUEST_TOO_LARGE',
  SECRET_INVALID: 'EMAIL_VERIFICATION_SECRET_INVALID',
  STORAGE_FAILED: 'EMAIL_VERIFICATION_STORAGE_FAILED',
  ATTEMPT_NOT_FOUND: 'EMAIL_VERIFICATION_ATTEMPT_NOT_FOUND',
  ATTEMPT_INVALID: 'EMAIL_VERIFICATION_ATTEMPT_INVALID',
  ATTEMPT_EXPIRED: 'EMAIL_VERIFICATION_ATTEMPT_EXPIRED',
  ATTEMPT_LOCKED: 'EMAIL_VERIFICATION_ATTEMPT_LOCKED',
  ATTEMPT_CONSUMED: 'EMAIL_VERIFICATION_ATTEMPT_CONSUMED',
  VALUE_INCORRECT: 'EMAIL_VERIFICATION_VALUE_INCORRECT',
  REDIRECT_NOT_ALLOWED: 'EMAIL_VERIFICATION_REDIRECT_NOT_ALLOWED',
} as const);

export type EmailVerificationMethod = typeof EMAIL_VERIFICATION_METHODS[number];
export type EmailVerificationStatus = typeof EMAIL_VERIFICATION_STATUSES[number];
export type EmailVerificationErrorCode = typeof EMAIL_VERIFICATION_ERROR_CODES[
  keyof typeof EMAIL_VERIFICATION_ERROR_CODES
];
export type EmailVerificationEnvironment = 'local' | 'test' | 'staging' | 'production';

export type EmailVerificationSecret = Readonly<{
  name: typeof AUTHORIZATION_SECRET_NAMES.EMAIL_OTP
    | typeof AUTHORIZATION_SECRET_NAMES.MAGIC_LINK;
  value: string | Uint8Array;
}>;

export type EmailVerificationAttemptRecord = Readonly<Record<string, unknown> & {
  id?: string;
  attempt_id: string;
  environment: EmailVerificationEnvironment;
  verification_method: EmailVerificationMethod;
  recovery_email_lookup_hash: string;
  verification_token_hash: string;
  status: EmailVerificationStatus;
  requested_at: string;
  expires_at: string;
  attempt_count: number;
  maximum_attempts: number;
  request_id: string;
}>;

export type EmailVerificationAttemptRepository = Readonly<{
  create: (record: Readonly<Record<string, unknown>>) => Promise<unknown>;
  findByAttemptId: (attemptId: string) => Promise<unknown>;
  conditionalUpdate: (
    recordId: string,
    changes: Readonly<Record<string, unknown>>,
    expected: Readonly<{
      status: EmailVerificationStatus;
      attemptCount: number;
      verificationTokenHash: string;
    }>,
  ) => Promise<unknown>;
}>;

export type EmailVerificationResult = Readonly<{
  verified: true;
  verificationMethod: EmailVerificationMethod;
  recoveryEmailLookupHash: string;
  recoveryEmailVerificationStatus: 'verified_otp' | 'verified_magic_link';
  attemptId: string;
}>;

type CryptoProvider = RandomCryptoProvider & SubtleCryptoProvider;

export class EmailVerificationFrameworkError extends Error {
  readonly code: EmailVerificationErrorCode;
  readonly status: number;

  constructor(code: EmailVerificationErrorCode, status = 400) {
    super('Email verification could not be completed.');
    this.name = 'EmailVerificationFrameworkError';
    this.code = code;
    this.status = status;
  }
}

function fail(code: EmailVerificationErrorCode, status = 400): never {
  throw new EmailVerificationFrameworkError(code, status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const OTP_PATTERN = /^\d{6}$/u;
const MAGIC_TOKEN_PATTERN = /^pdeml_[A-Za-z0-9_-]{43}$/u;
const OTP_REJECTION_LIMIT = 250;
const MAX_OTP_RANDOM_BATCHES = 32;

function requireHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.INVALID_REQUEST);
  }
  return value;
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.INVALID_REQUEST);
  }
  return value;
}

function requireEnvironment(value: unknown): EmailVerificationEnvironment {
  if (!['local', 'test', 'staging', 'production'].includes(String(value))) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.INVALID_REQUEST);
  }
  return value as EmailVerificationEnvironment;
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.INVALID_REQUEST);
  }
  return value;
}

function requireSecret(
  secret: EmailVerificationSecret,
  expectedName: EmailVerificationSecret['name'],
): string | Uint8Array {
  if (!secret || secret.name !== expectedName || !('value' in secret)) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.SECRET_INVALID, 503);
  }
  return secret.value;
}

function optionalHash(value: unknown): string | undefined {
  return value === undefined ? undefined : requireHash(value);
}

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || Number(selected) < 1 || Number(selected) > maximum) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.INVALID_REQUEST);
  }
  return Number(selected);
}

function recordId(record: EmailVerificationAttemptRecord): string {
  return typeof record.id === 'string' && ID_PATTERN.test(record.id)
    ? record.id
    : record.attempt_id;
}

function parseAttempt(value: unknown): EmailVerificationAttemptRecord {
  if (!isPlainObject(value)
    || !ID_PATTERN.test(String(value.attempt_id ?? ''))
    || !['local', 'test', 'staging', 'production'].includes(String(value.environment ?? ''))
    || !EMAIL_VERIFICATION_METHODS.includes(value.verification_method as EmailVerificationMethod)
    || !HASH_PATTERN.test(String(value.recovery_email_lookup_hash ?? ''))
    || !HASH_PATTERN.test(String(value.verification_token_hash ?? ''))
    || !EMAIL_VERIFICATION_STATUSES.includes(value.status as EmailVerificationStatus)
    || Number.isNaN(Date.parse(String(value.requested_at ?? '')))
    || Number.isNaN(Date.parse(String(value.expires_at ?? '')))
    || !Number.isSafeInteger(value.attempt_count)
    || Number(value.attempt_count) < 0
    || !Number.isSafeInteger(value.maximum_attempts)
    || Number(value.maximum_attempts) < 1
    || !ID_PATTERN.test(String(value.request_id ?? ''))) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_INVALID, 409);
  }
  return value as EmailVerificationAttemptRecord;
}

async function persistCreate(
  repository: EmailVerificationAttemptRepository,
  record: Readonly<Record<string, unknown>>,
): Promise<EmailVerificationAttemptRecord> {
  try {
    return parseAttempt(await repository.create(record));
  } catch (error) {
    if (error instanceof EmailVerificationFrameworkError) throw error;
    return fail(EMAIL_VERIFICATION_ERROR_CODES.STORAGE_FAILED, 503);
  }
}

async function loadAttempt(
  repository: EmailVerificationAttemptRepository,
  attemptId: string,
): Promise<EmailVerificationAttemptRecord> {
  let found: unknown;
  try {
    found = await repository.findByAttemptId(attemptId);
  } catch {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.STORAGE_FAILED, 503);
  }
  if (found === null || found === undefined) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_NOT_FOUND, 404);
  }
  return parseAttempt(found);
}

async function persistUpdate(
  repository: EmailVerificationAttemptRepository,
  current: EmailVerificationAttemptRecord,
  changes: Readonly<Record<string, unknown>>,
): Promise<EmailVerificationAttemptRecord> {
  try {
    return parseAttempt(await repository.conditionalUpdate(recordId(current), changes, {
      status: current.status,
      attemptCount: current.attempt_count,
      verificationTokenHash: current.verification_token_hash,
    }));
  } catch (error) {
    if (error instanceof EmailVerificationFrameworkError) throw error;
    return fail(EMAIL_VERIFICATION_ERROR_CODES.STORAGE_FAILED, 503);
  }
}

export function isOtpEnabled(config: Partial<BackendRuntimeConfig> | undefined): boolean {
  return config?.durableDraftV2Enabled === true && config.emailOtpEnabled === true;
}

export function isMagicLinkEnabled(
  config: Partial<BackendRuntimeConfig> | undefined,
): boolean {
  return config?.durableDraftV2Enabled === true && config.magicLinkEnabled === true;
}

export function generateOtpCode(options: Readonly<{
  cryptoProvider?: RandomCryptoProvider;
}> = {}): string {
  let output = '';
  for (let batch = 0; batch < MAX_OTP_RANDOM_BATCHES && output.length < 6; batch += 1) {
    const bytes = generateSecureRandomBytes(16, options.cryptoProvider);
    for (const byte of bytes) {
      if (byte < OTP_REJECTION_LIMIT) output += String(byte % 10);
      if (output.length === EMAIL_VERIFICATION_OTP_DIGITS) break;
    }
  }
  if (output.length !== EMAIL_VERIFICATION_OTP_DIGITS) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.INVALID_REQUEST, 503);
  }
  return output;
}

export async function hashOtpCode(
  otpCode: unknown,
  secret: EmailVerificationSecret,
  binding: Readonly<{ attemptId: unknown; recoveryEmailLookupHash: unknown }>,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  if (typeof otpCode !== 'string' || !OTP_PATTERN.test(otpCode)) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.INVALID_REQUEST);
  }
  const attemptId = requireId(binding.attemptId);
  const lookupHash = requireHash(binding.recoveryEmailLookupHash);
  return hmacSha256Hex(
    requireSecret(secret, AUTHORIZATION_SECRET_NAMES.EMAIL_OTP),
    `pro-draft:email-verification:otp:v1:${attemptId}:${lookupHash}:${otpCode}`,
    cryptoProvider,
  );
}

export function generateMagicLinkToken(options: Readonly<{
  cryptoProvider?: RandomCryptoProvider;
}> = {}): string {
  return generateOpaqueToken({
    byteLength: 32,
    prefix: 'pdeml_',
    cryptoProvider: options.cryptoProvider,
  });
}

export async function hashMagicLinkToken(
  token: unknown,
  secret: EmailVerificationSecret,
  binding: Readonly<{ attemptId: unknown; recoveryEmailLookupHash: unknown }>,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  if (typeof token !== 'string' || !MAGIC_TOKEN_PATTERN.test(token)) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.INVALID_REQUEST);
  }
  const attemptId = requireId(binding.attemptId);
  const lookupHash = requireHash(binding.recoveryEmailLookupHash);
  return hmacSha256Hex(
    requireSecret(secret, AUTHORIZATION_SECRET_NAMES.MAGIC_LINK),
    `pro-draft:email-verification:magic-link:v1:${attemptId}:${lookupHash}:${token}`,
    cryptoProvider,
  );
}

export function validateEmailVerificationRedirectPath(value: unknown): string {
  if (typeof value !== 'string'
    || !EMAIL_VERIFICATION_REDIRECT_PATHS.includes(
      value as typeof EMAIL_VERIFICATION_REDIRECT_PATHS[number],
    )
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('?')
    || value.includes('#')
    || value.includes('..')
    || /[\s\\]/u.test(value)) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.REDIRECT_NOT_ALLOWED);
  }
  return value;
}

export async function hashEmailVerificationRedirectPath(
  value: unknown,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  const path = validateEmailVerificationRedirectPath(value);
  return sha256Hex(
    `pro-draft:email-verification:redirect-path:v1:${path}`,
    cryptoProvider,
  );
}

type CreateAttemptBase = Readonly<{
  repository: EmailVerificationAttemptRepository;
  environment: EmailVerificationEnvironment;
  recoveryEmailLookupHash: string;
  requestId: string;
  now?: Date;
  attemptIdGenerator?: () => string;
  cryptoProvider?: CryptoProvider;
  deviceHash?: string;
  ipHash?: string;
  testRunId?: string;
}>;

function newAttemptId(generator?: () => string): string {
  return requireId(generator ? generator() : generateOpaqueToken({ prefix: 'pdeva_' }));
}

function commonAttemptFields(
  input: CreateAttemptBase,
  method: EmailVerificationMethod,
  attemptId: string,
  now: Date,
  expiresAt: Date,
  maximumAttempts: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    attempt_id: attemptId,
    environment: requireEnvironment(input.environment),
    verification_method: method,
    recovery_email_lookup_hash: requireHash(input.recoveryEmailLookupHash),
    status: 'pending',
    requested_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    attempt_count: 0,
    maximum_attempts: maximumAttempts,
    request_id: requireId(input.requestId),
    email_delivery_status: 'not_sent',
    ...(optionalHash(input.deviceHash) ? { device_hash: input.deviceHash } : {}),
    ...(optionalHash(input.ipHash) ? { ip_hash: input.ipHash } : {}),
    ...(input.testRunId ? { test_run_id: requireId(input.testRunId) } : {}),
  });
}

export async function createOtpAttempt(
  input: CreateAttemptBase & Readonly<{
    secret: EmailVerificationSecret;
    ttlSeconds?: number;
    maximumAttempts?: number;
  }>,
): Promise<Readonly<{ otpCode: string; attempt: EmailVerificationAttemptRecord }>> {
  const now = requireDate(input.now ?? new Date());
  const ttlSeconds = boundedPositiveInteger(
    input.ttlSeconds,
    EMAIL_VERIFICATION_DEFAULT_OTP_TTL_SECONDS,
    EMAIL_VERIFICATION_MAX_OTP_TTL_SECONDS,
  );
  const maximumAttempts = boundedPositiveInteger(
    input.maximumAttempts,
    EMAIL_VERIFICATION_DEFAULT_OTP_ATTEMPTS,
    10,
  );
  const attemptId = newAttemptId(input.attemptIdGenerator);
  const otpCode = generateOtpCode({ cryptoProvider: input.cryptoProvider });
  const verificationTokenHash = await hashOtpCode(otpCode, input.secret, {
    attemptId,
    recoveryEmailLookupHash: input.recoveryEmailLookupHash,
  }, input.cryptoProvider);
  const record = Object.freeze({
    ...commonAttemptFields(
      input,
      'otp',
      attemptId,
      now,
      new Date(now.getTime() + ttlSeconds * 1000),
      maximumAttempts,
    ),
    verification_token_hash: verificationTokenHash,
  });
  return Object.freeze({
    otpCode,
    attempt: await persistCreate(input.repository, record),
  });
}

export async function createMagicLinkAttempt(
  input: CreateAttemptBase & Readonly<{
    secret: EmailVerificationSecret;
    redirectPath: string;
  }>,
): Promise<Readonly<{
  magicLinkToken: string;
  attempt: EmailVerificationAttemptRecord;
}>> {
  const now = requireDate(input.now ?? new Date());
  const attemptId = newAttemptId(input.attemptIdGenerator);
  const magicLinkToken = generateMagicLinkToken({ cryptoProvider: input.cryptoProvider });
  const verificationTokenHash = await hashMagicLinkToken(
    magicLinkToken,
    input.secret,
    { attemptId, recoveryEmailLookupHash: input.recoveryEmailLookupHash },
    input.cryptoProvider,
  );
  const redirectPathHash = await hashEmailVerificationRedirectPath(
    input.redirectPath,
    input.cryptoProvider,
  );
  const record = Object.freeze({
    ...commonAttemptFields(
      input,
      'magic_link',
      attemptId,
      now,
      new Date(now.getTime() + EMAIL_VERIFICATION_MAGIC_LINK_TTL_SECONDS * 1000),
      1,
    ),
    verification_token_hash: verificationTokenHash,
    redirect_path_hash: redirectPathHash,
  });
  return Object.freeze({
    magicLinkToken,
    attempt: await persistCreate(input.repository, record),
  });
}

async function requirePendingAttempt(
  repository: EmailVerificationAttemptRepository,
  attemptIdInput: unknown,
  method: EmailVerificationMethod,
  now: Date,
): Promise<EmailVerificationAttemptRecord> {
  const attempt = await loadAttempt(repository, requireId(attemptIdInput));
  if (attempt.verification_method !== method) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_INVALID, 409);
  }
  if (attempt.status === 'consumed' || attempt.status === 'verified') {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_CONSUMED, 409);
  }
  if (attempt.status === 'locked') {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_LOCKED, 429);
  }
  if (attempt.status !== 'pending') {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_INVALID, 409);
  }
  if (Date.parse(attempt.expires_at) <= now.getTime()) {
    await persistUpdate(repository, attempt, { status: 'expired' });
    return fail(EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_EXPIRED, 410);
  }
  return attempt;
}

function verificationResult(
  attempt: EmailVerificationAttemptRecord,
): EmailVerificationResult {
  const otp = attempt.verification_method === 'otp';
  return Object.freeze({
    verified: true,
    verificationMethod: attempt.verification_method,
    recoveryEmailLookupHash: attempt.recovery_email_lookup_hash,
    recoveryEmailVerificationStatus: otp ? 'verified_otp' : 'verified_magic_link',
    attemptId: attempt.attempt_id,
  });
}

export async function verifyOtpAttempt(input: Readonly<{
  repository: EmailVerificationAttemptRepository;
  attemptId: string;
  otpCode: string;
  secret: EmailVerificationSecret;
  now?: Date;
  cryptoProvider?: SubtleCryptoProvider;
}>): Promise<EmailVerificationResult> {
  const now = requireDate(input.now ?? new Date());
  const attempt = await requirePendingAttempt(
    input.repository,
    input.attemptId,
    'otp',
    now,
  );
  const suppliedHash = await hashOtpCode(input.otpCode, input.secret, {
    attemptId: attempt.attempt_id,
    recoveryEmailLookupHash: attempt.recovery_email_lookup_hash,
  }, input.cryptoProvider);
  const nextAttemptCount = attempt.attempt_count + 1;
  if (!timingSafeEqualStrings(attempt.verification_token_hash, suppliedHash)) {
    const locked = nextAttemptCount >= attempt.maximum_attempts;
    await persistUpdate(input.repository, attempt, {
      attempt_count: nextAttemptCount,
      ...(locked ? { status: 'locked' } : {}),
    });
    return fail(
      locked
        ? EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_LOCKED
        : EMAIL_VERIFICATION_ERROR_CODES.VALUE_INCORRECT,
      locked ? 429 : 401,
    );
  }
  const consumed = await persistUpdate(input.repository, attempt, {
    status: 'consumed',
    attempt_count: nextAttemptCount,
    verified_at: now.toISOString(),
    consumed_at: now.toISOString(),
  });
  return verificationResult(consumed);
}

export async function consumeMagicLinkAttempt(input: Readonly<{
  repository: EmailVerificationAttemptRepository;
  attemptId: string;
  magicLinkToken: string;
  secret: EmailVerificationSecret;
  redirectPath: string;
  now?: Date;
  cryptoProvider?: SubtleCryptoProvider;
}>): Promise<EmailVerificationResult> {
  const now = requireDate(input.now ?? new Date());
  const attempt = await requirePendingAttempt(
    input.repository,
    input.attemptId,
    'magic_link',
    now,
  );
  const redirectPathHash = await hashEmailVerificationRedirectPath(
    input.redirectPath,
    input.cryptoProvider,
  );
  if (typeof attempt.redirect_path_hash !== 'string'
    || !timingSafeEqualStrings(attempt.redirect_path_hash, redirectPathHash)) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.REDIRECT_NOT_ALLOWED, 403);
  }
  const suppliedHash = await hashMagicLinkToken(
    input.magicLinkToken,
    input.secret,
    {
      attemptId: attempt.attempt_id,
      recoveryEmailLookupHash: attempt.recovery_email_lookup_hash,
    },
    input.cryptoProvider,
  );
  if (!timingSafeEqualStrings(attempt.verification_token_hash, suppliedHash)) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.VALUE_INCORRECT, 401);
  }
  const consumed = await persistUpdate(input.repository, attempt, {
    status: 'consumed',
    attempt_count: 1,
    verified_at: now.toISOString(),
    consumed_at: now.toISOString(),
  });
  return verificationResult(consumed);
}

export async function issueVerifiedEmailRecoverySession(
  verification: EmailVerificationResult,
  selection: Readonly<{
    environment: EmailVerificationEnvironment;
    draftId: string;
    sessionIdHash: string;
    recoveryCodeVersion: number;
    recoverySessionVersion: number;
    grantVersion: number;
    authorizedScopes: RecoverySessionClaims['authorizedScopes'];
  }>,
  options: Readonly<{
    secret: AuthorizationSecret;
    ttlSeconds?: number;
    clock?: () => number;
    tokenIdGenerator?: () => string;
    cryptoProvider?: SubtleCryptoProvider;
  }>,
): Promise<Readonly<{
  recoverySessionToken: string;
  authorizationMethod: 'email_otp' | 'magic_link';
  recoveryEmailLookupHash: string;
  draftId: string;
  recoveryEmailVerificationStatus: 'verified_otp' | 'verified_magic_link';
}>> {
  if (verification.verified !== true) {
    return fail(EMAIL_VERIFICATION_ERROR_CODES.ATTEMPT_INVALID, 409);
  }
  const authorizationMethod = verification.verificationMethod === 'otp'
    ? 'email_otp'
    : 'magic_link';
  const draftId = requireId(selection.draftId);
  const recoverySessionToken = await issueRecoverySessionToken({
    environment: requireEnvironment(selection.environment),
    draftId,
    sessionIdHash: requireHash(selection.sessionIdHash),
    authorizationMethod,
    authorizedScopes: selection.authorizedScopes,
    recoveryEmailLookupHash: requireHash(verification.recoveryEmailLookupHash),
    recoveryEmailVerificationStatus: verification.recoveryEmailVerificationStatus,
    recoveryCodeVersion: selection.recoveryCodeVersion,
    recoverySessionVersion: selection.recoverySessionVersion,
    grantVersion: selection.grantVersion,
  }, options);
  return Object.freeze({
    recoverySessionToken,
    authorizationMethod,
    recoveryEmailLookupHash: verification.recoveryEmailLookupHash,
    draftId,
    recoveryEmailVerificationStatus: verification.recoveryEmailVerificationStatus,
  });
}

async function consumeBodyWithoutParsing(request: Request): Promise<void> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)
      || Number(declaredLength) > EMAIL_VERIFICATION_MAX_REQUEST_BYTES) {
      return fail(EMAIL_VERIFICATION_ERROR_CODES.REQUEST_TOO_LARGE, 413);
    }
  }
  if (!request.body) return;
  const reader = request.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > EMAIL_VERIFICATION_MAX_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded-size rejection remains authoritative.
        }
        return fail(EMAIL_VERIFICATION_ERROR_CODES.REQUEST_TOO_LARGE, 413);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The disabled response contains no request-derived workflow value.
    }
  }
}

export type EmailVerificationFunctionOperation =
  | 'request_otp'
  | 'verify_otp'
  | 'request_magic_link'
  | 'consume_magic_link';

export type EmailVerificationFunctionDependencies = Readonly<{
  getEnvironmentValue: (name: string) => string | undefined;
  operation: EmailVerificationFunctionOperation;
  createRequestId?: () => string;
  allowEnabledTestMode?: boolean;
  testExecutor?: (request: Request, requestId: string) => Promise<Response>;
}>;

function operationUsesOtp(operation: EmailVerificationFunctionOperation): boolean {
  return operation === 'request_otp' || operation === 'verify_otp';
}

function disabledResponse(requestId: string, status = 503): Response {
  return buildSafeJsonResponse({
    success: false,
    enabled: false,
    requestId,
    errorCode: EMAIL_VERIFICATION_ERROR_CODES.FEATURE_DISABLED,
    message: 'Email verification is unavailable.',
  }, { status });
}

export function createEmailVerificationFunctionHandler(
  dependencies: EmailVerificationFunctionDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const runtime = getBackendRuntimeConfig(dependencies.getEnvironmentValue);
    const flagEnabled = operationUsesOtp(dependencies.operation)
      ? isOtpEnabled(runtime)
      : isMagicLinkEnabled(runtime);
    const requestId = createServerRequestId(
      dependencies.createRequestId ? { generator: dependencies.createRequestId } : {},
    );
    try {
      const enabledSyntheticPath = flagEnabled
        && runtime.environment === 'test'
        && dependencies.allowEnabledTestMode === true
        && typeof dependencies.testExecutor === 'function';
      if (!enabledSyntheticPath) {
        await consumeBodyWithoutParsing(request);
        return disabledResponse(requestId);
      }
      return await dependencies.testExecutor(request, requestId);
    } catch (error) {
      if (error instanceof EmailVerificationFrameworkError
        && error.code === EMAIL_VERIFICATION_ERROR_CODES.REQUEST_TOO_LARGE) {
        return buildSafeJsonResponse({
          success: false,
          enabled: false,
          requestId,
          errorCode: error.code,
          message: 'The request is too large.',
        }, { status: error.status });
      }
      return disabledResponse(requestId);
    }
  };
}

export function getSafeEmailVerificationDiagnostics(
  config?: Partial<BackendRuntimeConfig>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: EMAIL_VERIFICATION_FRAMEWORK_VERSION,
    otpEnabled: isOtpEnabled(config),
    magicLinkEnabled: isMagicLinkEnabled(config),
    otpDigits: EMAIL_VERIFICATION_OTP_DIGITS,
    otpDefaultTtlSeconds: EMAIL_VERIFICATION_DEFAULT_OTP_TTL_SECONDS,
    otpMaximumTtlSeconds: EMAIL_VERIFICATION_MAX_OTP_TTL_SECONDS,
    otpDefaultMaximumAttempts: EMAIL_VERIFICATION_DEFAULT_OTP_ATTEMPTS,
    magicLinkTtlSeconds: EMAIL_VERIFICATION_MAGIC_LINK_TTL_SECONDS,
    magicLinkEntropyBits: 256,
    separateSecrets: true,
    storesRawEmail: false,
    storesRawOtp: false,
    storesRawMagicLinkToken: false,
    logsVerificationValues: false,
    publicUrlImplemented: false,
    redirectPaths: EMAIL_VERIFICATION_REDIRECT_PATHS,
    productionActivationImplemented: false,
  });
}
