/**
 * Signed authorization-claim primitives for durable-draft backend functions.
 *
 * Tokens are integrity-protected, not encrypted. This module performs no I/O,
 * logging, environment lookup, Base44 operation, authorization side effect, or
 * browser persistence. Callers inject secrets and policy expectations.
 */

import {
  type SecretMaterial,
  type SubtleCryptoProvider,
  fromBase64Url,
  generateOpaqueToken,
  hmacSha256Bytes,
  timingSafeEqualBytes,
  timingSafeEqualStrings,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from './proDraftSecurity.ts';

export const PRO_DRAFT_AUTHORIZATION_VERSION = 1;
export const DEFAULT_CLOCK_SKEW_SECONDS = 60;
export const SIGNED_INVITATION_MAX_TTL_SECONDS = 90 * 24 * 60 * 60;
export const DEFAULT_RECOVERY_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const MAX_RECOVERY_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_FUTURE_OTP_TTL_SECONDS = 10 * 60;
export const MAX_FUTURE_OTP_TTL_SECONDS = 15 * 60;
export const DEFAULT_FUTURE_MAGIC_LINK_TTL_SECONDS = 30 * 60;

export const SIGNED_TOKEN_TYPES = Object.freeze({
  SIGNED_INVITATION: 'signed_invitation',
  RECOVERY_SESSION: 'recovery_session',
  ADMIN_RECOVERY_GRANT: 'admin_recovery_grant',
  EMAIL_OTP: 'email_otp',
  MAGIC_LINK: 'magic_link',
} as const);

export const SIGNED_TOKEN_SCOPES = Object.freeze({
  DRAFT_INVITATION: 'draft:invitation',
  DRAFT_RECOVER: 'draft:recover',
  DRAFT_READ: 'draft:read',
  DRAFT_WRITE: 'draft:write',
  DRAFT_EVENTS: 'draft:events',
  DRAFT_LIST_ASSOCIATED: 'draft:list-associated',
  DRAFT_SUBMITTED_READ: 'draft:submitted-read',
  ADMIN_DRAFT_RECOVERY: 'admin:draft-recovery',
  EMAIL_OTP: 'email:otp',
  EMAIL_MAGIC_LINK: 'email:magic-link',
} as const);

export const AUTHORIZATION_SECRET_NAMES = Object.freeze({
  SIGNED_INVITATION: 'PRO_FORM_DRAFT_LINK_SECRET',
  RECOVERY_SESSION: 'PRO_FORM_RECOVERY_SESSION_SECRET',
  ADMIN_RECOVERY_GRANT: 'PRO_FORM_ADMIN_GRANT_SECRET',
  EMAIL_OTP: 'PRO_FORM_EMAIL_OTP_SECRET',
  MAGIC_LINK: 'PRO_FORM_MAGIC_LINK_SECRET',
} as const);

export const AUTHORIZATION_ERROR_CODES = Object.freeze({
  TOKEN_REQUIRED: 'PRO_DRAFT_AUTH_TOKEN_REQUIRED',
  TOKEN_STRUCTURE_INVALID: 'PRO_DRAFT_AUTH_TOKEN_STRUCTURE_INVALID',
  TOKEN_ENCODING_INVALID: 'PRO_DRAFT_AUTH_TOKEN_ENCODING_INVALID',
  TOKEN_SIGNATURE_INVALID: 'PRO_DRAFT_AUTH_TOKEN_SIGNATURE_INVALID',
  TOKEN_JSON_INVALID: 'PRO_DRAFT_AUTH_TOKEN_JSON_INVALID',
  TOKEN_JSON_NONCANONICAL: 'PRO_DRAFT_AUTH_TOKEN_JSON_NONCANONICAL',
  TOKEN_CLAIMS_INVALID: 'PRO_DRAFT_AUTH_TOKEN_CLAIMS_INVALID',
  TOKEN_VERSION_UNSUPPORTED: 'PRO_DRAFT_AUTH_TOKEN_VERSION_UNSUPPORTED',
  TOKEN_TYPE_INVALID: 'PRO_DRAFT_AUTH_TOKEN_TYPE_INVALID',
  TOKEN_SCOPE_INVALID: 'PRO_DRAFT_AUTH_TOKEN_SCOPE_INVALID',
  TOKEN_ENVIRONMENT_INVALID: 'PRO_DRAFT_AUTH_TOKEN_ENVIRONMENT_INVALID',
  TOKEN_ISSUED_IN_FUTURE: 'PRO_DRAFT_AUTH_TOKEN_ISSUED_IN_FUTURE',
  TOKEN_NOT_ACTIVE: 'PRO_DRAFT_AUTH_TOKEN_NOT_ACTIVE',
  TOKEN_EXPIRED: 'PRO_DRAFT_AUTH_TOKEN_EXPIRED',
  TOKEN_LIFETIME_INVALID: 'PRO_DRAFT_AUTH_TOKEN_LIFETIME_INVALID',
  TOKEN_GRANT_VERSION_INVALID: 'PRO_DRAFT_AUTH_TOKEN_GRANT_VERSION_INVALID',
  TOKEN_DRAFT_BINDING_INVALID: 'PRO_DRAFT_AUTH_TOKEN_DRAFT_BINDING_INVALID',
  TOKEN_METHOD_INVALID: 'PRO_DRAFT_AUTH_TOKEN_METHOD_INVALID',
  TOKEN_REQUIRED_SCOPE_MISSING: 'PRO_DRAFT_AUTH_TOKEN_REQUIRED_SCOPE_MISSING',
  TOKEN_EMAIL_BINDING_INVALID: 'PRO_DRAFT_AUTH_TOKEN_EMAIL_BINDING_INVALID',
  TOKEN_DOMAIN_BINDING_INVALID: 'PRO_DRAFT_AUTH_TOKEN_DOMAIN_BINDING_INVALID',
  TOKEN_USER_BINDING_INVALID: 'PRO_DRAFT_AUTH_TOKEN_USER_BINDING_INVALID',
  TOKEN_DEVICE_BINDING_INVALID: 'PRO_DRAFT_AUTH_TOKEN_DEVICE_BINDING_INVALID',
  TOKEN_PASSWORD_VERSION_INVALID: 'PRO_DRAFT_AUTH_TOKEN_PASSWORD_VERSION_INVALID',
  TOKEN_POLICY_VERSION_INVALID: 'PRO_DRAFT_AUTH_TOKEN_POLICY_VERSION_INVALID',
  TOKEN_SESSION_VERSION_INVALID: 'PRO_DRAFT_AUTH_TOKEN_SESSION_VERSION_INVALID',
  TOKEN_SECRET_PURPOSE_INVALID: 'PRO_DRAFT_AUTH_TOKEN_SECRET_PURPOSE_INVALID',
  TOKEN_CLOCK_INVALID: 'PRO_DRAFT_AUTH_TOKEN_CLOCK_INVALID',
  FUTURE_FEATURE_DISABLED: 'PRO_DRAFT_AUTH_FUTURE_FEATURE_DISABLED',
} as const);

export type SignedTokenType = typeof SIGNED_TOKEN_TYPES[
  keyof typeof SIGNED_TOKEN_TYPES
];
export type SignedTokenScope = typeof SIGNED_TOKEN_SCOPES[
  keyof typeof SIGNED_TOKEN_SCOPES
];
export type AuthorizationSecretName = typeof AUTHORIZATION_SECRET_NAMES[
  keyof typeof AUTHORIZATION_SECRET_NAMES
];
export type AuthorizationErrorCode = typeof AUTHORIZATION_ERROR_CODES[
  keyof typeof AUTHORIZATION_ERROR_CODES
];
export type DraftTokenEnvironment = 'local' | 'test' | 'staging' | 'production';
export type AuthorizationMethod =
  | 'email'
  | 'recovery_code'
  | 'signed_invitation'
  | 'email_otp'
  | 'magic_link';
export type RecoveryEmailVerificationStatus =
  | 'verified_otp'
  | 'verified_magic_link';
export type AllowedInvitationAssociation = 'current_invitation' | 'new_draft';

export type AuthorizationSecret = Readonly<{
  name: AuthorizationSecretName;
  value: SecretMaterial;
}>;

export type CommonStructuredClaims = Readonly<{
  version: number;
  type: SignedTokenType;
  scope: SignedTokenScope;
  environment: DraftTokenEnvironment;
  issuedAt: number;
  notBefore: number;
  expiresAt: number | null;
  tokenId: string;
  grantVersion: number;
}>;

export type SignedInvitationClaims = CommonStructuredClaims & Readonly<{
  type: 'signed_invitation';
  scope: 'draft:invitation';
  invitationId: string;
  formType: string;
  userIdHash: string;
  recoveryEmailLookupHash: string;
  domainIdentityHash: string;
  allowedAssociation: AllowedInvitationAssociation;
  linkVersion: number;
}>;

export type RecoverySessionClaims = CommonStructuredClaims & Readonly<{
  type: 'recovery_session';
  scope: 'draft:recover';
  draftId: string;
  sessionIdHash: string;
  authorizationMethod: AuthorizationMethod;
  authorizedScopes: readonly (
    | 'draft:read'
    | 'draft:write'
    | 'draft:submitted-read'
    | 'draft:events'
    | 'draft:list-associated'
  )[];
  recoveryEmailLookupHash?: string;
  recoveryEmailVerificationStatus?: RecoveryEmailVerificationStatus;
  recoveryCodeVersion: number;
  recoverySessionVersion: number;
}>;

export type AdminRecoveryGrantClaims = Omit<
  CommonStructuredClaims,
  'type' | 'scope' | 'expiresAt'
> & Readonly<{
  type: 'admin_recovery_grant';
  scope: 'admin:draft-recovery';
  expiresAt: null;
  deviceBindingHash: string | null;
  passwordVersion: number;
  recoveryPolicyVersion: number;
}>;

export type FutureOtpClaims = CommonStructuredClaims & Readonly<{
  type: 'email_otp';
  scope: 'email:otp';
  recoveryEmailLookupHash: string;
  attemptId: string;
  otpVersion: number;
  expiresAt: number;
  attemptCount: number;
}>;

export type FutureMagicLinkClaims = CommonStructuredClaims & Readonly<{
  type: 'magic_link';
  scope: 'email:magic-link';
  recoveryEmailLookupHash: string;
  attemptId: string;
  magicLinkVersion: number;
  expiresAt: number;
  redirectPathHash: string;
}>;

export type StructuredTokenClaims =
  | SignedInvitationClaims
  | RecoverySessionClaims
  | AdminRecoveryGrantClaims
  | FutureOtpClaims
  | FutureMagicLinkClaims;

export type SignStructuredTokenOptions = Readonly<{
  secret: AuthorizationSecret;
  cryptoProvider?: SubtleCryptoProvider;
}>;

export type VerifyStructuredTokenOptions = Readonly<{
  expectedType: SignedTokenType;
  expectedScope: SignedTokenScope;
  expectedEnvironment: DraftTokenEnvironment;
  expectedGrantVersion?: number;
  secret: AuthorizationSecret;
  clock?: () => number;
  clockSkewSeconds?: number;
  cryptoProvider?: SubtleCryptoProvider;
}>;

export type SignedInvitationValidationOptions = Readonly<{
  expectedEnvironment: DraftTokenEnvironment;
  expectedFormType: string;
  expectedRecoveryEmailLookupHash?: string;
  expectedDomainIdentityHash?: string;
  expectedUserIdHash?: string;
  expectedAllowedAssociation?: AllowedInvitationAssociation;
  clock?: () => number;
  clockSkewSeconds?: number;
}>;

export type RecoverySessionIssueInput = Readonly<{
  environment: DraftTokenEnvironment;
  draftId: string;
  sessionIdHash: string;
  authorizationMethod: AuthorizationMethod;
  authorizedScopes: RecoverySessionClaims['authorizedScopes'];
  recoveryEmailLookupHash?: string;
  recoveryEmailVerificationStatus?: RecoveryEmailVerificationStatus;
  recoveryCodeVersion: number;
  recoverySessionVersion: number;
  grantVersion: number;
}>;

export type RecoverySessionIssueOptions = Readonly<{
  secret: AuthorizationSecret;
  ttlSeconds?: number;
  clock?: () => number;
  tokenIdGenerator?: () => string;
  cryptoProvider?: SubtleCryptoProvider;
}>;

export type RecoverySessionVerifyOptions = Readonly<{
  secret: AuthorizationSecret;
  expectedEnvironment: DraftTokenEnvironment;
  expectedDraftId: string;
  expectedAuthorizationMethod: AuthorizationMethod;
  expectedRecoverySessionVersion: number;
  expectedGrantVersion: number;
  requiredScopes?: readonly RecoverySessionClaims['authorizedScopes'][number][];
  clock?: () => number;
  clockSkewSeconds?: number;
  cryptoProvider?: SubtleCryptoProvider;
}>;

export type AdminRecoveryGrantIssueInput = Readonly<{
  environment: DraftTokenEnvironment;
  grantVersion: number;
  deviceBindingHash?: string | null;
  passwordVersion: number;
  recoveryPolicyVersion: number;
}>;

export type AdminRecoveryGrantIssueOptions = Readonly<{
  secret: AuthorizationSecret;
  clock?: () => number;
  tokenIdGenerator?: () => string;
  cryptoProvider?: SubtleCryptoProvider;
}>;

export type AdminRecoveryGrantVerifyOptions = Readonly<{
  secret: AuthorizationSecret;
  expectedEnvironment: DraftTokenEnvironment;
  expectedGrantVersion: number;
  expectedPasswordVersion: number;
  expectedRecoveryPolicyVersion: number;
  expectedDeviceBindingHash?: string | null;
  clock?: () => number;
  clockSkewSeconds?: number;
  cryptoProvider?: SubtleCryptoProvider;
}>;

export type SafeAuthorizationDiagnostics = Readonly<{
  version: number;
  tokenFormat: 'base64url-json.base64url-hmac';
  signatureAlgorithm: 'HMAC-SHA-256';
  defaultClockSkewSeconds: number;
  recoverySessionDefaultTtlSeconds: number;
  recoverySessionMaximumTtlSeconds: number;
  adminGrantHasFixedExpiry: false;
  futureOtpEnabled: false;
  futureMagicLinkEnabled: false;
  errorCode: AuthorizationErrorCode | null;
}>;

const TOKEN_TYPES = new Set<SignedTokenType>(Object.values(SIGNED_TOKEN_TYPES));
const TOKEN_SCOPES = new Set<SignedTokenScope>(Object.values(SIGNED_TOKEN_SCOPES));
const ENVIRONMENTS = new Set<DraftTokenEnvironment>([
  'local',
  'test',
  'staging',
  'production',
]);
const AUTHORIZATION_METHODS = new Set<AuthorizationMethod>([
  'email',
  'recovery_code',
  'signed_invitation',
  'email_otp',
  'magic_link',
]);
const INVITATION_ASSOCIATIONS = new Set<AllowedInvitationAssociation>([
  'current_invitation',
  'new_draft',
]);
const RECOVERY_AUTHORIZED_SCOPES = new Set<SignedTokenScope>([
  SIGNED_TOKEN_SCOPES.DRAFT_READ,
  SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
  SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ,
  SIGNED_TOKEN_SCOPES.DRAFT_EVENTS,
  SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED,
]);
const LOWER_HEX_256_PATTERN = /^[0-9a-f]{64}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const FORM_TYPE_PATTERN = /^[a-z0-9_-]{1,64}$/u;
const TOKEN_ID_PATTERN = /^pdti_[A-Za-z0-9_-]{43,123}$/u;
const TOKEN_DOMAINS: Readonly<Record<SignedTokenType, string>> = Object.freeze({
  [SIGNED_TOKEN_TYPES.SIGNED_INVITATION]: 'pro-draft:authorization:signed-invitation:v1:',
  [SIGNED_TOKEN_TYPES.RECOVERY_SESSION]: 'pro-draft:authorization:recovery-session:v1:',
  [SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT]: 'pro-draft:authorization:admin-recovery-grant:v1:',
  [SIGNED_TOKEN_TYPES.EMAIL_OTP]: 'pro-draft:authorization:email-otp:v1:',
  [SIGNED_TOKEN_TYPES.MAGIC_LINK]: 'pro-draft:authorization:magic-link:v1:',
});
const TOKEN_SECRET_NAMES: Readonly<Record<SignedTokenType, AuthorizationSecretName>> =
  Object.freeze({
    [SIGNED_TOKEN_TYPES.SIGNED_INVITATION]: AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION,
    [SIGNED_TOKEN_TYPES.RECOVERY_SESSION]: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
    [SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT]: AUTHORIZATION_SECRET_NAMES.ADMIN_RECOVERY_GRANT,
    [SIGNED_TOKEN_TYPES.EMAIL_OTP]: AUTHORIZATION_SECRET_NAMES.EMAIL_OTP,
    [SIGNED_TOKEN_TYPES.MAGIC_LINK]: AUTHORIZATION_SECRET_NAMES.MAGIC_LINK,
  });
const TYPE_SCOPES: Readonly<Record<SignedTokenType, SignedTokenScope>> = Object.freeze({
  [SIGNED_TOKEN_TYPES.SIGNED_INVITATION]: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
  [SIGNED_TOKEN_TYPES.RECOVERY_SESSION]: SIGNED_TOKEN_SCOPES.DRAFT_RECOVER,
  [SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT]: SIGNED_TOKEN_SCOPES.ADMIN_DRAFT_RECOVERY,
  [SIGNED_TOKEN_TYPES.EMAIL_OTP]: SIGNED_TOKEN_SCOPES.EMAIL_OTP,
  [SIGNED_TOKEN_TYPES.MAGIC_LINK]: SIGNED_TOKEN_SCOPES.EMAIL_MAGIC_LINK,
});
const TYPE_MAXIMUM_TTLS: Readonly<Record<SignedTokenType, number | null>> =
  Object.freeze({
    [SIGNED_TOKEN_TYPES.SIGNED_INVITATION]: SIGNED_INVITATION_MAX_TTL_SECONDS,
    [SIGNED_TOKEN_TYPES.RECOVERY_SESSION]: MAX_RECOVERY_SESSION_TTL_SECONDS,
    [SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT]: null,
    [SIGNED_TOKEN_TYPES.EMAIL_OTP]: MAX_FUTURE_OTP_TTL_SECONDS,
    [SIGNED_TOKEN_TYPES.MAGIC_LINK]: DEFAULT_FUTURE_MAGIC_LINK_TTL_SECONDS,
  });
const COMMON_CLAIM_KEYS = Object.freeze([
  'version',
  'type',
  'scope',
  'environment',
  'issuedAt',
  'notBefore',
  'expiresAt',
  'tokenId',
  'grantVersion',
]);
const TYPE_CLAIM_KEYS: Readonly<Record<SignedTokenType, readonly string[]>> =
  Object.freeze({
    [SIGNED_TOKEN_TYPES.SIGNED_INVITATION]: Object.freeze([
      'invitationId',
      'formType',
      'userIdHash',
      'recoveryEmailLookupHash',
      'domainIdentityHash',
      'allowedAssociation',
      'linkVersion',
    ]),
    [SIGNED_TOKEN_TYPES.RECOVERY_SESSION]: Object.freeze([
      'draftId',
      'sessionIdHash',
      'authorizationMethod',
      'authorizedScopes',
      'recoveryCodeVersion',
      'recoverySessionVersion',
    ]),
    [SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT]: Object.freeze([
      'deviceBindingHash',
      'passwordVersion',
      'recoveryPolicyVersion',
    ]),
    [SIGNED_TOKEN_TYPES.EMAIL_OTP]: Object.freeze([
      'recoveryEmailLookupHash',
      'attemptId',
      'otpVersion',
      'attemptCount',
    ]),
    [SIGNED_TOKEN_TYPES.MAGIC_LINK]: Object.freeze([
      'recoveryEmailLookupHash',
      'attemptId',
      'magicLinkVersion',
      'redirectPathHash',
    ]),
  });

const ERROR_MESSAGES: Readonly<Record<AuthorizationErrorCode, string>> =
  Object.freeze({
    [AUTHORIZATION_ERROR_CODES.TOKEN_REQUIRED]: 'A signed authorization token is required.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_STRUCTURE_INVALID]: 'The signed token structure is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_ENCODING_INVALID]: 'The signed token encoding is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_SIGNATURE_INVALID]: 'The signed token could not be verified.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_JSON_INVALID]: 'The signed token payload is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_JSON_NONCANONICAL]: 'The signed token payload is not canonical.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID]: 'The signed token claims are invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_VERSION_UNSUPPORTED]: 'The signed token version is unsupported.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_TYPE_INVALID]: 'The signed token type is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID]: 'The signed token scope is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_ENVIRONMENT_INVALID]: 'The signed token environment is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_ISSUED_IN_FUTURE]: 'The signed token issue time is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_NOT_ACTIVE]: 'The signed token is not active.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_EXPIRED]: 'The signed token has expired.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID]: 'The signed token lifetime is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_GRANT_VERSION_INVALID]: 'The signed token grant version is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_DRAFT_BINDING_INVALID]: 'The signed token draft binding is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_METHOD_INVALID]: 'The signed token method is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_REQUIRED_SCOPE_MISSING]: 'The signed token lacks a required scope.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_EMAIL_BINDING_INVALID]: 'The signed token email binding is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_DOMAIN_BINDING_INVALID]: 'The signed token domain binding is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_USER_BINDING_INVALID]: 'The signed token user binding is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_DEVICE_BINDING_INVALID]: 'The signed token device binding is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_PASSWORD_VERSION_INVALID]: 'The signed token password version is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_POLICY_VERSION_INVALID]: 'The signed token policy version is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_SESSION_VERSION_INVALID]: 'The signed token session version is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_SECRET_PURPOSE_INVALID]: 'The signing secret purpose is invalid.',
    [AUTHORIZATION_ERROR_CODES.TOKEN_CLOCK_INVALID]: 'The authorization clock is invalid.',
    [AUTHORIZATION_ERROR_CODES.FUTURE_FEATURE_DISABLED]: 'The future authorization feature is disabled.',
  });

