/** Authorization resolution for future draft backend functions. */

import {
  PRO_DRAFT_ACCESS_SCOPES,
  PRO_DRAFT_API_OPERATION_NAMES,
  PRO_DRAFT_AUTHORIZATION_METHODS,
  type DraftAccessScope,
  type DraftApiOperation,
  type DraftAuthorizationInput,
  validateDraftAuthorizationInput,
} from '../proDraftApi/entry.ts';
import {
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  type AuthorizationSecret,
  type RecoverySessionClaims,
  type SignedInvitationClaims,
  validateSignedInvitationClaims,
  verifyRecoverySessionToken,
  verifyStructuredToken,
} from '../proDraftAuthorization/entry.ts';
import {
  type DraftRecord,
  type DraftRepository,
  findDraftsByIdentityKeyHash,
  findDraftsByResumeTokenHash,
  getDraftById,
} from '../proDraftRepository/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  type PurposeBoundSecret,
  type SubtleCryptoProvider,
  hashResumeToken,
  sha256Hex,
} from '../proDraftSecurity/entry.ts';

export const PRO_DRAFT_AUTHORIZATION_RESOLVER_VERSION = 1;

export const PRO_DRAFT_RESOLVER_ERROR_CODES = Object.freeze({
  AUTHORIZATION_DENIED: 'PRO_DRAFT_RESOLVER_AUTHORIZATION_DENIED',
  DRAFT_NOT_FOUND: 'PRO_DRAFT_RESOLVER_DRAFT_NOT_FOUND',
  DRAFT_BINDING_INVALID: 'PRO_DRAFT_RESOLVER_DRAFT_BINDING_INVALID',
  SCOPE_MISSING: 'PRO_DRAFT_RESOLVER_SCOPE_MISSING',
  MULTIPLE_DRAFTS: 'PRO_DRAFT_RESOLVER_MULTIPLE_DRAFTS',
  NEW_DRAFT_OPERATION_INVALID: 'PRO_DRAFT_RESOLVER_NEW_DRAFT_OPERATION_INVALID',
  CONFIGURATION_INVALID: 'PRO_DRAFT_RESOLVER_CONFIGURATION_INVALID',
} as const);

export interface ResolveDraftAuthorizationInput {
  readonly operation: DraftApiOperation;
  readonly authorization: DraftAuthorizationInput | unknown;
  readonly requestedDraftId?: string;
  readonly associationIntent?: string;
}

export interface ResolveDraftAuthorizationOptions {
  readonly repository: DraftRepository;
  readonly environment: 'local' | 'test' | 'staging' | 'production';
  readonly formType: string;
  readonly grantVersion: number;
  readonly resumeTokenSecret: PurposeBoundSecret;
  readonly signedInvitationSecret: AuthorizationSecret;
  readonly recoverySessionSecret: AuthorizationSecret;
  readonly clock?: () => number;
  readonly cryptoProvider?: SubtleCryptoProvider;
  readonly deriveIdentityKeyHash?: (
    claims: SignedInvitationClaims,
  ) => Promise<string>;
  readonly deriveSessionIdHash?: (sessionId: string) => Promise<string>;
}

export interface ResolvedDraftAuthorization {
  readonly method: DraftAuthorizationInput['method'];
  readonly scopes: readonly DraftAccessScope[];
  readonly record: DraftRecord | null;
  readonly draftId: string | null;
  readonly createsNewDraft: boolean;
  readonly internalReasonCode: string;
}

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export class ProDraftAuthorizationResolverError extends Error {
  readonly code: string;
  readonly status: 401 | 403;

  constructor(code: string, status: 401 | 403 = 401) {
    super('Authorization could not be verified.');
    this.name = 'ProDraftAuthorizationResolverError';
    this.code = code;
    this.status = status;
  }

  toSafeResponse(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      success: false,
      errorCode: 'AUTHORIZATION_DENIED',
      message: 'Authorization could not be verified.',
    });
  }
}

function denied(code: string, status: 401 | 403 = 401): never {
  throw new ProDraftAuthorizationResolverError(code, status);
}

function validatedAuthorization(value: unknown): DraftAuthorizationInput {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'method' in value) {
    const candidate = value as Record<string, unknown>;
    const tokenOnly = candidate.method === PRO_DRAFT_AUTHORIZATION_METHODS.RESUME_TOKEN
      ? { resumeToken: candidate.resumeToken }
      : candidate.method === PRO_DRAFT_AUTHORIZATION_METHODS.SIGNED_INVITATION
        ? { signedDraftAccessToken: candidate.signedDraftAccessToken }
        : candidate.method === PRO_DRAFT_AUTHORIZATION_METHODS.RECOVERY_SESSION
          ? { recoverySessionToken: candidate.recoverySessionToken }
          : {};
    const validated = validateDraftAuthorizationInput(tokenOnly);
    if (validated.method !== candidate.method) {
      return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.AUTHORIZATION_DENIED);
    }
    return validated;
  }
  return validateDraftAuthorizationInput(value);
}

