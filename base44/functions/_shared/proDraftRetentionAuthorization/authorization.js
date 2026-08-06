import {
  fromBase64Url, generateOpaqueToken, hmacSha256Base64Url, sha256Hex,
  timingSafeEqualStrings, toBase64Url, utf8Decode, utf8Encode,
} from '../proDraftSecurity/entry.ts';

export const PRO_FORM_RETENTION_APPLY_SECRET = 'PRO_FORM_RETENTION_APPLY_SECRET';
export const RETENTION_APPLY_SCOPE = 'admin:retention-apply';
export const RETENTION_APPLY_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const TOKEN_TYPE = 'pro_form_retention_apply';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export class RetentionAuthorizationError extends Error {
  constructor(code) {
    super('Retention apply authorization was denied.');
    this.name = 'RetentionAuthorizationError';
    this.code = code;
  }
}
const fail = (code) => { throw new RetentionAuthorizationError(code); };
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const encoded = (value) => toBase64Url(utf8Encode(JSON.stringify(stable(value))));

function validateClaims(claims) {
  if (!claims || claims.type !== TOKEN_TYPE || claims.scope !== RETENTION_APPLY_SCOPE
    || !SAFE_ID.test(claims.environment || '') || !SAFE_ID.test(claims.batchId || '')
    || !Number.isInteger(claims.policyVersion) || claims.policyVersion < 1
    || typeof claims.cutoff !== 'string' || !Number.isFinite(Date.parse(claims.cutoff))
    || !HASH.test(claims.reportHash || '') || !HASH.test(claims.adminGrantTokenIdHash || '')
    || !Number.isInteger(claims.maxDeletionCount) || claims.maxDeletionCount < 0 || claims.maxDeletionCount > 200
    || !Number.isInteger(claims.issuedAt) || !Number.isInteger(claims.expiresAt)
    || claims.expiresAt - claims.issuedAt !== RETENTION_APPLY_TOKEN_TTL_SECONDS
    || !SAFE_ID.test(claims.tokenId || '')) fail('RETENTION_APPLY_TOKEN_INVALID');
  return claims;
}

export async function issueRetentionApplyToken(input, options = {}) {
  if (typeof options.secret !== 'string' || new TextEncoder().encode(options.secret).byteLength < 32) {
    fail('RETENTION_APPLY_SECRET_UNAVAILABLE');
  }
  const now = Math.floor((options.clock?.() ?? Date.now()) / 1000);
  const claims = validateClaims({
    type: TOKEN_TYPE, scope: RETENTION_APPLY_SCOPE,
    environment: input.environment, policyVersion: input.policyVersion,
    cutoff: input.cutoff, reportHash: input.reportHash,
    maxDeletionCount: input.maxDeletionCount, batchId: input.batchId,
    adminGrantTokenIdHash: input.adminGrantTokenIdHash,
    tokenId: options.tokenIdGenerator?.() ?? generateOpaqueToken({ prefix: 'rat_' }),
    issuedAt: now, expiresAt: now + RETENTION_APPLY_TOKEN_TTL_SECONDS,
  });
  const payload = encoded(claims);
  const signature = await hmacSha256Base64Url(options.secret, `pro-draft:retention-apply:v1:${payload}`, options.cryptoProvider);
  const token = `${payload}.${signature}`;
  return Object.freeze({ token, claims: Object.freeze(claims), tokenHash: await sha256Hex(token, options.cryptoProvider) });
}

export async function verifyRetentionApplyToken(token, expected, options = {}) {
  if (typeof options.secret !== 'string' || new TextEncoder().encode(options.secret).byteLength < 32) fail('RETENTION_APPLY_SECRET_UNAVAILABLE');
  if (typeof token !== 'string' || token.length > 8192) fail('RETENTION_APPLY_TOKEN_INVALID');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) fail('RETENTION_APPLY_TOKEN_INVALID');
  const calculated = await hmacSha256Base64Url(options.secret, `pro-draft:retention-apply:v1:${payload}`, options.cryptoProvider);
  if (!timingSafeEqualStrings(signature, calculated)) fail('RETENTION_APPLY_TOKEN_INVALID');
  let claims;
  try { claims = JSON.parse(utf8Decode(fromBase64Url(payload))); } catch { fail('RETENTION_APPLY_TOKEN_INVALID'); }
  validateClaims(claims);
  const now = Math.floor((options.clock?.() ?? Date.now()) / 1000);
  if (now < claims.issuedAt || now >= claims.expiresAt) fail('RETENTION_APPLY_TOKEN_EXPIRED');
  for (const [key, value] of Object.entries(expected ?? {})) {
    if (value !== undefined && claims[key] !== value) fail('RETENTION_APPLY_TOKEN_CLAIM_MISMATCH');
  }
  return Object.freeze({ claims: Object.freeze(claims), tokenHash: await sha256Hex(token, options.cryptoProvider) });
}

export async function hashRetentionAdminGrantTokenId(tokenId, cryptoProvider) {
  if (!SAFE_ID.test(tokenId || '')) fail('RETENTION_ADMIN_GRANT_ID_INVALID');
  return sha256Hex(`pro-draft:retention-admin-grant:v1:${tokenId}`, cryptoProvider);
}

export function getSafeRetentionAuthorizationDiagnostics() {
  return Object.freeze({ version: 1, secretName: PRO_FORM_RETENTION_APPLY_SECRET,
    scope: RETENTION_APPLY_SCOPE, ttlSeconds: RETENTION_APPLY_TOKEN_TTL_SECONDS,
    oneTime: true, algorithm: 'HMAC-SHA-256', maxDeletionCount: 200 });
}
