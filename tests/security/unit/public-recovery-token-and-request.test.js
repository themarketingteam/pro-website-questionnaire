import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_ERROR_CODES,
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  issueAdminRecoveryGrant,
  issueRecoverySessionToken,
  verifyAdminRecoveryGrant,
  verifyRecoverySessionToken,
  verifyStructuredToken,
} from '../../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  PERSISTENCE_ERROR_CODES,
  readBoundedJsonBody,
  validateJsonContentType,
  validateRequestMethod,
} from '../../../base44/functions/_shared/proDraftPersistence/entry.ts';
import {
  calculateRecoveryDelay,
  createGenericPublicRecoveryFailure,
  readTrustedClientNetworkContext,
} from '../../../base44/functions/_shared/proDraftRecoverySecurity/entry.ts';
import {
  ATTACK_CATEGORY_CASES,
  SYNTHETIC_TEST_RUN_ID,
  safeTokenSecret,
  syntheticSecurityIdentity,
} from '../fixtures/adversarialFixtures.js';
import {
  assertIsolatedRateLimitSubject,
  assertSecurityTarget,
} from '../helpers/targetSafety.js';
import {
  assertSafeRelativeRedirect,
  sanitizeLogText,
  sanitizeSpreadsheetCell,
} from '../../../scripts/lib/security-output-safety.mjs';

const NOW_SECONDS = 2_000_000_000;
const clock = () => NOW_SECONDS;
const HASH = Object.freeze({
  session: 'a'.repeat(64),
  email: 'b'.repeat(64),
  device: 'c'.repeat(64),
});
const recoverySecret = safeTokenSecret(AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION, 'r');
const adminSecret = safeTokenSecret(AUTHORIZATION_SECRET_NAMES.ADMIN_RECOVERY_GRANT, 'a');

describe('public recovery adversarial boundaries', () => {
  it('keeps invalid, unknown, and ineligible subjects enumeration-equivalent', () => {
    const responses = ['invalid_email', 'unknown_email', 'ineligible_only'].map((internalReason) => (
      createGenericPublicRecoveryFailure({
        requestId: `security-${internalReason.replaceAll('_', '-')}`,
        internalReason,
      })
    ));
    expect(new Set(responses.map(({ message }) => message)).size).toBe(1);
    expect(new Set(responses.map(({ errorCode }) => errorCode))).toEqual(new Set([
      'RECOVERY_NOT_COMPLETED',
    ]));
    expect(JSON.stringify(responses)).not.toMatch(/invalid_email|unknown_email|ineligible_only/u);
  });

  it('uses the same bounded minimum timing envelope for equivalent failures', () => {
    const policy = { minResponseMs: 400, maxJitterMs: 200 };
    const delays = [0, 50, 199].map((randomValue) => calculateRecoveryDelay({
      requestStartedAtMs: 1_000,
      nowMs: 1_100,
      policy,
      cryptoProvider: {
        getRandomValues(values) {
          values[0] = randomValue;
          return values;
        },
      },
    }));
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(300);
    expect(Math.max(...delays) - Math.min(...delays)).toBeLessThanOrEqual(200);
  });

  it('ignores body-spoofed IP and uses trusted forwarding metadata only', () => {
    const request = new Request('https://security.example.test/recover', {
      method: 'POST',
      headers: { 'x-forwarded-for': syntheticSecurityIdentity.sourceIp },
      body: JSON.stringify({ ip: '203.0.113.99', draftId: 'injected-draft' }),
    });
    expect(readTrustedClientNetworkContext(request)).toMatchObject({
      trustedAddress: syntheticSecurityIdentity.sourceIp,
      source: 'x-forwarded-for',
    });
  });

  it('enforces isolated subjects and a hard non-brute-force attempt ceiling', () => {
    expect(assertIsolatedRateLimitSubject({
      testRunId: SYNTHETIC_TEST_RUN_ID,
      subject: syntheticSecurityIdentity.email,
      attempts: 12,
    })).toMatchObject({ isolated: true, attempts: 12 });
    expect(() => assertIsolatedRateLimitSubject({
      testRunId: SYNTHETIC_TEST_RUN_ID,
      subject: syntheticSecurityIdentity.email,
      attempts: 21,
    })).toThrow('SECURITY_BRUTE_FORCE_BOUND_EXCEEDED');
  });

  it('denies production and verifies only local/test/staging targets', () => {
    expect(assertSecurityTarget({
      environment: 'local', baseURL: 'http://127.0.0.1:4173',
    })).toMatchObject({ production: false });
    expect(() => assertSecurityTarget({
      environment: 'production', baseURL: 'https://www.mspsuccesswebsites.com',
    })).toThrow('SECURITY_TARGET_ENVIRONMENT_DENIED');
  });
});