export class ProDraftAuthorizationError extends Error {
  readonly code: AuthorizationErrorCode;

  constructor(code: AuthorizationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ProDraftAuthorizationError';
    this.code = code;
  }

  toSafeResponse(): Readonly<{
    ok: false;
    error: Readonly<{ code: 'AUTHORIZATION_DENIED'; message: string }>;
  }> {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'AUTHORIZATION_DENIED',
        message: 'Authorization could not be verified.',
      }),
    });
  }
}

function authorizationError(code: AuthorizationErrorCode): never {
  throw new ProDraftAuthorizationError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortedJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!isPlainObject(value)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortedJsonValue(value[key])]),
  );
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortedJsonValue(value));
}

function exactClaimKeys(
  claims: Record<string, unknown>,
  type: SignedTokenType,
): boolean {
  const typeKeys = [...TYPE_CLAIM_KEYS[type]];
  if (type === SIGNED_TOKEN_TYPES.RECOVERY_SESSION
    && Object.hasOwn(claims, 'recoveryEmailLookupHash')) {
    typeKeys.push('recoveryEmailLookupHash');
  }
  if (type === SIGNED_TOKEN_TYPES.RECOVERY_SESSION
    && Object.hasOwn(claims, 'recoveryEmailVerificationStatus')) {
    typeKeys.push('recoveryEmailVerificationStatus');
  }
  const expected = [...COMMON_CLAIM_KEYS, ...typeKeys].sort();
  const actual = Object.keys(claims).sort();
  return expected.length === actual.length
    && expected.every((key, index) => key === actual[index]);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && LOWER_HEX_256_PATTERN.test(value);
}

