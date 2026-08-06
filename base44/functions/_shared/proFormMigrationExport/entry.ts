import { sha256Hex } from '../proDraftSecurity/entry.ts';
import {
  createMigrationBundle,
  getSafeMigrationBundleDiagnostics,
  signMigrationBundle,
} from '../proFormMigrationBundle/entry.ts';
import { hashMigratableRecord } from '../proFormMigrationContentHash/entry.ts';

export class MigrationExportError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('The migration export record was rejected.');
    this.name = 'MigrationExportError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new MigrationExportError(code); };
const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const deepClone = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined && typeof child !== 'function')
    .map(([key, child]) => [key, deepClone(child)]));
};
const RAW_FORBIDDEN_FIELDS = new Set([
  'adminGrant', 'migrationAuthorization', 'password', 'recovery_code',
  'recoveryCode', 'resume_token', 'resumeToken', 'access_token', 'accessToken',
  'service_role_key', 'serviceRoleKey', 'secret',
]);

export function validateSourceRecordForExport(
  record: unknown,
  policy: Record<string, unknown>,
  options: {
    sourceAppId: string;
    sourceEnvironment: string;
    destinationEnvironment: string;
    includeTestRecords?: boolean;
    testRunId?: string;
  },
) {
  if (!isRecord(record) || typeof record.id !== 'string' || record.id.length === 0
    || !Array.isArray(policy.allowedFields)
    || policy.migrationPolicy === 'environment_local'
    || policy.migrationPolicy === 'never_migrate') {
    return fail('MIGRATION_EXPORT_ENTITY_REJECTED');
  }
  if (options.sourceEnvironment !== options.destinationEnvironment) {
    return fail('MIGRATION_EXPORT_ENVIRONMENT_REJECTED');
  }
  const recordEnvironment = typeof record.environment === 'string'
    ? record.environment : null;
  if ((options.destinationEnvironment === 'production'
    && recordEnvironment !== null && recordEnvironment !== 'production')
    || (options.destinationEnvironment !== 'production'
      && recordEnvironment !== options.sourceEnvironment)) {
    return fail('MIGRATION_EXPORT_ENVIRONMENT_REJECTED');
  }
  const isTest = record.test_run_id !== undefined && record.test_run_id !== null
    && record.test_run_id !== '';
  if (options.destinationEnvironment === 'production' && isTest) {
    return fail('MIGRATION_EXPORT_TEST_RECORD_REJECTED');
  }
  if (isTest && (options.includeTestRecords !== true
    || options.sourceEnvironment === 'production'
    || record.test_run_id !== options.testRunId)) {
    return fail('MIGRATION_EXPORT_TEST_RECORD_REJECTED');
  }
  const known = new Set([
    ...policy.allowedFields as string[],
    ...(Array.isArray(policy.serverManagedFields) ? policy.serverManagedFields as string[] : []),
  ]);
  const unknown = Object.keys(record).filter((key) => !known.has(key));
  if (unknown.length > 0 || [...RAW_FORBIDDEN_FIELDS].some((key) => Object.hasOwn(record, key))) {
    return fail('MIGRATION_EXPORT_FIELD_REJECTED');
  }
  return true;
}