describe('token and authorization attack boundaries', () => {
  it('binds recovery sessions to exact draft, environment, method, and scope', async () => {
    const token = await issueRecoverySessionToken({
      environment: 'staging',
      draftId: syntheticSecurityIdentity.draftId,
      sessionIdHash: HASH.session,
      authorizationMethod: 'email',
      authorizedScopes: [SIGNED_TOKEN_SCOPES.DRAFT_READ, SIGNED_TOKEN_SCOPES.DRAFT_WRITE],
      recoveryEmailLookupHash: HASH.email,
      recoveryCodeVersion: 1,
      recoverySessionVersion: 1,
      grantVersion: 1,
    }, { secret: recoverySecret, clock });

    const common = {
      expectedEnvironment: 'staging',
      expectedDraftId: syntheticSecurityIdentity.draftId,
      expectedGrantVersion: 1,
      expectedAuthorizationMethod: 'email',
      expectedRecoverySessionVersion: 1,
      requiredScopes: [SIGNED_TOKEN_SCOPES.DRAFT_READ],
      secret: recoverySecret,
      clock,
    };
    await expect(verifyRecoverySessionToken(token, common)).resolves.toMatchObject({
      draftId: syntheticSecurityIdentity.draftId,
    });
    await expect(verifyRecoverySessionToken(token, {
      ...common, expectedDraftId: 'security-other-draft',
    })).rejects.toMatchObject({ code: AUTHORIZATION_ERROR_CODES.TOKEN_DRAFT_BINDING_INVALID });
  });

  it('revokes no-expiry admin grants by grant and password version', async () => {
    const token = await issueAdminRecoveryGrant({
      environment: 'staging',
      grantVersion: 2,
      deviceBindingHash: HASH.device,
      passwordVersion: 3,
      recoveryPolicyVersion: 1,
    }, { secret: adminSecret, clock });
    const common = {
      expectedEnvironment: 'staging',
      expectedGrantVersion: 2,
      expectedDeviceBindingHash: HASH.device,
      expectedPasswordVersion: 3,
      expectedRecoveryPolicyVersion: 1,
      secret: adminSecret,
      clock,
    };
    await expect(verifyAdminRecoveryGrant(token, common)).resolves.toMatchObject({ expiresAt: null });
    await expect(verifyAdminRecoveryGrant(token, { ...common, expectedGrantVersion: 3 }))
      .rejects.toMatchObject({ code: AUTHORIZATION_ERROR_CODES.TOKEN_GRANT_VERSION_INVALID });
    await expect(verifyAdminRecoveryGrant(token, { ...common, expectedPasswordVersion: 4 }))
      .rejects.toMatchObject({ code: AUTHORIZATION_ERROR_CODES.TOKEN_PASSWORD_VERSION_INVALID });
    await expect(verifyAdminRecoveryGrant(token, {
      ...common, expectedDeviceBindingHash: 'd'.repeat(64),
    })).rejects.toMatchObject({ code: AUTHORIZATION_ERROR_CODES.TOKEN_DEVICE_BINDING_INVALID });
  });

  it.each([
    'one',
    'one.two.three',
    `${'A'.repeat(9_000)}.${'B'.repeat(43)}`,
    `control\u0000.${'B'.repeat(43)}`,
  ])('rejects malformed, extra-segment, oversized, or control-bearing token input', async (token) => {
    await expect(verifyStructuredToken(token, {
      expectedType: SIGNED_TOKEN_TYPES.RECOVERY_SESSION,
      expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_READ,
      expectedEnvironment: 'staging',
      secret: recoverySecret,
      clock,
    })).rejects.toHaveProperty('code');
  });

  it('declares every required public-recovery and token attack case', () => {
    expect(ATTACK_CATEGORY_CASES.publicRecovery).toHaveLength(17);
    expect(ATTACK_CATEGORY_CASES.tokenAuthorization).toHaveLength(19);
    expect(new Set(ATTACK_CATEGORY_CASES.tokenAuthorization).size).toBe(19);
  });
});

