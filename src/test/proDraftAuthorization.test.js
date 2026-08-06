import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_ERROR_CODES,
  AUTHORIZATION_SECRET_NAMES,
  DEFAULT_CLOCK_SKEW_SECONDS,
  DEFAULT_RECOVERY_SESSION_TTL_SECONDS,
  MAX_RECOVERY_SESSION_TTL_SECONDS,
  PRO_DRAFT_AUTHORIZATION_VERSION,
  ProDraftAuthorizationError,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  getSafeAuthorizationDiagnostics,
  issueAdminRecoveryGrant,
  issueRecoverySessionToken,
  signStructuredToken,
  validateFutureMagicLinkClaims,
  validateFutureOtpClaims,
  validateSignedInvitationClaims,
  verifyAdminRecoveryGrant,
  verifyRecoverySessionToken,
  verifyStructuredToken,
} from '../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  fromBase64Url,
  hmacSha256Bytes,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from '../../base44/functions/_shared/proDraftSecurity/entry.ts';

const NOW = 2_000_000_000;
const clock = () => NOW;
const HASHES = Object.freeze({
  user: 'a'.repeat(64),
  email: 'b'.repeat(64),
  domain: 'c'.repeat(64),
  session: 'd'.repeat(64),
  device: 'e'.repeat(64),
  redirect: 'f'.repeat(64),
  alternate: '1'.repeat(64),
});
const TOKEN_ID = `pdti_${'A'.repeat(43)}`;

const secret = (name, marker) => Object.freeze({
  name,
  value: marker.repeat(32),
});

const invitationSecret = secret(AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION, 'i');
const recoverySecret = secret(AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION, 'r');
const adminSecret = secret(AUTHORIZATION_SECRET_NAMES.ADMIN_RECOVERY_GRANT, 'a');
const otpSecret = secret(AUTHORIZATION_SECRET_NAMES.EMAIL_OTP, 'o');
const magicLinkSecret = secret(AUTHORIZATION_SECRET_NAMES.MAGIC_LINK, 'm');

const invitationClaims = (overrides = {}) => ({
  version: PRO_DRAFT_AUTHORIZATION_VERSION,
  type: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
  scope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
  environment: 'staging',
  issuedAt: NOW,
  notBefore: NOW,
  expiresAt: NOW + 3600,
  tokenId: TOKEN_ID,
  grantVersion: 1,
  invitationId: 'invitation-opaque-1',
  formType: 'pro',
  userIdHash: HASHES.user,
  recoveryEmailLookupHash: HASHES.email,
  domainIdentityHash: HASHES.domain,
  allowedAssociation: 'current_invitation',
  linkVersion: 1,
  ...overrides,
});

const recoveryInput = (overrides = {}) => ({
  environment: 'staging',
  draftId: 'draft-opaque-1',
  sessionIdHash: HASHES.session,
  authorizationMethod: 'email',
  authorizedScopes: [SIGNED_TOKEN_SCOPES.DRAFT_READ, SIGNED_TOKEN_SCOPES.DRAFT_WRITE],
  recoveryEmailLookupHash: HASHES.email,
  recoveryCodeVersion: 1,
  recoverySessionVersion: 1,
  grantVersion: 1,
  ...overrides,
});

const adminInput = (overrides = {}) => ({
  environment: 'staging',
  grantVersion: 1,
  deviceBindingHash: HASHES.device,
  passwordVersion: 2,
  recoveryPolicyVersion: 1,
  ...overrides,
});

const verifyInvitationOptions = (overrides = {}) => ({
  expectedType: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
  expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
  expectedEnvironment: 'staging',
  expectedGrantVersion: 1,
  secret: invitationSecret,
  clock,
  ...overrides,
});

const decodeTokenPayloadText = (token) => {
  const [encodedPayload] = token.split('.');
  return utf8Decode(fromBase64Url(encodedPayload));
};

const decodeToken = (token) => JSON.parse(decodeTokenPayloadText(token));

