import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  latestMeaningfulActivity,
  RETENTION_DAYS,
  retentionUntilFor,
  shouldArchiveAt,
} from '../../base44/functions/archiveRecoveryRecords/recoveryRetention.ts';

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const readEntity = (path) => JSON.parse(readProjectFile(path));

describe('three-year questionnaire retention', () => {
  it('keeps records active before day 1,095 and archives at the inclusive boundary', () => {
    const activityAt = '2026-01-01T00:00:00.000Z';
    const retentionUntil = retentionUntilFor(activityAt);

    expect(RETENTION_DAYS).toBe(1095);
    expect(shouldArchiveAt(activityAt, new Date(Date.parse(retentionUntil) - 1))).toBe(false);
    expect(shouldArchiveAt(activityAt, retentionUntil)).toBe(true);
  });

  it('does not treat retention-maintenance updated_date as newer client activity', () => {
    const activity = latestMeaningfulActivity({
      created_date: '2026-01-01T00:00:00.000Z',
      updated_date: '2026-08-18T00:00:00.000Z',
      retention_started_at: '2026-04-01T00:00:00.000Z',
      last_saved_at: '',
    }, ['last_saved_at', 'created_date']);

    expect(activity).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reactivates an authorized archived draft when it is saved again', () => {
    const source = readProjectFile('base44/functions/syncProQuestionnaireDraft/entry.ts');

    expect(source).toContain("archived_at: ''");
    expect(source).toContain("archive_reason: ''");
    expect(source).toContain('retention_until: retentionUntil');
    expect(source).toContain("action: 'reactivate'");
  });

  it('disables entity-level permanent deletion for every retained record family', () => {
    const entityPaths = [
      'base44/entities/ProFormDraft.jsonc',
      'base44/entities/ProFormSubmission.jsonc',
      'base44/entities/ProFormSubmissionIntake.jsonc',
      'base44/entities/pro-form-draft-revision.jsonc',
      'base44/entities/ProFormDraftEvent.jsonc',
      'base44/entities/QuestionnairePdfVersion.jsonc',
      'base44/entities/pro-form-recovery-lifecycle-event.jsonc',
      'base44/entities/pro-form-identity-resolution-attempt.jsonc',
      'base44/entities/pro-form-identity-resolution-run.jsonc',
    ];

    for (const path of entityPaths) expect(readEntity(path).rls.delete, path).toBe(false);
  });

  it('exposes protected standalone submissions and excludes linked duplicates', () => {
    const source = readProjectFile('base44/functions/queryDraftRecoveryRecords/entry.ts');

    expect(source).toContain("submission: {");
    expect(source).toContain("entityName: 'ProFormSubmission'");
    expect(source).toContain("'metadata.source_draft_id'");
    expect(source).toContain("'metadata.source_intake_id'");
    expect(source).toContain("archiveState === 'deleted'");
    expect(source).toContain("if (archiveState === 'all') return null");
  });

  it('provides fingerprinted encrypted backups with dry-run-first non-overwriting restore', () => {
    const backup = readProjectFile('base44/functions/backupProQuestionnaireRetention/retentionBackup.ts');
    const restore = readProjectFile('base44/functions/restoreProQuestionnaireRetentionBackup/entry.ts');
    const automation = readEntity('base44/functions/backupProQuestionnaireRetention/function.jsonc');

    expect(backup).toContain("ServerSideEncryption: 'aws:kms'");
    expect(backup).toContain('SSEKMSKeyId: configuration.kmsKeyId');
    expect(backup).toContain("crypto.subtle.digest('SHA-256'");
    expect(restore).toContain('const apply = body?.apply === true');
    expect(restore).toContain("decision = existing");
    expect(restore).toContain("'blocked_newer_record'");
    expect(restore).not.toContain('.update(manifest.source_record_id');
    expect(automation.automations[0].cron_expression).toBe('30 8 * * *');
    expect(automation.automations[0].is_active).toBe(false);
  });
});
