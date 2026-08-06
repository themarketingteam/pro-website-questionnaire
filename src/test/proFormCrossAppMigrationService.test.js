import { describe, expect, it } from 'vitest';

import {
  bindCrossAppMigrationAuthorization,
  createCrossAppMigrationAuthorization,
  verifyCrossAppMigrationAuthorization,
} from '../../base44/functions/_shared/proFormCrossAppMigrationAuth/entry.ts';
import {
  assertCrossAppMigrationRoute,
  getCrossAppMigrationConfig,
} from '../../base44/functions/_shared/proFormCrossAppMigrationConfig/entry.ts';
import {
  finalizeMigrationRelationships,
  exportMigrationBatch,
  getMigrationStatus,
  importMigrationBatch,
} from '../../base44/functions/_shared/proFormCrossAppMigrationService/entry.ts';
import { buildMigrationExportRecord } from '../../base44/functions/_shared/proFormMigrationExport/entry.ts';
import { getProFormMigrationRuntimePolicy } from '../../base44/functions/_shared/proFormMigrationPolicy/entry.ts';

class Entity {
  constructor(rows = []) { this.rows = rows.map((row) => ({ ...row })); this.next = 1; }
  async list(_sort, limit = 5000, skip = 0) { return this.rows.slice(skip, skip + limit); }
  async filter(query, _sort, limit = 5000, skip = 0) { return this.rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)).slice(skip, skip + limit); }
  async get(id) { return this.rows.find((row) => row.id === id); }
  async create(data) { const row = { id: `id-${this.next++}`, created_date: '2026-08-06T12:00:00Z', updated_date: '2026-08-06T12:00:00Z', ...data }; this.rows.push(row); return row; }
  async update(id, patch) { const row = await this.get(id); Object.assign(row, patch); return row; }
}

const SECRET = 'cross-app-auth-test-secret-value-123456789';
const env = (patch = {}) => ({
  PRO_FORM_CROSS_APP_MIGRATION_SECRET: SECRET,
  PRO_FORM_MIGRATION_LOCAL_APP_ID: 'app-green-test',
  PRO_FORM_MIGRATION_LOCAL_APP_NAME: 'green-test',
  PRO_FORM_MIGRATION_ROLE: 'destination',
  PRO_FORM_MIGRATION_ALLOWED_SOURCE_APP_IDS: 'app-blue-test',
  PRO_FORM_MIGRATION_ALLOWED_DESTINATION_APP_IDS: 'app-green-test',
  PRO_FORM_MIGRATION_ALLOWED_DIRECTIONS: 'blue_to_green',
  PRO_DRAFT_ENVIRONMENT: 'production',
  ...patch,
});
const config = (patch) => { const values = env(patch); return getCrossAppMigrationConfig((name) => values[name]); };