function requireAuthorizationSecret(
  type: SignedTokenType,
  secret: AuthorizationSecret,
): SecretMaterial {
  if (
    !secret
    || typeof secret !== 'object'
    || secret.name !== TOKEN_SECRET_NAMES[type]
    || !('value' in secret)
  ) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_SECRET_PURPOSE_INVALID,
    );
  }
  return secret.value;
}

function nowSeconds(clock: (() => number) | undefined): number {
  const value = clock ? clock() : Date.now() / 1000;
  if (!Number.isFinite(value)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLOCK_INVALID);
  }
  return Math.floor(value);
}

function clockSkew(value: number | undefined): number {
  const skew = value ?? DEFAULT_CLOCK_SKEW_SECONDS;
  if (!Number.isSafeInteger(skew) || skew < 0 || skew > DEFAULT_CLOCK_SKEW_SECONDS) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLOCK_INVALID);
  }
  return skew;
}

function validateCommonClaims(
  value: Record<string, unknown>,
  expectedType?: SignedTokenType,
): CommonStructuredClaims {
  if (value.version !== PRO_DRAFT_AUTHORIZATION_VERSION) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_VERSION_UNSUPPORTED,
    );
  }
  if (!TOKEN_TYPES.has(value.type as SignedTokenType)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_TYPE_INVALID);
  }
  const type = value.type as SignedTokenType;
  if (expectedType && type !== expectedType) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_TYPE_INVALID);
  }
  if (
    !TOKEN_SCOPES.has(value.scope as SignedTokenScope)
    || value.scope !== TYPE_SCOPES[type]
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID);
  }
  if (!ENVIRONMENTS.has(value.environment as DraftTokenEnvironment)) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_ENVIRONMENT_INVALID,
    );
  }
  if (
    !isNonnegativeInteger(value.issuedAt)
    || !isNonnegativeInteger(value.notBefore)
    || (value.expiresAt !== null && !isNonnegativeInteger(value.expiresAt))
    || !TOKEN_ID_PATTERN.test(String(value.tokenId ?? ''))
    || !isPositiveInteger(value.grantVersion)
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  if ((value.notBefore as number) < (value.issuedAt as number)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID);
  }
  const maximumTtl = TYPE_MAXIMUM_TTLS[type];
  if (type === SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT) {
    if (value.expiresAt !== null) {
      return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID);
    }
  } else if (
    typeof value.expiresAt !== 'number'
    || value.expiresAt <= (value.notBefore as number)
    || value.expiresAt <= (value.issuedAt as number)
    || maximumTtl === null
    || value.expiresAt - (value.issuedAt as number) > maximumTtl
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID);
  }
  return value as unknown as CommonStructuredClaims;
}

