import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { verifyCrossAppMigrationAuthorization } from '../_shared/proFormCrossAppMigrationAuth/entry.ts';
import { assertCrossAppMigrationRoute, getCrossAppMigrationConfig } from '../_shared/proFormCrossAppMigrationConfig/entry.ts';
import { getCrossAppMigrationCheckpoint, writeCrossAppMigrationCheckpoint } from '../_shared/proFormCrossAppMigrationCheckpoint/entry.ts';
import {
  buildForcedMigrationLeaseRelease,
  buildMigrationDirectionLease,
  findActiveMigrationDirectionLease,
} from '../_shared/proFormMigrationLease/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.MANAGE_CROSS_APP_MIGRATION_LEASE,
  maxBytes: 64 * 1024,
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, payload, authorization }) => {
    const config = getCrossAppMigrationConfig((name) => Deno.env.get(name));
    const sourceAppId = String(payload.sourceAppId);
    const destinationAppId = String(payload.destinationAppId);
    const claims = await verifyCrossAppMigrationAuthorization(payload.migrationAuthorization, {
      scope: 'status', sourceAppId, destinationAppId,
      migrationDirection: payload.migrationDirection, entityName: 'all', batchId: payload.batchId,
    }, { secret: config.secret, clockSkewSeconds: config.clockSkewSeconds });
    const operation = config.localAppId === sourceAppId ? 'source' : 'destination';
    assertCrossAppMigrationRoute(config, {
      operation, sourceAppId, destinationAppId,
      direction: String(payload.migrationDirection),
      sourceEnvironment: String(claims.sourceEnvironment),
      destinationEnvironment: String(claims.destinationEnvironment),
    });
    const checkpointEntity = client.asServiceRole?.entities
      ?.ProFormMigrationCheckpoint as Record<string, unknown>;
    const currentLease = await findActiveMigrationDirectionLease(
      checkpointEntity, sourceAppId, destinationAppId,
    );
    if (payload.action === 'force_release') {
      if (!currentLease) return { released: false, alreadyExpired: true };
      const patch = await buildForcedMigrationLeaseRelease({
        lease: currentLease,
        adminGrantVerified: true,
        reason: String(payload.reason ?? ''),
        releasedBy: authorization.actorHash,
      });
      await (checkpointEntity.update as Function)(currentLease.id, patch);
      return { released: true, containsGrant: false };
    }
    if (payload.action !== undefined && payload.action !== 'acquire') {
      throw new Error('MIGRATION_DIRECTION_LEASE_ACTION_INVALID');
    }
    const lease = await buildMigrationDirectionLease({
      currentLease,
      direction: String(payload.migrationDirection),
      leaseId: String(payload.leaseId),
      leaseOwner: String(payload.leaseOwner),
      sourceAppId,
      destinationAppId,
      operationMode: String(payload.operationMode ?? 'initial_full'),
      ttlSeconds: config.directionLeaseSeconds,
    });
    const identity = { environment: config.environment, batchId: String(payload.batchId),
      migrationDirection: String(payload.migrationDirection),
      migrationVersion: Number(payload.migrationVersion ?? 1), entityName: '__lease__' };
    const checkpoint = await getCrossAppMigrationCheckpoint(checkpointEntity, identity);
    await writeCrossAppMigrationCheckpoint(checkpointEntity, checkpoint, {
      ...identity, mode: 'dry_run', entityName: '__lease__', phase: 'direction_lease', status: 'running',
      operationMode: payload.operationMode ?? 'initial_full', sourceAppId, destinationAppId,
      activeDirection: lease.active_direction, leaseId: lease.lease_id,
      leaseOwner: lease.lease_owner, leaseAcquiredAt: lease.lease_acquired_at,
      leaseExpiresAt: lease.lease_expires_at, leaseHeartbeatAt: lease.lease_heartbeat_at,
      appPairKey: lease.app_pair_key,
    });
    const verifiedLease = await findActiveMigrationDirectionLease(
      checkpointEntity, sourceAppId, destinationAppId,
    );
    if (!verifiedLease || verifiedLease.lease_id !== lease.lease_id
      || verifiedLease.active_direction !== lease.active_direction) {
      throw new Error('MIGRATION_DIRECTION_LEASE_VERIFICATION_FAILED');
    }
    return { acquired: true, direction: lease.active_direction,
      expiresAt: lease.lease_expires_at, containsGrant: false };
  },
}));
