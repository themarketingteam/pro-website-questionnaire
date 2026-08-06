import {
  AUTHORIZATION_SECRET_NAMES,
  PRO_DRAFT_AUTHORIZATION_VERSION,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  issueAdminRecoveryGrant,
  issueRecoverySessionToken,
  signStructuredToken,
  verifyAdminRecoveryGrant,
  verifyRecoverySessionToken,
  verifyStructuredToken,
} from './vendor/proDraftAuthorization.ts';
import {
  PRO_DRAFT_PERSISTENCE_VERSION,
  createServerRequestId,
  evaluateRevisionWrite,
  readBoundedJsonBody,
} from './vendor/proDraftPersistence.ts';
import {
  PRO_DRAFT_SECURITY_VERSION,
  SECURITY_SECRET_NAMES,
  generateOpaqueToken,
  generateSecureRecoveryCode,
  hashNormalizedRecoveryEmail,
  hashRecoveryCode,
  hashResumeToken,
  sha256Hex,
} from './vendor/proDraftSecurity.ts';

export const PRO_DRAFT_SECURITY_SELF_CHECK_REQUEST_LIMIT_BYTES = 16 * 1024;

export const PRO_DRAFT_SECURITY_SELF_CHECK_SECRET_NAMES = Object.freeze({
  draftToken: SECURITY_SECRET_NAMES.RESUME_TOKEN,
  linkSigning: AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION,
  recoveryCode: SECURITY_SECRET_NAMES.RECOVERY_CODE,
  emailLookup: SECURITY_SECRET_NAMES.RECOVERY_EMAIL,
  recoverySession: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
  adminGrant: AUTHORIZATION_SECRET_NAMES.ADMIN_RECOVERY_GRANT,
} as const);

const CHECK_NAMES = Object.freeze([
  'secretLengths',
  'secretSeparation',
  'recoveryCodeGeneration',
  'recoveryCodeHash',
  'emailLookupHash',
  'opaqueToken',
  'resumeTokenHash',
  'recoverySessionToken',
  'signedInvitationToken',
  'adminGrantToken',
  'tamperRejection',
  'environmentRejection',
  'crossPurposeRejection',
  'idempotentRevision',
  'staleRevisionRejection',
  'submittedRegressionRejection',
  'requestLimit',
] as const);

type CheckName = typeof CHECK_NAMES[number];
type SecretName = keyof typeof PRO_DRAFT_SECURITY_SELF_CHECK_SECRET_NAMES;
type SafeEnvironment = 'staging' | 'production' | 'unknown';
type SecretValues = Readonly<Record<SecretName, string>>;
type SecretConfiguration = Readonly<{
  configured: Readonly<Record<SecretName, boolean>>;
  values: SecretValues | null;
  lengthsValid: boolean;
  separationValid: boolean;
}>;

export type SecuritySelfCheckResponse = Readonly<{
  success: boolean;
  environment: SafeEnvironment;
  securityVersion: number;
  authorizationVersion: number;
  persistenceVersion: number;
  configuredSecrets: Readonly<Record<SecretName, boolean>>;
  checks: Readonly<Record<CheckName, boolean>>;
  requestId: string;
}>;

type Base44RequestClient = Readonly<{
  auth: Readonly<{
    me: () => Promise<unknown>;
  }>;
}>;

export type SecuritySelfCheckDependencies = Readonly<{
  createClientFromRequest: (request: Request) => Base44RequestClient;
  getEnvironmentValue: (name: string) => string | undefined;
  createRequestId?: () => string;
}>;

const FALSE_CHECKS = Object.freeze(Object.fromEntries(
  CHECK_NAMES.map((name) => [name, false]),
) as Record<CheckName, boolean>);

const FALSE_CONFIGURED_SECRETS = Object.freeze(Object.fromEntries(
  Object.keys(PRO_DRAFT_SECURITY_SELF_CHECK_SECRET_NAMES)
    .map((name) => [name, false]),
) as Record<SecretName, boolean>);

const encoder = new TextEncoder();
const HEX_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const RECOVERY_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}$/u;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const NOW_SECONDS = 2_000_000_000;
const FIXED_CLOCK = () => NOW_SECONDS;
const TOKEN_ID = `pdti_${'S'.repeat(43)}`;

function safeEnvironment(value: string | undefined): SafeEnvironment {
  if (value === 'staging' || value === 'production') return value;
  return 'unknown';
}