function validateTemporalClaims(
  claims: CommonStructuredClaims,
  clock?: () => number,
  clockSkewSeconds?: number,
): void {
  const now = nowSeconds(clock);
  const skew = clockSkew(clockSkewSeconds);
  if (claims.issuedAt > now + skew) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_ISSUED_IN_FUTURE);
  }
  if (claims.notBefore > now + skew) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_NOT_ACTIVE);
  }
  if (claims.expiresAt !== null && claims.expiresAt < now - skew) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_EXPIRED);
  }
}

function validateInvitationShape(value: Record<string, unknown>): SignedInvitationClaims {
  const common = validateCommonClaims(value, SIGNED_TOKEN_TYPES.SIGNED_INVITATION);
  if (
    !exactClaimKeys(value, SIGNED_TOKEN_TYPES.SIGNED_INVITATION)
    || !isOpaqueId(value.invitationId)
    || typeof value.formType !== 'string'
    || !FORM_TYPE_PATTERN.test(value.formType)
    || !isHash(value.userIdHash)
    || !isHash(value.recoveryEmailLookupHash)
    || !isHash(value.domainIdentityHash)
    || !INVITATION_ASSOCIATIONS.has(
      value.allowedAssociation as AllowedInvitationAssociation,
    )
    || !isPositiveInteger(value.linkVersion)
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  return { ...common, ...value } as SignedInvitationClaims;
}

function validateRecoverySessionShape(
  value: Record<string, unknown>,
): RecoverySessionClaims {
  const common = validateCommonClaims(value, SIGNED_TOKEN_TYPES.RECOVERY_SESSION);
  const authorizedScopes = value.authorizedScopes;
  if (
    !exactClaimKeys(value, SIGNED_TOKEN_TYPES.RECOVERY_SESSION)
    || !isOpaqueId(value.draftId)
    || !isHash(value.sessionIdHash)
    || !AUTHORIZATION_METHODS.has(value.authorizationMethod as AuthorizationMethod)
    || !Array.isArray(authorizedScopes)
    || authorizedScopes.length === 0
    || new Set(authorizedScopes).size !== authorizedScopes.length
    || authorizedScopes.some((scope) => (
      typeof scope !== 'string'
      || !RECOVERY_AUTHORIZED_SCOPES.has(scope as SignedTokenScope)
    ))
    || (Object.hasOwn(value, 'recoveryEmailLookupHash')
      && !isHash(value.recoveryEmailLookupHash))
    || !isPositiveInteger(value.recoveryCodeVersion)
    || !isPositiveInteger(value.recoverySessionVersion)
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  if (authorizedScopes.includes(SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ)
    && authorizedScopes.some((scope) => ![
      SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ,
      SIGNED_TOKEN_SCOPES.DRAFT_READ,
      SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED,
    ].includes(scope as 'draft:submitted-read' | 'draft:read'
      | 'draft:list-associated'))) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID);
  }
  if (['email', 'email_otp', 'magic_link'].includes(String(value.authorizationMethod))
    && !Object.hasOwn(value, 'recoveryEmailLookupHash')) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID);
  }
  const verificationStatus = value.recoveryEmailVerificationStatus;
  if ((value.authorizationMethod === 'email_otp'
    && verificationStatus !== 'verified_otp')
    || (value.authorizationMethod === 'magic_link'
      && verificationStatus !== 'verified_magic_link')
    || (!['email_otp', 'magic_link'].includes(String(value.authorizationMethod))
      && Object.hasOwn(value, 'recoveryEmailVerificationStatus'))) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID);
  }
  if (authorizedScopes.includes(SIGNED_TOKEN_SCOPES.DRAFT_LIST_ASSOCIATED)
    && value.authorizationMethod !== 'email') {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID);
  }
  return { ...common, ...value } as unknown as RecoverySessionClaims;
}