describe('bounded request parser attack boundaries', () => {
  it('rejects method and content-type confusion', () => {
    expect(() => validateRequestMethod('GET')).toThrowError(expect.objectContaining({
      code: PERSISTENCE_ERROR_CODES.METHOD_NOT_ALLOWED,
    }));
    expect(() => validateJsonContentType('text/plain')).toThrowError(expect.objectContaining({
      code: PERSISTENCE_ERROR_CODES.CONTENT_TYPE_UNSUPPORTED,
    }));
  });

  it('rejects declared and chunked bodies above the strict byte limit', async () => {
    const declared = new Request('https://security.example.test/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '4097' },
      body: '{}',
    });
    await expect(readBoundedJsonBody(declared, { maxBytes: 4096 }))
      .rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE });

    const chunk = new TextEncoder().encode(`{"value":"${'x'.repeat(128)}"}`);
    const chunked = new Request('https://security.example.test/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } }),
      duplex: 'half',
    });
    await expect(readBoundedJsonBody(chunked, { maxBytes: 64 }))
      .rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE });
  });

  it('rejects malformed UTF-8 without reflecting input', async () => {
    const request = new Request('https://security.example.test/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Uint8Array([0xc3, 0x28]),
    });
    await expect(readBoundedJsonBody(request, { maxBytes: 64 }))
      .rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.JSON_MALFORMED });
  });

  it('rejects duplicate JSON keys instead of accepting last-key-wins ambiguity', async () => {
    const request = new Request('https://security.example.test/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"operation":"safe","operation":"confused"}',
    });
    await expect(readBoundedJsonBody(request, { maxBytes: 256 }))
      .rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.JSON_MALFORMED });
  });
});

describe('security report and redirect output boundaries', () => {
  it.each([
    '=HYPERLINK("https://security.example.test")',
    ' +SUM(1,1)',
    '-2+3',
    '@security',
    '\tformula',
    '\rformula',
  ])('neutralizes spreadsheet formula input before CSV-style export', (value) => {
    const sanitized = sanitizeSpreadsheetCell(value);
    expect(sanitized.startsWith("'")).toBe(true);
    expect(sanitized.slice(1)).toBe(value.replaceAll('\u0000', ''));
  });

  it('collapses header and log injection controls and enforces an output bound', () => {
    const sanitized = sanitizeLogText('safe\r\nforged-header: value\u0000tail', { maxLength: 24 });
    expect(sanitized).toHaveLength(24);
    expect(sanitized).not.toMatch(/[\r\n\u0000]/u);
  });

  it.each([
    'https://security.example.test/recover',
    '//security.example.test/recover',
    '/%2e%2e/admin',
    '/safe\\redirect',
    '/safe%0d%0aheader',
    '%E0%A4%A',
  ])('denies open-redirect, traversal, control, and malformed redirect targets', (value) => {
    expect(() => assertSafeRelativeRedirect(value)).toThrow(/^SECURITY_REDIRECT_/u);
  });

  it('allows a bounded same-origin relative recovery path', () => {
    expect(assertSafeRelativeRedirect('/recover?source=security')).toBe('/recover?source=security');
  });
});
