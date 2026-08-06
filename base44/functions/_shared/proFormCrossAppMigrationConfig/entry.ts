import { sha256Hex } from '../proDraftSecurity/entry.ts';

export const CROSS_APP_MIGRATION_SECRET_NAME = 'PRO_FORM_CROSS_APP_MIGRATION_SECRET';
export const CROSS_APP_MIGRATION_DEFAULTS = Object.freeze({
  maxBatchRecords: 100,
  maxBundleBytes: 1024 * 1024,
  clockSkewSeconds: 60,
  deltaOverlapSeconds: 300,
  lateWritePollSeconds: 60,
  lateWriteQuietSeconds: 300,
  directionLeaseSeconds: 300,
});

export const CROSS_APP_MIGRATION_ERROR_CODES = Object.freeze({
  CONFIG_INVALID: 'CROSS_APP_MIGRATION_CONFIG_INVALID',
  SECRET_MISSING: 'CROSS_APP_MIGRATION_SECRET_MISSING',
  LOCAL_APP_ID_MISSING: 'CROSS_APP_MIGRATION_LOCAL_APP_ID_MISSING',
  ROLE_DENIED: 'CROSS_APP_MIGRATION_ROLE_DENIED',
  PEER_NOT_ALLOWED: 'CROSS_APP_MIGRATION_PEER_NOT_ALLOWED',
  DIRECTION_NOT_ALLOWED: 'CROSS_APP_MIGRATION_DIRECTION_NOT_ALLOWED',
  SAME_APP: 'CROSS_APP_MIGRATION_SAME_APP_REJECTED',
  ENVIRONMENT_MISMATCH: 'CROSS_APP_MIGRATION_ENVIRONMENT_MISMATCH',
});

export class CrossAppMigrationConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('Cross-application migration configuration was rejected.');
    this.name = 'CrossAppMigrationConfigError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new CrossAppMigrationConfigError(code); };
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const ROLES = new Set(['source', 'destination', 'both']);
const DIRECTIONS = new Set(['blue_to_green', 'green_to_blue']);
const ENVIRONMENTS = new Set(['production', 'staging', 'test']);

function csv(value: string | undefined): ReadonlyArray<string> {
  if (typeof value !== 'string' || value.trim() === '') return Object.freeze([]);
  const values = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (values.some((entry) => !SAFE_ID.test(entry)) || new Set(values).size !== values.length) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.CONFIG_INVALID);
  }
  return Object.freeze(values);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/u.test(value)) return fail(CROSS_APP_MIGRATION_ERROR_CODES.CONFIG_INVALID);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.CONFIG_INVALID);
  }
  return parsed;
}

