import { describe, expect, it } from 'vitest';
import {
  createMigrationRepository,
  getMigrationRecordFingerprint,
  getSafeMigrationRepositoryDiagnostics,
} from '../../base44/functions/_shared/proDraftMigrationRepository/repository.js';
import {
  analyzeMigrationPage,
  applyMigrationPage,
  resolveDuplicate,
  rollbackMigrationPage,
} from '../../base44/functions/_shared/proDraftMigrationService/service.js';

class Entity {
  constructor(rows = []) { this.rows = rows.map((row) => ({ ...row })); this.next = 100; }
  async list(_sort, limit = 50, skip = 0) { return this.rows.slice(skip, skip + limit).map((row) => ({ ...row })); }
  async filter(query, _sort, limit = 50, skip = 0) { return this.rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)).slice(skip, skip + limit).map((row) => ({ ...row })); }
  async get(id) { const row = this.rows.find((item) => item.id === id); if (!row) throw new Error('not found'); return { ...row }; }
  async create(data) { const row = { id: `new-${this.next++}`, created_date: new Date(this.next).toISOString(), ...data }; this.rows.push(row); return { ...row }; }
  async update(id, patch) { const index = this.rows.findIndex((item) => item.id === id); this.rows[index] = { ...this.rows[index], ...patch }; return { ...this.rows[index] }; }
}

const makeEntities = (drafts = [], events = []) => ({ ProFormDraft: new Entity(drafts), ProFormDraftEvent: new Entity(events), ProFormMigrationCheckpoint: new Entity() });
const draft = (id, overrides = {}) => ({ id, created_date: `2026-01-0${id.slice(-1)}T00:00:00.000Z`, session_id: `session-${id}`, status: 'draft', responses_json: '{}', ...overrides });
const migrationInput = { migrationName: 'legacy-v1', environment: 'staging', migrationVersion: 1, batchId: 'batch-1', dryRun: true, pageSize: 50, adminGrantTokenIdHash: 'b'.repeat(64) };
const serviceOptions = { secret: 'migration-secret-material-that-is-at-least-thirty-two-bytes', now: () => new Date('2026-08-06T12:00:00.000Z'), clock: () => Date.parse('2026-08-06T12:00:00.000Z'), tokenIdGenerator: () => 'mat_service_test' };

