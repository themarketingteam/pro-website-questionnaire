import { describe, expect, it } from 'vitest';

import {
  advanceMigrationHighWaterCheckpoint,
  createMigrationHighWaterCheckpoint,
  detectLateWriteCandidates,
  detectMigrationAdapterCapabilities,
  getLateWritePollingState,
  isFinalFreezeDeltaComplete,
  hasMigrationPaginationShift,
  selectMigrationDeltaRecords,
} from '../../base44/functions/_shared/proFormMigrationDelta/entry.ts';
import {
  MIGRATION_LEASE_ERROR_CODES,
  assertMigrationDirectionAvailable,
  buildForcedMigrationLeaseRelease,
  buildMigrationDirectionLease,
  getMigrationAppPairKey,
  isMigrationDirectionLeaseActive,
} from '../../base44/functions/_shared/proFormMigrationLease/entry.ts';
import {
  resolveProFormMigrationConflict,
  safeProFormMigrationConflict,
} from '../../base44/functions/_shared/proFormMigrationConflict/entry.ts';
import {
  buildProFormFileReferenceAuditRecord,
  classifyProFormFileReference,
  collectProFormFileReferences,
  redactProFormFileReference,
  summarizeProFormFileReferenceAudit,
} from '../lib/proFormMigrationFileReferences.js';
import {
  PRO_FORM_MIGRATION_VERIFICATION_DIMENSIONS,
  buildProFormMigrationVerificationReport,
  compareProFormMigrationInventories,
} from '../../base44/functions/_shared/proFormMigrationVerification/entry.ts';
import {
  REVERSE_APPLY_CONFIRMATION,
  parseMigrationCliArguments,
  sanitizeMigrationReport,
} from '../../scripts/pro-form-blue-green-migration.mjs';
import { buildMigrationExportRecord } from '../../base44/functions/_shared/proFormMigrationExport/entry.ts';
import { upsertMigratedRecord } from '../../base44/functions/_shared/proFormMigrationImport/entry.ts';
import { getProFormMigrationRuntimePolicy } from '../../base44/functions/_shared/proFormMigrationPolicy/entry.ts';

class MemoryEntity {
  constructor(rows = []) { this.rows = rows.map((row) => ({ ...row })); this.next = 1; }
  async filter(query, _sort, limit = 5000, skip = 0) { return this.rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)).slice(skip, skip + limit); }
  async get(id) { return this.rows.find((row) => row.id === id); }
  async create(data) { const row = { id: `created-${this.next++}`, created_date: '2026-08-06T12:00:00Z', updated_date: '2026-08-06T12:00:00Z', ...data }; this.rows.push(row); return row; }
  async update(id, patch) { const row = await this.get(id); Object.assign(row, patch); return row; }
}

const leaseInput = (patch = {}) => ({
  direction: 'blue_to_green', leaseId: 'lease-1', leaseOwner: 'runner-1',
  sourceAppId: 'blue', destinationAppId: 'green', operationMode: 'incremental_delta',
  now: '2026-08-06T12:00:00.000Z', ttlSeconds: 300, ...patch,
});

