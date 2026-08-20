import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('draft recovery archive-state semantics', () => {
  it('treats missing, null, and blank archive values as active records', () => {
    const source = readProjectFile('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts');

    expect(source).toContain("if (archiveState === 'active')");
    expect(source).toContain('{ archived_at: { $exists: false } }');
    expect(source).toContain('{ archived_at: null }');
    expect(source).toContain("{ archived_at: '' }");
  });

  it('requires a real nonblank archive value for archived records', () => {
    const source = readProjectFile('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts');

    expect(source).toContain("if (archiveState === 'archived')");
    expect(source).toContain('{ archived_at: { $ne: null } }');
    expect(source).toContain("{ archived_at: { $ne: '' } }");
  });

  it('uses the same active semantics in the retention job', () => {
    const source = readProjectFile('base44/functions/archiveRecoveryRecords/entry.ts');

    expect(source).toContain('const unarchivedCondition = {');
    expect(source).toContain('{ archived_at: null }');
    expect(source).toContain("{ archived_at: '' }");
    expect(source).toContain('unarchivedCondition,');
  });
});
