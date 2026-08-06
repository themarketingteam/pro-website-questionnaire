import { sha256Hex } from '../proDraftSecurity/entry.ts';
import { hashMigratableRecord } from '../proFormMigrationContentHash/entry.ts';
import {
  PRO_FORM_MIGRATION_CONFLICT_TYPES,
  resolveProFormMigrationConflict,
} from '../proFormMigrationConflict/entry.ts';

export class MigrationImportError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('The migration import operation was rejected.');
    this.name = 'MigrationImportError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new MigrationImportError(code); };
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
const one = (rows: unknown, duplicateCode: string) => {
  if (!Array.isArray(rows)) return fail('MIGRATION_IMPORT_ENTITY_RESULT_INVALID');
  if (rows.length > 1) return fail(duplicateCode);
  return rows[0] ?? null;
};

export function prepareImportedEntityData(
  envelope: Record<string, unknown>,
  policy: Record<string, unknown>,
  options: {
    destinationEnvironment: string;
    migrationDirection: string;
    migrationVersion: number;
    batchId: string;
    migratedAt?: string;
    testRunId?: string;
  },
) {
  if (!isRecord(envelope) || !isRecord(envelope.data)
    || !Array.isArray(policy.allowedFields)
    || envelope.sourceEntity !== policy.entityName) {
    return fail('MIGRATION_IMPORT_ENVELOPE_INVALID');
  }
  const allowed = new Set(policy.allowedFields as string[]);
  if (Object.keys(envelope.data).some((key) => !allowed.has(key))) {
    return fail('MIGRATION_IMPORT_FIELD_REJECTED');
  }
  const data = Object.fromEntries(Object.entries(envelope.data)
    .map(([key, value]) => [key, deepClone(value)]));
  return Object.freeze({
    ...data,
    environment: options.destinationEnvironment,
    ...(options.testRunId ? { test_run_id: options.testRunId } : {}),
    origin_app_id: envelope.originAppId,
    origin_entity: envelope.originEntity,
    origin_record_id: envelope.originRecordId,
    origin_created_at: envelope.originCreatedAt,
    origin_updated_at: envelope.originUpdatedAt,
    source_app_id: envelope.sourceAppId,
    source_entity: envelope.sourceEntity,
    source_record_id: envelope.sourceRecordId,
    source_created_date: envelope.sourceCreatedDate,
    source_updated_date: envelope.sourceUpdatedDate,
    migration_batch_id: options.batchId,
    migration_direction: options.migrationDirection,
    migrated_at: options.migratedAt ?? new Date().toISOString(),
    source_content_hash: envelope.sourceContentHash,
    migration_version: options.migrationVersion,
  });
}

export async function findExistingMigrationMapping(
  idMapEntity: Record<string, unknown>,
  input: { sourceAppId: string; sourceEntity: string; sourceRecordId: string; destinationAppId: string; destinationEntity: string },
) {
  if (typeof idMapEntity?.filter !== 'function') {
    return fail('MIGRATION_IMPORT_ID_MAP_UNAVAILABLE');
  }
  return one(await (idMapEntity.filter as Function)({
    source_app_id: input.sourceAppId,
    source_entity: input.sourceEntity,
    source_record_id: input.sourceRecordId,
    destination_app_id: input.destinationAppId,
    destination_entity: input.destinationEntity,
  }, 'created_date', 2, 0), 'MIGRATION_IMPORT_ID_MAP_DUPLICATE');
}

export async function findExistingDestinationRecord(
  destinationEntity: Record<string, unknown>,
  input: { sourceAppId: string; sourceEntity: string; sourceRecordId: string },
) {
  if (typeof destinationEntity?.filter !== 'function') {
    return fail('MIGRATION_IMPORT_DESTINATION_UNAVAILABLE');
  }
  return one(await (destinationEntity.filter as Function)({
    source_app_id: input.sourceAppId,
    source_entity: input.sourceEntity,
    source_record_id: input.sourceRecordId,
  }, 'created_date', 2, 0), 'MIGRATION_IMPORT_DESTINATION_DUPLICATE');
}