describe('cross-app migration configuration and authorization', () => {
  it('uses bounded defaults and exact allowlists', () => {
    expect(config()).toMatchObject({ maxBatchRecords: 100, maxBundleBytes: 1048576, clockSkewSeconds: 60 });
  });

  it('fails closed without local app identity or secret', () => {
    expect(() => config({ PRO_FORM_MIGRATION_LOCAL_APP_ID: '' })).toThrowError(expect.objectContaining({ code: 'CROSS_APP_MIGRATION_LOCAL_APP_ID_MISSING' }));
    expect(() => config({ PRO_FORM_CROSS_APP_MIGRATION_SECRET: '' })).toThrowError(expect.objectContaining({ code: 'CROSS_APP_MIGRATION_SECRET_MISSING' }));
  });

  it('rejects same-app, wrong source, wrong role, and environment crossing', () => {
    const base = config();
    const route = { operation: 'destination', sourceAppId: 'app-blue-test', destinationAppId: 'app-green-test', direction: 'blue_to_green', sourceEnvironment: 'production', destinationEnvironment: 'production' };
    expect(() => assertCrossAppMigrationRoute(base, { ...route, sourceAppId: 'app-green-test' })).toThrowError(expect.objectContaining({ code: 'CROSS_APP_MIGRATION_SAME_APP_REJECTED' }));
    expect(() => assertCrossAppMigrationRoute(base, { ...route, sourceAppId: 'unknown' })).toThrowError(expect.objectContaining({ code: 'CROSS_APP_MIGRATION_PEER_NOT_ALLOWED' }));
    expect(() => assertCrossAppMigrationRoute(config({ PRO_FORM_MIGRATION_ROLE: 'source' }), route)).toThrowError(expect.objectContaining({ code: 'CROSS_APP_MIGRATION_ROLE_DENIED' }));
    expect(() => assertCrossAppMigrationRoute(base, { ...route, sourceEnvironment: 'staging' })).toThrowError(expect.objectContaining({ code: 'CROSS_APP_MIGRATION_ENVIRONMENT_MISMATCH' }));
  });

  it('signs migration-specific authorization and rejects claim mismatch', async () => {
    const token = await createCrossAppMigrationAuthorization({ scope: 'export', sourceAppId: 'app-blue-test', destinationAppId: 'app-green-test', migrationDirection: 'blue_to_green', sourceEnvironment: 'production', destinationEnvironment: 'production', entityName: 'ProFormDraft', batchId: 'batch-1' }, { secret: SECRET, clock: () => 1000 });
    await expect(verifyCrossAppMigrationAuthorization(token, { scope: 'export', entityName: 'ProFormDraft' }, { secret: SECRET, clock: () => 1000 })).resolves.toMatchObject({ scope: 'export' });
    await expect(verifyCrossAppMigrationAuthorization(token, { scope: 'import' }, { secret: SECRET, clock: () => 1000 })).rejects.toMatchObject({ code: 'CROSS_APP_MIGRATION_AUTH_CLAIM_MISMATCH' });
  });

  it('binds an orchestrator authorization to the exact bundle hash', async () => {
    const token = await createCrossAppMigrationAuthorization({ scope: 'orchestrate', sourceAppId: 'app-blue-test', destinationAppId: 'app-green-test', migrationDirection: 'blue_to_green', sourceEnvironment: 'production', destinationEnvironment: 'production', entityName: 'all', batchId: 'batch-1' }, { secret: SECRET, clock: () => 1000 });
    const hash = 'a'.repeat(64); const bound = await bindCrossAppMigrationAuthorization(token, hash);
    await expect(verifyCrossAppMigrationAuthorization(bound, { scope: 'import', entityName: 'ProFormDraft', bundleHash: hash }, { secret: SECRET, clock: () => 1000 })).resolves.toMatchObject({ scope: 'orchestrate' });
    await expect(verifyCrossAppMigrationAuthorization(bound, { scope: 'import', bundleHash: 'b'.repeat(64) }, { secret: SECRET, clock: () => 1000 })).rejects.toMatchObject({ code: 'CROSS_APP_MIGRATION_AUTH_CLAIM_MISMATCH' });
  });
});

const makeEntities = () => Object.fromEntries([
  'ProFormDraft', 'ProFormDraftEvent', 'ProFormSubmission', 'ProFormSubmissionIntake',
  'ProFormRecoverySecurityEvent', 'ProFormMigrationIdMap', 'ProFormMigrationConflict',
  'ProFormMigrationCheckpoint',
].map((name) => [name, new Entity()]));
const exportOptions = { sourceAppId: 'app-blue-test', sourceEnvironment: 'production', destinationEnvironment: 'production' };
const serviceOptions = { apply: true, destinationAppId: 'app-green-test', destinationEnvironment: 'production', migrationDirection: 'blue_to_green', migrationVersion: 1, batchId: 'batch-1', now: () => new Date('2026-08-06T12:00:00Z') };

