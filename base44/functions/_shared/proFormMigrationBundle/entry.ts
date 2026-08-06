import {
  hmacSha256Base64Url,
  sha256Hex,
  timingSafeEqualStrings,
} from '../proDraftSecurity/entry.ts';

export const PRO_FORM_MIGRATION_BUNDLE_VERSION = 1;
export const MIGRATION_BUNDLE_ERROR_CODES = Object.freeze({
  INVALID: 'MIGRATION_BUNDLE_INVALID',
  TOO_LARGE: 'MIGRATION_BUNDLE_TOO_LARGE',
  RECORD_COUNT: 'MIGRATION_BUNDLE_RECORD_COUNT_MISMATCH',
  CONTENT_HASH: 'MIGRATION_BUNDLE_CONTENT_HASH_MISMATCH',
  SIGNATURE: 'MIGRATION_BUNDLE_SIGNATURE_INVALID',
  ROUTE: 'MIGRATION_BUNDLE_ROUTE_MISMATCH',
  SAME_APP: 'MIGRATION_BUNDLE_SAME_APP_REJECTED',
  ENTITY_MIXED: 'MIGRATION_BUNDLE_ENTITY_MIXED',
  SEQUENCE: 'MIGRATION_BUNDLE_SEQUENCE_INVALID',
  CHAIN: 'MIGRATION_BUNDLE_CHAIN_INVALID',
  CLOCK: 'MIGRATION_BUNDLE_CLOCK_INVALID',
});

export class MigrationBundleError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('The protected migration bundle was rejected.');
    this.name = 'MigrationBundleError';
    this.code = code;
  }
}

const PURPOSE = 'pro-form:cross-app-migration-bundle:v1:';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43,128}$/u;
const DIRECTIONS = new Set(['blue_to_green', 'green_to_blue']);
const ENVIRONMENTS = new Set(['production', 'staging', 'test']);
const FORBIDDEN_RECORD_KEYS = new Set([
  'adminGrant', 'migrationAuthorization', 'accessToken', 'serviceRoleKey',
  'password', 'recoveryCode', 'resumeToken', 'secret',
]);

const fail = (code: string): never => { throw new MigrationBundleError(code); };
const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stableValue(value[key])]));
};
const without = (value: Record<string, unknown>, fields: string[]) => Object.fromEntries(
  Object.entries(value).filter(([key]) => !fields.includes(key)),
);
const stableSerialize = (value: unknown) => JSON.stringify(stableValue(value));
const byteLength = (value: unknown) => new TextEncoder().encode(stableSerialize(value)).byteLength;

function validateEnvelope(value: unknown, bundle: Record<string, unknown>) {
  if (!isRecord(value) || !SAFE_ID.test(String(value.sourceAppId ?? ''))
    || value.sourceAppId !== bundle.sourceAppId
    || value.sourceEntity !== bundle.entityName
    || !SAFE_ID.test(String(value.sourceRecordId ?? ''))
    || !HASH.test(String(value.sourceContentHash ?? ''))
    || !isRecord(value.data)
    || [...FORBIDDEN_RECORD_KEYS].some((key) => Object.hasOwn(value, key)
      || Object.hasOwn(value.data as Record<string, unknown>, key))) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.ENTITY_MIXED);
  }
}

async function calculateContentHash(bundle: Record<string, unknown>, cryptoProvider?: Pick<Crypto, 'subtle'>) {
  return sha256Hex(
    stableSerialize(without(bundle, ['signature', 'bundleContentHash'])),
    cryptoProvider,
  );
}

