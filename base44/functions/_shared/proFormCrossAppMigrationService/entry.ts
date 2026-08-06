import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from '../proDraftSecurity/entry.ts';
import { buildMigrationExportBundle } from '../proFormMigrationExport/entry.ts';
import {
  buildMigrationConflictRecord,
  buildRelationshipPatch,
  getSafeMigrationImportDiagnostics,
  upsertMigratedRecord,
} from '../proFormMigrationImport/entry.ts';
import { getProFormMigrationRuntimePolicy, PRO_FORM_MIGRATION_RUNTIME_POLICIES } from '../proFormMigrationPolicy/entry.ts';
import {
  advanceMigrationHighWaterCheckpoint,
  assertMigrationOperationMode,
  createMigrationHighWaterCheckpoint,
  detectMigrationAdapterCapabilities,
  selectMigrationDeltaRecords,
} from '../proFormMigrationDelta/entry.ts';
import { calculateMigrationBundleHash } from '../proFormMigrationBundle/entry.ts';

export class CrossAppMigrationServiceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('The cross-application migration operation was rejected.');
    this.name = 'CrossAppMigrationServiceError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new CrossAppMigrationServiceError(code); };
const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const entityMethods = (value: unknown) => isRecord(value) ? value : fail('MIGRATION_ENTITY_UNAVAILABLE');
const cursorEncode = (value: unknown) => toBase64Url(utf8Encode(JSON.stringify(value)));
const cursorDecode = (value: unknown, entityName: string, snapshotCutoff: string) => {
  if (value === undefined || value === null || value === '') {
    return { offset: 0, anchorId: null, anchorCreatedDate: null };
  }
  if (typeof value !== 'string' || value.length > 2048) return fail('MIGRATION_CURSOR_INVALID');
  try {
    const decoded = JSON.parse(utf8Decode(fromBase64Url(value)));
    if (decoded.version !== 1 || decoded.entityName !== entityName
      || decoded.snapshotCutoff !== snapshotCutoff || !Number.isInteger(decoded.offset)
      || decoded.offset < 1 || typeof decoded.anchorId !== 'string'
      || typeof decoded.anchorCreatedDate !== 'string') return fail('MIGRATION_CURSOR_INVALID');
    return decoded;
  } catch (error) {
    if (error instanceof CrossAppMigrationServiceError) throw error;
    return fail('MIGRATION_CURSOR_INVALID');
  }
};