describe('relationship finalization and safe status', () => {
  it('exports bounded resumable pages at a fixed snapshot cutoff', async () => {
    const entities = makeEntities();
    entities.ProFormDraft.rows.push(
      { id: 'draft-1', created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-01T00:00:00Z', session_id: 's1' },
      { id: 'draft-2', created_date: '2026-01-02T00:00:00Z', updated_date: '2026-01-02T00:00:00Z', session_id: 's2' },
    );
    const input = { entityName: 'ProFormDraft', destinationAppId: 'app-green-test', migrationDirection: 'blue_to_green', batchId: 'batch-1', sequence: 0, pageSize: 1, snapshotCutoff: '2026-08-06T00:00:00Z' };
    const options = { secret: SECRET, sourceAppId: 'app-blue-test', sourceEnvironment: 'production', destinationEnvironment: 'production', maxBatchRecords: 100, maxBundleBytes: 1048576, now: () => new Date('2026-08-06T00:00:00Z') };
    const first = await exportMigrationBatch(entities, input, options);
    const second = await exportMigrationBatch(entities, { ...input, cursor: first.nextCursor, sequence: 1 }, options);
    expect(first).toMatchObject({ hasMore: true, counts: { scanned: 1, exported: 1 } });
    expect(second).toMatchObject({ hasMore: false, counts: { scanned: 1, exported: 1 } });
    expect(first.bundle.records[0].sourceRecordId).toBe('draft-1');
    expect(second.bundle.records[0].sourceRecordId).toBe('draft-2');
  });

  it('patches a source relationship through the ID map', async () => {
    const entities = makeEntities();
    const draftPolicy = getProFormMigrationRuntimePolicy('ProFormDraft');
    const eventPolicy = getProFormMigrationRuntimePolicy('ProFormDraftEvent');
    const draft = await buildMigrationExportRecord({ id: 'source-draft', created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-01T00:00:00Z', session_id: 's' }, draftPolicy, exportOptions);
    const event = await buildMigrationExportRecord({ id: 'source-event', created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-01T00:00:00Z', session_id: 's', event_type: 'synthetic', draft_id: 'source-draft' }, eventPolicy, exportOptions);
    await importMigrationBatch(entities, { entityName: 'ProFormDraft', records: [draft] }, serviceOptions);
    await importMigrationBatch(entities, { entityName: 'ProFormDraftEvent', records: [event] }, serviceOptions);
    const result = await finalizeMigrationRelationships(entities, { sourceAppId: 'app-blue-test', migrationDirection: 'blue_to_green', batchId: 'batch-1' }, serviceOptions);
    expect(result.counts.finalized).toBeGreaterThan(0);
    expect(entities.ProFormDraftEvent.rows[0].draft_id).toBe(entities.ProFormDraft.rows[0].id);
  });

  it('reports missing relationship mappings without writing', async () => {
    const entities = makeEntities();
    entities.ProFormDraftEvent.rows.push({ id: 'event-dest', updated_date: 'x', draft_id: 'missing-source' });
    entities.ProFormMigrationIdMap.rows.push({ id: 'map-event', source_app_id: 'app-blue-test', source_entity: 'ProFormDraftEvent', source_record_id: 'event-source', destination_app_id: 'app-green-test', destination_entity: 'ProFormDraftEvent', destination_record_id: 'event-dest', relationship_finalized: false });
    const result = await finalizeMigrationRelationships(entities, { sourceAppId: 'app-blue-test', migrationDirection: 'blue_to_green', batchId: 'batch-1' }, { ...serviceOptions, apply: false });
    expect(result).toMatchObject({ cutoverReady: false, counts: { unresolved: 1 } });
  });

  it('persists a content-free conflict idempotently', async () => {
    const entities = makeEntities(); const submissionPolicy = getProFormMigrationRuntimePolicy('ProFormSubmission');
    const envelope = await buildMigrationExportRecord({ id: 'source-1', created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-01T00:00:00Z', metadata: {}, userdata: { answer: 'synthetic' } }, submissionPolicy, exportOptions);
    await importMigrationBatch(entities, { entityName: 'ProFormSubmission', records: [envelope] }, serviceOptions);
    entities.ProFormSubmission.rows[0].userdata = { answer: 'native-change' };
    const changed = await buildMigrationExportRecord({ id: 'source-1', created_date: '2026-01-01T00:00:00Z', updated_date: '2026-02-01T00:00:00Z', metadata: {}, userdata: { answer: 'source-change' } }, submissionPolicy, exportOptions);
    await importMigrationBatch(entities, { entityName: 'ProFormSubmission', records: [changed] }, serviceOptions);
    await importMigrationBatch(entities, { entityName: 'ProFormSubmission', records: [changed] }, serviceOptions);
    expect(entities.ProFormMigrationConflict.rows).toHaveLength(1);
    expect(entities.ProFormMigrationConflict.rows[0]).not.toHaveProperty('payload');
  });

  it('returns only counts and checkpoint metadata in status', async () => {
    const entities = makeEntities();
    entities.ProFormMigrationCheckpoint.rows.push({ migration_name: 'pro-form-cross-app', environment: 'production', migration_direction: 'blue_to_green', batch_id: 'batch-1', status: 'running', phase: 'import', cursor: 'opaque' });
    const result = await getMigrationStatus(entities, { migrationDirection: 'blue_to_green', batchId: 'batch-1' }, { destinationAppId: 'app-green-test', environment: 'production' });
    expect(result).toMatchObject({ containsRecordData: false, checkpoint: { status: 'running', lastCursor: 'opaque' } });
    expect(JSON.stringify(result)).not.toContain('synthetic');
  });
});
