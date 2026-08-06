import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  calculateMigrationBundleHash,
  createMigrationBundle,
  getSafeMigrationBundleDiagnostics,
  signMigrationBundle,
  validateMigrationBundle,
  verifyMigrationBundle,
} from '../../base44/functions/_shared/proFormMigrationBundle/entry.ts';

const SECRET = 'migration-bundle-test-secret-value-1234567890';
const now = Date.parse('2026-08-06T12:00:00.000Z');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const envelope = {
  sourceAppId: 'app-blue-test', sourceEntity: 'ProFormDraft', sourceRecordId: 'draft-1',
  sourceCreatedDate: '2026-01-01T00:00:00.000Z', sourceUpdatedDate: '2026-01-02T00:00:00.000Z',
  originAppId: 'app-blue-test', originEntity: 'ProFormDraft', originRecordId: 'draft-1',
  originCreatedAt: '2026-01-01T00:00:00.000Z', originUpdatedAt: '2026-01-02T00:00:00.000Z',
  sourceContentHash: 'a'.repeat(64), data: { session_id: 'synthetic-session', responses_json: '{"q":"synthetic"}' },
};
const input = (patch = {}) => ({
  migrationVersion: 1, migrationDirection: 'blue_to_green', sourceAppId: 'app-blue-test',
  sourceAppFingerprint: hash('app-blue-test'), destinationAppId: 'app-green-test',
  destinationAppFingerprint: hash('app-green-test'), sourceEnvironment: 'production',
  destinationEnvironment: 'production', entityName: 'ProFormDraft', batchId: 'batch-1',
  sequence: 0, snapshotCutoff: '2026-08-06T11:59:00.000Z', exportedAt: '2026-08-06T11:59:30.000Z',
  previousBundleHash: null, records: [envelope], ...patch,
});
const signed = async (patch = {}, options = {}) => signMigrationBundle(
  await createMigrationBundle(input(patch), options), { secret: SECRET, ...options },
);

describe('signed Pro Form migration bundles', () => {
  it('creates a dependency-specific bundle with record count and content hash', async () => {
    const bundle = await signed();
    expect(bundle).toMatchObject({ bundleVersion: 1, entityName: 'ProFormDraft', recordCount: 1 });
    expect(bundle.bundleContentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('signs and verifies all non-signature fields', async () => {
    await expect(verifyMigrationBundle(await signed(), {
      secret: SECRET, expectedSourceAppId: 'app-blue-test', expectedDestinationAppId: 'app-green-test',
      clock: () => now,
    })).resolves.toMatchObject({ recordCount: 1 });
  });

  it('rejects tampering with protected data', async () => {
    const bundle = await signed();
    bundle.records[0].data.responses_json = '{"q":"tampered"}';
    await expect(verifyMigrationBundle(bundle, { secret: SECRET, clock: () => now }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_CONTENT_HASH_MISMATCH' });
  });

  it('rejects the wrong destination and wrong source', async () => {
    const bundle = await signed();
    await expect(verifyMigrationBundle(bundle, { secret: SECRET, expectedDestinationAppId: 'other', clock: () => now }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_ROUTE_MISMATCH' });
    await expect(verifyMigrationBundle(bundle, { secret: SECRET, expectedSourceAppId: 'other', clock: () => now }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_ROUTE_MISMATCH' });
  });

  it('rejects same-app routes', async () => {
    await expect(createMigrationBundle(input({ destinationAppId: 'app-blue-test' })))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_SAME_APP_REJECTED' });
  });

  it('enforces sequence and previous-hash chaining', async () => {
    const first = await signed();
    const hash = await calculateMigrationBundleHash(first);
    const second = await signed({ sequence: 1, previousBundleHash: hash });
    await expect(verifyMigrationBundle(second, {
      secret: SECRET, expectedSequence: 1, expectedPreviousBundleHash: hash, clock: () => now,
    })).resolves.toMatchObject({ sequence: 1 });
    await expect(verifyMigrationBundle(second, {
      secret: SECRET, expectedSequence: 0, clock: () => now,
    })).rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_SEQUENCE_INVALID' });
  });

  it('enforces bundle byte limits before transfer', async () => {
    await expect(signed({}, { maxBundleBytes: 512 }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_TOO_LARGE' });
  });

  it('rejects record-count and content-hash inconsistencies', async () => {
    const bundle = await signed();
    await expect(validateMigrationBundle({ ...bundle, recordCount: 2 }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_RECORD_COUNT_MISMATCH' });
    await expect(validateMigrationBundle({ ...bundle, bundleContentHash: 'd'.repeat(64) }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_CONTENT_HASH_MISMATCH' });
  });

  it('returns diagnostics without records or sensitive content', async () => {
    const diagnostics = getSafeMigrationBundleDiagnostics(await signed());
    expect(diagnostics).toMatchObject({ recordCount: 1, containsRecords: false, signed: true });
    expect(JSON.stringify(diagnostics)).not.toContain('synthetic-session');
  });
});