function validateOptions(options: ResolveDraftAuthorizationOptions): void {
  if (!options
    || !ID_PATTERN.test(options.formType)
    || !Number.isSafeInteger(options.grantVersion)
    || options.grantVersion < 1
    || options.resumeTokenSecret?.name !== SECURITY_SECRET_NAMES.RESUME_TOKEN
    || options.signedInvitationSecret?.name
      !== AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION
    || options.recoverySessionSecret?.name
      !== AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.CONFIGURATION_INVALID, 403);
  }
}

function recordId(record: DraftRecord): string {
  const id = record.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_NOT_FOUND);
  }
  return id;
}

function selectBoundDraft(
  drafts: readonly DraftRecord[],
  requestedDraftId: string | undefined,
): DraftRecord | null {
  const bounded = requestedDraftId === undefined
    ? drafts
    : drafts.filter((draft) => recordId(draft) === requestedDraftId);
  if (bounded.length === 0) return null;
  if (requestedDraftId !== undefined) {
    if (bounded.length !== 1) {
      return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.MULTIPLE_DRAFTS);
    }
    return bounded[0];
  }
  const sorted = [...bounded].sort((left, right) => {
    const revisionDifference = Number(right.server_revision ?? -1)
      - Number(left.server_revision ?? -1);
    if (revisionDifference !== 0) return revisionDifference;
    const dateDifference = Date.parse(String(right.updated_date ?? ''))
      - Date.parse(String(left.updated_date ?? ''));
    if (Number.isFinite(dateDifference) && dateDifference !== 0) return dateDifference;
    return recordId(right).localeCompare(recordId(left));
  });
  return sorted[0] ?? null;
}

function assertRequestedBinding(
  record: DraftRecord,
  requestedDraftId: string | undefined,
): string {
  const id = recordId(record);
  if (requestedDraftId !== undefined && id !== requestedDraftId) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID);
  }
  return id;
}

function scopesForRecord(record: DraftRecord): readonly DraftAccessScope[] {
  const scopes: DraftAccessScope[] = [
    PRO_DRAFT_ACCESS_SCOPES.READ,
    PRO_DRAFT_ACCESS_SCOPES.WRITE,
    PRO_DRAFT_ACCESS_SCOPES.EVENTS,
  ];
  if (record.status === 'submitted') {
    return Object.freeze([PRO_DRAFT_ACCESS_SCOPES.SUBMITTED_READ]);
  }
  return Object.freeze(scopes);
}

async function defaultIdentityKeyHash(
  claims: SignedInvitationClaims,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  return sha256Hex([
    'pro-draft:verified-invitation-identity:v1',
    claims.formType,
    claims.invitationId,
    claims.userIdHash,
    claims.recoveryEmailLookupHash,
    claims.domainIdentityHash,
  ].join(':'), cryptoProvider);
}

async function resolveResumeToken(
  authorization: DraftAuthorizationInput,
  input: ResolveDraftAuthorizationInput,
  options: ResolveDraftAuthorizationOptions,
): Promise<ResolvedDraftAuthorization> {
  const hash = await hashResumeToken(
    authorization.resumeToken,
    options.resumeTokenSecret,
    options.cryptoProvider,
  );
  const drafts = await findDraftsByResumeTokenHash(options.repository, hash, 2);
  if (drafts.length !== 1) {
    return denied(drafts.length === 0
      ? PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_NOT_FOUND
      : PRO_DRAFT_RESOLVER_ERROR_CODES.MULTIPLE_DRAFTS);
  }
  const record = drafts[0];
  const draftId = assertRequestedBinding(record, input.requestedDraftId);
  return Object.freeze({
    method: authorization.method,
    scopes: scopesForRecord(record),
    record,
    draftId,
    createsNewDraft: false,
    internalReasonCode: 'RESUME_TOKEN_MATCHED',
  });
}

