import { describe, expect, it } from 'vitest';

import {
  buildMigrationExportRecord,
  getSafeMigrationExportDiagnostics,
  validateSourceRecordForExport,
} from '../../base44/functions/_shared/proFormMigrationExport/entry.ts';
import {
  buildMigrationConflictRecord,
  getSafeMigrationImportDiagnostics,
  upsertMigratedRecord,
} from '../../base44/functions/_shared/proFormMigrationImport/entry.ts';
import { getProFormMigrationRuntimePolicy } from '../../base44/functions/_shared/proFormMigrationPolicy/entry.ts';

class Entity {
  constructor(rows = []) { this.rows = rows.map((row) => ({ ...row })); this.next = 1; }
  async filter(query, _sort, limit = 5000, skip = 0) {
    return this.rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)).slice(skip, skip + limit);
  }
  async get(id) { return this.rows.find((row) => row.id === id); }
  async create(data) {
    const row = { id: `destination-${this.next++}`, created_date: '2026-08-06T12:00:00.000Z', updated_date: '2026-08-06T12:00:00.000Z', ...data };
    this.rows.push(row); return row;
  }
  async update(id, patch) {
    const row = await this.get(id); Object.assign(row, patch, { updated_date: '2026-08-06T12:01:00.000Z' }); return row;
  }
}

const policy = getProFormMigrationRuntimePolicy('ProFormSubmission');
const source = (patch = {}) => ({
  id: 'source-submission-1', created_date: '2026-01-01T00:00:00.000Z', updated_date: '2026-01-02T00:00:00.000Z',
  metadata: { synthetic: true }, userdata: { answer: 'synthetic-answer' },
  questionnaire_session_id: 'synthetic-session', environment: 'production', ...patch,
});
const exportOptions = { sourceAppId: 'app-blue-test', sourceEnvironment: 'production', destinationEnvironment: 'production' };
const entities = () => ({
  ProFormSubmission: new Entity(), ProFormMigrationIdMap: new Entity(), ProFormMigrationConflict: new Entity(),
});
const importOptions = { apply: true, destinationAppId: 'app-green-test', destinationEnvironment: 'production', migrationDirection: 'blue_to_green', migrationVersion: 1, batchId: 'batch-1', migratedAt: '2026-08-06T12:00:00.000Z' };

