const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

export async function getCrossAppMigrationCheckpoint(
  entity: Record<string, unknown>,
  identity: {
    environment: string;
    batchId: string;
    migrationDirection: string;
    migrationVersion: number;
  },
) {
  const rows = await (entity.filter as Function)({
    migration_name: 'pro-form-cross-app',
    environment: identity.environment,
    migration_version: identity.migrationVersion,
    batch_id: identity.batchId,
    migration_direction: identity.migrationDirection,
  }, 'created_date', 2, 0);
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('MIGRATION_CHECKPOINT_INVALID');
  return rows[0] ?? null;
}

export function readCrossAppCheckpointState(checkpoint: Record<string, unknown> | null) {
  if (!checkpoint || typeof checkpoint.report_json !== 'string') {
    return Object.freeze({ sequence: -1, lastBundleHash: null, dependencyOrder: 0 });
  }
  try {
    const state = JSON.parse(checkpoint.report_json);
    if (!isRecord(state) || state.version !== 1 || !Number.isInteger(state.sequence)
      || state.sequence < -1 || (state.lastBundleHash !== null
        && !/^[a-f0-9]{64}$/u.test(String(state.lastBundleHash)))
      || !Number.isInteger(state.dependencyOrder) || state.dependencyOrder < 0) {
      throw new Error('MIGRATION_CHECKPOINT_INVALID');
    }
    return Object.freeze({
      sequence: state.sequence,
      lastBundleHash: state.lastBundleHash,
      dependencyOrder: state.dependencyOrder,
    });
  } catch {
    throw new Error('MIGRATION_CHECKPOINT_INVALID');
  }
}

export async function writeCrossAppMigrationCheckpoint(
  entity: Record<string, unknown>,
  checkpoint: Record<string, unknown> | null,
  input: Record<string, unknown>,
) {
  const now = String(input.updatedAt ?? new Date().toISOString());
  const patch = {
    migration_name: 'pro-form-cross-app',
    environment: input.environment,
    migration_version: input.migrationVersion,
    batch_id: input.batchId,
    migration_direction: input.migrationDirection,
    mode: input.mode,
    entity_name: input.entityName,
    cursor: input.cursor ?? null,
    status: input.status ?? 'running',
    phase: input.phase,
    records_scanned: Number(input.recordsScanned ?? 0),
    records_planned: Number(input.recordsPlanned ?? 0),
    records_updated: Number(input.recordsUpdated ?? 0),
    records_skipped: Number(input.recordsSkipped ?? 0),
    records_failed: Number(input.recordsFailed ?? 0),
    updated_at: now,
    ...(checkpoint ? {} : { started_at: now }),
    ...(input.status === 'completed' ? { completed_at: now } : {}),
    report_json: JSON.stringify({
      version: 1,
      sequence: Number(input.sequence ?? -1),
      lastBundleHash: input.lastBundleHash ?? null,
      dependencyOrder: Number(input.dependencyOrder ?? 0),
      counts: isRecord(input.counts) ? input.counts : {},
    }),
    test_run_id: input.testRunId,
  };
  if (checkpoint) return (entity.update as Function)(checkpoint.id, patch);
  return (entity.create as Function)(patch);
}

export function getSafeCrossAppMigrationCheckpointDiagnostics(checkpoint: unknown) {
  const value = isRecord(checkpoint) ? checkpoint : {};
  const state = readCrossAppCheckpointState(isRecord(checkpoint) ? checkpoint : null);
  return Object.freeze({
    status: value.status ?? null,
    phase: value.phase ?? null,
    entityName: value.entity_name ?? null,
    sequence: state.sequence,
    hasLastBundleHash: typeof state.lastBundleHash === 'string',
    dependencyOrder: state.dependencyOrder,
    containsRecordData: false,
  });
}