describe('migration direction lease', () => {
  it('acquires a bounded direction lease', async () => {
    const lease = await buildMigrationDirectionLease(leaseInput());
    expect(lease).toMatchObject({ active_direction: 'blue_to_green', lease_id: 'lease-1' });
    expect(lease.lease_expires_at).toBe('2026-08-06T12:05:00.000Z');
  });
  it('heartbeats the same owner without replacing acquisition time', async () => {
    const first = await buildMigrationDirectionLease(leaseInput());
    const next = await buildMigrationDirectionLease(leaseInput({ currentLease: first, now: '2026-08-06T12:01:00.000Z' }));
    expect(next.lease_acquired_at).toBe(first.lease_acquired_at);
    expect(next.lease_heartbeat_at).toBe('2026-08-06T12:01:00.000Z');
  });
  it('rejects an active opposite direction', async () => {
    const first = await buildMigrationDirectionLease(leaseInput());
    await expect(buildMigrationDirectionLease(leaseInput({ currentLease: first,
      direction: 'green_to_blue', leaseId: 'lease-2' })))
      .rejects.toThrow(MIGRATION_LEASE_ERROR_CODES.OPPOSITE_DIRECTION);
  });
  it('allows a new direction after stale expiry', async () => {
    const first = await buildMigrationDirectionLease(leaseInput());
    const reverse = await buildMigrationDirectionLease(leaseInput({ currentLease: first,
      direction: 'green_to_blue', leaseId: 'lease-2', now: '2026-08-06T12:06:00.000Z' }));
    expect(reverse.active_direction).toBe('green_to_blue');
  });
  it('requires verified admin grant and a bounded reason for force release', async () => {
    const lease = await buildMigrationDirectionLease(leaseInput());
    await expect(buildForcedMigrationLeaseRelease({ lease, adminGrantVerified: false,
      reason: 'incident rollback', releasedBy: 'admin' }))
      .rejects.toThrow(MIGRATION_LEASE_ERROR_CODES.FORCE_GRANT_REQUIRED);
    const released = await buildForcedMigrationLeaseRelease({ lease, adminGrantVerified: true,
      reason: 'incident rollback', releasedBy: 'admin', now: '2026-08-06T12:02:00.000Z' });
    expect(released.force_release_audit_json).not.toContain('adminGrant');
  });
  it('uses a direction-independent pair key and availability check', async () => {
    expect(await getMigrationAppPairKey('blue', 'green')).toBe(await getMigrationAppPairKey('green', 'blue'));
    const lease = await buildMigrationDirectionLease(leaseInput());
    expect(isMigrationDirectionLeaseActive(lease, '2026-08-06T12:01:00.000Z')).toBe(true);
    expect(() => assertMigrationDirectionAvailable(lease, 'green_to_blue', '2026-08-06T12:01:00.000Z'))
      .toThrow(MIGRATION_LEASE_ERROR_CODES.OPPOSITE_DIRECTION);
  });
});