function validateAdminGrantShape(
  value: Record<string, unknown>,
): AdminRecoveryGrantClaims {
  const common = validateCommonClaims(
    value,
    SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT,
  );
  if (
    !exactClaimKeys(value, SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT)
    || (value.deviceBindingHash !== null && !isHash(value.deviceBindingHash))
    || !isPositiveInteger(value.passwordVersion)
    || !isPositiveInteger(value.recoveryPolicyVersion)
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  return { ...common, ...value } as AdminRecoveryGrantClaims;
}

function validateOtpShape(value: Record<string, unknown>): FutureOtpClaims {
  const common = validateCommonClaims(value, SIGNED_TOKEN_TYPES.EMAIL_OTP);
  if (
    !exactClaimKeys(value, SIGNED_TOKEN_TYPES.EMAIL_OTP)
    || !isHash(value.recoveryEmailLookupHash)
    || !isOpaqueId(value.attemptId)
    || !isPositiveInteger(value.otpVersion)
    || !isNonnegativeInteger(value.attemptCount)
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  return { ...common, ...value } as FutureOtpClaims;
}

function validateMagicLinkShape(
  value: Record<string, unknown>,
): FutureMagicLinkClaims {
  const common = validateCommonClaims(value, SIGNED_TOKEN_TYPES.MAGIC_LINK);
  if (
    !exactClaimKeys(value, SIGNED_TOKEN_TYPES.MAGIC_LINK)
    || !isHash(value.recoveryEmailLookupHash)
    || !isOpaqueId(value.attemptId)
    || !isPositiveInteger(value.magicLinkVersion)
    || !isHash(value.redirectPathHash)
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  return { ...common, ...value } as FutureMagicLinkClaims;
}

function validateClaimShape(
  value: unknown,
  expectedType?: SignedTokenType,
): StructuredTokenClaims {
  if (!isPlainObject(value)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  const common = validateCommonClaims(value, expectedType);
  switch (common.type) {
    case SIGNED_TOKEN_TYPES.SIGNED_INVITATION:
      return validateInvitationShape(value);
    case SIGNED_TOKEN_TYPES.RECOVERY_SESSION:
      return validateRecoverySessionShape(value);
    case SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT:
      return validateAdminGrantShape(value);
    case SIGNED_TOKEN_TYPES.EMAIL_OTP:
      return validateOtpShape(value);
    case SIGNED_TOKEN_TYPES.MAGIC_LINK:
      return validateMagicLinkShape(value);
    default:
      return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_TYPE_INVALID);
  }
}

function parseCanonicalPayload(encodedPayload: string): unknown {
  let payloadText: string;
  try {
    payloadText = utf8Decode(fromBase64Url(encodedPayload));
  } catch {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_ENCODING_INVALID);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_JSON_INVALID);
  }
  if (stableSerialize(parsed) !== payloadText) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_JSON_NONCANONICAL);
  }
  return parsed;
}

