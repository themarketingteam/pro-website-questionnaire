import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const readEntity = (path) => JSON.parse(readProjectFile(path));

describe('questionnaire draft version history', () => {
  it('exposes protected version listing, detail, and non-destructive recovery-copy actions', () => {
    const source = readProjectFile('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts');
    const authIndex = source.indexOf('if (!isAdmin && !hasRecoveryAccess)');

    expect(authIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(source.indexOf("action === 'list_versions'"));
    expect(authIndex).toBeLessThan(source.indexOf("action === 'get_version'"));
    expect(authIndex).toBeLessThan(source.indexOf("action === 'create_version_copy'"));
    expect(source).toContain("source: 'recovery_version_copy'");
    expect(source).toContain('source_version_id: versionId');
    expect(source).not.toContain('ProFormDraftRevision.delete');
  });

  it('groups only authoritative or exact multi-field client identities', () => {
    const source = readProjectFile('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts');

    expect(source).toContain('anchor.session_id === candidate.session_id');
    expect(source).toContain('anchorUserId === candidateUserId');
    expect(source).toContain('anchorEmail === candidateEmail');
    expect(source).toContain('anchorDomain === candidateDomain');
    expect(source).toContain('anchorName === candidateName');
  });

  it('defaults to submitted history and detects pre-clear/high-water checkpoints', () => {
    const source = readProjectFile('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts');

    expect(source).toContain("version.kind === 'submitted'");
    expect(source).toContain("version.kind === 'final_submission'");
    expect(source).toContain('const beforeLargeDrop');
    expect(source).toContain('isNewHighWater');
    expect(source).toContain("mode === 'all'");
  });

  it('paginates replay beyond the previous 5,000 revision ceiling and refuses silent truncation', () => {
    const source = readProjectFile('base44/functions/syncProQuestionnaireDraft/entry.ts');

    expect(source).toContain('const listDraftRevisions');
    expect(source).toContain('const maximum = 25_000');
    expect(source).toContain('requires compaction');
    expect(source).not.toContain("{ draft_id: draft.id },\n    'server_received_at',\n    5000");
  });

  it('prevents post-submit autosaves and pagehide flushes from regressing finalized drafts', () => {
    const source = readProjectFile('base44/functions/syncProQuestionnaireDraft/entry.ts');

    expect(source).toContain("cleanText(draft.status, 40) === 'submitted'");
    expect(source).toContain("cleanText(body?.status, 40) !== 'submitted'");
    expect(source).toContain('finalized: true');
    expect(source).toContain('ignored: true');
  });

  it('makes raw revisions immutable after creation', () => {
    const revisionEntity = readEntity('base44/entities/ProFormDraftRevision.jsonc');

    expect(revisionEntity.rls.update).toBe(false);
    expect(revisionEntity.rls.delete).toBe(false);
  });
});