export function getCrossAppMigrationConfig(
  getEnvironmentValue: (name: string) => string | undefined,
) {
  const secret = getEnvironmentValue(CROSS_APP_MIGRATION_SECRET_NAME);
  if (typeof secret !== 'string' || new TextEncoder().encode(secret).byteLength < 32) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.SECRET_MISSING);
  }
  const localAppId = getEnvironmentValue('PRO_FORM_MIGRATION_LOCAL_APP_ID');
  if (typeof localAppId !== 'string' || !SAFE_ID.test(localAppId)) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.LOCAL_APP_ID_MISSING);
  }
  const localAppName = getEnvironmentValue('PRO_FORM_MIGRATION_LOCAL_APP_NAME');
  const role = getEnvironmentValue('PRO_FORM_MIGRATION_ROLE');
  const environment = getEnvironmentValue('PRO_DRAFT_ENVIRONMENT');
  const allowedDirections = csv(getEnvironmentValue('PRO_FORM_MIGRATION_ALLOWED_DIRECTIONS'));
  if (typeof localAppName !== 'string' || !SAFE_ID.test(localAppName)
    || typeof role !== 'string' || !ROLES.has(role)
    || typeof environment !== 'string' || !ENVIRONMENTS.has(environment)
    || allowedDirections.length === 0
    || allowedDirections.some((direction) => !DIRECTIONS.has(direction))) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.CONFIG_INVALID);
  }
  return Object.freeze({
    secret,
    localAppId,
    localAppName,
    role,
    environment,
    allowedSourceAppIds: csv(getEnvironmentValue('PRO_FORM_MIGRATION_ALLOWED_SOURCE_APP_IDS')),
    allowedDestinationAppIds: csv(getEnvironmentValue('PRO_FORM_MIGRATION_ALLOWED_DESTINATION_APP_IDS')),
    allowedDirections,
    maxBatchRecords: boundedInteger(
      getEnvironmentValue('PRO_FORM_MIGRATION_MAX_BATCH_RECORDS'),
      CROSS_APP_MIGRATION_DEFAULTS.maxBatchRecords, 1, 100,
    ),
    maxBundleBytes: boundedInteger(
      getEnvironmentValue('PRO_FORM_MIGRATION_MAX_BUNDLE_BYTES'),
      CROSS_APP_MIGRATION_DEFAULTS.maxBundleBytes, 1024, 1024 * 1024,
    ),
    clockSkewSeconds: boundedInteger(
      getEnvironmentValue('PRO_FORM_MIGRATION_CLOCK_SKEW_SECONDS'),
      CROSS_APP_MIGRATION_DEFAULTS.clockSkewSeconds, 0, 300,
    ),
    deltaOverlapSeconds: boundedInteger(
      getEnvironmentValue('PRO_FORM_MIGRATION_DELTA_OVERLAP_SECONDS'),
      CROSS_APP_MIGRATION_DEFAULTS.deltaOverlapSeconds, 0, 86400,
    ),
    lateWritePollSeconds: boundedInteger(
      getEnvironmentValue('PRO_FORM_MIGRATION_LATE_WRITE_POLL_SECONDS'),
      CROSS_APP_MIGRATION_DEFAULTS.lateWritePollSeconds, 10, 3600,
    ),
    lateWriteQuietSeconds: boundedInteger(
      getEnvironmentValue('PRO_FORM_MIGRATION_LATE_WRITE_QUIET_SECONDS'),
      CROSS_APP_MIGRATION_DEFAULTS.lateWriteQuietSeconds, 60, 86400,
    ),
    directionLeaseSeconds: boundedInteger(
      getEnvironmentValue('PRO_FORM_MIGRATION_DIRECTION_LEASE_SECONDS'),
      CROSS_APP_MIGRATION_DEFAULTS.directionLeaseSeconds, 30, 1800,
    ),
  });
}

export function assertCrossAppMigrationRoute(config: Record<string, unknown>, input: {
  operation: 'source' | 'destination';
  sourceAppId: string;
  destinationAppId: string;
  direction: string;
  sourceEnvironment: string;
  destinationEnvironment: string;
}) {
  if (input.sourceAppId === input.destinationAppId) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.SAME_APP);
  }
  if (!Array.isArray(config.allowedDirections)
    || !config.allowedDirections.includes(input.direction)) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.DIRECTION_NOT_ALLOWED);
  }
  const role = String(config.role ?? '');
  if (role !== 'both' && role !== input.operation) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.ROLE_DENIED);
  }
  const localAppId = String(config.localAppId ?? '');
  const expectedLocalId = input.operation === 'source'
    ? input.sourceAppId : input.destinationAppId;
  if (localAppId !== expectedLocalId) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.LOCAL_APP_ID_MISSING);
  }
  const peers = input.operation === 'source'
    ? config.allowedDestinationAppIds : config.allowedSourceAppIds;
  const peer = input.operation === 'source' ? input.destinationAppId : input.sourceAppId;
  if (!Array.isArray(peers) || !peers.includes(peer)) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.PEER_NOT_ALLOWED);
  }
  if (input.sourceEnvironment !== input.destinationEnvironment) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.ENVIRONMENT_MISMATCH);
  }
  if (config.environment !== (input.operation === 'source'
    ? input.sourceEnvironment : input.destinationEnvironment)) {
    return fail(CROSS_APP_MIGRATION_ERROR_CODES.ENVIRONMENT_MISMATCH);
  }
  return true;
}

export async function getCrossAppMigrationConfigDiagnostics(config: Record<string, unknown>) {
  return Object.freeze({
    version: 1,
    localAppFingerprint: typeof config.localAppId === 'string'
      ? (await sha256Hex(config.localAppId)).slice(0, 12) : null,
    role: config.role ?? null,
    environment: config.environment ?? null,
    maxBatchRecords: config.maxBatchRecords ?? null,
    maxBundleBytes: config.maxBundleBytes ?? null,
    clockSkewSeconds: config.clockSkewSeconds ?? null,
    deltaOverlapSeconds: config.deltaOverlapSeconds ?? null,
    lateWritePollSeconds: config.lateWritePollSeconds ?? null,
    lateWriteQuietSeconds: config.lateWriteQuietSeconds ?? null,
    directionLeaseSeconds: config.directionLeaseSeconds ?? null,
    secretConfigured: typeof config.secret === 'string',
  });
}
