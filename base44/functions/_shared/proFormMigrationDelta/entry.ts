export const PRO_FORM_MIGRATION_OPERATION_MODES = Object.freeze([
  'initial_full',
  'incremental_delta',
  'final_freeze_delta',
  'late_write_reconciliation',
  'reverse_full',
  'reverse_delta',
  'integrity_verify',
  'file_reference_audit',
] as const);

export type ProFormMigrationOperationMode = typeof PRO_FORM_MIGRATION_OPERATION_MODES[number];

export type MigrationHighWaterCheckpoint = Readonly<{
  entityName: string;
  snapshotCutoff: string;
  lastLogicalUpdatedAt: string | null;
  lastSourceRecordId: string | null;
  overlapStartedAt: string;
  pageOffset: number;
  passNumber: number;
  sourceCountObserved: number;
  lastBundleHash: string | null;
  quietPassCount: number;
}>;

const validTime = (value: unknown): value is string => (
  typeof value === 'string' && Number.isFinite(Date.parse(value))
);
const fail = (code: string): never => { throw new Error(code); };

export function assertMigrationOperationMode(value: unknown): ProFormMigrationOperationMode {
  if (!PRO_FORM_MIGRATION_OPERATION_MODES.includes(value as ProFormMigrationOperationMode)) {
    return fail('MIGRATION_OPERATION_MODE_INVALID');
  }
  return value as ProFormMigrationOperationMode;
}