describe('incremental checkpoint, overlap, and late writes', () => {
  const checkpoint = () => createMigrationHighWaterCheckpoint({ entityName: 'ProFormDraft',
    snapshotCutoff: '2026-08-06T12:10:00.000Z', lastLogicalUpdatedAt: '2026-08-06T12:05:00.000Z',
    lastSourceRecordId: 'draft-1', overlapSeconds: 300 });
  it('starts the default five-minute overlap from source updated_date', () => {
    expect(checkpoint().overlapStartedAt).toBe('2026-08-06T12:00:00.000Z');
  });
  it('creates an initial per-entity checkpoint without inventing a high-water tuple', () => {
    const initial = createMigrationHighWaterCheckpoint({ entityName: 'ProFormDraft',
      snapshotCutoff: '2026-08-06T12:10:00Z' });
    expect(initial).toMatchObject({ lastLogicalUpdatedAt: null, lastSourceRecordId: null,
      pageOffset: 0, passNumber: 1 });
  });
  it('sorts equal timestamps with source ID as tie breaker', () => {
    const selected = selectMigrationDeltaRecords([
      { id: 'b', updated_date: '2026-08-06T12:06:00Z' },
      { id: 'a', updated_date: '2026-08-06T12:06:00Z' },
    ], checkpoint());
    expect(selected.map((row) => row.id)).toEqual(['a', 'b']);
  });
  it('deduplicates source IDs within an overlap pass', () => {
    const selected = selectMigrationDeltaRecords([
      { id: 'a', updated_date: '2026-08-06T12:06:00Z' },
      { id: 'a', updated_date: '2026-08-06T12:07:00Z' },
    ], checkpoint());
    expect(selected).toHaveLength(1);
  });
  it('fails closed to overlap fallback unless adapter capability is explicit', () => {
    expect(detectMigrationAdapterCapabilities({})).toEqual({ updatedDateSort: false, updatedDateRange: false });
    expect(detectMigrationAdapterCapabilities({ migrationCapabilities: { updatedDateSort: true } }).updatedDateSort).toBe(true);
  });
  it('detects a source-count pagination shift for a repeated overlap pass', () => {
    expect(hasMigrationPaginationShift({ ...checkpoint(), sourceCountObserved: 5 }, 6)).toBe(true);
  });
  it('excludes rows beyond the preserved snapshot cutoff', () => {
    expect(selectMigrationDeltaRecords([
      { id: 'late', updated_date: '2026-08-06T12:11:00Z' },
    ], checkpoint())).toHaveLength(0);
  });
  it('advances a high-water tuple and resets quiet count on change', () => {
    const advanced = advanceMigrationHighWaterCheckpoint({ ...checkpoint(), quietPassCount: 1 }, [
      { id: 'b', updated_date: '2026-08-06T12:07:00Z' },
    ], { sourceCountObserved: 9, changedCount: 1 });
    expect(advanced).toMatchObject({ lastSourceRecordId: 'b', sourceCountObserved: 9, quietPassCount: 0 });
  });
  it('requires two zero-change final-freeze passes', () => {
    const once = advanceMigrationHighWaterCheckpoint(checkpoint(), [], { changedCount: 0 });
    const twice = advanceMigrationHighWaterCheckpoint(once, [], { changedCount: 0 });
    expect(isFinalFreezeDeltaComplete([once])).toBe(false);
    expect(isFinalFreezeDeltaComplete([twice])).toBe(true);
  });
  it('detects post-freeze writes whose destination fingerprint differs', () => {
    const records = [{ id: 'd1', updated_date: '2026-08-06T12:01:00Z', source_content_hash: 'new' }];
    expect(detectLateWriteCandidates(records, { d1: { destinationContentHash: 'old' } }, {
      freezeStartedAt: '2026-08-06T12:00:00Z', domainSwitchedAt: '2026-08-06T12:00:30Z',
    })).toHaveLength(1);
  });
  it('requires two complete quiet polling windows', () => {
    const first = getLateWritePollingState({ now: '2026-08-06T12:06:00Z',
      lastChangeAt: '2026-08-06T12:00:00Z', changedCount: 0, quietPassCount: 0 });
    const second = getLateWritePollingState({ now: '2026-08-06T12:07:00Z',
      lastChangeAt: '2026-08-06T12:00:00Z', changedCount: 0, quietPassCount: first.quietPassCount });
    expect(first.complete).toBe(false); expect(second.complete).toBe(true);
  });
});

