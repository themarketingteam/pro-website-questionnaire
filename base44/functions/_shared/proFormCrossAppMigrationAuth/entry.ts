import {
  fromBase64Url,
  hmacSha256Base64Url,
  timingSafeEqualStrings,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from '../proDraftSecurity/entry.ts';

export const CROSS_APP_MIGRATION_AUTH_VERSION = 1;
const PURPOSE = 'pro-form:cross-app-migration-authorization:v1:';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const BINDING_PURPOSE = 'pro-form:cross-app-migration-authorization-binding:v1:';
const SCOPES = new Set(['export', 'import', 'finalize', 'status', 'orchestrate']);

export class CrossAppMigrationAuthorizationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('Cross-application migration authorization was denied.');
    this.name = 'CrossAppMigrationAuthorizationError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new CrossAppMigrationAuthorizationError(code); };
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
};

function validateClaims(value: unknown) {
  const claims = value as Record<string, unknown>;
  if (!claims || claims.version !== CROSS_APP_MIGRATION_AUTH_VERSION
    || !SCOPES.has(String(claims.scope))
    || !SAFE_ID.test(String(claims.sourceAppId ?? ''))
    || !SAFE_ID.test(String(claims.destinationAppId ?? ''))
    || claims.sourceAppId === claims.destinationAppId
    || !SAFE_ID.test(String(claims.migrationDirection ?? ''))
    || !SAFE_ID.test(String(claims.sourceEnvironment ?? ''))
    || !SAFE_ID.test(String(claims.destinationEnvironment ?? ''))
    || !SAFE_ID.test(String(claims.entityName ?? ''))
    || !SAFE_ID.test(String(claims.batchId ?? ''))
    || !Number.isInteger(claims.issuedAt) || !Number.isInteger(claims.expiresAt)
    || Number(claims.expiresAt) <= Number(claims.issuedAt)
    || (claims.bundleHash !== null && !HASH.test(String(claims.bundleHash ?? '')))) {
    return fail('CROSS_APP_MIGRATION_AUTH_INVALID');
  }
  return claims;
}

export async function createCrossAppMigrationAuthorization(
  input: Record<string, unknown>,
  options: { secret: string; clock?: () => number; ttlSeconds?: number; cryptoProvider?: Pick<Crypto, 'subtle'> },
) {
  const now = Math.floor((options.clock?.() ?? Date.now()) / 1000);
  const claims = validateClaims({
    version: CROSS_APP_MIGRATION_AUTH_VERSION,
    ...input,
    bundleHash: input.bundleHash ?? null,
    issuedAt: now,
    expiresAt: now + (options.ttlSeconds ?? 15 * 60),
  });
  const payload = toBase64Url(utf8Encode(JSON.stringify(stable(claims))));
  const signature = await hmacSha256Base64Url(
    options.secret, `${PURPOSE}${payload}`, options.cryptoProvider,
  );
  return `${payload}.${signature}`;
}

export async function verifyCrossAppMigrationAuthorization(
  token: unknown,
  expected: Record<string, unknown>,
  options: { secret: string; clock?: () => number; clockSkewSeconds?: number; cryptoProvider?: Pick<Crypto, 'subtle'> },
) {
  if (typeof token !== 'string' || token.length > 8192) {
    return fail('CROSS_APP_MIGRATION_AUTH_INVALID');
  }
  const [payload, signature, binding, extra] = token.split('.');
  if (!payload || !signature || extra) return fail('CROSS_APP_MIGRATION_AUTH_INVALID');
  const baseToken = `${payload}.${signature}`;
  const calculated = await hmacSha256Base64Url(
    options.secret, `${PURPOSE}${payload}`, options.cryptoProvider,
  );
  if (!timingSafeEqualStrings(signature, calculated)) {
    return fail('CROSS_APP_MIGRATION_AUTH_INVALID');
  }
  let claims: Record<string, unknown>;
  try { claims = validateClaims(JSON.parse(utf8Decode(fromBase64Url(payload)))); } catch {
    return fail('CROSS_APP_MIGRATION_AUTH_INVALID');
  }
  const now = Math.floor((options.clock?.() ?? Date.now()) / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  if (now + skew < Number(claims.issuedAt) || now - skew >= Number(claims.expiresAt)) {
    return fail('CROSS_APP_MIGRATION_AUTH_EXPIRED');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value === undefined || key === 'bundleHash') continue;
    const matchesOrchestrator = key === 'scope' && claims.scope === 'orchestrate';
    const matchesAllEntities = key === 'entityName' && claims.entityName === 'all';
    if (claims[key] !== value && !matchesOrchestrator && !matchesAllEntities) {
      return fail('CROSS_APP_MIGRATION_AUTH_CLAIM_MISMATCH');
    }
  }
  if (expected.bundleHash !== undefined) {
    if (claims.bundleHash !== expected.bundleHash) {
      if (claims.bundleHash !== null || typeof expected.bundleHash !== 'string'
        || typeof binding !== 'string') {
        return fail('CROSS_APP_MIGRATION_AUTH_CLAIM_MISMATCH');
      }
      const calculatedBinding = await hmacSha256Base64Url(
        baseToken, `${BINDING_PURPOSE}${expected.bundleHash}`, options.cryptoProvider,
      );
      if (!timingSafeEqualStrings(binding, calculatedBinding)) {
        return fail('CROSS_APP_MIGRATION_AUTH_CLAIM_MISMATCH');
      }
    }
  } else if (binding !== undefined) {
    return fail('CROSS_APP_MIGRATION_AUTH_INVALID');
  }
  return Object.freeze({ ...claims });
}

export async function bindCrossAppMigrationAuthorization(
  token: string,
  bundleHash: string,
  cryptoProvider?: Pick<Crypto, 'subtle'>,
) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)
    || !HASH.test(bundleHash)) return fail('CROSS_APP_MIGRATION_AUTH_INVALID');
  const binding = await hmacSha256Base64Url(
    token, `${BINDING_PURPOSE}${bundleHash}`, cryptoProvider,
  );
  return `${token}.${binding}`;
}

export function getSafeCrossAppMigrationAuthorizationDiagnostics() {
  return Object.freeze({
    version: CROSS_APP_MIGRATION_AUTH_VERSION,
    algorithm: 'HMAC-SHA-256',
    purposeSeparated: true,
    scopes: Object.freeze([...SCOPES]),
    containsAdminGrant: false,
    supportsBundleHashBinding: true,
  });
}