export async function createMigrationBundle(
  input: Record<string, unknown>,
  options: { maxBundleBytes?: number; cryptoProvider?: Pick<Crypto, 'subtle'> } = {},
) {
  const unsigned: Record<string, unknown> = {
    bundleVersion: PRO_FORM_MIGRATION_BUNDLE_VERSION,
    migrationVersion: input.migrationVersion,
    migrationDirection: input.migrationDirection,
    sourceAppId: input.sourceAppId,
    sourceAppFingerprint: input.sourceAppFingerprint,
    destinationAppId: input.destinationAppId,
    destinationAppFingerprint: input.destinationAppFingerprint,
    sourceEnvironment: input.sourceEnvironment,
    destinationEnvironment: input.destinationEnvironment,
    entityName: input.entityName,
    batchId: input.batchId,
    sequence: input.sequence,
    snapshotCutoff: input.snapshotCutoff,
    exportedAt: input.exportedAt,
    previousBundleHash: input.previousBundleHash ?? null,
    records: input.records,
    recordCount: Array.isArray(input.records) ? input.records.length : -1,
  };
  unsigned.bundleContentHash = await calculateContentHash(unsigned, options.cryptoProvider);
  unsigned.signature = null;
  await validateMigrationBundle(unsigned, {
    ...options,
    requireSignature: false,
  });
  return Object.freeze(unsigned);
}

export async function signMigrationBundle(
  bundle: Record<string, unknown>,
  options: { secret: string; maxBundleBytes?: number; cryptoProvider?: Pick<Crypto, 'subtle'> },
) {
  if (typeof options.secret !== 'string'
    || new TextEncoder().encode(options.secret).byteLength < 32) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.SIGNATURE);
  }
  const validated = await validateMigrationBundle(bundle, {
    ...options, requireSignature: false,
  });
  const signature = await hmacSha256Base64Url(
    options.secret,
    `${PURPOSE}${stableSerialize(without(validated, ['signature']))}`,
    options.cryptoProvider,
  );
  const signed = Object.freeze({ ...validated, signature });
  if (byteLength(signed) > (options.maxBundleBytes ?? 1024 * 1024)) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.TOO_LARGE);
  }
  return signed;
}

export async function calculateMigrationBundleHash(
  bundle: Record<string, unknown>,
  options: { cryptoProvider?: Pick<Crypto, 'subtle'> } = {},
) {
  if (!isRecord(bundle)) return fail(MIGRATION_BUNDLE_ERROR_CODES.INVALID);
  return sha256Hex(
    stableSerialize(without(bundle, ['signature'])), options.cryptoProvider,
  );
}

export async function validateMigrationBundle(
  value: unknown,
  options: {
    maxBundleBytes?: number;
    requireSignature?: boolean;
    cryptoProvider?: Pick<Crypto, 'subtle'>;
  } = {},
) {
  if (!isRecord(value) || value.bundleVersion !== PRO_FORM_MIGRATION_BUNDLE_VERSION
    || !Number.isInteger(value.migrationVersion) || Number(value.migrationVersion) < 1
    || !DIRECTIONS.has(String(value.migrationDirection))
    || !SAFE_ID.test(String(value.sourceAppId ?? ''))
    || !SAFE_ID.test(String(value.destinationAppId ?? ''))
    || value.sourceAppId === value.destinationAppId
    || !HASH.test(String(value.sourceAppFingerprint ?? ''))
    || !HASH.test(String(value.destinationAppFingerprint ?? ''))
    || !ENVIRONMENTS.has(String(value.sourceEnvironment))
    || !ENVIRONMENTS.has(String(value.destinationEnvironment))
    || !SAFE_ID.test(String(value.entityName ?? ''))
    || !SAFE_ID.test(String(value.batchId ?? ''))
    || !Number.isInteger(value.sequence) || Number(value.sequence) < 0
    || typeof value.snapshotCutoff !== 'string' || !Number.isFinite(Date.parse(value.snapshotCutoff))
    || typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))
    || (value.previousBundleHash !== null && !HASH.test(String(value.previousBundleHash ?? '')))
    || !Array.isArray(value.records)
    || !Number.isInteger(value.recordCount)
    || !HASH.test(String(value.bundleContentHash ?? ''))
    || (options.requireSignature !== false && !SIGNATURE.test(String(value.signature ?? '')))) {
    return fail(value && isRecord(value) && value.sourceAppId === value.destinationAppId
      ? MIGRATION_BUNDLE_ERROR_CODES.SAME_APP : MIGRATION_BUNDLE_ERROR_CODES.INVALID);
  }
  if (value.recordCount !== value.records.length) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.RECORD_COUNT);
  }
  const [sourceFingerprint, destinationFingerprint] = await Promise.all([
    sha256Hex(String(value.sourceAppId), options.cryptoProvider),
    sha256Hex(String(value.destinationAppId), options.cryptoProvider),
  ]);
  if (!timingSafeEqualStrings(String(value.sourceAppFingerprint), sourceFingerprint)
    || !timingSafeEqualStrings(String(value.destinationAppFingerprint), destinationFingerprint)) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.ROUTE);
  }
  for (const envelope of value.records) validateEnvelope(envelope, value);
  if (byteLength(value) > (options.maxBundleBytes ?? 1024 * 1024)) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.TOO_LARGE);
  }
  const hash = await calculateContentHash(value, options.cryptoProvider);
  if (!timingSafeEqualStrings(String(value.bundleContentHash), hash)) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.CONTENT_HASH);
  }
  return Object.freeze({ ...value, records: Object.freeze([...value.records]) });
}