export async function exportMigrationBatch(
  entities: Record<string, unknown>,
  input: Record<string, unknown>,
  options: {
    secret: string;
    sourceAppId: string;
    sourceEnvironment: string;
    destinationEnvironment: string;
    maxBatchRecords: number;
    maxBundleBytes: number;
    now?: () => Date;
    cryptoProvider?: Pick<Crypto, 'subtle'>;
    deltaOverlapSeconds?: number;
    supportsUpdatedDateSort?: boolean;
  },
) {
  const policy = getProFormMigrationRuntimePolicy(input.entityName);
  const pageSize = input.pageSize === undefined ? options.maxBatchRecords : Number(input.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > options.maxBatchRecords) {
    return fail('MIGRATION_PAGE_SIZE_INVALID');
  }
  const snapshotCutoff = typeof input.snapshotCutoff === 'string'
    ? input.snapshotCutoff : options.now?.().toISOString() ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(snapshotCutoff))) return fail('MIGRATION_SNAPSHOT_INVALID');
  const cursor = cursorDecode(input.cursor, String(input.entityName), snapshotCutoff);
  const source = entityMethods(entities[String(input.entityName)]);
  if (typeof source.list !== 'function') return fail('MIGRATION_ENTITY_UNAVAILABLE');
  const operationMode = assertMigrationOperationMode(input.operationMode ?? 'initial_full');
  const isDelta = operationMode !== 'initial_full' && operationMode !== 'reverse_full';
  const skip = cursor.offset > 0 ? cursor.offset - 1 : 0;
  const adapterCapabilities = detectMigrationAdapterCapabilities(source);
  const supportsUpdatedDateSort = options.supportsUpdatedDateSort
    ?? adapterCapabilities.updatedDateSort;
  const requestedSort = isDelta && supportsUpdatedDateSort === true
    ? 'updated_date' : 'created_date';
  const rows = await (source.list as Function)(requestedSort, pageSize + 2, skip);
  if (!Array.isArray(rows)) return fail('MIGRATION_ENTITY_RESULT_INVALID');
  const highWater = isDelta ? createMigrationHighWaterCheckpoint({
    entityName: String(input.entityName), snapshotCutoff,
    lastLogicalUpdatedAt: typeof input.lastLogicalUpdatedAt === 'string'
      ? input.lastLogicalUpdatedAt : null,
    lastSourceRecordId: typeof input.lastSourceRecordId === 'string'
      ? input.lastSourceRecordId : null,
    overlapSeconds: options.deltaOverlapSeconds ?? 300,
    pageOffset: cursor.offset,
    passNumber: Number(input.passNumber ?? 1),
    sourceCountObserved: Number(input.sourceCountObserved ?? rows.length),
    lastBundleHash: typeof input.previousBundleHash === 'string'
      ? input.previousBundleHash : null,
    quietPassCount: Number(input.quietPassCount ?? 0),
  }) : null;
  const ordered = isDelta && highWater
    ? [...selectMigrationDeltaRecords(rows, highWater)]
    : [...rows].sort((left, right) => String(left.created_date ?? '')
      .localeCompare(String(right.created_date ?? ''))
      || String(left.id ?? '').localeCompare(String(right.id ?? '')));
  let start = 0;
  if (cursor.offset > 0) {
    if (!isDelta && (ordered[0]?.id !== cursor.anchorId
      || String(ordered[0]?.created_date ?? '') !== cursor.anchorCreatedDate)) {
      return fail('MIGRATION_CURSOR_ANCHOR_CHANGED');
    }
    if (!isDelta) start = 1;
  }
  const withinSnapshot = ordered.slice(start)
    .filter((record) => Date.parse(String(record.created_date ?? '')) <= Date.parse(snapshotCutoff));
  const scanned = withinSnapshot.slice(0, pageSize);
  const includeTest = input.includeTestRecords === true;
  const exportable = scanned.filter((record) => {
    const isTest = Boolean(record.test_run_id);
    if (!isTest) return true;
    return includeTest && options.sourceEnvironment !== 'production'
      && options.destinationEnvironment !== 'production'
      && record.test_run_id === input.testRunId;
  });
  const last = scanned.at(-1);
  const hasMore = withinSnapshot.length > pageSize;
  const nextHighWaterBase = highWater
    ? advanceMigrationHighWaterCheckpoint(highWater, scanned, {
      pageOffset: cursor.offset + scanned.length,
      sourceCountObserved: rows.length,
    }) : null;
  const bundle = await buildMigrationExportBundle(exportable, policy, {
    secret: options.secret,
    migrationVersion: Number(input.migrationVersion ?? 1),
    migrationDirection: String(input.migrationDirection),
    sourceAppId: options.sourceAppId,
    destinationAppId: String(input.destinationAppId),
    sourceEnvironment: options.sourceEnvironment,
    destinationEnvironment: options.destinationEnvironment,
    batchId: String(input.batchId),
    sequence: Number(input.sequence ?? 0),
    snapshotCutoff,
    exportedAt: options.now?.().toISOString() ?? new Date().toISOString(),
    previousBundleHash: input.previousBundleHash as string | null | undefined,
    operationMode,
    highWater: nextHighWaterBase,
    includeTestRecords: includeTest,
    testRunId: input.testRunId as string | undefined,
    maxBundleBytes: options.maxBundleBytes,
    cryptoProvider: options.cryptoProvider,
  });
  const bundleHash = await calculateMigrationBundleHash(bundle, {
    cryptoProvider: options.cryptoProvider,
  });
  const nextHighWater = nextHighWaterBase
    ? Object.freeze({ ...nextHighWaterBase, lastBundleHash: bundleHash }) : null;
  return Object.freeze({
    bundle,
    nextCursor: hasMore && last ? cursorEncode({
      version: 1,
      entityName: input.entityName,
      snapshotCutoff,
      offset: cursor.offset + scanned.length,
      anchorId: last.id,
      anchorCreatedDate: String(last.created_date ?? ''),
    }) : null,
    hasMore,
    snapshotCutoff,
    operationMode,
    queryStrategy: isDelta && supportsUpdatedDateSort === true
      ? 'server_updated_date_sort' : isDelta ? 'sorted_page_overlap_fallback' : 'created_date_snapshot',
    highWater: nextHighWater,
    bundleHash,
    counts: Object.freeze({
      scanned: scanned.length,
      exported: exportable.length,
      skipped: scanned.length - exportable.length,
    }),
  });
}