describe('conflict and reverse safety policy', () => {
  it('treats equal hashes as a no-op', () => {
    expect(resolveProFormMigrationConflict({ sourceHash: 'same', destinationHash: 'same' }).policy).toBe('noop');
  });
  it('applies a newer source only when destination remains at base', () => {
    expect(resolveProFormMigrationConflict({ sourceHash: 'new', destinationHash: 'base', baseHash: 'base',
      sourceUpdatedAt: '2026-08-06T12:02:00Z', destinationUpdatedAt: '2026-08-06T12:01:00Z' }))
      .toMatchObject({ applySource: true, policy: 'apply_newer_source' });
  });
  it('never automatically merges dual modifications', () => {
    expect(resolveProFormMigrationConflict({ sourceHash: 'a', destinationHash: 'b', baseHash: 'c' }))
      .toMatchObject({ manual: true, policy: 'manual_no_merge' });
  });
  it('requires manual handling for submitted-state mismatch', () => {
    expect(resolveProFormMigrationConflict({ sourceStatus: 'submitted', destinationStatus: 'draft' }))
      .toMatchObject({ manual: true, conflictType: 'submitted_state_mismatch' });
  });
  it('rejects status regression', () => {
    expect(resolveProFormMigrationConflict({ sourceStatus: 'draft', destinationStatus: 'submitted' }))
      .toMatchObject({ policy: 'reject_status_regression' });
  });
  it('defers missing relationship targets', () => {
    expect(resolveProFormMigrationConflict({ relationshipResolved: false }))
      .toMatchObject({ policy: 'defer_relationship', manual: false });
  });
  it('quarantines destination-native collisions', () => {
    expect(resolveProFormMigrationConflict({ destinationNative: true }))
      .toMatchObject({ policy: 'manual_destination_native' });
  });
  it('keeps conflict records free of answer payloads and hashes', () => {
    expect(safeProFormMigrationConflict({ conflictType: 'source_and_destination_modified',
      entityName: 'ProFormDraft', answers: 'private', sourceHash: 'hash' }))
      .toEqual({ conflictType: 'source_and_destination_modified', entityName: 'ProFormDraft' });
  });

  it('updates the original blue record through origin identity on reverse', async () => {
    const policy = getProFormMigrationRuntimePolicy('ProFormSubmission');
    const blueRecord = { id: 'blue-1', created_date: '2026-01-01T00:00:00Z',
      updated_date: '2026-01-02T00:00:00Z', metadata: {}, userdata: { answer: 'first' } };
    const firstEnvelope = await buildMigrationExportRecord(blueRecord, policy, {
      sourceAppId: 'blue', sourceEnvironment: 'production', destinationEnvironment: 'production' });
    const greenStore = { ProFormSubmission: new MemoryEntity(), ProFormMigrationIdMap: new MemoryEntity() };
    await upsertMigratedRecord(greenStore, firstEnvelope, policy, { apply: true,
      destinationAppId: 'green', destinationEnvironment: 'production', migrationDirection: 'blue_to_green',
      migrationVersion: 1, batchId: 'forward' });
    greenStore.ProFormSubmission.rows[0].userdata = { answer: 'green-new' };
    greenStore.ProFormSubmission.rows[0].updated_date = '2026-08-06T12:10:00Z';
    const reverseEnvelope = await buildMigrationExportRecord(greenStore.ProFormSubmission.rows[0], policy, {
      sourceAppId: 'green', sourceEnvironment: 'production', destinationEnvironment: 'production' });
    const blueStore = { ProFormSubmission: new MemoryEntity([blueRecord]), ProFormMigrationIdMap: new MemoryEntity() };
    const result = await upsertMigratedRecord(blueStore, reverseEnvelope, policy, { apply: true,
      destinationAppId: 'blue', destinationEnvironment: 'production', migrationDirection: 'green_to_blue',
      migrationVersion: 1, batchId: 'reverse' });
    expect(result.outcome).toBe('updated');
    expect(blueStore.ProFormSubmission.rows[0].userdata.answer).toBe('green-new');
    expect(blueStore.ProFormSubmission.rows).toHaveLength(1);
  });

  it('creates a single blue record for a green-native origin', async () => {
    const policy = getProFormMigrationRuntimePolicy('ProFormSubmission');
    const envelope = await buildMigrationExportRecord({ id: 'green-native',
      created_date: '2026-08-06T12:00:00Z', updated_date: '2026-08-06T12:01:00Z',
      metadata: {}, userdata: { answer: 'native' } }, policy, {
      sourceAppId: 'green', sourceEnvironment: 'production', destinationEnvironment: 'production' });
    const store = { ProFormSubmission: new MemoryEntity(), ProFormMigrationIdMap: new MemoryEntity() };
    await upsertMigratedRecord(store, envelope, policy, { apply: true, destinationAppId: 'blue',
      destinationEnvironment: 'production', migrationDirection: 'green_to_blue', migrationVersion: 1,
      batchId: 'reverse' });
    await expect(upsertMigratedRecord(store, envelope, policy, { apply: true, destinationAppId: 'blue',
      destinationEnvironment: 'production', migrationDirection: 'green_to_blue', migrationVersion: 1,
      batchId: 'reverse' })).resolves.toMatchObject({ outcome: 'unchanged' });
    expect(store.ProFormSubmission.rows).toHaveLength(1);
  });

  it('conflicts when original blue changed after the forward copy', async () => {
    const policy = getProFormMigrationRuntimePolicy('ProFormSubmission');
    const original = { id: 'blue-1', created_date: '2026-01-01T00:00:00Z',
      updated_date: '2026-01-02T00:00:00Z', metadata: {}, userdata: { answer: 'first' } };
    const firstEnvelope = await buildMigrationExportRecord(original, policy, {
      sourceAppId: 'blue', sourceEnvironment: 'production', destinationEnvironment: 'production' });
    const greenStore = { ProFormSubmission: new MemoryEntity(), ProFormMigrationIdMap: new MemoryEntity() };
    await upsertMigratedRecord(greenStore, firstEnvelope, policy, { apply: true,
      destinationAppId: 'green', destinationEnvironment: 'production', migrationDirection: 'blue_to_green',
      migrationVersion: 1, batchId: 'forward' });
    greenStore.ProFormSubmission.rows[0].userdata = { answer: 'green-change' };
    const reverse = await buildMigrationExportRecord(greenStore.ProFormSubmission.rows[0], policy, {
      sourceAppId: 'green', sourceEnvironment: 'production', destinationEnvironment: 'production' });
    const blueChanged = { ...original, userdata: { answer: 'blue-change' } };
    const blueStore = { ProFormSubmission: new MemoryEntity([blueChanged]), ProFormMigrationIdMap: new MemoryEntity() };
    await expect(upsertMigratedRecord(blueStore, reverse, policy, { apply: true,
      destinationAppId: 'blue', destinationEnvironment: 'production', migrationDirection: 'green_to_blue',
      migrationVersion: 1, batchId: 'reverse' })).resolves.toMatchObject({
      outcome: 'conflicted', conflictType: 'source_and_destination_modified',
    });
  });
});