async function relationshipIdentitiesForDestination(
  record: Record<string, unknown>,
  policy: Record<string, unknown>,
  idMapEntity: Record<string, unknown>,
  sourceAppId: string,
  destinationAppId: string,
) {
  const identities: Record<string, string> = {};
  for (const relationship of Array.isArray(policy.relationshipFields)
    ? policy.relationshipFields as Array<Record<string, unknown>> : []) {
    const path = String(relationship.path ?? '');
    const target = String(relationship.targetEntity ?? '');
    const value = record[path];
    if (typeof value !== 'string' || value === '') continue;
    const bySource = await (idMapEntity.filter as Function)({
      source_app_id: sourceAppId,
      source_entity: target,
      source_record_id: value,
      destination_app_id: destinationAppId,
      destination_entity: target,
    }, 'created_date', 2, 0);
    const sourceMatch = one(bySource, 'MIGRATION_IMPORT_RELATIONSHIP_MAP_DUPLICATE');
    if (sourceMatch) {
      identities[path] = `${sourceAppId}:${target}:${value}`;
      continue;
    }
    const byDestination = await (idMapEntity.filter as Function)({
      destination_app_id: destinationAppId,
      destination_entity: target,
      destination_record_id: value,
    }, 'created_date', 2, 0);
    const destinationMatch = one(byDestination, 'MIGRATION_IMPORT_RELATIONSHIP_MAP_DUPLICATE');
    if (destinationMatch) {
      identities[path] = `${destinationMatch.source_app_id}:${target}:${destinationMatch.source_record_id}`;
    }
  }
  return identities;
}

export async function recordMigrationIdMap(
  idMapEntity: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  data: Record<string, unknown>,
  options: { apply?: boolean } = {},
) {
  if (options.apply !== true) return Object.freeze({ outcome: existing ? 'update' : 'create' });
  if (existing) {
    if (typeof idMapEntity.update !== 'function') return fail('MIGRATION_IMPORT_ID_MAP_UNAVAILABLE');
    return Object.freeze({
      outcome: 'updated',
      record: await (idMapEntity.update as Function)(existing.id, data),
    });
  }
  if (typeof idMapEntity.create !== 'function') return fail('MIGRATION_IMPORT_ID_MAP_UNAVAILABLE');
  return Object.freeze({
    outcome: 'created',
    record: await (idMapEntity.create as Function)(data),
  });
}