async function persistConflict(
  conflicts: Record<string, unknown>,
  data: Record<string, unknown>,
  apply: boolean,
) {
  const record = await buildMigrationConflictRecord(data);
  if (!apply) return record;
  const matches = await (conflicts.filter as Function)(
    { conflict_id: record.conflict_id, environment: record.environment }, 'created_date', 2, 0,
  );
  if (Array.isArray(matches) && matches.length > 0) return matches[0];
  return (conflicts.create as Function)(record);
}

export async function importMigrationBatch(
  entities: Record<string, Record<string, unknown>>,
  bundle: Record<string, unknown>,
  options: {
    apply?: boolean;
    destinationAppId: string;
    destinationEnvironment: string;
    migrationDirection: string;
    migrationVersion: number;
    batchId: string;
    testRunId?: string;
    now?: () => Date;
    cryptoProvider?: Pick<Crypto, 'subtle'>;
  },
) {
  const policy = getProFormMigrationRuntimePolicy(bundle.entityName);
  const conflicts = entityMethods(entities.ProFormMigrationConflict);
  const counts = { created: 0, updated: 0, unchanged: 0, conflicted: 0, failed: 0 };
  const migratedAt = options.now?.().toISOString() ?? new Date().toISOString();
  for (const envelope of bundle.records as Array<Record<string, unknown>>) {
    try {
      const result = await upsertMigratedRecord(entities, envelope, policy, {
        ...options,
        migratedAt,
      });
      if (result.outcome === 'create' || result.outcome === 'created') counts.created += 1;
      else if (result.outcome === 'update' || result.outcome === 'updated') counts.updated += 1;
      else if (result.outcome === 'unchanged') counts.unchanged += 1;
      else if (result.outcome === 'conflicted') {
        counts.conflicted += 1;
        await persistConflict(conflicts, {
          environment: options.destinationEnvironment,
          migrationDirection: options.migrationDirection,
          batchId: options.batchId,
          entityName: bundle.entityName,
          sourceAppId: envelope.sourceAppId,
          sourceRecordId: envelope.sourceRecordId,
          destinationAppId: options.destinationAppId,
          destinationRecordId: result.destinationRecordId,
          conflictType: result.conflictType,
          sourceContentHash: result.sourceContentHash,
          destinationContentHash: result.destinationContentHash,
          baseContentHash: result.baseContentHash,
          testRunId: options.testRunId,
          detectedAt: migratedAt,
        }, options.apply === true);
      }
    } catch {
      counts.failed += 1;
    }
  }
  return Object.freeze({
    dryRun: options.apply !== true,
    apply: options.apply === true,
    counts: Object.freeze(counts),
    safeDiagnostics: getSafeMigrationImportDiagnostics({
      entityName: bundle.entityName, ...counts,
    }),
  });
}

