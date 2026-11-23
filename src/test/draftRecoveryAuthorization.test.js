import { describe, expect, it } from 'vitest';
import { loadBackend } from './utils/loadBackend';

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
  const shared = path.includes('/retryPro');
  const { exposed } = loadBackend(shared ? 'base44/shared/draftRecoveryAuthorization.ts' : path, {
    env: { DRAFT_RECOVERY_PASSWORD: configuredPassword },
    expose: shared ? 'authorizeRecoveryRequest' : 'authorizeDraftRecoveryRequest',
  });
  return { authorizeDraftRecoveryRequest: async (base44, body) => {
    const result = shared
      ? await exposed.authorizeRecoveryRequest(base44, body)
      : await exposed.authorizeDraftRecoveryRequest(base44, body);
    return shared ? result.actorMode : result;
  } };
};

describe.each(functionPaths)('%s public recovery authorization', (path) => {
  it('rejects an unauthenticated endpoint request before accessing any records', async () => {
    const { send } = loadBackend(path, { base44: { auth: { me: async () => null } } });
    expect((await send({ draftId: 'untrusted-draft', mode: 'repair_and_retry' })).status).toBe(403);
  });
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
    const [payloadPart, signaturePart] = validToken.split('.');
    // Changing the first character changes signature bytes. Changing only the
    // last Base64url character can leave its unused padding bits equivalent.
    const tamperedToken = `${payloadPart}.${signaturePart[0] === 'A' ? 'B' : 'A'}${signaturePart.slice(1)}`;
    const { authorizeDraftRecoveryRequest } = loadAuthorizationHelpers(path, secret);
    const anonymousBase44 = { auth: { me: async () => { throw new Error('Unauthorized'); } } };

    await expect(authorizeDraftRecoveryRequest(anonymousBase44, {})).resolves.toBe('');
    await expect(authorizeDraftRecoveryRequest(anonymousBase44, {
      recoveryGrant: tamperedToken,
    })).resolves.toBe('');
    await expect(authorizeDraftRecoveryRequest(anonymousBase44, {
      recoveryGrant: expiredToken,
    })).resolves.toBe('');
    await expect(authorizeDraftRecoveryRequest(anonymousBase44, {
      recoveryGrant: wrongScopeToken,
    })).resolves.toBe('');
  });
});
