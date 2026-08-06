import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import * as browserHash from '@/lib/proFormMigrationContentHash';
import * as backendHash from '../../base44/functions/_shared/proFormMigrationContentHash/entry.ts';

const manifest = JSON.parse(readFileSync(path.resolve(
  'config/pro-form-migration-entity-policy.json',
), 'utf8'));
const draftPolicy = manifest.entities.find(({ entityName }) => entityName === 'ProFormDraft');
const implementations = [
  ['browser', browserHash],
  ['backend', backendHash],
];

describe.each(implementations)('migration content hash (%s)', (_name, subject) => {
  it('is stable across object insertion order', async () => {
    const left = { session_id: 'session', status: 'active', responses_json: '{"1":"yes"}' };
    const right = { responses_json: '{"1":"yes"}', status: 'active', session_id: 'session' };
    expect(await subject.hashMigratableRecord(left, draftPolicy))
      .toBe(await subject.hashMigratableRecord(right, draftPolicy));
  });

  it('ignores destination IDs, platform dates, and migration-only timestamps', async () => {
    const common = { session_id: 'session', status: 'active', responses_json: '{"1":"yes"}' };
    const left = {
      ...common,
      id: 'blue-id',
      created_date: '2024-01-01T00:00:00.000Z',
      migrated_at: '2026-01-01T00:00:00.000Z',
    };
    const right = {
      ...common,
      id: 'green-id',
      created_date: '2026-01-01T00:00:00.000Z',
      migrated_at: '2026-02-01T00:00:00.000Z',
    };
    expect((await subject.compareMigratableRecords(left, right, draftPolicy)).equal)
      .toBe(true);
  });

  it('detects a meaningful response change', async () => {
    const left = { session_id: 'session', responses_json: '{"1":"yes"}' };
    const right = { session_id: 'session', responses_json: '{"1":"no"}' };
    expect((await subject.compareMigratableRecords(left, right, draftPolicy)).equal)
      .toBe(false);
  });

  it('normalizes remapped relationships to the same logical identity', async () => {
    const left = { session_id: 'session', previous_draft_id: 'blue-record-id' };
    const right = { session_id: 'session', previous_draft_id: 'green-record-id' };
    const options = {
      source: { relationshipIdentities: { previous_draft_id: 'origin-app:ProFormDraft:origin-id' } },
      destination: {
        relationshipIdentities: { previous_draft_id: 'origin-app:ProFormDraft:origin-id' },
      },
    };
    expect((await subject.compareMigratableRecords(left, right, draftPolicy, options)).equal)
      .toBe(true);
  });

  it('returns only hashes and safe metadata in diagnostics', async () => {
    const sourceHash = await subject.hashMigratableRecord({
      session_id: 'session',
      responses_json: 'private answer',
    }, draftPolicy);
    const diagnostics = subject.getSafeMigrationHashDiagnostics({
      entityName: 'ProFormDraft',
      sourceHash,
      destinationHash: sourceHash,
    });
    expect(diagnostics).toMatchObject({ compared: true, equal: true, entityName: 'ProFormDraft' });
    expect(JSON.stringify(diagnostics)).not.toContain('private answer');
  });
});