export function createMigrationHighWaterCheckpoint(input: {
  entityName: string;
  snapshotCutoff: string;
  lastLogicalUpdatedAt?: string | null;
  lastSourceRecordId?: string | null;
  overlapSeconds?: number;
  pageOffset?: number;
  passNumber?: number;
  sourceCountObserved?: number;
  lastBundleHash?: string | null;
  quietPassCount?: number;
}): MigrationHighWaterCheckpoint {
  if (!/^[A-Za-z][A-Za-z0-9]{0,127}$/u.test(input.entityName)
    || !validTime(input.snapshotCutoff)
    || (input.lastLogicalUpdatedAt !== undefined && input.lastLogicalUpdatedAt !== null
      && !validTime(input.lastLogicalUpdatedAt))
    || (input.lastSourceRecordId !== undefined && input.lastSourceRecordId !== null
      && !/^[A-Za-z0-9._:-]{1,256}$/u.test(input.lastSourceRecordId))
    || (input.lastLogicalUpdatedAt !== undefined && input.lastLogicalUpdatedAt !== null
      && Date.parse(input.lastLogicalUpdatedAt) > Date.parse(input.snapshotCutoff))
    || !Number.isInteger(input.pageOffset ?? 0) || Number(input.pageOffset ?? 0) < 0
    || !Number.isInteger(input.passNumber ?? 1) || Number(input.passNumber ?? 1) < 1
    || !Number.isInteger(input.sourceCountObserved ?? 0)
    || Number(input.sourceCountObserved ?? 0) < 0
    || !Number.isInteger(input.quietPassCount ?? 0) || Number(input.quietPassCount ?? 0) < 0
    || (input.lastBundleHash !== undefined && input.lastBundleHash !== null
      && !/^[a-f0-9]{64}$/u.test(input.lastBundleHash))) {
    return fail('MIGRATION_HIGH_WATER_INVALID');
  }
  const overlapSeconds = input.overlapSeconds ?? 300;
  if (!Number.isInteger(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > 86400) {
    return fail('MIGRATION_HIGH_WATER_INVALID');
  }
  const anchor = input.lastLogicalUpdatedAt ?? input.snapshotCutoff;
  const overlapStartedAt = new Date(Date.parse(anchor) - overlapSeconds * 1000).toISOString();
  return Object.freeze({
    entityName: input.entityName,
    snapshotCutoff: new Date(input.snapshotCutoff).toISOString(),
    lastLogicalUpdatedAt: input.lastLogicalUpdatedAt
      ? new Date(input.lastLogicalUpdatedAt).toISOString() : null,
    lastSourceRecordId: input.lastSourceRecordId ?? null,
    overlapStartedAt,
    pageOffset: Number(input.pageOffset ?? 0),
    passNumber: Number(input.passNumber ?? 1),
    sourceCountObserved: Number(input.sourceCountObserved ?? 0),
    lastBundleHash: input.lastBundleHash ?? null,
    quietPassCount: Number(input.quietPassCount ?? 0),
  });
}

export function compareMigrationLogicalTuple(
  left: { updated_date?: unknown; id?: unknown },
  right: { updated_date?: unknown; id?: unknown },
) {
  return String(left.updated_date ?? '').localeCompare(String(right.updated_date ?? ''))
    || String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

export function detectMigrationAdapterCapabilities(entity: Record<string, unknown>) {
  const capabilities = entity.migrationCapabilities;
  return Object.freeze({
    updatedDateSort: capabilities !== null && typeof capabilities === 'object'
      && !Array.isArray(capabilities)
      && (capabilities as Record<string, unknown>).updatedDateSort === true,
    updatedDateRange: capabilities !== null && typeof capabilities === 'object'
      && !Array.isArray(capabilities)
      && (capabilities as Record<string, unknown>).updatedDateRange === true,
  });
}

export function hasMigrationPaginationShift(
  checkpoint: MigrationHighWaterCheckpoint,
  currentSourceCount: number,
) {
  return Number.isInteger(currentSourceCount)
    && checkpoint.sourceCountObserved > 0
    && currentSourceCount !== checkpoint.sourceCountObserved;
}

export function selectMigrationDeltaRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  checkpoint: MigrationHighWaterCheckpoint,
) {
  const cutoff = Date.parse(checkpoint.snapshotCutoff);
  const overlap = Date.parse(checkpoint.overlapStartedAt);
  const seen = new Set<string>();
  return Object.freeze([...records]
    .filter((record) => typeof record.id === 'string'
      && validTime(record.updated_date)
      && Date.parse(record.updated_date) >= overlap
      && Date.parse(record.updated_date) <= cutoff)
    .sort(compareMigrationLogicalTuple)
    .filter((record) => {
      if (seen.has(String(record.id))) return false;
      seen.add(String(record.id));
      return true;
    }));
}

export function advanceMigrationHighWaterCheckpoint(
  checkpoint: MigrationHighWaterCheckpoint,
  records: ReadonlyArray<Record<string, unknown>>,
  input: { pageOffset?: number; sourceCountObserved?: number; lastBundleHash?: string | null;
    changedCount?: number } = {},
) {
  const ordered = [...records].sort(compareMigrationLogicalTuple);
  const last = ordered.at(-1);
  return Object.freeze({
    ...checkpoint,
    lastLogicalUpdatedAt: last && validTime(last.updated_date)
      ? new Date(last.updated_date).toISOString() : checkpoint.lastLogicalUpdatedAt,
    lastSourceRecordId: last && typeof last.id === 'string'
      ? last.id : checkpoint.lastSourceRecordId,
    pageOffset: input.pageOffset ?? checkpoint.pageOffset + records.length,
    sourceCountObserved: input.sourceCountObserved ?? checkpoint.sourceCountObserved,
    lastBundleHash: input.lastBundleHash ?? checkpoint.lastBundleHash,
    quietPassCount: input.changedCount === undefined ? checkpoint.quietPassCount
      : input.changedCount === 0 ? checkpoint.quietPassCount + 1 : 0,
  });
}

export function isFinalFreezeDeltaComplete(checkpoints: ReadonlyArray<MigrationHighWaterCheckpoint>) {
  return checkpoints.length > 0 && checkpoints.every((checkpoint) => checkpoint.quietPassCount >= 2);
}

export function detectLateWriteCandidates(
  records: ReadonlyArray<Record<string, unknown>>,
  mappingsBySourceId: Readonly<Record<string, { destinationContentHash?: unknown }>>,
  input: { freezeStartedAt: string; domainSwitchedAt: string },
) {
  if (!validTime(input.freezeStartedAt) || !validTime(input.domainSwitchedAt)) {
    return fail('MIGRATION_LATE_WRITE_WINDOW_INVALID');
  }
  const boundary = Math.min(Date.parse(input.freezeStartedAt), Date.parse(input.domainSwitchedAt));
  return Object.freeze(records.filter((record) => {
    const changedAt = Date.parse(String(record.updated_date ?? record.created_date ?? ''));
    if (!Number.isFinite(changedAt) || changedAt < boundary || typeof record.id !== 'string') return false;
    const mapped = mappingsBySourceId[record.id];
    return !mapped || mapped.destinationContentHash !== record.source_content_hash;
  }));
}

export function getLateWritePollingState(input: {
  now: string;
  lastChangeAt: string | null;
  changedCount: number;
  quietPassCount: number;
  quietSeconds?: number;
}) {
  if (!validTime(input.now) || (input.lastChangeAt !== null && !validTime(input.lastChangeAt))) {
    return fail('MIGRATION_LATE_WRITE_WINDOW_INVALID');
  }
  const quietSeconds = input.quietSeconds ?? 300;
  const quietLongEnough = input.changedCount === 0 && input.lastChangeAt !== null
    && Date.parse(input.now) - Date.parse(input.lastChangeAt) >= quietSeconds * 1000;
  const quietPassCount = quietLongEnough ? input.quietPassCount + 1 : 0;
  return Object.freeze({ quietPassCount, complete: quietPassCount >= 2 });
}