function safeResponse(
  requestId: string,
  environment: SafeEnvironment,
  options: Readonly<{
    configuredSecrets?: Readonly<Record<SecretName, boolean>>;
    checks?: Readonly<Record<CheckName, boolean>>;
    success?: boolean;
  }> = {},
): SecuritySelfCheckResponse {
  return Object.freeze({
    success: options.success === true,
    environment,
    securityVersion: PRO_DRAFT_SECURITY_VERSION,
    authorizationVersion: PRO_DRAFT_AUTHORIZATION_VERSION,
    persistenceVersion: PRO_DRAFT_PERSISTENCE_VERSION,
    configuredSecrets: Object.freeze({
      ...(options.configuredSecrets ?? FALSE_CONFIGURED_SECRETS),
    }),
    checks: Object.freeze({ ...(options.checks ?? FALSE_CHECKS) }),
    requestId,
  });
}

function jsonResponse(
  body: SecuritySelfCheckResponse,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      ...extraHeaders,
    },
  });
}

function resolveSecrets(
  getEnvironmentValue: SecuritySelfCheckDependencies['getEnvironmentValue'],
): SecretConfiguration {
  const entries = Object.entries(PRO_DRAFT_SECURITY_SELF_CHECK_SECRET_NAMES) as Array<
    [SecretName, typeof PRO_DRAFT_SECURITY_SELF_CHECK_SECRET_NAMES[SecretName]]
  >;
  const values = {} as Record<SecretName, string>;
  const configured = {} as Record<SecretName, boolean>;
  let lengthsValid = true;

  for (const [purpose, variableName] of entries) {
    const value = getEnvironmentValue(variableName);
    configured[purpose] = typeof value === 'string' && value.length > 0;
    values[purpose] = configured[purpose] ? value as string : '';
    lengthsValid = lengthsValid
      && configured[purpose]
      && encoder.encode(values[purpose]).byteLength >= 32;
  }

  const allConfigured = Object.values(configured).every(Boolean);
  const separationValid = allConfigured
    && new Set(Object.values(values)).size === entries.length;

  return Object.freeze({
    configured: Object.freeze({ ...configured }),
    values: allConfigured ? Object.freeze({ ...values }) : null,
    lengthsValid,
    separationValid,
  });
}

function revisionInput(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    storedClientRevision: 4,
    storedServerRevision: 7,
    storedStateHash: 'a'.repeat(64),
    storedStatus: 'active',
    incomingClientRevision: 4,
    expectedServerRevision: 7,
    incomingStateHash: 'a'.repeat(64),
    incomingStatus: 'active',
    idempotencyKey: 'idem.security.self-check.0001',
    storedIdempotencyKey: 'idem.security.self-check.0001',
    ...overrides,
  };
}

