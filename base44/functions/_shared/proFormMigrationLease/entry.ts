import { sha256Hex } from '../proDraftSecurity/entry.ts';
import { assertMigrationOperationMode } from '../proFormMigrationDelta/entry.ts';

export const MIGRATION_LEASE_ERROR_CODES = Object.freeze({
  ACTIVE: 'MIGRATION_DIRECTION_LEASE_ACTIVE',
  OPPOSITE_DIRECTION: 'MIGRATION_OPPOSITE_DIRECTION_REJECTED',
  OWNER_MISMATCH: 'MIGRATION_DIRECTION_LEASE_OWNER_MISMATCH',
  FORCE_GRANT_REQUIRED: 'MIGRATION_DIRECTION_LEASE_FORCE_GRANT_REQUIRED',
  FORCE_REASON_REQUIRED: 'MIGRATION_DIRECTION_LEASE_FORCE_REASON_REQUIRED',
});

const fail = (code: string): never => { throw new Error(code); };
const validTime = (value: unknown): value is string => typeof value === 'string'
  && Number.isFinite(Date.parse(value));

export async function getMigrationAppPairKey(firstAppId: string, secondAppId: string) {
  return `pair_${(await sha256Hex([firstAppId, secondAppId].sort().join(':'))).slice(0, 48)}`;
}

export async function findActiveMigrationDirectionLease(
  checkpointEntity: Record<string, unknown>,
  sourceAppId: string,
  destinationAppId: string,
  now = new Date().toISOString(),
) {
  const rows = await (checkpointEntity.filter as Function)({
    migration_name: 'pro-form-cross-app',
    app_pair_key: await getMigrationAppPairKey(sourceAppId, destinationAppId),
  }, '-lease_expires_at', 10, 0);
  if (!Array.isArray(rows)) return fail('MIGRATION_DIRECTION_LEASE_RESULT_INVALID');
  const active = rows.filter((row) => isMigrationDirectionLeaseActive(row, now));
  if (active.length > 1) return fail('MIGRATION_DIRECTION_LEASE_COLLISION');
  return active[0] ?? null;
}

export function isMigrationDirectionLeaseActive(
  lease: Record<string, unknown> | null,
  now = new Date().toISOString(),
) {
  return Boolean(lease && validTime(lease.lease_expires_at)
    && Date.parse(lease.lease_expires_at) > Date.parse(now));
}

export async function buildMigrationDirectionLease(input: {
  currentLease?: Record<string, unknown> | null;
  direction: string;
  leaseId: string;
  leaseOwner: string;
  sourceAppId: string;
  destinationAppId: string;
  operationMode: string;
  now?: string;
  ttlSeconds?: number;
}) {
  const now = input.now ?? new Date().toISOString();
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!validTime(now) || !Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 1800) {
    return fail('MIGRATION_DIRECTION_LEASE_INVALID');
  }
  const safeIdentity = /^[A-Za-z0-9._:-]{1,256}$/u;
  if (!['blue_to_green', 'green_to_blue'].includes(input.direction)
    || !safeIdentity.test(input.leaseId) || !safeIdentity.test(input.leaseOwner)
    || !safeIdentity.test(input.sourceAppId) || !safeIdentity.test(input.destinationAppId)
    || input.sourceAppId === input.destinationAppId) {
    return fail('MIGRATION_DIRECTION_LEASE_INVALID');
  }
  assertMigrationOperationMode(input.operationMode);
  if (isMigrationDirectionLeaseActive(input.currentLease ?? null, now)) {
    if (input.currentLease?.active_direction !== input.direction) {
      return fail(MIGRATION_LEASE_ERROR_CODES.OPPOSITE_DIRECTION);
    }
    if (input.currentLease?.lease_id !== input.leaseId
      || input.currentLease?.lease_owner !== input.leaseOwner
      || input.currentLease?.operation_mode !== input.operationMode) {
      return fail(MIGRATION_LEASE_ERROR_CODES.ACTIVE);
    }
  }
  return Object.freeze({
    active_direction: input.direction,
    lease_id: input.leaseId,
    lease_owner: input.leaseOwner,
    lease_acquired_at: input.currentLease?.lease_acquired_at ?? now,
    lease_expires_at: new Date(Date.parse(now) + ttlSeconds * 1000).toISOString(),
    lease_heartbeat_at: now,
    source_app_id: input.sourceAppId,
    destination_app_id: input.destinationAppId,
    app_pair_key: await getMigrationAppPairKey(input.sourceAppId, input.destinationAppId),
    operation_mode: input.operationMode,
  });
}

export async function buildForcedMigrationLeaseRelease(input: {
  lease: Record<string, unknown>;
  adminGrantVerified: boolean;
  reason: string;
  releasedBy: string;
  now?: string;
}) {
  if (input.adminGrantVerified !== true) return fail(MIGRATION_LEASE_ERROR_CODES.FORCE_GRANT_REQUIRED);
  if (!/^[A-Za-z0-9 ._:-]{8,256}$/u.test(input.reason)) {
    return fail(MIGRATION_LEASE_ERROR_CODES.FORCE_REASON_REQUIRED);
  }
  const now = input.now ?? new Date().toISOString();
  return Object.freeze({
    active_direction: null,
    lease_expires_at: now,
    lease_heartbeat_at: now,
    force_release_audit_json: JSON.stringify({
      version: 1,
      leaseFingerprint: await sha256Hex(String(input.lease.lease_id ?? '')),
      releasedByFingerprint: await sha256Hex(input.releasedBy),
      reason: input.reason,
      releasedAt: now,
      authorizationVerified: true,
    }),
  });
}

export function assertMigrationDirectionAvailable(
  lease: Record<string, unknown> | null,
  direction: string,
  now?: string,
) {
  if (isMigrationDirectionLeaseActive(lease, now)
    && lease?.active_direction !== direction) {
    return fail(MIGRATION_LEASE_ERROR_CODES.OPPOSITE_DIRECTION);
  }
  return true;
}