function tokenId(generator?: () => string): string {
  const value = generator ? generator() : generateOpaqueToken({ prefix: 'pdti_' });
  if (typeof value !== 'string' || !TOKEN_ID_PATTERN.test(value)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  return value;
}

function exactStringMatch(left: string, right: string): boolean {
  return timingSafeEqualStrings(left, right);
}

export async function signStructuredToken(
  claimsInput: StructuredTokenClaims,
  options: SignStructuredTokenOptions,
): Promise<string> {
  const claims = validateClaimShape(claimsInput);
  const payload = stableSerialize(claims);
  const encodedPayload = toBase64Url(utf8Encode(payload));
  const signature = await hmacSha256Bytes(
    requireAuthorizationSecret(claims.type, options.secret),
    `${TOKEN_DOMAINS[claims.type]}${encodedPayload}`,
    options.cryptoProvider,
  );
  return `${encodedPayload}.${toBase64Url(signature)}`;
}

export async function verifyStructuredToken(
  token: unknown,
  options: VerifyStructuredTokenOptions,
): Promise<StructuredTokenClaims> {
  if (!TOKEN_TYPES.has(options.expectedType)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_TYPE_INVALID);
  }
  if (!TOKEN_SCOPES.has(options.expectedScope)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID);
  }
  if (!ENVIRONMENTS.has(options.expectedEnvironment)) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_ENVIRONMENT_INVALID,
    );
  }
  if (typeof token !== 'string' || token.length === 0) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_REQUIRED);
  }
  const segments = token.split('.');
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_STRUCTURE_INVALID);
  }
  const [encodedPayload, encodedSignature] = segments;

  let suppliedSignature: Uint8Array;
  try {
    suppliedSignature = fromBase64Url(encodedSignature);
  } catch {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_ENCODING_INVALID);
  }
  const expectedSignature = await hmacSha256Bytes(
    requireAuthorizationSecret(options.expectedType, options.secret),
    `${TOKEN_DOMAINS[options.expectedType]}${encodedPayload}`,
    options.cryptoProvider,
  );
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqualBytes(suppliedSignature, expectedSignature)
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_SIGNATURE_INVALID);
  }

  const claims = validateClaimShape(
    parseCanonicalPayload(encodedPayload),
    options.expectedType,
  );
  if (claims.scope !== options.expectedScope) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID);
  }
  if (claims.environment !== options.expectedEnvironment) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_ENVIRONMENT_INVALID,
    );
  }
  if (
    options.expectedGrantVersion !== undefined
    && claims.grantVersion !== options.expectedGrantVersion
  ) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_GRANT_VERSION_INVALID,
    );
  }
  validateTemporalClaims(claims, options.clock, options.clockSkewSeconds);
  return Object.freeze({ ...claims }) as StructuredTokenClaims;
}