async function rejects(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

async function runChecks(secrets: SecretValues): Promise<Record<CheckName, boolean>> {
  const checks = { ...FALSE_CHECKS };
  let recoveryCode = '';
  let opaqueToken = '';
  let recoverySessionToken = '';
  let invitationToken = '';
  let adminGrantToken = '';

  try {
    const recoveryCodeResult = generateSecureRecoveryCode();
    recoveryCode = recoveryCodeResult.formattedCode;
    checks.recoveryCodeGeneration = RECOVERY_CODE_PATTERN.test(recoveryCode);

    const recoveryCodeHash = await hashRecoveryCode(recoveryCode, {
      name: SECURITY_SECRET_NAMES.RECOVERY_CODE,
      value: secrets.recoveryCode,
    });
    checks.recoveryCodeHash = HEX_HASH_PATTERN.test(recoveryCodeHash);

    const emailLookupHash = await hashNormalizedRecoveryEmail(
      'security-self-check@example.test',
      {
        name: SECURITY_SECRET_NAMES.RECOVERY_EMAIL,
        value: secrets.emailLookup,
      },
    );
    checks.emailLookupHash = HEX_HASH_PATTERN.test(emailLookupHash);

    opaqueToken = generateOpaqueToken();
    checks.opaqueToken = OPAQUE_TOKEN_PATTERN.test(opaqueToken);
    const resumeTokenHash = await hashResumeToken(opaqueToken, {
      name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
      value: secrets.draftToken,
    });
    checks.resumeTokenHash = HEX_HASH_PATTERN.test(resumeTokenHash);

    const sessionIdHash = await sha256Hex('security-self-check-session');
    const deviceBindingHash = await sha256Hex('security-self-check-device');
    const domainIdentityHash = await sha256Hex('security-self-check-domain');
    const userIdHash = await sha256Hex('security-self-check-user');
    const draftId = 'security-self-check-draft';

    const recoverySecret = {
      name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
      value: secrets.recoverySession,
    } as const;
    recoverySessionToken = await issueRecoverySessionToken({
      environment: 'staging',
      draftId,
      sessionIdHash,
      authorizationMethod: 'recovery_code',
      authorizedScopes: [SIGNED_TOKEN_SCOPES.DRAFT_READ, SIGNED_TOKEN_SCOPES.DRAFT_WRITE],
      recoveryEmailLookupHash: emailLookupHash,
      recoveryCodeVersion: 1,
      recoverySessionVersion: 1,
      grantVersion: 1,
    }, {
      secret: recoverySecret,
      clock: FIXED_CLOCK,
      tokenIdGenerator: () => TOKEN_ID,
    });
    const verifiedRecovery = await verifyRecoverySessionToken(recoverySessionToken, {
      secret: recoverySecret,
      expectedEnvironment: 'staging',
      expectedDraftId: draftId,
      expectedAuthorizationMethod: 'recovery_code',
      expectedRecoverySessionVersion: 1,
      expectedGrantVersion: 1,
      requiredScopes: [SIGNED_TOKEN_SCOPES.DRAFT_WRITE],
      clock: FIXED_CLOCK,
    });
    checks.recoverySessionToken = verifiedRecovery.draftId === draftId;

    const invitationSecret = {
      name: AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION,
      value: secrets.linkSigning,
    } as const;
    const invitationClaims = {
      version: PRO_DRAFT_AUTHORIZATION_VERSION,
      type: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
      scope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
      environment: 'staging' as const,
      issuedAt: NOW_SECONDS,
      notBefore: NOW_SECONDS,
      expiresAt: NOW_SECONDS + 3600,
      tokenId: TOKEN_ID,
      grantVersion: 1,
      invitationId: 'security-self-check-invitation',
      formType: 'pro',
      userIdHash,
      recoveryEmailLookupHash: emailLookupHash,
      domainIdentityHash,
      allowedAssociation: 'current_invitation' as const,
      linkVersion: 1,
    };
    invitationToken = await signStructuredToken(invitationClaims, {
      secret: invitationSecret,
    });
    const verifiedInvitation = await verifyStructuredToken(invitationToken, {
      expectedType: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
      expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
      expectedEnvironment: 'staging',
      expectedGrantVersion: 1,
      secret: invitationSecret,
      clock: FIXED_CLOCK,
    });
    checks.signedInvitationToken = verifiedInvitation.type
      === SIGNED_TOKEN_TYPES.SIGNED_INVITATION;

    const adminSecret = {
      name: AUTHORIZATION_SECRET_NAMES.ADMIN_RECOVERY_GRANT,
      value: secrets.adminGrant,
    } as const;
    adminGrantToken = await issueAdminRecoveryGrant({
      environment: 'staging',
      grantVersion: 1,
      deviceBindingHash,
      passwordVersion: 1,
      recoveryPolicyVersion: 1,
    }, {
      secret: adminSecret,
      clock: FIXED_CLOCK,
      tokenIdGenerator: () => TOKEN_ID,
    });
    const verifiedAdminGrant = await verifyAdminRecoveryGrant(adminGrantToken, {
      secret: adminSecret,
      expectedEnvironment: 'staging',
      expectedGrantVersion: 1,
      expectedPasswordVersion: 1,
      expectedRecoveryPolicyVersion: 1,
      expectedDeviceBindingHash: deviceBindingHash,
      clock: FIXED_CLOCK,
    });
    checks.adminGrantToken = verifiedAdminGrant.expiresAt === null;

    const [payload, signature] = invitationToken.split('.');
    const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    checks.tamperRejection = await rejects(() => verifyStructuredToken(
      `${payload}.${tamperedSignature}`,
      {
        expectedType: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
        expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
        expectedEnvironment: 'staging',
        expectedGrantVersion: 1,
        secret: invitationSecret,
        clock: FIXED_CLOCK,
      },
    ));
    checks.environmentRejection = await rejects(() => verifyStructuredToken(
      invitationToken,
      {
        expectedType: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
        expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
        expectedEnvironment: 'production',
        expectedGrantVersion: 1,
        secret: invitationSecret,
        clock: FIXED_CLOCK,
      },
    ));
    checks.crossPurposeRejection = await rejects(() => verifyStructuredToken(
      invitationToken,
      {
        expectedType: SIGNED_TOKEN_TYPES.RECOVERY_SESSION,
        expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_RECOVER,
        expectedEnvironment: 'staging',
        expectedGrantVersion: 1,
        secret: recoverySecret,
        clock: FIXED_CLOCK,
      },
    ));

    checks.idempotentRevision = evaluateRevisionWrite(revisionInput()).decision
      === 'idempotent_success';
    checks.staleRevisionRejection = evaluateRevisionWrite(revisionInput({
      incomingClientRevision: 3,
      incomingStateHash: 'b'.repeat(64),
      idempotencyKey: 'idem.security.self-check.0002',
    })).decision === 'reject_stale_client_revision';
    checks.submittedRegressionRejection = evaluateRevisionWrite(revisionInput({
      storedStatus: 'submitted',
      incomingClientRevision: 5,
      incomingStateHash: 'c'.repeat(64),
      incomingStatus: 'active',
      idempotencyKey: 'idem.security.self-check.0003',
    })).decision === 'reject_status_transition';

    const parsedSyntheticRequest = await readBoundedJsonBody(new Request(
      'https://security-self-check.invalid/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthetic: true }),
      },
    ), { maxBytes: PRO_DRAFT_SECURITY_SELF_CHECK_REQUEST_LIMIT_BYTES });
    checks.requestLimit = (
      typeof parsedSyntheticRequest === 'object'
      && parsedSyntheticRequest !== null
      && (parsedSyntheticRequest as { synthetic?: unknown }).synthetic === true
    );
  } finally {
    recoveryCode = '';
    opaqueToken = '';
    recoverySessionToken = '';
    invitationToken = '';
    adminGrantToken = '';
  }

  return checks;
}