async function resolveSignedInvitation(
  authorization: DraftAuthorizationInput,
  input: ResolveDraftAuthorizationInput,
  options: ResolveDraftAuthorizationOptions,
): Promise<ResolvedDraftAuthorization> {
  const verified = await verifyStructuredToken(
    authorization.signedDraftAccessToken,
    {
      expectedType: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
      expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
      expectedEnvironment: options.environment,
      expectedGrantVersion: options.grantVersion,
      secret: options.signedInvitationSecret,
      clock: options.clock,
      cryptoProvider: options.cryptoProvider,
    },
  ) as SignedInvitationClaims;
  const claims = validateSignedInvitationClaims(verified, {
    expectedEnvironment: options.environment,
    expectedFormType: options.formType,
    clock: options.clock,
  });
  const identityKeyHash = options.deriveIdentityKeyHash
    ? await options.deriveIdentityKeyHash(claims)
    : await defaultIdentityKeyHash(claims, options.cryptoProvider);
  if (!HASH_PATTERN.test(identityKeyHash)) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.CONFIGURATION_INVALID, 403);
  }
  if (input.associationIntent === 'changed_signed_email') {
    if (input.operation !== PRO_DRAFT_API_OPERATION_NAMES.BOOTSTRAP_DRAFT
      || input.requestedDraftId !== undefined) {
      return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID);
    }
    return Object.freeze({
      method: authorization.method,
      scopes: Object.freeze([PRO_DRAFT_ACCESS_SCOPES.CREATE]),
      record: null,
      draftId: null,
      createsNewDraft: true,
      internalReasonCode: 'SIGNED_EMAIL_CHANGED_NEW_ASSOCIATION',
    });
  }
  const drafts = await findDraftsByIdentityKeyHash(
    options.repository,
    identityKeyHash,
    25,
  );
  const record = selectBoundDraft(drafts, input.requestedDraftId);
  if (!record) {
    if (input.operation === PRO_DRAFT_API_OPERATION_NAMES.BOOTSTRAP_DRAFT) {
      return Object.freeze({
        method: authorization.method,
        scopes: Object.freeze([PRO_DRAFT_ACCESS_SCOPES.CREATE]),
        record: null,
        draftId: null,
        createsNewDraft: true,
        internalReasonCode: 'SIGNED_INVITATION_NEW_ASSOCIATION',
      });
    }
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_NOT_FOUND);
  }
  return Object.freeze({
    method: authorization.method,
    scopes: scopesForRecord(record),
    record,
    draftId: assertRequestedBinding(record, input.requestedDraftId),
    createsNewDraft: false,
    internalReasonCode: 'SIGNED_INVITATION_IDENTITY_MATCHED',
  });
}

async function resolveRecoverySession(
  authorization: DraftAuthorizationInput,
  input: ResolveDraftAuthorizationInput,
  options: ResolveDraftAuthorizationOptions,
): Promise<ResolvedDraftAuthorization> {
  const initialClaims = await verifyStructuredToken(
    authorization.recoverySessionToken,
    {
      expectedType: SIGNED_TOKEN_TYPES.RECOVERY_SESSION,
      expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_RECOVER,
      expectedEnvironment: options.environment,
      expectedGrantVersion: options.grantVersion,
      secret: options.recoverySessionSecret,
      clock: options.clock,
      cryptoProvider: options.cryptoProvider,
    },
  ) as RecoverySessionClaims;
  if (input.requestedDraftId !== undefined
    && initialClaims.draftId !== input.requestedDraftId) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID);
  }
  const record = await getDraftById(options.repository, initialClaims.draftId);
  const sessionVersion = Number(record.recovery_session_version);
  if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 1) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.AUTHORIZATION_DENIED);
  }
  if (typeof record.session_id !== 'string') {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID);
  }
  const sessionIdHash = options.deriveSessionIdHash
    ? await options.deriveSessionIdHash(record.session_id)
    : await sha256Hex(
      `pro-draft:session-id:v1:${record.session_id}`,
      options.cryptoProvider,
    );
  if (!HASH_PATTERN.test(sessionIdHash)
    || sessionIdHash !== initialClaims.sessionIdHash) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID);
  }
  const claims = await verifyRecoverySessionToken(
    authorization.recoverySessionToken,
    {
      secret: options.recoverySessionSecret,
      expectedEnvironment: options.environment,
      expectedDraftId: recordId(record),
      expectedAuthorizationMethod: initialClaims.authorizationMethod,
      expectedRecoverySessionVersion: sessionVersion,
      expectedGrantVersion: options.grantVersion,
      clock: options.clock,
      cryptoProvider: options.cryptoProvider,
    },
  );
  const scopes = claims.authorizedScopes as readonly DraftAccessScope[];
  return Object.freeze({
    method: authorization.method,
    scopes,
    record,
    draftId: assertRequestedBinding(record, input.requestedDraftId),
    createsNewDraft: false,
    internalReasonCode: 'RECOVERY_SESSION_VERIFIED',
  });
}