export function validateSignedInvitationClaims(
  claimsInput: unknown,
  options: SignedInvitationValidationOptions,
): SignedInvitationClaims {
  const claims = validateClaimShape(
    claimsInput,
    SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
  ) as SignedInvitationClaims;
  if (claims.environment !== options.expectedEnvironment) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_ENVIRONMENT_INVALID,
    );
  }
  if (!exactStringMatch(claims.formType, options.expectedFormType)) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  if (
    options.expectedRecoveryEmailLookupHash !== undefined
    && !exactStringMatch(
      claims.recoveryEmailLookupHash,
      options.expectedRecoveryEmailLookupHash,
    )
  ) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_EMAIL_BINDING_INVALID,
    );
  }
  if (
    options.expectedDomainIdentityHash !== undefined
    && !exactStringMatch(
      claims.domainIdentityHash,
      options.expectedDomainIdentityHash,
    )
  ) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_DOMAIN_BINDING_INVALID,
    );
  }
  if (
    options.expectedUserIdHash !== undefined
    && !exactStringMatch(claims.userIdHash, options.expectedUserIdHash)
  ) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_USER_BINDING_INVALID,
    );
  }
  if (
    options.expectedAllowedAssociation !== undefined
    && claims.allowedAssociation !== options.expectedAllowedAssociation
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID);
  }
  validateTemporalClaims(claims, options.clock, options.clockSkewSeconds);
  return Object.freeze({ ...claims });
}

export async function issueRecoverySessionToken(
  input: RecoverySessionIssueInput,
  options: RecoverySessionIssueOptions,
): Promise<string> {
  const issuedAt = nowSeconds(options.clock);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_RECOVERY_SESSION_TTL_SECONDS;
  if (
    !Number.isSafeInteger(ttlSeconds)
    || ttlSeconds <= 0
    || ttlSeconds > MAX_RECOVERY_SESSION_TTL_SECONDS
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID);
  }
  const claims: RecoverySessionClaims = Object.freeze({
    version: PRO_DRAFT_AUTHORIZATION_VERSION,
    type: SIGNED_TOKEN_TYPES.RECOVERY_SESSION,
    scope: SIGNED_TOKEN_SCOPES.DRAFT_RECOVER,
    environment: input.environment,
    issuedAt,
    notBefore: issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    tokenId: tokenId(options.tokenIdGenerator),
    grantVersion: input.grantVersion,
    draftId: input.draftId,
    sessionIdHash: input.sessionIdHash,
    authorizationMethod: input.authorizationMethod,
    authorizedScopes: Object.freeze([...input.authorizedScopes]),
    ...(input.recoveryEmailLookupHash
      ? { recoveryEmailLookupHash: input.recoveryEmailLookupHash }
      : {}),
    ...(input.recoveryEmailVerificationStatus
      ? { recoveryEmailVerificationStatus: input.recoveryEmailVerificationStatus }
      : {}),
    recoveryCodeVersion: input.recoveryCodeVersion,
    recoverySessionVersion: input.recoverySessionVersion,
  });
  return signStructuredToken(claims, options);
}

