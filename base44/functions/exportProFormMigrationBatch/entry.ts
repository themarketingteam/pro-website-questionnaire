import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { verifyCrossAppMigrationAuthorization } from '../_shared/proFormCrossAppMigrationAuth/entry.ts';
import { assertCrossAppMigrationRoute, getCrossAppMigrationConfig } from '../_shared/proFormCrossAppMigrationConfig/entry.ts';
import { getCrossAppMigrationCheckpoint, writeCrossAppMigrationCheckpoint } from '../_shared/proFormCrossAppMigrationCheckpoint/entry.ts';
import { exportMigrationBatch } from '../_shared/proFormCrossAppMigrationService/entry.ts';
import {
  buildMigrationDirectionLease,
  findActiveMigrationDirectionLease,
} from '../_shared/proFormMigrationLease/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.EXPORT_CROSS_APP_MIGRATION,
  maxBytes: 128 * 1024,
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, payload }) => {
    const config = getCrossAppMigrationConfig((name) => Deno.env.get(name));
    const claims = await verifyCrossAppMigrationAuthorization(payload.migrationAuthorization, {
      scope: 'export',
      sourceAppId: config.localAppId,
      destinationAppId: payload.destinationAppId,
      migrationDirection: payload.migrationDirection,
      entityName: payload.entityName,
      batchId: payload.batchId,
    }, { secret: config.secret, clockSkewSeconds: config.clockSkewSeconds });
    assertCrossAppMigrationRoute(config, {
      operation: 'source',
      sourceAppId: config.localAppId,
      destinationAppId: String(payload.destinationAppId),
      direction: String(payload.migrationDirection),
      sourceEnvironment: String(claims.sourceEnvironment),
      destinationEnvironment: String(claims.destinationEnvironment),
    });
    const entities = client.asServiceRole?.entities as Record<string, unknown>;
    const checkpointEntity = entities.ProFormMigrationCheckpoint as Record<string, unknown>;
    const currentLease = await findActiveMigrationDirectionLease(
      checkpointEntity, config.localAppId, String(payload.destinationAppId),
    );
    if (!currentLease) throw new Error('MIGRATION_DIRECTION_LEASE_REQUIRED');
    const lease = await buildMigrationDirectionLease({
      currentLease,
      direction: String(payload.migrationDirection),
      leaseId: String(payload.leaseId),
      leaseOwner: String(payload.leaseOwner),
      sourceAppId: config.localAppId,
      destinationAppId: String(payload.destinationAppId),
      operationMode: String(payload.operationMode ?? 'initial_full'),
      ttlSeconds: config.directionLeaseSeconds,
    });
    const result = await exportMigrationBatch(entities, payload, {
      secret: config.secret,
      sourceAppId: config.localAppId,
      sourceEnvironment: String(claims.sourceEnvironment),
      destinationEnvironment: String(claims.destinationEnvironment),
      maxBatchRecords: config.maxBatchRecords,
      maxBundleBytes: config.maxBundleBytes,
      deltaOverlapSeconds: config.deltaOverlapSeconds,
    });
    const identity = {
      environment: config.environment,
      batchId: String(payload.batchId),
      migrationDirection: String(payload.migrationDirection),
      migrationVersion: Number(payload.migrationVersion ?? 1),
      entityName: String(payload.entityName),
    };
    const checkpoint = await getCrossAppMigrationCheckpoint(checkpointEntity, identity);
    await writeCrossAppMigrationCheckpoint(checkpointEntity, checkpoint, {
      ...identity,
      mode: 'dry_run',
      operationMode: result.operationMode,
      sourceAppId: config.localAppId,
      destinationAppId: payload.destinationAppId,
      activeDirection: lease.active_direction,
      leaseId: lease.lease_id,
      leaseOwner: lease.lease_owner,
      leaseAcquiredAt: lease.lease_acquired_at,
      leaseExpiresAt: lease.lease_expires_at,
      leaseHeartbeatAt: lease.lease_heartbeat_at,
      snapshotCutoff: result.highWater?.snapshotCutoff ?? result.snapshotCutoff,
      lastLogicalUpdatedAt: result.highWater?.lastLogicalUpdatedAt,
      lastSourceRecordId: result.highWater?.lastSourceRecordId,
      overlapStartedAt: result.highWater?.overlapStartedAt,
      pageOffset: result.highWater?.pageOffset,
      passNumber: result.highWater?.passNumber,
      sourceCountObserved: result.highWater?.sourceCountObserved,
      lastBundleHash: result.bundleHash,
      quietPassCount: result.highWater?.quietPassCount,
      highWater: result.highWater,
      entityName: payload.entityName,
      cursor: result.nextCursor,
      status: result.hasMore ? 'running' : 'completed',
      phase: 'export',
      recordsScanned: result.counts.scanned,
      recordsPlanned: result.counts.exported,
      recordsSkipped: result.counts.skipped,
      sequence: payload.sequence,
      dependencyOrder: 0,
      counts: result.counts,
      testRunId: payload.testRunId,
    });
    return result;
  },
}));