export async function upsertMigratedRecord(
  entities: Record<string, Record<string, unknown>>,
  envelope: Record<string, unknown>,
  policy: Record<string, unknown>,
  options: {
    apply?: boolean;
    destinationAppId: string;
    destinationEnvironment: string;
    migrationDirection: string;
    migrationVersion: number;
    batchId: string;
    migratedAt?: string;
    testRunId?: string;
    cryptoProvider?: Pick<Crypto, 'subtle'>;
  },
) {
  const destinationEntity = entities[String(policy.entityName)];
  const idMapEntity = entities.ProFormMigrationIdMap;
  if (!destinationEntity || !idMapEntity) return fail('MIGRATION_IMPORT_ENTITY_UNAVAILABLE');
  const identity = {
    sourceAppId: String(envelope.sourceAppId),
    sourceEntity: String(envelope.sourceEntity),
    sourceRecordId: String(envelope.sourceRecordId),
    destinationAppId: options.destinationAppId,
    destinationEntity: String(policy.entityName),
  };
  const mapping = await findExistingMigrationMapping(idMapEntity, identity);
  let existing: Record<string, unknown> | null = null;
  if (mapping) {
    if (typeof destinationEntity.get !== 'function') return fail('MIGRATION_IMPORT_DESTINATION_UNAVAILABLE');
    existing = await (destinationEntity.get as Function)(mapping.destination_record_id);
    const exact = await findExistingDestinationRecord(destinationEntity, identity);
    if (exact && exact.id !== existing?.id) return fail('MIGRATION_IMPORT_IDENTITY_CONFLICT');
  } else {
    existing = await findExistingDestinationRecord(destinationEntity, identity);
  }
  const reverseToOrigin = options.migrationDirection === 'green_to_blue'
    && envelope.originAppId === options.destinationAppId
    && envelope.originEntity === policy.entityName
    && typeof envelope.originRecordId === 'string';
  if (!existing && reverseToOrigin && typeof destinationEntity.get === 'function') {
    existing = await (destinationEntity.get as Function)(envelope.originRecordId);
  }
  const prepared = prepareImportedEntityData(envelope, policy, options);
  let currentHash: string | null = null;
  if (existing) {
    const relationshipIdentities = await relationshipIdentitiesForDestination(
      existing, policy, idMapEntity, identity.sourceAppId, options.destinationAppId,
    );
    currentHash = await hashMigratableRecord(existing, policy, {
      relationshipIdentities,
      cryptoProvider: options.cryptoProvider,
    });
    const baseHash = reverseToOrigin
      ? envelope.immediateBaseContentHash ?? mapping?.destination_content_hash ?? null
      : mapping?.destination_content_hash ?? existing.source_content_hash ?? null;
    const decision = resolveProFormMigrationConflict({
      sourceHash: String(envelope.sourceContentHash ?? ''),
      destinationHash: currentHash,
      baseHash: typeof baseHash === 'string' ? baseHash : null,
      sourceUpdatedAt: String(envelope.sourceUpdatedDate ?? ''),
      destinationUpdatedAt: String(existing.source_updated_date ?? existing.updated_date ?? ''),
      sourceStatus: typeof envelope.data === 'object' && envelope.data
        ? String((envelope.data as Record<string, unknown>).status ?? '') : null,
      destinationStatus: String(existing.status ?? ''),
      destinationNative: !mapping && !reverseToOrigin,
    });
    if (decision.manual === true) {
      return Object.freeze({
        outcome: 'conflicted',
        conflictType: decision.conflictType ?? 'source_and_destination_modified',
        sourceContentHash: envelope.sourceContentHash,
        destinationContentHash: currentHash,
        baseContentHash: baseHash,
        destinationRecordId: existing.id,
      });
    }
    if (decision.policy === 'noop'
      || (envelope.sourceContentHash === existing.source_content_hash
        && envelope.sourceContentHash === currentHash)) {
      return Object.freeze({ outcome: 'unchanged', record: existing, mapping });
    }
  }
  if (options.apply !== true) {
    return Object.freeze({ outcome: existing ? 'update' : 'create' });
  }
  let destinationRecord: Record<string, unknown>;
  if (existing) {
    if (typeof destinationEntity.update !== 'function') return fail('MIGRATION_IMPORT_DESTINATION_UNAVAILABLE');
    destinationRecord = await (destinationEntity.update as Function)(existing.id, prepared);
  } else {
    if (typeof destinationEntity.create !== 'function') return fail('MIGRATION_IMPORT_DESTINATION_UNAVAILABLE');
    destinationRecord = await (destinationEntity.create as Function)(prepared);
  }
  const relationshipIdentities = Object.fromEntries(
    (Array.isArray(policy.relationshipFields) ? policy.relationshipFields : [])
      .filter((relationship) => isRecord(relationship)
        && typeof prepared[String(relationship.path)] === 'string')
      .map((relationship) => [String(relationship.path),
        `${identity.sourceAppId}:${relationship.targetEntity}:${prepared[String(relationship.path)]}`]),
  );
  const destinationContentHash = await hashMigratableRecord(destinationRecord, policy, {
    relationshipIdentities,
    cryptoProvider: options.cryptoProvider,
  });
  const now = options.migratedAt ?? new Date().toISOString();
  const mapData = {
    source_app_id: identity.sourceAppId,
    source_entity: identity.sourceEntity,
    source_record_id: identity.sourceRecordId,
    destination_app_id: options.destinationAppId,
    destination_entity: identity.destinationEntity,
    destination_record_id: destinationRecord.id,
    origin_app_id: envelope.originAppId,
    origin_entity: envelope.originEntity,
    origin_record_id: envelope.originRecordId,
    migration_direction: options.migrationDirection,
    migration_version: options.migrationVersion,
    first_migrated_at: mapping?.first_migrated_at ?? now,
    last_migrated_at: now,
    source_content_hash: envelope.sourceContentHash,
    destination_content_hash: destinationContentHash,
    last_migration_batch_id: options.batchId,
    relationship_finalized: (policy.relationshipFields as unknown[])?.length === 0,
    environment: options.destinationEnvironment,
    ...(options.testRunId ? { test_run_id: options.testRunId } : {}),
  };
  await recordMigrationIdMap(idMapEntity, mapping, mapData, { apply: true });
  return Object.freeze({
    outcome: existing ? 'updated' : 'created',
    record: destinationRecord,
    destinationContentHash,
  });
}

