import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { verifyCrossAppMigrationAuthorization } from '../_shared/proFormCrossAppMigrationAuth/entry.ts';
import { assertCrossAppMigrationRoute, getCrossAppMigrationConfig } from '../_shared/proFormCrossAppMigrationConfig/entry.ts';
import { getCrossAppMigrationCheckpoint, readCrossAppCheckpointState, writeCrossAppMigrationCheckpoint } from '../_shared/proFormCrossAppMigrationCheckpoint/entry.ts';
import { calculateMigrationBundleHash, verifyMigrationBundle } from '../_shared/proFormMigrationBundle/entry.ts';
import { getProFormMigrationRuntimePolicy } from '../_shared/proFormMigrationPolicy/entry.ts';
import { importMigrationBatch } from '../_shared/proFormCrossAppMigrationService/entry.ts';
import {
  assertMigrationDirectionAvailable,
  findActiveMigrationDirectionLease,
} from '../_shared/proFormMigrationLease/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.IMPORT_CROSS_APP_MIGRATION,
  maxBytes: 2 * 1024 * 1024,
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, payload }) => {
    const config = getCrossAppMigrationConfig((name) => Deno.env.get(name));
    const bundle = await verifyMigrationBundle(payload.bundle, {
      secret: config.secret,
      maxBundleBytes: config.maxBundleBytes,
      expectedDestinationAppId: config.localAppId,
      clockSkewSeconds: config.clockSkewSeconds,
    });
    const bundleHash = await calculateMigrationBundleHash(bundle);
    const claims = await verifyCrossAppMigrationAuthorization(payload.migrationAuthorization, {
      scope: 'import',
      sourceAppId: bundle.sourceAppId,
      destinationAppId: bundle.destinationAppId,
      migrationDirection: bundle.migrationDirection,
      entityName: bundle.entityName,
      batchId: bundle.batchId,
      bundleHash,
    }, { secret: config.secret, clockSkewSeconds: config.clockSkewSeconds });
    assertCrossAppMigrationRoute(config, {
      operation: 'destination',
      sourceAppId: String(bundle.sourceAppId),
      destinationAppId: config.localAppId,
      direction: String(bundle.migrationDirection),
      sourceEnvironment: String(claims.sourceEnvironment),
      destinationEnvironment: String(claims.destinationEnvironment),
    });
    const entities = client.asServiceRole?.entities as Record<string, Record<string, unknown>>;
    const checkpointEntity = entities.ProFormMigrationCheckpoint;
    const activeLease = await findActiveMigrationDirectionLease(
      checkpointEntity, String(bundle.sourceAppId), config.localAppId,
    );
    if (!activeLease) throw new Error('MIGRATION_DIRECTION_LEASE_REQUIRED');
    assertMigrationDirectionAvailable(activeLease, String(bundle.migrationDirection));
    if (activeLease && (activeLease.lease_id !== payload.leaseId
      || activeLease.lease_owner !== payload.leaseOwner)) {
      throw new Error('MIGRATION_DIRECTION_LEASE_OWNER_MISMATCH');
    }
    const identity = {
      environment: config.environment,
      batchId: String(bundle.batchId),
      migrationDirection: String(bundle.migrationDirection),
      migrationVersion: Number(bundle.migrationVersion),
      entityName: String(bundle.entityName),
    };
    const checkpoint = await getCrossAppMigrationCheckpoint(checkpointEntity, identity);
    const state = readCrossAppCheckpointState(checkpoint);
    if (state.sequence === bundle.sequence && state.lastBundleHash === bundleHash) {
      return { dryRun: payload.apply !== true, replayed: true, counts: { created: 0, updated: 0, unchanged: bundle.recordCount, conflicted: 0, failed: 0 } };
    }
    await verifyMigrationBundle(bundle, {
      secret: config.secret,
      maxBundleBytes: config.maxBundleBytes,
      expectedSourceAppId: String(bundle.sourceAppId),
      expectedDestinationAppId: config.localAppId,
      expectedDirection: String(bundle.migrationDirection),
      expectedEntityName: String(bundle.entityName),
      expectedSequence: state.sequence + 1,
      expectedPreviousBundleHash: state.lastBundleHash,
      clockSkewSeconds: config.clockSkewSeconds,
    });
    const policy = getProFormMigrationRuntimePolicy(bundle.entityName);
    if (policy.dependencyOrder < state.dependencyOrder) throw new Error('MIGRATION_DEPENDENCY_ORDER_INVALID');
    const result = await importMigrationBatch(entities, bundle, {
      apply: payload.apply === true,
      destinationAppId: config.localAppId,
      destinationEnvironment: config.environment,
      migrationDirection: String(bundle.migrationDirection),
      migrationVersion: Number(bundle.migrationVersion),
      batchId: String(bundle.batchId),
      testRunId: payload.testRunId as string | undefined,
    });
    if (payload.apply === true) {
      const changedCount = result.counts.created + result.counts.updated
        + result.counts.conflicted + result.counts.failed;
      const quietPassCount = changedCount === 0 ? state.quietPassCount + 1 : 0;
      const highWater = bundle.highWater && typeof bundle.highWater === 'object'
        ? { ...(bundle.highWater as Record<string, unknown>), quietPassCount } : null;
      await writeCrossAppMigrationCheckpoint(checkpointEntity, checkpoint, {
        ...identity,
        mode: 'apply',
        operationMode: payload.operationMode ?? 'initial_full',
        sourceAppId: bundle.sourceAppId,
        destinationAppId: config.localAppId,
        activeDirection: activeLease?.active_direction,
        leaseId: activeLease?.lease_id,
        leaseOwner: activeLease?.lease_owner,
        leaseAcquiredAt: activeLease?.lease_acquired_at,
        leaseExpiresAt: activeLease?.lease_expires_at,
        leaseHeartbeatAt: activeLease?.lease_heartbeat_at,
        entityName: bundle.entityName,
        status: result.counts.failed > 0 ? 'failed' : 'running',
        phase: 'import',
        recordsScanned: bundle.recordCount,
        recordsUpdated: result.counts.created + result.counts.updated,
        recordsSkipped: result.counts.unchanged,
        recordsFailed: result.counts.failed,
        sequence: bundle.sequence,
        lastBundleHash: bundleHash,
        highWater,
        snapshotCutoff: highWater?.snapshotCutoff ?? bundle.snapshotCutoff,
        lastLogicalUpdatedAt: highWater?.lastLogicalUpdatedAt,
        lastSourceRecordId: highWater?.lastSourceRecordId,
        overlapStartedAt: highWater?.overlapStartedAt,
        pageOffset: highWater?.pageOffset,
        passNumber: highWater?.passNumber,
        sourceCountObserved: highWater?.sourceCountObserved,
        quietPassCount,
        dependencyOrder: policy.dependencyOrder,
        counts: result.counts,
        testRunId: payload.testRunId,
      });
    }
    return { ...result, bundleHash };
  },
}));