describe('file reference audit', () => {
  it.each([
    ['https://files.example.test/a.pdf', 'external_stable_url'],
    ['https://cdn.base44.com/public/a.pdf', 'public_base44_url'],
    ['https://cdn.base44.com/apps/x/private/a.pdf', 'app_scoped_base44_asset'],
    ['https://bucket.s3.us-east-1.amazonaws.com/a.pdf', 's3_url'],
    ['https://abc.cloudfront.net/a.pdf', 'cloudfront_url'],
    ['data:application/pdf;base64,private', 'embedded_data_url'],
    [null, 'missing'],
  ])('classifies %s as %s', (value, expected) => {
    expect(classifyProFormFileReference(value)).toBe(expected);
  });
  it('classifies signed query URLs before provider family', () => {
    expect(classifyProFormFileReference('https://bucket.s3.amazonaws.com/a?X-Amz-Signature=private'))
      .toBe('signed_or_expiring_url');
  });
  it('redacts every query and fragment', () => {
    expect(redactProFormFileReference('https://files.example/a.pdf?token=private#x'))
      .toBe('https://files.example/a.pdf');
  });
  it('collects upload/PDF fields but excludes recovery email and external links', () => {
    const found = collectProFormFileReferences({ pdf_url: 'https://x/a', recovery_email: 'x@y.test',
      external_link: 'https://example.test', nested: { guarantee_file_url: 'https://x/b' } });
    expect(found.map((item) => item.fieldPath)).toEqual(['pdf_url', 'nested.guarantee_file_url']);
  });
  it('does not probe or download by default', async () => {
    const record = await buildProFormFileReferenceAuditRecord({ entityName: 'ProFormSubmission',
      sourceRecordId: 's1', fieldPath: 'userdata.pdf_url', value: 'https://files.example/a.pdf' });
    expect(record).toMatchObject({ reachability: 'not_checked', copyRequired: false });
  });
  it('blocks cutover for signed, scoped, embedded, unknown, and missing references', async () => {
    const record = await buildProFormFileReferenceAuditRecord({ entityName: 'ProFormSubmission',
      sourceRecordId: 's1', fieldPath: 'userdata.pdf_url', value: 'data:application/pdf;base64,x' });
    expect(summarizeProFormFileReferenceAudit([record])).toMatchObject({ blockers: 1, cutoverReady: false, downloadsPerformed: 0 });
  });
  it('marks an app-scoped Base44 asset as a cutover blocker', async () => {
    const record = await buildProFormFileReferenceAuditRecord({ entityName: 'ProFormSubmission',
      sourceRecordId: 's1', fieldPath: 'userdata.upload_url',
      value: 'https://cdn.base44.com/apps/private/upload.pdf' });
    expect(record).toMatchObject({ classification: 'app_scoped_base44_asset',
      authRequired: true, manualReview: true });
  });
});