export async function buildRelationshipPatch(
  destinationRecord: Record<string, unknown>,
  policy: Record<string, unknown>,
  idMapEntity: Record<string, unknown>,
  options: { sourceAppId: string; destinationAppId: string },
) {
  const patch: Record<string, unknown> = {};
  const unresolved: Array<Record<string, unknown>> = [];
  const conflicts: Array<Record<string, unknown>> = [];
  for (const relationship of Array.isArray(policy.relationshipFields)
    ? policy.relationshipFields as Array<Record<string, unknown>> : []) {
    const path = String(relationship.path);
    const sourceRecordId = destinationRecord[path];
    if (sourceRecordId === null || sourceRecordId === undefined || sourceRecordId === '') continue;
    const matches = await (idMapEntity.filter as Function)({
      source_app_id: options.sourceAppId,
      source_entity: relationship.targetEntity,
      source_record_id: sourceRecordId,
      destination_app_id: options.destinationAppId,
      destination_entity: relationship.targetEntity,
    }, 'created_date', 2, 0);
    let mapping = one(matches, 'MIGRATION_RELATIONSHIP_MAP_DUPLICATE');
    if (!mapping) {
      const destinationMatches = await (idMapEntity.filter as Function)({
        source_app_id: options.sourceAppId,
        destination_app_id: options.destinationAppId,
        destination_entity: relationship.targetEntity,
        destination_record_id: sourceRecordId,
      }, 'created_date', 2, 0);
      mapping = one(destinationMatches, 'MIGRATION_RELATIONSHIP_MAP_DUPLICATE');
    }
    if (!mapping) {
      unresolved.push(Object.freeze({ path, required: relationship.required === true }));
      continue;
    }
    if (sourceRecordId !== mapping.source_record_id
      && sourceRecordId !== mapping.destination_record_id) {
      conflicts.push(Object.freeze({ path, code: 'RELATIONSHIP_CHANGED_INDEPENDENTLY' }));
      continue;
    }
    if (sourceRecordId !== mapping.destination_record_id) {
      patch[path] = mapping.destination_record_id;
    }
  }
  return Object.freeze({
    patch: Object.freeze(patch),
    unresolved: Object.freeze(unresolved),
    conflicts: Object.freeze(conflicts),
    complete: unresolved.length === 0 && conflicts.length === 0,
  });
}

export async function buildMigrationConflictRecord(input: Record<string, unknown>) {
  if (!PRO_FORM_MIGRATION_CONFLICT_TYPES.includes(
    input.conflictType as (typeof PRO_FORM_MIGRATION_CONFLICT_TYPES)[number],
  )) {
    return fail('MIGRATION_IMPORT_CONFLICT_TYPE_INVALID');
  }
  const identity = [input.migrationDirection, input.batchId, input.entityName,
    input.sourceAppId, input.sourceRecordId, input.conflictType].join(':');
  return Object.freeze({
    conflict_id: `pmc_${(await sha256Hex(identity)).slice(0, 48)}`,
    environment: input.environment,
    migration_direction: input.migrationDirection,
    migration_batch_id: input.batchId,
    entity_name: input.entityName,
    source_app_id: input.sourceAppId,
    source_record_id: input.sourceRecordId,
    destination_app_id: input.destinationAppId,
    destination_record_id: input.destinationRecordId,
    conflict_type: input.conflictType,
    source_content_hash: input.sourceContentHash,
    destination_content_hash: input.destinationContentHash,
    base_content_hash: input.baseContentHash,
    detected_at: input.detectedAt ?? new Date().toISOString(),
    status: 'open',
    test_run_id: input.testRunId,
    safe_diagnostics_json: JSON.stringify({
      version: 1,
      code: input.conflictType,
      entityName: input.entityName,
      hasSourceHash: typeof input.sourceContentHash === 'string',
      hasDestinationHash: typeof input.destinationContentHash === 'string',
    }),
  });
}

export function getSafeMigrationImportDiagnostics(input: Record<string, unknown> = {}) {
  return Object.freeze({
    version: 1,
    entityName: typeof input.entityName === 'string' ? input.entityName : null,
    created: Number(input.created ?? 0),
    updated: Number(input.updated ?? 0),
    unchanged: Number(input.unchanged ?? 0),
    conflicted: Number(input.conflicted ?? 0),
    failed: Number(input.failed ?? 0),
    deleted: 0,
    upsertIdentity: Object.freeze(['source_app_id', 'source_entity', 'source_record_id']),
    matchesByEmail: false,
    containsRecordData: false,
  });
}
