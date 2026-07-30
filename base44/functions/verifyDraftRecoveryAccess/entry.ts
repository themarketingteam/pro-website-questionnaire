const SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';
const GRANT_SCOPE = 'draft-recovery';
const GRANT_VERSION = 1;
const GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache'
  }
});

const toBase64Url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const importSigningKey = (secret: string) => crypto.subtle.importKey(
  'raw',
  encoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign', 'verify']
);

const passwordsMatch = async (submittedPassword: string, configuredPassword: string) => {
  const [submittedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(submittedPassword)),
    crypto.subtle.digest('SHA-256', encoder.encode(configuredPassword))
  ]);

  const submittedBytes = new Uint8Array(submittedHash);
  const configuredBytes = new Uint8Array(configuredHash);
  let difference = 0;

  for (let index = 0; index < submittedBytes.length; index += 1) {
    difference |= submittedBytes[index] ^ configuredBytes[index];
  }

  return difference === 0;
};

const issueGrant = async (secret: string) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + GRANT_TTL_SECONDS;
  const payload = encoder.encode(JSON.stringify({
    version: GRANT_VERSION,
    scope: GRANT_SCOPE,
    issuedAt,
    expiresAt
  }));
  const encodedPayload = toBase64Url(payload);
  const signingKey = await importSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', signingKey, encoder.encode(encodedPayload));

  return {
    token: `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`,
    expiresAt: expiresAt * 1000
  };
};

const verifyGrant = async (token: string, secret: string) => {
  const [encodedPayload, encodedSignature, ...extraParts] = token.split('.');
  if (!encodedPayload || !encodedSignature || extraParts.length > 0) return null;

  try {
    const signingKey = await importSigningKey(secret);
    const signatureIsValid = await crypto.subtle.verify(
      'HMAC',
      signingKey,
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload)
    );
    if (!signatureIsValid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    const now = Math.floor(Date.now() / 1000);
    const hasValidShape = payload?.version === GRANT_VERSION
      && payload?.scope === GRANT_SCOPE
      && Number.isFinite(payload?.issuedAt)
      && Number.isFinite(payload?.expiresAt)
      && payload.issuedAt <= now + 60
      && payload.expiresAt > now
      && payload.expiresAt <= payload.issuedAt + GRANT_TTL_SECONDS;

    return hasValidShape ? payload : null;
  } catch {
    return null;
  }
};

// eslint-disable-next-line no-undef
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ authorized: false, error: 'Method not allowed.' }, 405);
  }

  const configuredPassword = Deno.env.get(SECRET_NAME);
  if (!configuredPassword) {
    return jsonResponse({
      authorized: false,
      error: `Draft recovery access is not configured. Add the ${SECRET_NAME} Base44 secret.`
    }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token : '';

  if (token) {
    const grant = await verifyGrant(token, configuredPassword);
    return grant
      ? jsonResponse({ authorized: true, expiresAt: grant.expiresAt * 1000 })
      : jsonResponse({ authorized: false, error: 'Your saved access has expired. Enter the password again.' }, 401);
  }

  const submittedPassword = typeof body?.password === 'string' ? body.password : '';
  const authorized = submittedPassword.length > 0
    && await passwordsMatch(submittedPassword, configuredPassword);

  if (!authorized) {
    // Slow repeated guesses without changing the response based on password shape.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return jsonResponse({ authorized: false, error: 'Incorrect password.' }, 401);
  }

  const grant = await issueGrant(configuredPassword);
  return jsonResponse({ authorized: true, ...grant });
});