describe('migration repository', () => {
  it('uses page size 50 by default and caps at 200', () => {
    expect(getSafeMigrationRepositoryDiagnostics()).toMatchObject({ defaultPageSize: 50, maxPageSize: 200, supportsDelete: false });
  });
  it('fingerprints stable object key order', async () => {
    expect(await getMigrationRecordFingerprint({ a: 1, b: 2 })).toBe(await getMigrationRecordFingerprint({ b: 2, a: 1 }));
  });
  it('creates and then resumes one checkpoint', async () => {
    const repo = createMigrationRepository(makeEntities());
    const first = await repo.getOrCreateCheckpoint(migrationInput);
    const second = await repo.getOrCreateCheckpoint(migrationInput);
    expect(second.id).toBe(first.id);
  });
  it('returns stable sorted draft pages', async () => {
    const repo = createMigrationRepository(makeEntities([draft('d2'), draft('d1')]));
    expect((await repo.listLegacyDraftBatch({ pageSize: 2 })).items.map((item) => item.id)).toEqual(['d1', 'd2']);
  });
  it('rejects an invalid cursor', async () => {
    const repo = createMigrationRepository(makeEntities([draft('d1')]));
    await expect(repo.listLegacyDraftBatch({ cursor: 'bad', pageSize: 1 })).rejects.toMatchObject({ code: 'MIGRATION_CURSOR_INVALID' });
  });
  it('detects a changed cursor anchor', async () => {
    const entities = makeEntities([draft('d1'), draft('d2'), draft('d3')]);
    const repo = createMigrationRepository(entities);
    const first = await repo.listLegacyDraftBatch({ pageSize: 1 });
    entities.ProFormDraft.rows[0].created_date = '2099-01-01T00:00:00.000Z';
    await expect(repo.listLegacyDraftBatch({ pageSize: 1, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'MIGRATION_CURSOR_ANCHOR_CHANGED' });
  });
  it('applies only after the expected fingerprint matches', async () => {
    const entities = makeEntities([draft('d1')]); const repo = createMigrationRepository(entities);
    const current = await entities.ProFormDraft.get('d1'); const fingerprint = await repo.getMigrationRecordFingerprint(current);
    await expect(repo.applyDraftUpgradePatch('d1', fingerprint, { status: 'active' }, { batchId: 'batch-1', migrationVersion: 1, migratedAt: '2026-08-06T00:00:00Z' })).resolves.toMatchObject({ outcome: 'applied' });
  });
  it('skips a changed record on fingerprint mismatch', async () => {
    const entities = makeEntities([draft('d1')]); const repo = createMigrationRepository(entities);
    await expect(repo.applyDraftUpgradePatch('d1', 'a'.repeat(64), { status: 'active' }, { batchId: 'batch-1', migrationVersion: 1, migratedAt: '2026-08-06T00:00:00Z' })).resolves.toMatchObject({ outcome: 'fingerprint_mismatch' });
  });
  it('makes a repeated batch application idempotent', async () => {
    const entities = makeEntities([draft('d1', { migration_batch_id: 'batch-1', migration_version: 1 })]); const repo = createMigrationRepository(entities);
    await expect(repo.applyDraftUpgradePatch('d1', 'a'.repeat(64), { status: 'active' }, { batchId: 'batch-1', migrationVersion: 1, migratedAt: '2026-08-06T00:00:00Z' })).resolves.toMatchObject({ outcome: 'already_applied' });
  });
  it('never allows protected created/submitted fields in a patch', async () => {
    const repo = createMigrationRepository(makeEntities([draft('d1')]));
    await expect(repo.applyDraftUpgradePatch('d1', 'a'.repeat(64), { created_date: 'x' }, { batchId: 'batch-1', migrationVersion: 1, migratedAt: 'x' })).rejects.toMatchObject({ code: 'MIGRATION_PATCH_PROTECTED_FIELD' });
  });
  it('does not overwrite a nonempty current field', async () => {
    const entities = makeEntities([draft('d1', { business_name: 'Current' })]); const repo = createMigrationRepository(entities);
    const fingerprint = await repo.getMigrationRecordFingerprint(await repo.getDraft('d1'));
    await expect(repo.applyDraftUpgradePatch('d1', fingerprint, { business_name: 'Legacy' }, { batchId: 'batch-1', migrationVersion: 1, migratedAt: 'x' })).rejects.toMatchObject({ code: 'MIGRATION_CURRENT_FIELD_OVERWRITE_FORBIDDEN' });
  });
  it('refuses to supersede a submitted record with an active record', async () => {
    const repo = createMigrationRepository(makeEntities([draft('d1', { status: 'submitted', submitted_at: '2026-01-01' }), draft('d2', { status: 'active', session_id: 'session-d1' })]));
    await expect(repo.markDuplicateCandidate({ recordId: 'd1', canonicalRecordId: 'd2', batchId: 'batch-1', migrationVersion: 1, migratedAt: 'x' })).rejects.toMatchObject({ code: 'MIGRATION_SUBMITTED_SUPERSESSION_FORBIDDEN' });
  });
});

describe('migration execution services', () => {
  it('requires dry-run mode for analysis', async () => {
    await expect(analyzeMigrationPage(createMigrationRepository(makeEntities()), { ...migrationInput, dryRun: false }, serviceOptions)).rejects.toMatchObject({ code: 'MIGRATION_DRY_RUN_REQUIRED' });
  });
  it('analyzes drafts then events and issues an apply token only at completion', async () => {
    const repo = createMigrationRepository(makeEntities([draft('d1')]));
    const first = await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    const second = await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    expect(first).not.toHaveProperty('applyToken');
    expect(second).toMatchObject({ complete: true, analyzedCount: 1 });
    expect(second.applyToken).toBeTypeOf('string');
  });
  it('completes dry-run analysis without a configured apply secret and issues later', async () => {
    const repo = createMigrationRepository(makeEntities([draft('d1')]));
    await analyzeMigrationPage(repo, migrationInput, { ...serviceOptions, secret: undefined });
    const complete = await analyzeMigrationPage(repo, migrationInput, { ...serviceOptions, secret: undefined });
    expect(complete).toMatchObject({ complete: true, applyAuthorizationReady: false });
    expect(complete).not.toHaveProperty('applyToken');
    const authorized = await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    expect(authorized).toMatchObject({ applyAuthorizationReady: true });
    expect(authorized.applyToken).toBeTypeOf('string');
  });
  it('applies an analyzed batch without deleting records', async () => {
    const entities = makeEntities([draft('d1')]); const repo = createMigrationRepository(entities);
    await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    const ready = await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    const first = await applyMigrationPage(repo, { ...migrationInput, reportHash: ready.reportHash, applyToken: ready.applyToken }, serviceOptions);
    const complete = await applyMigrationPage(repo, { ...migrationInput, reportHash: ready.reportHash, applyToken: ready.applyToken }, serviceOptions);
    expect(first.phase).toBe('apply_events');
    expect(complete.complete).toBe(true);
    expect(entities.ProFormDraft.rows).toHaveLength(1);
  });
  it('rejects apply before a complete dry run', async () => {
    const repo = createMigrationRepository(makeEntities([draft('d1')]));
    await expect(applyMigrationPage(repo, { ...migrationInput, reportHash: 'a'.repeat(64), applyToken: 'bad' }, serviceOptions)).rejects.toMatchObject({ code: 'MIGRATION_DRY_RUN_NOT_COMPLETE' });
  });
  it('marks duplicate lineage and emits an audit event without merge/delete', async () => {
    const entities = makeEntities([draft('d1'), draft('d2', { session_id: 'session-d1' })]); const repo = createMigrationRepository(entities);
    await analyzeMigrationPage(repo, migrationInput, serviceOptions); const ready = await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    const canonicalFingerprint = await repo.getMigrationRecordFingerprint(await repo.getDraft('d1'));
    const fingerprint = await repo.getMigrationRecordFingerprint(await repo.getDraft('d2'));
    const result = await resolveDuplicate(repo, { ...migrationInput, reportHash: ready.reportHash, applyToken: ready.applyToken, recordIds: ['d1','d2'], canonicalRecordId: 'd1', fingerprints: { d1: canonicalFingerprint, d2: fingerprint }, reason: 'legacy_duplicate_resolution', idempotencyKey: 'dup-key' }, serviceOptions);
    expect(result).toMatchObject({ markedCount: 1, deletedCount: 0 });
    expect(entities.ProFormDraftEvent.rows.at(-1).event_type).toBe('legacy_duplicate_resolution');
  });
  it('replays duplicate resolution idempotently with one audit event', async () => {
    const entities = makeEntities([draft('d1'), draft('d2', { session_id: 'session-d1' })]); const repo = createMigrationRepository(entities);
    await analyzeMigrationPage(repo, migrationInput, serviceOptions); const ready = await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    const fingerprints = { d1: await repo.getMigrationRecordFingerprint(await repo.getDraft('d1')), d2: await repo.getMigrationRecordFingerprint(await repo.getDraft('d2')) };
    const input = { ...migrationInput, reportHash: ready.reportHash, applyToken: ready.applyToken, recordIds: ['d1','d2'], canonicalRecordId: 'd1', fingerprints, reason: 'legacy_duplicate_resolution', idempotencyKey: 'dup-key' };
    await resolveDuplicate(repo, input, serviceOptions);
    const replay = await resolveDuplicate(repo, input, serviceOptions);
    expect(replay).toMatchObject({ markedCount: 0, skippedCount: 1, deletedCount: 0 });
    expect(entities.ProFormDraftEvent.rows).toHaveLength(1);
  });
  it('requires exact duplicate fingerprints', async () => {
    const repo = createMigrationRepository(makeEntities([draft('d1'), draft('d2', { session_id: 'session-d1' })]));
    await analyzeMigrationPage(repo, migrationInput, serviceOptions); const ready = await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    const canonicalFingerprint = await repo.getMigrationRecordFingerprint(await repo.getDraft('d1'));
    await expect(resolveDuplicate(repo, { ...migrationInput, reportHash: ready.reportHash, applyToken: ready.applyToken, recordIds: ['d1','d2'], canonicalRecordId: 'd1', fingerprints: { d1: canonicalFingerprint, d2: 'a'.repeat(64) }, reason: 'legacy_duplicate_resolution', idempotencyKey: 'dup-key' }, serviceOptions)).rejects.toMatchObject({ code: 'MIGRATION_DUPLICATE_FINGERPRINT_MISMATCH' });
  });
  it('rolls back additive bookkeeping but preserves current V2 records for review', async () => {
    const entities = makeEntities([draft('d1', { migration_batch_id: 'batch-1', migration_version: 1 }), draft('d2', { migration_batch_id: 'batch-1', migration_version: 1, draft_schema_version: 4 })]);
    const repo = createMigrationRepository(entities);
    await analyzeMigrationPage(repo, migrationInput, serviceOptions); const ready = await analyzeMigrationPage(repo, migrationInput, serviceOptions);
    const result = await rollbackMigrationPage(repo, { ...migrationInput, reportHash: ready.reportHash, applyToken: ready.applyToken, skip: 0 }, serviceOptions);
    expect(result).toMatchObject({ rolledBack: 1, manualReview: 1, deletedCount: 0, preservedAnswerFields: true });
  });
});