export async function resolveDraftAuthorization(
  input: ResolveDraftAuthorizationInput,
  options: ResolveDraftAuthorizationOptions,
): Promise<ResolvedDraftAuthorization> {
  validateOptions(options);
  if (!Object.values(PRO_DRAFT_API_OPERATION_NAMES).includes(input.operation)) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.AUTHORIZATION_DENIED);
  }
  if (input.requestedDraftId !== undefined
    && !ID_PATTERN.test(input.requestedDraftId)) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID);
  }
  if (input.associationIntent !== undefined
    && input.associationIntent !== 'changed_signed_email') {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID);
  }
  try {
    const authorization = validatedAuthorization(input.authorization);
    if (input.associationIntent === 'changed_signed_email'
      && authorization.method
        !== PRO_DRAFT_AUTHORIZATION_METHODS.SIGNED_INVITATION) {
      return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID);
    }
    if (authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.NEW_ANONYMOUS_DRAFT) {
      if (input.operation !== PRO_DRAFT_API_OPERATION_NAMES.BOOTSTRAP_DRAFT
        || input.requestedDraftId !== undefined) {
        return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.NEW_DRAFT_OPERATION_INVALID);
      }
      return Object.freeze({
        method: authorization.method,
        scopes: Object.freeze([PRO_DRAFT_ACCESS_SCOPES.CREATE]),
        record: null,
        draftId: null,
        createsNewDraft: true,
        internalReasonCode: 'NEW_ANONYMOUS_DRAFT_ALLOWED',
      });
    }
    if (authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.RESUME_TOKEN) {
      return await resolveResumeToken(authorization, input, options);
    }
    if (authorization.method === PRO_DRAFT_AUTHORIZATION_METHODS.SIGNED_INVITATION) {
      return await resolveSignedInvitation(authorization, input, options);
    }
    return await resolveRecoverySession(authorization, input, options);
  } catch (error) {
    if (error instanceof ProDraftAuthorizationResolverError) throw error;
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.AUTHORIZATION_DENIED);
  }
}

function requireScope(
  resolved: ResolvedDraftAuthorization,
  requested: DraftAccessScope,
  alternatives: readonly DraftAccessScope[] = [],
): ResolvedDraftAuthorization {
  if (!resolved.scopes.some((scope) => scope === requested
    || alternatives.includes(scope))) {
    return denied(PRO_DRAFT_RESOLVER_ERROR_CODES.SCOPE_MISSING, 403);
  }
  return resolved;
}

export async function authorizeDraftRead(
  input: ResolveDraftAuthorizationInput,
  options: ResolveDraftAuthorizationOptions,
  submitted = false,
): Promise<ResolvedDraftAuthorization> {
  const resolved = await resolveDraftAuthorization(input, options);
  const recordIsSubmitted = resolved.record?.status === 'submitted';
  return requireScope(
    resolved,
    submitted || recordIsSubmitted
      ? PRO_DRAFT_ACCESS_SCOPES.SUBMITTED_READ
      : PRO_DRAFT_ACCESS_SCOPES.READ,
  );
}

export async function authorizeDraftWrite(
  input: ResolveDraftAuthorizationInput,
  options: ResolveDraftAuthorizationOptions,
): Promise<ResolvedDraftAuthorization> {
  return requireScope(
    await resolveDraftAuthorization(input, options),
    PRO_DRAFT_ACCESS_SCOPES.WRITE,
  );
}

export async function authorizeDraftEvents(
  input: ResolveDraftAuthorizationInput,
  options: ResolveDraftAuthorizationOptions,
): Promise<ResolvedDraftAuthorization> {
  return requireScope(
    await resolveDraftAuthorization(input, options),
    PRO_DRAFT_ACCESS_SCOPES.EVENTS,
    [PRO_DRAFT_ACCESS_SCOPES.WRITE],
  );
}

export function getSafeResolvedAuthorizationDiagnostics(
  resolved?: ResolvedDraftAuthorization,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: PRO_DRAFT_AUTHORIZATION_RESOLVER_VERSION,
    resolved: resolved !== undefined,
    method: resolved?.method ?? null,
    scopes: Object.freeze([...(resolved?.scopes ?? [])]),
    draftBound: resolved?.draftId !== null && resolved?.draftId !== undefined,
    createsNewDraft: resolved?.createsNewDraft === true,
    internalReasonCode: resolved?.internalReasonCode ?? null,
    containsCredential: false,
    containsHash: false,
  });
}
