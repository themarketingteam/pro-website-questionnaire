import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const functionPaths = [
  'base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts',
  'base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts',
];

const encodeBase64Url = (bytes) => Buffer.from(bytes)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const issueGrant = async (secret, overrides = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = new TextEncoder().encode(JSON.stringify({
    version: 1,
    scope: 'draft-recovery',
    issuedAt: now,
    expiresAt: now + 3600,
    ...overrides,
  }));
  const encodedPayload = encodeBase64Url(payload);
  const signingKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    signingKey,
    new TextEncoder().encode(encodedPayload),
  );

  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
};

const loadAuthorizationHelpers = (path, configuredPassword) => {
  const source = readFileSync(resolve(process.cwd(), path), 'utf8');
  const start = source.indexOf("const DRAFT_RECOVERY_SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';");
  const end = source.indexOf('// --- End draft recovery authorization helpers ---', start);
  const helperSource = source.slice(start, end);
  const evaluate = new Function(
    'Deno',
    `${helperSource}\nreturn { verifyDraftRecoveryGrant, authorizeDraftRecoveryRequest };`,
  );

  return evaluate({
    env: {
      get: (name) => name === 'DRAFT_RECOVERY_PASSWORD' ? configuredPassword : undefined,
    },
  });
};

describe.each(functionPaths)('%s public recovery authorization', (path) => {
  it('accepts the same signed grant issued by the password gate', async () => {
    const secret = 'test-recovery-password';
    const token = await issueGrant(secret);
    const { authorizeDraftRecoveryRequest } = loadAuthorizationHelpers(path, secret);

    await expect(authorizeDraftRecoveryRequest({
      auth: { me: async () => null },
    }, { recoveryGrant: token })).resolves.toBe('recovery_grant');
  });

  it('continues to accept authenticated Base44 admins', async () => {
    const { authorizeDraftRecoveryRequest } = loadAuthorizationHelpers(path, '');

    await expect(authorizeDraftRecoveryRequest({
      auth: { me: async () => ({ role: 'admin' }) },
    }, {})).resolves.toBe('admin');
  });

  it('rejects missing, tampered, expired, and wrong-scope grants', async () => {
    const secret = 'test-recovery-password';
    const validToken = await issueGrant(secret);
    const expiredToken = await issueGrant(secret, {
      issuedAt: Math.floor(Date.now() / 1000) - 7200,
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
    });
    const wrongScopeToken = await issueGrant(secret, { scope: 'other-scope' });
    const { authorizeDraftRecoveryRequest } = loadAuthorizationHelpers(path, secret);
    const anonymousBase44 = { auth: { me: async () => { throw new Error('Unauthorized'); } } };

    await expect(authorizeDraftRecoveryRequest(anonymousBase44, {})).resolves.toBe('');
    const [payload, signature] = validToken.split('.');
    const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    await expect(authorizeDraftRecoveryRequest(anonymousBase44, {
      recoveryGrant: `${payload}.${tamperedSignature}`,
    })).resolves.toBe('');
    await expect(authorizeDraftRecoveryRequest(anonymousBase44, {
      recoveryGrant: expiredToken,
    })).resolves.toBe('');
    await expect(authorizeDraftRecoveryRequest(anonymousBase44, {
      recoveryGrant: wrongScopeToken,
    })).resolves.toBe('');
  });
});
