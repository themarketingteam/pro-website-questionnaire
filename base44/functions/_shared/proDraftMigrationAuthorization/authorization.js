import {
  fromBase64Url,
  generateOpaqueToken,
  hmacSha256Base64Url,
  sha256Hex,
  timingSafeEqualStrings,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from '../proDraftSecurity/entry.ts';

export const PRO_FORM_MIGRATION_APPLY_SECRET = 'PRO_FORM_MIGRATION_APPLY_SECRET';
export const MIGRATION_APPLY_SCOPE = 'admin:migration-apply';
export const MIGRATION_APPLY_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const TOKEN_TYPE = 'pro_form_migration_apply';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export class MigrationAuthorizationError extends Error {
  constructor(code) {
    super('Migration apply authorization was denied.');
    this.name = 'MigrationAuthorizationError';
    this.code = code;
  }
}

const fail = (code) => { throw new MigrationAuthorizationError(code); };
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};
const encoded = (value) => toBase64Url(utf8Encode(JSON.stringify(stable(value))));

function validateClaims(claims) {
  if (!claims || claims.type !== TOKEN_TYPE || claims.scope !== MIGRATION_APPLY_SCOPE
    || !SAFE_ID.test(claims.environment || '') || !SAFE_ID.test(claims.migrationName || '')
    || !SAFE_ID.test(claims.batchId || '') || !Number.isInteger(claims.migrationVersion)
    || claims.migrationVersion < 1 || !HASH.test(claims.reportHash || '')
    || !Number.isInteger(claims.maxRecordCount) || claims.maxRecordCount < 0
    || !Number.isInteger(claims.issuedAt) || !Number.isInteger(claims.expiresAt)
    || claims.expiresAt - claims.issuedAt !== MIGRATION_APPLY_TOKEN_TTL_SECONDS
    || !SAFE_ID.test(claims.tokenId || '') || !HASH.test(claims.adminGrantTokenIdHash || '')) {
    fail('MIGRATION_APPLY_TOKEN_INVALID');
  }
  return claims;
}

export async function issueMigrationApplyToken(input, options = {}) {
  const now = Math.floor((options.clock?.() ?? Date.now()) / 1000);
  const tokenId = options.tokenIdGenerator?.() ?? generateOpaqueToken({ prefix: 'mat_' });
  const claims = validateClaims({
    type: TOKEN_TYPE,
    scope: MIGRATION_APPLY_SCOPE,
    environment: input.environment,
    migrationName: input.migrationName,
    migrationVersion: input.migrationVersion,
    batchId: input.batchId,
    reportHash: input.reportHash,
    maxRecordCount: input.maxRecordCount,
    adminGrantTokenIdHash: input.adminGrantTokenIdHash,
    tokenId,
    issuedAt: now,
    expiresAt: now + MIGRATION_APPLY_TOKEN_TTL_SECONDS,
  });
  const payload = encoded(claims);
  const signature = await hmacSha256Base64Url(options.secret, `pro-draft:migration-apply:v1:${payload}`, options.cryptoProvider);
  const token = `${payload}.${signature}`;
  return Object.freeze({ token, claims: Object.freeze(claims), tokenHash: await sha256Hex(token, options.cryptoProvider) });
}

export async function verifyMigrationApplyToken(token, expected, options = {}) {
  if (typeof token !== 'string' || token.length > 8192) fail('MIGRATION_APPLY_TOKEN_INVALID');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) fail('MIGRATION_APPLY_TOKEN_INVALID');
  const calculated = await hmacSha256Base64Url(options.secret, `pro-draft:migration-apply:v1:${payload}`, options.cryptoProvider);
  if (!timingSafeEqualStrings(signature, calculated)) fail('MIGRATION_APPLY_TOKEN_INVALID');
  let claims;
  try { claims = JSON.parse(utf8Decode(fromBase64Url(payload))); } catch { fail('MIGRATION_APPLY_TOKEN_INVALID'); }
  validateClaims(claims);
  const now = Math.floor((options.clock?.() ?? Date.now()) / 1000);
  if (now < claims.issuedAt || now >= claims.expiresAt) fail('MIGRATION_APPLY_TOKEN_EXPIRED');
  for (const [claim, expectedValue] of Object.entries({
    environment: expected.environment,
    migrationName: expected.migrationName,
    migrationVersion: expected.migrationVersion,
    batchId: expected.batchId,
    reportHash: expected.reportHash,
  })) if (expectedValue !== undefined && claims[claim] !== expectedValue) fail('MIGRATION_APPLY_TOKEN_CLAIM_MISMATCH');
  return Object.freeze({ claims: Object.freeze(claims), tokenHash: await sha256Hex(token, options.cryptoProvider) });
}

export async function hashAdminGrantTokenId(tokenId, cryptoProvider) {
  if (!SAFE_ID.test(tokenId || '')) fail('MIGRATION_ADMIN_GRANT_ID_INVALID');
  return sha256Hex(`pro-draft:migration-admin-grant:v1:${tokenId}`, cryptoProvider);
}

export function getSafeMigrationAuthorizationDiagnostics() {
  return Object.freeze({ version: 1, secretName: PRO_FORM_MIGRATION_APPLY_SECRET, scope: MIGRATION_APPLY_SCOPE, ttlSeconds: MIGRATION_APPLY_TOKEN_TTL_SECONDS, oneTime: true, algorithm: 'HMAC-SHA-256' });
}