const TOKEN_DOMAINS = Object.freeze({
  [SIGNED_TOKEN_TYPES.SIGNED_INVITATION]:
    'pro-draft:authorization:signed-invitation:v1:',
  [SIGNED_TOKEN_TYPES.RECOVERY_SESSION]:
    'pro-draft:authorization:recovery-session:v1:',
  [SIGNED_TOKEN_TYPES.ADMIN_RECOVERY_GRANT]:
    'pro-draft:authorization:admin-recovery-grant:v1:',
  [SIGNED_TOKEN_TYPES.EMAIL_OTP]: 'pro-draft:authorization:email-otp:v1:',
  [SIGNED_TOKEN_TYPES.MAGIC_LINK]: 'pro-draft:authorization:magic-link:v1:',
});

const signRawPayload = async (payloadText, type, signingSecret) => {
  const encodedPayload = toBase64Url(utf8Encode(payloadText));
  const signature = await hmacSha256Bytes(
    signingSecret.value,
    `${TOKEN_DOMAINS[type]}${encodedPayload}`,
  );
  return `${encodedPayload}.${toBase64Url(signature)}`;
};

const expectAuthorizationCode = async (operation, code) => {
  await expect(operation).rejects.toMatchObject({ code });
};

describe('structured signed-token format and verification', () => {
  it('signs and verifies an ordinary canonical structured token', async () => {
    const token = await signStructuredToken(invitationClaims(), {
      secret: invitationSecret,
    });
    const verified = await verifyStructuredToken(token, verifyInvitationOptions());
    expect(verified).toEqual(invitationClaims());
    expect(token.split('.')).toHaveLength(2);
    expect(token).not.toContain('=');
  });

  it('stable-serializes claims regardless of source key order', async () => {
    const claims = invitationClaims();
    const reversed = Object.fromEntries(Object.entries(claims).reverse());
    const first = await signStructuredToken(claims, { secret: invitationSecret });
    const second = await signStructuredToken(reversed, { secret: invitationSecret });
    expect(first).toBe(second);
  });

  it('rejects a tampered payload before parsing its claims', async () => {
    const token = await signStructuredToken(invitationClaims(), {
      secret: invitationSecret,
    });
    const [payload, signatureValue] = token.split('.');
    const replacement = payload[0] === 'A' ? 'B' : 'A';
    await expectAuthorizationCode(
      verifyStructuredToken(
        `${replacement}${payload.slice(1)}.${signatureValue}`,
        verifyInvitationOptions(),
      ),
      AUTHORIZATION_ERROR_CODES.TOKEN_SIGNATURE_INVALID,
    );
  });

  it('rejects a tampered signature with the generic public response', async () => {
    const token = await signStructuredToken(invitationClaims(), {
      secret: invitationSecret,
    });
    const [payload, signatureValue] = token.split('.');
    const replacement = signatureValue[0] === 'A' ? 'B' : 'A';
    try {
      await verifyStructuredToken(
        `${payload}.${replacement}${signatureValue.slice(1)}`,
        verifyInvitationOptions(),
      );
      throw new Error('Expected verification to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ProDraftAuthorizationError);
      expect(error.code).toBe(AUTHORIZATION_ERROR_CODES.TOKEN_SIGNATURE_INVALID);
      expect(error.toSafeResponse()).toEqual({
        ok: false,
        error: {
          code: 'AUTHORIZATION_DENIED',
          message: 'Authorization could not be verified.',
        },
      });
    }
  });

  it.each(['one.two.three', 'one', '.signature', 'payload.'])(
    'rejects invalid segment structure %j',
    async (token) => {
      await expectAuthorizationCode(
        verifyStructuredToken(token, verifyInvitationOptions()),
        AUTHORIZATION_ERROR_CODES.TOKEN_STRUCTURE_INVALID,
      );
    },
  );

  it('rejects invalid Base64URL only after a valid signature check', async () => {
    const encodedPayload = 'A';
    const signature = await hmacSha256Bytes(
      invitationSecret.value,
      `${TOKEN_DOMAINS.signed_invitation}${encodedPayload}`,
    );
    await expectAuthorizationCode(
      verifyStructuredToken(
        `${encodedPayload}.${toBase64Url(signature)}`,
        verifyInvitationOptions(),
      ),
      AUTHORIZATION_ERROR_CODES.TOKEN_ENCODING_INVALID,
    );
  });

  it('rejects malformed JSON after verifying its signature', async () => {
    const token = await signRawPayload(
      'not-json',
      SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
      invitationSecret,
    );
    await expectAuthorizationCode(
      verifyStructuredToken(token, verifyInvitationOptions()),
      AUTHORIZATION_ERROR_CODES.TOKEN_JSON_INVALID,
    );
  });

  it('rejects duplicate JSON keys through canonical-payload enforcement', async () => {
    const token = await signStructuredToken(invitationClaims(), {
      secret: invitationSecret,
    });
    const duplicateJson = decodeTokenPayloadText(token)
      .replace('"version":1', '"version":1,"version":1');
    const duplicateToken = await signRawPayload(
      duplicateJson,
      SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
      invitationSecret,
    );
    await expectAuthorizationCode(
      verifyStructuredToken(duplicateToken, verifyInvitationOptions()),
      AUTHORIZATION_ERROR_CODES.TOKEN_JSON_NONCANONICAL,
    );
  });

  it('rejects unsupported versions, wrong types, and wrong scopes', async () => {
    for (const [field, value, expectedCode] of [
      ['version', 2, AUTHORIZATION_ERROR_CODES.TOKEN_VERSION_UNSUPPORTED],
      ['type', SIGNED_TOKEN_TYPES.RECOVERY_SESSION, AUTHORIZATION_ERROR_CODES.TOKEN_TYPE_INVALID],
      ['scope', SIGNED_TOKEN_SCOPES.DRAFT_READ, AUTHORIZATION_ERROR_CODES.TOKEN_SCOPE_INVALID],
    ]) {
      const original = await signStructuredToken(invitationClaims(), {
        secret: invitationSecret,
      });
      const changedJson = decodeTokenPayloadText(original)
        .replace(
          `"${field}":${JSON.stringify(invitationClaims()[field])}`,
          `"${field}":${JSON.stringify(value)}`,
        );
      const changedToken = await signRawPayload(
        changedJson,
        SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
        invitationSecret,
      );
      await expectAuthorizationCode(
        verifyStructuredToken(changedToken, verifyInvitationOptions()),
        expectedCode,
      );
    }
  });

  it('rejects staging tokens in production', async () => {
    const token = await signStructuredToken(invitationClaims(), {
      secret: invitationSecret,
    });
    await expectAuthorizationCode(
      verifyStructuredToken(token, verifyInvitationOptions({
        expectedEnvironment: 'production',
      })),
      AUTHORIZATION_ERROR_CODES.TOKEN_ENVIRONMENT_INVALID,
    );
  });

  it('enforces not-before, expiry, and bounded 60-second clock skew', async () => {
    const notActive = await signStructuredToken(invitationClaims({
      notBefore: NOW + 61,
      expiresAt: NOW + 3600,
    }), { secret: invitationSecret });
    await expectAuthorizationCode(
      verifyStructuredToken(notActive, verifyInvitationOptions()),
      AUTHORIZATION_ERROR_CODES.TOKEN_NOT_ACTIVE,
    );

    const recentlyExpired = await signStructuredToken(invitationClaims({
      issuedAt: NOW - 3600,
      notBefore: NOW - 3600,
      expiresAt: NOW - 30,
    }), { secret: invitationSecret });
    await expect(verifyStructuredToken(
      recentlyExpired,
      verifyInvitationOptions(),
    )).resolves.toBeDefined();
    await expectAuthorizationCode(
      verifyStructuredToken(recentlyExpired, verifyInvitationOptions({
        clockSkewSeconds: 0,
      })),
      AUTHORIZATION_ERROR_CODES.TOKEN_EXPIRED,
    );
    await expectAuthorizationCode(
      verifyStructuredToken(recentlyExpired, verifyInvitationOptions({
        clockSkewSeconds: DEFAULT_CLOCK_SKEW_SECONDS + 1,
      })),
      AUTHORIZATION_ERROR_CODES.TOKEN_CLOCK_INVALID,
    );
  });

  it('rejects cross-purpose substitution even when secret bytes are reused', async () => {
    const reusedInvitationSecret = secret(
      AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION,
      'x',
    );
    const reusedRecoverySecret = secret(
      AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
      'x',
    );
    const invitation = await signStructuredToken(invitationClaims(), {
      secret: reusedInvitationSecret,
    });

    await expectAuthorizationCode(
      verifyStructuredToken(invitation, {
        expectedType: SIGNED_TOKEN_TYPES.RECOVERY_SESSION,
        expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_RECOVER,
        expectedEnvironment: 'staging',
        secret: reusedRecoverySecret,
        clock,
      }),
      AUTHORIZATION_ERROR_CODES.TOKEN_SIGNATURE_INVALID,
    );
  });

  it('rejects future issue time and excessive lifetime', async () => {
    const future = await signStructuredToken(invitationClaims({
      issuedAt: NOW + 61,
      notBefore: NOW + 61,
      expiresAt: NOW + 3600,
    }), { secret: invitationSecret });
    await expectAuthorizationCode(
      verifyStructuredToken(future, verifyInvitationOptions()),
      AUTHORIZATION_ERROR_CODES.TOKEN_ISSUED_IN_FUTURE,
    );
    await expectAuthorizationCode(
      signStructuredToken(invitationClaims({
        expiresAt: NOW + 90 * 24 * 60 * 60 + 1,
      }), { secret: invitationSecret }),
      AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID,
    );
  });

  it('rejects unknown claims including raw-PII claim names', async () => {
    await expectAuthorizationCode(
      signStructuredToken(invitationClaims({
        email: 'synthetic@example.test',
      }), { secret: invitationSecret }),
      AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID,
    );
  });
});

describe('signed invitation claims', () => {
  it('validates exact environment, form, association, and identity hashes', () => {
    const claims = invitationClaims();
    expect(validateSignedInvitationClaims(claims, {
      expectedEnvironment: 'staging',
      expectedFormType: 'pro',
      expectedRecoveryEmailLookupHash: HASHES.email,
      expectedDomainIdentityHash: HASHES.domain,
      expectedUserIdHash: HASHES.user,
      expectedAllowedAssociation: 'current_invitation',
      clock,
    })).toEqual(claims);
  });

  it('rejects visible-email hash and domain hash mismatches', () => {
    expect(() => validateSignedInvitationClaims(invitationClaims(), {
      expectedEnvironment: 'staging',
      expectedFormType: 'pro',
      expectedRecoveryEmailLookupHash: HASHES.alternate,
      clock,
    })).toThrowError(expect.objectContaining({
      code: AUTHORIZATION_ERROR_CODES.TOKEN_EMAIL_BINDING_INVALID,
    }));
    expect(() => validateSignedInvitationClaims(invitationClaims(), {
      expectedEnvironment: 'staging',
      expectedFormType: 'pro',
      expectedDomainIdentityHash: HASHES.alternate,
      clock,
    })).toThrowError(expect.objectContaining({
      code: AUTHORIZATION_ERROR_CODES.TOKEN_DOMAIN_BINDING_INVALID,
    }));
  });
});

describe('recovery-session authorization', () => {
  const issueOptions = (overrides = {}) => ({
    secret: recoverySecret,
    clock,
    tokenIdGenerator: () => TOKEN_ID,
    ...overrides,
  });
  const verifyOptions = (overrides = {}) => ({
    secret: recoverySecret,
    expectedEnvironment: 'staging',
    expectedDraftId: 'draft-opaque-1',
    expectedAuthorizationMethod: 'email',
    expectedRecoverySessionVersion: 1,
    expectedGrantVersion: 1,
    requiredScopes: [SIGNED_TOKEN_SCOPES.DRAFT_READ],
    clock,
    ...overrides,
  });

  it('issues a deterministic 12-hour token and returns normalized claims', async () => {
    const token = await issueRecoverySessionToken(recoveryInput(), issueOptions());
    const payload = decodeToken(token);
    expect(payload.expiresAt - payload.issuedAt)
      .toBe(DEFAULT_RECOVERY_SESSION_TTL_SECONDS);
    expect(payload.tokenId).toBe(TOKEN_ID);
    await expect(verifyRecoverySessionToken(token, verifyOptions()))
      .resolves.toMatchObject({
        draftId: 'draft-opaque-1',
        authorizationMethod: 'email',
        authorizedScopes: [
          SIGNED_TOKEN_SCOPES.DRAFT_READ,
          SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
        ],
      });
  });

  it('rejects a token for another draft or authorization method', async () => {
    const token = await issueRecoverySessionToken(recoveryInput(), issueOptions());
    await expectAuthorizationCode(
      verifyRecoverySessionToken(token, verifyOptions({
        expectedDraftId: 'draft-opaque-2',
      })),
      AUTHORIZATION_ERROR_CODES.TOKEN_DRAFT_BINDING_INVALID,
    );
    await expectAuthorizationCode(
      verifyRecoverySessionToken(token, verifyOptions({
        expectedAuthorizationMethod: 'recovery_code',
      })),
      AUTHORIZATION_ERROR_CODES.TOKEN_METHOD_INVALID,
    );
  });

  it('requires explicit submitted-read authorization', async () => {
    const submittedToken = await issueRecoverySessionToken(recoveryInput({
      authorizationMethod: 'recovery_code',
      authorizedScopes: [SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ],
    }), issueOptions());
    await expect(verifyRecoverySessionToken(submittedToken, verifyOptions({
      expectedAuthorizationMethod: 'recovery_code',
      requiredScopes: [SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ],
    }))).resolves.toMatchObject({
      authorizedScopes: [SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ],
    });
    await expectAuthorizationCode(
      verifyRecoverySessionToken(submittedToken, verifyOptions({
        expectedAuthorizationMethod: 'recovery_code',
        requiredScopes: [SIGNED_TOKEN_SCOPES.DRAFT_WRITE],
      })),
      AUTHORIZATION_ERROR_CODES.TOKEN_REQUIRED_SCOPE_MISSING,
    );
  });

  it('supports code sessions with event scope and no email lookup claim', async () => {
    const token = await issueRecoverySessionToken(recoveryInput({
      authorizationMethod: 'recovery_code',
      authorizedScopes: [
        SIGNED_TOKEN_SCOPES.DRAFT_READ,
        SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
        SIGNED_TOKEN_SCOPES.DRAFT_EVENTS,
      ],
      recoveryEmailLookupHash: undefined,
    }), issueOptions());
    const claims = await verifyRecoverySessionToken(token, verifyOptions({
      expectedAuthorizationMethod: 'recovery_code',
      requiredScopes: [SIGNED_TOKEN_SCOPES.DRAFT_EVENTS],
    }));
    expect(claims.authorizedScopes).toContain(SIGNED_TOKEN_SCOPES.DRAFT_EVENTS);
    expect(claims).not.toHaveProperty('recoveryEmailLookupHash');
  });

  it('enforces the configurable seven-day maximum', async () => {
    await expect(issueRecoverySessionToken(
      recoveryInput(),
      issueOptions({ ttlSeconds: MAX_RECOVERY_SESSION_TTL_SECONDS }),
    )).resolves.toBeTypeOf('string');
    await expectAuthorizationCode(
      issueRecoverySessionToken(
        recoveryInput(),
        issueOptions({ ttlSeconds: MAX_RECOVERY_SESSION_TTL_SECONDS + 1 }),
      ),
      AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID,
    );
  });

  it('rejects a recovery token under another purpose secret', async () => {
    const token = await issueRecoverySessionToken(recoveryInput(), issueOptions());
    await expectAuthorizationCode(
      verifyRecoverySessionToken(token, verifyOptions({ secret: adminSecret })),
      AUTHORIZATION_ERROR_CODES.TOKEN_SECRET_PURPOSE_INVALID,
    );
  });
});

describe('persistent password-only admin recovery grants', () => {
  const issueOptions = (overrides = {}) => ({
    secret: adminSecret,
    clock,
    tokenIdGenerator: () => TOKEN_ID,
    ...overrides,
  });
  const verifyOptions = (overrides = {}) => ({
    secret: adminSecret,
    expectedEnvironment: 'staging',
    expectedGrantVersion: 1,
    expectedPasswordVersion: 2,
    expectedRecoveryPolicyVersion: 1,
    expectedDeviceBindingHash: HASHES.device,
    clock,
    ...overrides,
  });

  it('issues and verifies a grant with no fixed expiry', async () => {
    const token = await issueAdminRecoveryGrant(adminInput(), issueOptions());
    expect(decodeToken(token).expiresAt).toBeNull();
    await expect(verifyAdminRecoveryGrant(token, verifyOptions()))
      .resolves.toMatchObject({
        scope: SIGNED_TOKEN_SCOPES.ADMIN_DRAFT_RECOVERY,
        expiresAt: null,
        passwordVersion: 2,
      });
  });

  it('revokes through grant and password version increments', async () => {
    const token = await issueAdminRecoveryGrant(adminInput(), issueOptions());
    await expectAuthorizationCode(
      verifyAdminRecoveryGrant(token, verifyOptions({ expectedGrantVersion: 2 })),
      AUTHORIZATION_ERROR_CODES.TOKEN_GRANT_VERSION_INVALID,
    );
    await expectAuthorizationCode(
      verifyAdminRecoveryGrant(token, verifyOptions({ expectedPasswordVersion: 3 })),
      AUTHORIZATION_ERROR_CODES.TOKEN_PASSWORD_VERSION_INVALID,
    );
  });

  it('requires the random-device binding when the grant carries one', async () => {
    const token = await issueAdminRecoveryGrant(adminInput(), issueOptions());
    await expectAuthorizationCode(
      verifyAdminRecoveryGrant(token, verifyOptions({
        expectedDeviceBindingHash: HASHES.alternate,
      })),
      AUTHORIZATION_ERROR_CODES.TOKEN_DEVICE_BINDING_INVALID,
    );
    await expectAuthorizationCode(
      verifyAdminRecoveryGrant(token, verifyOptions({
        expectedDeviceBindingHash: null,
      })),
      AUTHORIZATION_ERROR_CODES.TOKEN_DEVICE_BINDING_INVALID,
    );
  });

  it('secret rotation invalidates every existing grant', async () => {
    const token = await issueAdminRecoveryGrant(adminInput(), issueOptions());
    const rotated = secret(AUTHORIZATION_SECRET_NAMES.ADMIN_RECOVERY_GRANT, 'z');
    await expectAuthorizationCode(
      verifyAdminRecoveryGrant(token, verifyOptions({ secret: rotated })),
      AUTHORIZATION_ERROR_CODES.TOKEN_SIGNATURE_INVALID,
    );
  });
});

describe('disabled future OTP and magic-link claim frameworks', () => {
  const common = (type, scope, ttl) => ({
    version: 1,
    type,
    scope,
    environment: 'staging',
    issuedAt: NOW,
    notBefore: NOW,
    expiresAt: NOW + ttl,
    tokenId: TOKEN_ID,
    grantVersion: 1,
  });

  it('validates bounded future OTP claim shape without issuing or sending', () => {
    const claims = {
      ...common(SIGNED_TOKEN_TYPES.EMAIL_OTP, SIGNED_TOKEN_SCOPES.EMAIL_OTP, 600),
      recoveryEmailLookupHash: HASHES.email,
      attemptId: 'attempt-opaque-1',
      otpVersion: 1,
      attemptCount: 0,
    };
    expect(validateFutureOtpClaims(claims)).toEqual(claims);
    expect(() => validateFutureOtpClaims({
      ...claims,
      expiresAt: NOW + 901,
    })).toThrowError(expect.objectContaining({
      code: AUTHORIZATION_ERROR_CODES.TOKEN_LIFETIME_INVALID,
    }));
  });

  it('validates hashed redirect metadata without accepting a URL', () => {
    const claims = {
      ...common(
        SIGNED_TOKEN_TYPES.MAGIC_LINK,
        SIGNED_TOKEN_SCOPES.EMAIL_MAGIC_LINK,
        1800,
      ),
      recoveryEmailLookupHash: HASHES.email,
      attemptId: 'attempt-opaque-2',
      magicLinkVersion: 1,
      redirectPathHash: HASHES.redirect,
    };
    expect(validateFutureMagicLinkClaims(claims)).toEqual(claims);
    expect(() => validateFutureMagicLinkClaims({
      ...claims,
      redirectPath: 'https://attacker.example.test',
    })).toThrowError(expect.objectContaining({
      code: AUTHORIZATION_ERROR_CODES.TOKEN_CLAIMS_INVALID,
    }));
  });

  it('keeps future purpose secrets separate', async () => {
    const otpClaims = {
      ...common(SIGNED_TOKEN_TYPES.EMAIL_OTP, SIGNED_TOKEN_SCOPES.EMAIL_OTP, 600),
      recoveryEmailLookupHash: HASHES.email,
      attemptId: 'attempt-opaque-3',
      otpVersion: 1,
      attemptCount: 0,
    };
    await expect(signStructuredToken(otpClaims, { secret: otpSecret }))
      .resolves.toBeTypeOf('string');
    await expectAuthorizationCode(
      signStructuredToken(otpClaims, { secret: magicLinkSecret }),
      AUTHORIZATION_ERROR_CODES.TOKEN_SECRET_PURPOSE_INVALID,
    );
  });
});

describe('PII exclusion, diagnostics, and source boundaries', () => {
  it('decoded invitation and recovery tokens contain hashes, not raw identity data', async () => {
    const invitation = await signStructuredToken(invitationClaims(), {
      secret: invitationSecret,
    });
    const recovery = await issueRecoverySessionToken(recoveryInput(), {
      secret: recoverySecret,
      clock,
      tokenIdGenerator: () => TOKEN_ID,
    });
    const decoded = `${decodeTokenPayloadText(invitation)}${decodeTokenPayloadText(recovery)}`;
    for (const forbidden of [
      'synthetic.person@example.test',
      'synthetic-user-id',
      'example.test',
      'RAW-RECOVERY-CODE',
      'RAW-RESUME-TOKEN',
    ]) {
      expect(decoded).not.toContain(forbidden);
    }
    expect(decoded).not.toMatch(
      /"(?:email|userId|domain|recoveryCode|resumeToken)"\s*:/u,
    );
  });

  it('uses the injected clock and token-ID generator deterministically', async () => {
    const token = await issueRecoverySessionToken(recoveryInput(), {
      secret: recoverySecret,
      clock: () => NOW + 123,
      tokenIdGenerator: () => `pdti_${'Z'.repeat(43)}`,
    });
    expect(decodeToken(token)).toMatchObject({
      issuedAt: NOW + 123,
      notBefore: NOW + 123,
      tokenId: `pdti_${'Z'.repeat(43)}`,
    });
  });

  it('returns only frozen nonsecret diagnostics and a safe internal error code', () => {
    const error = new ProDraftAuthorizationError(
      AUTHORIZATION_ERROR_CODES.TOKEN_EXPIRED,
    );
    const diagnostics = getSafeAuthorizationDiagnostics(error);
    expect(diagnostics).toEqual({
      version: 1,
      tokenFormat: 'base64url-json.base64url-hmac',
      signatureAlgorithm: 'HMAC-SHA-256',
      defaultClockSkewSeconds: DEFAULT_CLOCK_SKEW_SECONDS,
      recoverySessionDefaultTtlSeconds: DEFAULT_RECOVERY_SESSION_TTL_SECONDS,
      recoverySessionMaximumTtlSeconds: MAX_RECOVERY_SESSION_TTL_SECONDS,
      adminGrantHasFixedExpiry: false,
      futureOtpEnabled: false,
      futureMagicLinkEnabled: false,
      errorCode: AUTHORIZATION_ERROR_CODES.TOKEN_EXPIRED,
    });
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /"(?:tokenId|signature|secret|email|userId)"\s*:|@/u,
    );
  });

  it('contains no endpoint, environment read, logging, Base44 call, or legacy admin edit', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'base44/functions/_shared/proDraftAuthorization/entry.ts',
    ), 'utf8');
    expect(source).not.toMatch(/export\s+default|Deno\.serve|Deno\.env|process\.env/u);
    expect(source).not.toMatch(/console\s*\.|@base44\/sdk|createClientFromRequest/u);
    expect(source).not.toMatch(/verifyDraftRecoveryAccess/u);
  });
});