export async function buildMigrationExportRecord(
  record: Record<string, unknown>,
  policy: Record<string, unknown>,
  options: {
    sourceAppId: string;
    sourceEnvironment: string;
    destinationEnvironment: string;
    includeTestRecords?: boolean;
    testRunId?: string;
    cryptoProvider?: Pick<Crypto, 'subtle'>;
  },
) {
  validateSourceRecordForExport(record, policy, options);
  const excluded = new Set([
    ...(Array.isArray(policy.serverManagedFields) ? policy.serverManagedFields as string[] : []),
    ...(Array.isArray(policy.excludedFields) ? policy.excludedFields as string[] : []),
    ...(Array.isArray(policy.contentHashExcludedFields)
      ? policy.contentHashExcludedFields as string[] : []),
  ]);
  const data = Object.fromEntries((policy.allowedFields as string[])
    .filter((field) => !excluded.has(field) && !RAW_FORBIDDEN_FIELDS.has(field)
      && record[field] !== undefined)
    .map((field) => [field, deepClone(record[field])]));
  const relationshipIdentities = Object.fromEntries(
    (Array.isArray(policy.relationshipFields) ? policy.relationshipFields : [])
      .filter((relationship) => isRecord(relationship)
        && typeof relationship.path === 'string'
        && typeof record[relationship.path] === 'string')
      .map((relationship) => [relationship.path,
        `${options.sourceAppId}:${relationship.targetEntity}:${record[relationship.path]}`]),
  );
  const sourceContentHash = await hashMigratableRecord(record, policy, {
    relationshipIdentities,
    cryptoProvider: options.cryptoProvider,
  });
  return Object.freeze({
    sourceAppId: options.sourceAppId,
    sourceEntity: policy.entityName,
    sourceRecordId: record.id,
    sourceCreatedDate: typeof record.created_date === 'string' ? record.created_date : null,
    sourceUpdatedDate: typeof record.updated_date === 'string' ? record.updated_date : null,
    originAppId: typeof record.origin_app_id === 'string'
      ? record.origin_app_id : options.sourceAppId,
    originEntity: typeof record.origin_entity === 'string'
      ? record.origin_entity : policy.entityName,
    originRecordId: typeof record.origin_record_id === 'string'
      ? record.origin_record_id : record.id,
    originCreatedAt: typeof record.origin_created_at === 'string'
      ? record.origin_created_at : (record.source_created_date ?? record.created_date ?? null),
    originUpdatedAt: typeof record.origin_updated_at === 'string'
      ? record.origin_updated_at : (record.source_updated_date ?? record.updated_date ?? null),
    sourceContentHash,
    data: Object.freeze(data),
  });
}

export async function buildMigrationExportBundle(
  records: ReadonlyArray<Record<string, unknown>>,
  policy: Record<string, unknown>,
  options: {
    secret: string;
    migrationVersion: number;
    migrationDirection: string;
    sourceAppId: string;
    destinationAppId: string;
    sourceEnvironment: string;
    destinationEnvironment: string;
    batchId: string;
    sequence: number;
    snapshotCutoff: string;
    exportedAt?: string;
    previousBundleHash?: string | null;
    includeTestRecords?: boolean;
    testRunId?: string;
    maxBundleBytes?: number;
    cryptoProvider?: Pick<Crypto, 'subtle'>;
  },
) {
  const envelopes = await Promise.all(records.map((record) => buildMigrationExportRecord(
    record, policy, options,
  )));
  const unsigned = await createMigrationBundle({
    ...options,
    sourceAppFingerprint: await sha256Hex(options.sourceAppId, options.cryptoProvider),
    destinationAppFingerprint: await sha256Hex(
      options.destinationAppId, options.cryptoProvider,
    ),
    entityName: policy.entityName,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    records: envelopes,
  }, options);
  return signMigrationBundle(unsigned, options);
}

export function getSafeMigrationExportDiagnostics(input: {
  entityName?: unknown;
  scannedCount?: unknown;
  exportedCount?: unknown;
  skippedCount?: unknown;
  bundle?: unknown;
} = {}) {
  return Object.freeze({
    version: 1,
    entityName: typeof input.entityName === 'string' ? input.entityName : null,
    scannedCount: Number.isInteger(input.scannedCount) ? input.scannedCount : 0,
    exportedCount: Number.isInteger(input.exportedCount) ? input.exportedCount : 0,
    skippedCount: Number.isInteger(input.skippedCount) ? input.skippedCount : 0,
    ...(input.bundle ? { bundle: getSafeMigrationBundleDiagnostics(input.bundle) } : {}),
    containsRecordData: false,
    containsSensitiveHashes: false,
  });
}