export async function verifyMigrationBundle(
  bundle: unknown,
  options: {
    secret: string;
    maxBundleBytes?: number;
    expectedSourceAppId?: string;
    expectedDestinationAppId?: string;
    expectedDirection?: string;
    expectedEntityName?: string;
    expectedSequence?: number;
    expectedPreviousBundleHash?: string | null;
    clock?: () => number;
    clockSkewSeconds?: number;
    cryptoProvider?: Pick<Crypto, 'subtle'>;
  },
) {
  const validated = await validateMigrationBundle(bundle, options);
  const expectedSignature = await hmacSha256Base64Url(
    options.secret,
    `${PURPOSE}${stableSerialize(without(validated, ['signature']))}`,
    options.cryptoProvider,
  );
  if (!timingSafeEqualStrings(String(validated.signature), expectedSignature)) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.SIGNATURE);
  }
  for (const [field, expected] of [
    ['sourceAppId', options.expectedSourceAppId],
    ['destinationAppId', options.expectedDestinationAppId],
    ['migrationDirection', options.expectedDirection],
    ['entityName', options.expectedEntityName],
  ]) if (expected !== undefined && validated[field] !== expected) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.ROUTE);
  }
  if (options.expectedSequence !== undefined && validated.sequence !== options.expectedSequence) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.SEQUENCE);
  }
  if (options.expectedPreviousBundleHash !== undefined
    && validated.previousBundleHash !== options.expectedPreviousBundleHash) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.CHAIN);
  }
  const now = options.clock?.() ?? Date.now();
  const skew = (options.clockSkewSeconds ?? 60) * 1000;
  if (Date.parse(String(validated.exportedAt)) > now + skew
    || Date.parse(String(validated.snapshotCutoff)) > now + skew) {
    return fail(MIGRATION_BUNDLE_ERROR_CODES.CLOCK);
  }
  return validated;
}

export function getSafeMigrationBundleDiagnostics(bundle: unknown) {
  const value = isRecord(bundle) ? bundle : {};
  return Object.freeze({
    bundleVersion: value.bundleVersion ?? null,
    migrationVersion: value.migrationVersion ?? null,
    migrationDirection: value.migrationDirection ?? null,
    entityName: value.entityName ?? null,
    batchId: value.batchId ?? null,
    sequence: value.sequence ?? null,
    recordCount: value.recordCount ?? null,
    bundleContentHash: typeof value.bundleContentHash === 'string'
      ? value.bundleContentHash : null,
    signed: typeof value.signature === 'string',
    containsRecords: false,
    byteLength: isRecord(bundle) ? byteLength(bundle) : 0,
  });
}