export async function finalizeMigrationRelationships(
  entities: Record<string, Record<string, unknown>>,
  input: Record<string, unknown>,
  options: {
    apply?: boolean;
    destinationAppId: string;
    destinationEnvironment: string;
    now?: () => Date;
  },
) {
  const idMaps = entityMethods(entities.ProFormMigrationIdMap);
  const conflicts = entityMethods(entities.ProFormMigrationConflict);
  const limit = Math.min(100, Math.max(1, Number(input.pageSize ?? 50)));
  const skip = Math.max(0, Number(input.skip ?? 0));
  const mappings = await (idMaps.filter as Function)({
    source_app_id: input.sourceAppId,
    destination_app_id: options.destinationAppId,
    relationship_finalized: false,
  }, 'created_date', limit, skip);
  if (!Array.isArray(mappings)) return fail('MIGRATION_ID_MAP_RESULT_INVALID');
  const counts = { scanned: 0, finalized: 0, unchanged: 0, unresolved: 0, conflicted: 0 };
  for (const mapping of mappings) {
    counts.scanned += 1;
    const policy = getProFormMigrationRuntimePolicy(mapping.destination_entity);
    const destination = entityMethods(entities[mapping.destination_entity]);
    const record = await (destination.get as Function)(mapping.destination_record_id);
    const plan = await buildRelationshipPatch(record, policy, idMaps, {
      sourceAppId: String(input.sourceAppId),
      destinationAppId: options.destinationAppId,
    });
    if (plan.conflicts.length > 0) {
      counts.conflicted += 1;
      await persistConflict(conflicts, {
        environment: options.destinationEnvironment,
        migrationDirection: input.migrationDirection,
        batchId: input.batchId,
        entityName: mapping.destination_entity,
        sourceAppId: input.sourceAppId,
        sourceRecordId: mapping.source_record_id,
        destinationAppId: options.destinationAppId,
        destinationRecordId: mapping.destination_record_id,
        conflictType: 'source_and_destination_modified',
        sourceContentHash: mapping.source_content_hash,
        destinationContentHash: mapping.destination_content_hash,
        detectedAt: options.now?.().toISOString() ?? new Date().toISOString(),
        testRunId: input.testRunId,
      }, options.apply === true);
      continue;
    }
    if (plan.unresolved.length > 0) {
      counts.unresolved += 1;
      continue;
    }
    if (options.apply === true) {
      const current = await (destination.get as Function)(record.id);
      if (current.updated_date !== record.updated_date
        || Object.keys(plan.patch).some((field) => current[field] !== record[field])) {
        counts.conflicted += 1;
        continue;
      }
      if (Object.keys(plan.patch).length > 0) {
        await (destination.update as Function)(record.id, plan.patch);
        counts.finalized += 1;
      } else counts.unchanged += 1;
      await (idMaps.update as Function)(mapping.id, {
        relationship_finalized: true,
        last_migrated_at: options.now?.().toISOString() ?? new Date().toISOString(),
      });
    } else if (Object.keys(plan.patch).length > 0) counts.finalized += 1;
    else counts.unchanged += 1;
  }
  return Object.freeze({
    dryRun: options.apply !== true,
    counts: Object.freeze(counts),
    nextSkip: mappings.length === limit ? skip + mappings.length : null,
    cutoverReady: counts.unresolved === 0 && counts.conflicted === 0,
    deleted: 0,
  });
}

async function safeCount(entity: Record<string, unknown>, query?: Record<string, unknown>) {
  const rows = query
    ? await (entity.filter as Function)(query, 'created_date', 5000, 0, ['id'])
    : await (entity.list as Function)('created_date', 5000, 0, ['id']);
  if (!Array.isArray(rows)) return fail('MIGRATION_STATUS_RESULT_INVALID');
  return Object.freeze({ count: rows.length, truncated: rows.length === 5000 });
}

export async function getMigrationStatus(
  entities: Record<string, Record<string, unknown>>,
  input: Record<string, unknown>,
  options: { destinationAppId: string; environment: string },
) {
  const checkpoints = await (entityMethods(entities.ProFormMigrationCheckpoint).filter as Function)({
    migration_name: 'pro-form-cross-app',
    environment: options.environment,
    migration_direction: input.migrationDirection,
    batch_id: input.batchId,
  }, '-updated_at', 1, 0);
  const entityCounts: Record<string, unknown> = {};
  for (const name of Object.keys(PRO_FORM_MIGRATION_RUNTIME_POLICIES)) {
    entityCounts[name] = await safeCount(entityMethods(entities[name]));
  }
  const mappings = await safeCount(entityMethods(entities.ProFormMigrationIdMap), {
    destination_app_id: options.destinationAppId,
  });
  const conflicts = await safeCount(entityMethods(entities.ProFormMigrationConflict), {
    destination_app_id: options.destinationAppId,
    status: 'open',
  });
  const unresolved = await safeCount(entityMethods(entities.ProFormMigrationIdMap), {
    destination_app_id: options.destinationAppId,
    relationship_finalized: false,
  });
  const checkpoint = Array.isArray(checkpoints) ? checkpoints[0] : null;
  return Object.freeze({
    environment: options.environment,
    direction: input.migrationDirection,
    entityCounts: Object.freeze(entityCounts),
    mappingCount: mappings,
    conflictCount: conflicts,
    unresolvedRelationshipCount: unresolved,
    verificationVerdict: 'BLOCKED',
    verificationEvidenceComplete: false,
    checkpoint: checkpoint ? Object.freeze({
      status: checkpoint.status ?? null,
      phase: checkpoint.phase ?? null,
      lastBatch: checkpoint.batch_id ?? null,
      lastCursor: checkpoint.cursor ?? null,
      updatedAt: checkpoint.updated_at ?? null,
    }) : null,
    containsRecordData: false,
  });
}