describe('migration export projection', () => {
  it('includes approved sensitive record data only in the protected envelope', async () => {
    const envelope = await buildMigrationExportRecord(source(), policy, exportOptions);
    expect(envelope.data.userdata.answer).toBe('synthetic-answer');
    expect(envelope.sourceContentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('includes continuity hashes while rejecting raw credentials', async () => {
    const draftPolicy = getProFormMigrationRuntimePolicy('ProFormDraft');
    const draft = { id: 'draft-1', created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-02T00:00:00Z', session_id: 'session', recovery_code_hash: 'a'.repeat(64), resume_token_hash: 'b'.repeat(64) };
    const envelope = await buildMigrationExportRecord(draft, draftPolicy, exportOptions);
    expect(envelope.data).toMatchObject({ recovery_code_hash: 'a'.repeat(64), resume_token_hash: 'b'.repeat(64) });
    expect(() => validateSourceRecordForExport({ ...draft, recovery_code: 'raw' }, draftPolicy, exportOptions))
      .toThrowError(expect.objectContaining({ code: 'MIGRATION_EXPORT_FIELD_REJECTED' }));
  });

  it('keeps sensitive values out of diagnostics', () => {
    const diagnostics = getSafeMigrationExportDiagnostics({ entityName: 'ProFormSubmission', scannedCount: 1, exportedCount: 1 });
    expect(diagnostics).toMatchObject({ containsRecordData: false, containsSensitiveHashes: false });
    expect(JSON.stringify(diagnostics)).not.toContain('synthetic-answer');
  });

  it('rejects test records bound for production', () => {
    expect(() => validateSourceRecordForExport(source({ test_run_id: 'fixture' }), policy, exportOptions))
      .toThrowError(expect.objectContaining({ code: 'MIGRATION_EXPORT_TEST_RECORD_REJECTED' }));
  });

  it('rejects staging-tagged records bound for production', () => {
    expect(() => validateSourceRecordForExport(source({ environment: 'staging' }), policy, exportOptions))
      .toThrowError(expect.objectContaining({ code: 'MIGRATION_EXPORT_ENVIRONMENT_REJECTED' }));
  });

  it('rejects policy-forbidden entities and unknown fields', () => {
    expect(() => validateSourceRecordForExport(source({ unknown_private_field: 'x' }), policy, exportOptions))
      .toThrowError(expect.objectContaining({ code: 'MIGRATION_EXPORT_FIELD_REJECTED' }));
    expect(() => getProFormMigrationRuntimePolicy('ProFormMigrationCheckpoint'))
      .toThrow('MIGRATION_ENTITY_POLICY_REJECTED');
  });
});

describe('identity-only destination upsert', () => {
  it('creates a destination record and ID map', async () => {
    const store = entities(); const envelope = await buildMigrationExportRecord(source(), policy, exportOptions);
    await expect(upsertMigratedRecord(store, envelope, policy, importOptions)).resolves.toMatchObject({ outcome: 'created' });
    expect(store.ProFormMigrationIdMap.rows).toHaveLength(1);
    expect(store.ProFormMigrationIdMap.rows[0]).toMatchObject({ source_record_id: 'source-submission-1', destination_entity: 'ProFormSubmission' });
  });

  it('replays unchanged records idempotently without another mapping', async () => {
    const store = entities(); const envelope = await buildMigrationExportRecord(source(), policy, exportOptions);
    await upsertMigratedRecord(store, envelope, policy, importOptions);
    await expect(upsertMigratedRecord(store, envelope, policy, importOptions)).resolves.toMatchObject({ outcome: 'unchanged' });
    expect(store.ProFormMigrationIdMap.rows).toHaveLength(1);
  });

  it('updates when source changed and destination stayed at its mapped base', async () => {
    const store = entities(); const first = await buildMigrationExportRecord(source(), policy, exportOptions);
    await upsertMigratedRecord(store, first, policy, importOptions);
    const second = await buildMigrationExportRecord(source({ userdata: { answer: 'synthetic-revised' }, updated_date: '2026-02-01T00:00:00Z' }), policy, exportOptions);
    await expect(upsertMigratedRecord(store, second, policy, importOptions)).resolves.toMatchObject({ outcome: 'updated' });
    expect(store.ProFormSubmission.rows[0].userdata.answer).toBe('synthetic-revised');
  });

  it('reports a conflict when destination changed independently', async () => {
    const store = entities(); const first = await buildMigrationExportRecord(source(), policy, exportOptions);
    await upsertMigratedRecord(store, first, policy, importOptions);
    store.ProFormSubmission.rows[0].userdata = { answer: 'native-destination-change' };
    const second = await buildMigrationExportRecord(source({ userdata: { answer: 'source-change' } }), policy, exportOptions);
    await expect(upsertMigratedRecord(store, second, policy, importOptions)).resolves.toMatchObject({ outcome: 'conflicted', conflictType: 'source_and_destination_modified' });
  });

  it('performs a dry-run plan without writes', async () => {
    const store = entities(); const envelope = await buildMigrationExportRecord(source(), policy, exportOptions);
    await expect(upsertMigratedRecord(store, envelope, policy, { ...importOptions, apply: false })).resolves.toMatchObject({ outcome: 'create' });
    expect(store.ProFormSubmission.rows).toHaveLength(0);
    expect(store.ProFormMigrationIdMap.rows).toHaveLength(0);
  });

  it('builds content-free conflict records and diagnostics', async () => {
    const conflict = await buildMigrationConflictRecord({ migrationDirection: 'blue_to_green', batchId: 'batch-1', entityName: 'ProFormSubmission', sourceAppId: 'blue', sourceRecordId: 'source-1', destinationAppId: 'green', conflictType: 'source_and_destination_modified', environment: 'production' });
    expect(conflict.conflict_id).toMatch(/^pmc_/u);
    expect(conflict).not.toHaveProperty('payload');
    expect(getSafeMigrationImportDiagnostics({ entityName: 'ProFormSubmission', conflicted: 1 })).toMatchObject({ conflicted: 1, matchesByEmail: false, deleted: 0 });
  });
});