export function createProDraftSecuritySelfCheckHandler(
  dependencies: SecuritySelfCheckDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    let requestId = 'pdrq_unavailable';
    try {
      requestId = dependencies.createRequestId
        ? dependencies.createRequestId()
        : createServerRequestId();
    } catch {
      // The static fallback remains non-sensitive if randomness is unavailable.
    }

    const environment = safeEnvironment(
      dependencies.getEnvironmentValue('PRO_DRAFT_ENVIRONMENT'),
    );
    const baseResponse = () => safeResponse(requestId, environment);

    try {
      if (request.method !== 'POST') {
        return jsonResponse(baseResponse(), 405, { Allow: 'POST' });
      }

      try {
        await readBoundedJsonBody(request, {
          maxBytes: PRO_DRAFT_SECURITY_SELF_CHECK_REQUEST_LIMIT_BYTES,
        });
      } catch (error) {
        const code = typeof error === 'object' && error !== null
          ? (error as { code?: unknown }).code
          : null;
        if (code === 'PRO_DRAFT_PERSISTENCE_CONTENT_TYPE_UNSUPPORTED') {
          return jsonResponse(baseResponse(), 415);
        }
        if (code === 'PRO_DRAFT_PERSISTENCE_REQUEST_TOO_LARGE') {
          return jsonResponse(baseResponse(), 413);
        }
        return jsonResponse(baseResponse(), 400);
      }

      if (
        environment !== 'staging'
        || dependencies.getEnvironmentValue('PRO_DRAFT_DIAGNOSTICS_ENABLED') !== 'true'
      ) {
        return jsonResponse(baseResponse(), 404);
      }

      const base44 = dependencies.createClientFromRequest(request);
      const user = await base44.auth.me();
      if (!user || typeof user !== 'object') {
        return jsonResponse(baseResponse(), 401);
      }
      if ((user as { role?: unknown }).role !== 'admin') {
        return jsonResponse(baseResponse(), 403);
      }

      const secretConfiguration = resolveSecrets(dependencies.getEnvironmentValue);
      const configurationChecks = {
        ...FALSE_CHECKS,
        secretLengths: secretConfiguration.lengthsValid,
        secretSeparation: secretConfiguration.separationValid,
      };
      if (
        !secretConfiguration.values
        || !secretConfiguration.lengthsValid
        || !secretConfiguration.separationValid
      ) {
        return jsonResponse(safeResponse(requestId, environment, {
          configuredSecrets: secretConfiguration.configured,
          checks: configurationChecks,
        }), 503);
      }

      const checks = await runChecks(secretConfiguration.values);
      checks.secretLengths = true;
      checks.secretSeparation = true;
      const success = CHECK_NAMES.every((name) => checks[name] === true);
      return jsonResponse(safeResponse(requestId, environment, {
        configuredSecrets: secretConfiguration.configured,
        checks,
        success,
      }), success ? 200 : 500);
    } catch {
      return jsonResponse(baseResponse(), 500);
    }
  };
}
