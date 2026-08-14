const SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';
const GRANT_SCOPE = 'draft-recovery';
const GRANT_VERSION = 1;
const GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
const INTERNAL_SCOPE = 'pro-identity-resolver-internal';
const INTERNAL_TTL_SECONDS = 120;

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const toBase64Url = (value: Uint8Array) => {
  let binary = '';
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const importSigningKey = (secret: string, usage: KeyUsage[]) => crypto.subtle.importKey(
  'raw',
  encoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  usage
);

const verifyGrant = async (token: unknown) => {
  if (typeof token !== 'string' || !token) return false;
  const secret = Deno.env.get(SECRET_NAME) || '';
  if (!secret) return false;
  const [payloadPart, signaturePart, ...extra] = token.split('.');
  if (!payloadPart || !signaturePart || extra.length > 0) return false;

  try {
    const key = await importSigningKey(secret, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signaturePart),
      encoder.encode(payloadPart)
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadPart)));
    const now = Math.floor(Date.now() / 1000);
    return payload?.version === GRANT_VERSION
      && payload?.scope === GRANT_SCOPE
      && Number.isFinite(payload?.issuedAt)
      && Number.isFinite(payload?.expiresAt)
      && payload.issuedAt <= now + 60
      && payload.expiresAt > now
      && payload.expiresAt <= payload.issuedAt + GRANT_TTL_SECONDS;
  } catch {
    return false;
  }
};

export const createIdentityResolverInternalGrant = async ({
  recordType,
  recordId,
  trigger,
  apply
}: any) => {
  const secret = Deno.env.get(SECRET_NAME) || '';
  if (!secret) throw new Error('identity_internal_signing_unconfigured');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    version: GRANT_VERSION,
    scope: INTERNAL_SCOPE,
    issuedAt,
    expiresAt: issuedAt + INTERNAL_TTL_SECONDS,
    recordType,
    recordId,
    trigger,
    apply: Boolean(apply)
  };
  const payloadPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importSigningKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadPart));
  return `${payloadPart}.${toBase64Url(new Uint8Array(signature))}`;
};

const verifyIdentityResolverInternalGrant = async (token: unknown, body: any) => {
  if (typeof token !== 'string' || !token) return false;
  const secret = Deno.env.get(SECRET_NAME) || '';
  if (!secret) return false;
  const [payloadPart, signaturePart, ...extra] = token.split('.');
  if (!payloadPart || !signaturePart || extra.length > 0) return false;
  try {
    const key = await importSigningKey(secret, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signaturePart),
      encoder.encode(payloadPart)
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadPart)));
    const now = Math.floor(Date.now() / 1000);
    return payload?.version === GRANT_VERSION
      && payload?.scope === INTERNAL_SCOPE
      && payload?.issuedAt <= now + 30
      && payload?.expiresAt > now
      && payload?.expiresAt <= payload?.issuedAt + INTERNAL_TTL_SECONDS
      && payload?.recordType === body?.recordType
      && payload?.recordId === body?.recordId
      && payload?.trigger === body?.trigger
      && Boolean(payload?.apply) === Boolean(body?.apply);
  } catch {
    return false;
  }
};

export const authorizeRecoveryRequest = async (base44: any, body: any) => {
  try {
    const user = await base44.auth.me();
    if (user?.role === 'admin') return { authorized: true, actorMode: 'admin', user };
  } catch {
    // Password-gated recovery users do not necessarily have a Base44 user session.
  }

  if (await verifyGrant(body?.recoveryGrant)) {
    return { authorized: true, actorMode: 'recovery_grant', user: null };
  }
  if (await verifyIdentityResolverInternalGrant(body?.internalGrant, body)) {
    return { authorized: true, actorMode: 'backend_function', user: null };
  }
  return { authorized: false, actorMode: '', user: null };
};