export async function verifyRecoverySessionToken(
  token: unknown,
  options: RecoverySessionVerifyOptions,
): Promise<RecoverySessionClaims> {
  const claims = await verifyStructuredToken(token, {
    expectedType: SIGNED_TOKEN_TYPES.RECOVERY_SESSION,
    expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_RECOVER,
    expectedEnvironment: options.expectedEnvironment,
    expectedGrantVersion: options.expectedGrantVersion,
    secret: options.secret,
    clock: options.clock,
    clockSkewSeconds: options.clockSkewSeconds,
    cryptoProvider: options.cryptoProvider,
  }) as RecoverySessionClaims;
  if (!exactStringMatch(claims.draftId, options.expectedDraftId)) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_DRAFT_BINDING_INVALID,
    );
  }
  if (claims.authorizationMethod !== options.expectedAuthorizationMethod) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_METHOD_INVALID);
  }
  if (claims.recoverySessionVersion !== options.expectedRecoverySessionVersion) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_SESSION_VERSION_INVALID,
    );
  }
  for (const requiredScope of options.requiredScopes ?? []) {
    if (!claims.authorizedScopes.includes(requiredScope)) {
      return authorizationError(
        AUTHORIZATION_ERROR_CODES.TOKEN_REQUIRED_SCOPE_MISSING,
      );
    }
  }
  return Object.freeze({
    ...claims,
    authorizedScopes: Object.freeze([...claims.authorizedScopes]),
  });
}

export async function issueAdminRecoveryGrant(
  input: AdminRecoveryGrantIssueInput,
  options: AdminRecoveryGrantIssueOptions,
): Promise<string> {
  const issuedAt = nowSeconds(options.clock);
  const claims: AdminRecoveryGrantClaims = Object.freeze({
    version: PRO_DRAFT_AUTHORIZATION_VERSION,
    type: SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT,
    scope: SIGNED_TOKEN_SCOPES.ADMIN_DRAFT_RECOVERY,
    environment: input.environment,
    issuedAt,
    notBefore: issuedAt,
    expiresAt: null,
    tokenId: tokenId(options.tokenIdGenerator),
    grantVersion: input.grantVersion,
    deviceBindingHash: input.deviceBindingHash ?? null,
    passwordVersion: input.passwordVersion,
    recoveryPolicyVersion: input.recoveryPolicyVersion,
  });
  return signStructuredToken(claims, options);
}

export async function verifyAdminRecoveryGrant(
  token: unknown,
  options: AdminRecoveryGrantVerifyOptions,
): Promise<AdminRecoveryGrantClaims> {
  const claims = await verifyStructuredToken(token, {
    expectedType: SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT,
    expectedScope: SIGNED_TOKEN_SCOPES.ADMIN_DRAFT_RECOVERY,
    expectedEnvironment: options.expectedEnvironment,
    expectedGrantVersion: options.expectedGrantVersion,
    secret: options.secret,
    clock: options.clock,
    clockSkewSeconds: options.clockSkewSeconds,
    cryptoProvider: options.cryptoProvider,
  }) as AdminRecoveryGrantClaims;
  if (claims.passwordVersion !== options.expectedPasswordVersion) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_PASSWORD_VERSION_INVALID,
    );
  }
  if (claims.recoveryPolicyVersion !== options.expectedRecoveryPolicyVersion) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_POLICY_VERSION_INVALID,
    );
  }
  const expectedBinding = options.expectedDeviceBindingHash ?? null;
  const bindingMatches = claims.deviceBindingHash === null
    ? expectedBinding === null
    : expectedBinding !== null
      && exactStringMatch(claims.deviceBindingHash, expectedBinding);
  if (!bindingMatches) {
    return authorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_DEVICE_BINDING_INVALID,
    );
  }
  return Object.freeze({ ...claims });
}

export function validateFutureOtpClaims(input: unknown): FutureOtpClaims {
  const claims = validateClaimShape(
    input,
    SIGNED_TOKEN_TYPES.EMAIL_OTP,
  ) as FutureOtpClaims;
  if (claims.expiresAt - claims.issuedAt > MAX_FUTURE_OTP_TTL_SECONDS) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID);
  }
  return Object.freeze({ ...claims });
}

export function validateFutureMagicLinkClaims(
  input: unknown,
): FutureMagicLinkClaims {
  const claims = validateClaimShape(
    input,
    SIGNED_TOKEN_TYPES.MAGIC_LINK,
  ) as FutureMagicLinkClaims;
  if (
    claims.expiresAt - claims.issuedAt
      > DEFAULT_FUTURE_MAGIC_LINK_TTL_SECONDS
  ) {
    return authorizationError(AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID);
  }
  return Object.freeze({ ...claims });
}

export function getSafeAuthorizationDiagnostics(
  error?: unknown,
): SafeAuthorizationDiagnostics {
  return Object.freeze({
    version: PRO_DRAFT_AUTHORIZATION_VERSION,
    tokenFormat: 'base64url-json.base64url-hmac',
    signatureAlgorithm: 'HMAC-SHA-256',
    defaultClockSkewSeconds: DEFAULT_CLOCK_SKEW_SECONDS,
    recoverySessionDefaultTtlSeconds: DEFAULT_RECOVERY_SESSION_TTL_SECONDS,
    recoverySessionMaximumTtlSeconds: MAX_RECOVERY_SESSION_TTL_SECONDS,
    adminGrantHasFixedExpiry: false,
    futureOtpEnabled: false,
    futureMagicLinkEnabled: false,
    errorCode: error instanceof ProDraftAuthorizationError ? error.code : null,
  });
}