describe('integrity verdicts and CLI controls', () => {
  const completeEvidence = {
    statusDistributionMatch: true, logicalCreationRangeMatch: true,
    logicalUpdateRangeMatch: true, criticalNullDistributionMatch: true,
    submittedFinalIdErrorCount: 0, draftSessionIdErrorCount: 0,
    eventDraftErrorCount: 0, draftSubmissionErrorCount: 0,
  };
  it('defines all 18 required verification dimensions', () => {
    expect(PRO_FORM_MIGRATION_VERIFICATION_DIMENSIONS).toHaveLength(18);
  });
  it('returns PASS only for fully clean inventories', () => {
    const report = compareProFormMigrationInventories({ sourceCount: 2, destinationCount: 2,
      mappedCount: 2, hashMismatchCount: 0, relationshipErrorCount: 0, openConflictCount: 0,
      unresolvedCount: 0, contaminationCount: 0, duplicateMapCount: 0, orphanCount: 0,
      fileBlockerCount: 0, ...completeEvidence });
    expect(report).toMatchObject({ verdict: 'PASS', cutoverReady: true });
  });
  it('fails count, hash, and relationship mismatches', () => {
    const report = compareProFormMigrationInventories({ sourceCount: 2, destinationCount: 1,
      mappedCount: 1, hashMismatchCount: 1, relationshipErrorCount: 1, openConflictCount: 0,
      unresolvedCount: 0, contaminationCount: 0, duplicateMapCount: 0, orphanCount: 0,
      fileBlockerCount: 0, ...completeEvidence });
    expect(report).toMatchObject({ verdict: 'FAIL', cutoverReady: false });
  });
  it('fails test or staging contamination', () => {
    const report = compareProFormMigrationInventories({ sourceCount: 1, destinationCount: 1,
      mappedCount: 1, hashMismatchCount: 0, relationshipErrorCount: 0, openConflictCount: 0,
      unresolvedCount: 0, contaminationCount: 1, duplicateMapCount: 0, orphanCount: 0,
      fileBlockerCount: 0, ...completeEvidence });
    expect(report.checks.find((check) => check.dimension === 'test_staging_contamination'))
      .toMatchObject({ status: 'FAIL', observed: 1 });
  });
  it('returns BLOCKED when evidence is absent', () => {
    expect(buildProFormMigrationVerificationReport({ dimensions: {} }).verdict).toBe('BLOCKED');
  });
  it('supports sync, reverse, late-write, verify, and file-audit commands', () => {
    for (const command of ['sync', 'reverse', 'late-write', 'verify', 'file-audit']) {
      expect(parseMigrationCliArguments([command]).command).toBe(command);
    }
  });
  it('requires the exact reverse apply phrase', () => {
    expect(() => parseMigrationCliArguments(['reverse', '--apply', '--confirm', 'wrong'])).toThrow();
    expect(parseMigrationCliArguments(['reverse', '--apply', '--confirm', REVERSE_APPLY_CONFIRMATION]))
      .toMatchObject({ apply: true });
  });
  it('sanitizes URL query secrets in reports', () => {
    expect(sanitizeMigrationReport({ reference: 'https://x.test/a?token=private#x' }))
      .toEqual({ reference: 'https://x.test/a' });
  });
});
