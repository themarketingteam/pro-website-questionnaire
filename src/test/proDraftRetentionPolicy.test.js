import { describe, expect, it } from 'vitest';
import {
  RETENTION_DECISIONS, buildRetentionDryRunReport, calculateRetentionExpiry,
  evaluateDraftRetentionEligibility, evaluateEventRetentionEligibility,
  getRetentionPolicy, getSafeRetentionDiagnostics,
} from '../../base44/functions/_shared/proDraftRetention/entry.ts';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const policy = getRetentionPolicy({});
const draft = (patch = {}) => ({ id: 'draft-1', environment: 'staging', status: 'active',
  created_date: '2024-01-01T00:00:00.000Z', ...patch });
const evaluate = (patch = {}, options = {}) => evaluateDraftRetentionEligibility(draft(patch), {
  environment: 'staging', policy, now: NOW, ...options,
});

describe('one-year draft retention policy', () => {
  it('defaults and clamps retention configuration safely', () => {
    expect(getRetentionPolicy({})).toMatchObject({ draftRetentionDays: 365, eventRetentionDays: 365,
      dryRun: true, batchSize: 50, recentSupportDays: 30 });
    expect(getRetentionPolicy({ PRO_FORM_DRAFT_RETENTION_DAYS: '7', PRO_FORM_DRAFT_EVENT_RETENTION_DAYS: '30',
      PRO_FORM_DRAFT_RETENTION_BATCH_SIZE: '999' })).toMatchObject({ draftRetentionDays: 365,
      eventRetentionDays: 365, batchSize: 200 });
  });
  it('includes an active draft older than one year', () => expect(evaluate().eligible).toBe(true));
  it('protects a recent active draft', () => expect(evaluate({ last_saved_at: '2026-07-01T00:00:00.000Z' }).reasonCode).toBe('retention_window_active'));
  it('includes an old submit-failed draft', () => expect(evaluate({ status: 'submit_failed' }).eligible).toBe(true));
  it('protects recent submit-failed repair activity', () => expect(evaluate({ status: 'submit_failed', ai_repair_last_attempt_at: '2026-08-01T00:00:00.000Z' }).reasonCode).toBe('recent_support_activity'));
  it('includes an old cleared draft using superseded time', () => expect(evaluate({ status: 'cleared_superseded', superseded_at: '2024-03-01T00:00:00.000Z', last_saved_at: '2026-08-01T00:00:00.000Z' }).eligible).toBe(true));
  it('protects a recently superseded draft regardless of old saves', () => expect(evaluate({ status: 'cleared_superseded', superseded_at: '2026-07-01T00:00:00.000Z' }).reasonCode).toBe('retention_window_active'));
  it.each([{ status: 'submitted' }, { status: 'completed' }, { submitted_at: '2025-01-01T00:00:00.000Z' }, { final_submission_id: 'submission-1' }])('never selects submitted state %#', (patch) => expect(evaluate(patch).reasonCode).toBe('submitted_record'));
  it('enforces a hold and requires a hold reason', () => {
    expect(evaluate({ retention_hold: true, retention_hold_reason: 'Support case 123' }).reasonCode).toBe('retention_hold');
    expect(evaluate({ retention_hold: true }).decision).toBe(RETENTION_DECISIONS.MANUAL_REVIEW);
  });
  it('protects pending and orphaned replacements', () => {
    expect(evaluate({ replacement_transaction_id: 'replace-1', replacement_transaction_status: 'pending' }).reasonCode).toBe('pending_replacement');
    expect(evaluate({ replacement_transaction_id: 'replace-1', replacement_transaction_status: 'orphaned' }).reasonCode).toBe('orphaned_replacement');
  });
  it('protects migration rollback dependencies', () => expect(evaluate({ migration_rollback_required: true }).reasonCode).toBe('migration_rollback_dependency'));
  it('conservatively protects migrated records until rollback release is explicit', () => {
    expect(evaluate({ migration_batch_id: 'migration-1' }).reasonCode).toBe('migration_rollback_dependency');
    expect(evaluate({ migration_batch_id: 'migration-1' }, {
      migrationRollbackReleasedRecordIds: new Set(['draft-1']),
    }).eligible).toBe(true);
  });
  it('uses recent admin edit events as support activity', () => expect(evaluate({}, {
    recentAdminEditAt: '2026-08-01T00:00:00.000Z',
  }).reasonCode).toBe('recent_support_activity'));
  it('routes invalid or missing authoritative dates to manual review', () => {
    expect(evaluate({ created_date: 'not-a-date' }).decision).toBe(RETENTION_DECISIONS.MANUAL_REVIEW);
    expect(evaluate({ status: 'cleared_superseded', superseded_at: null }).decision).toBe(RETENTION_DECISIONS.MANUAL_REVIEW);
  });
  it('ignores client timestamps as retention authority', () => expect(evaluate({ client_saved_at: '2035-01-01T00:00:00.000Z' }).eligible).toBe(true));
  it('protects test records and cross-environment records', () => {
    expect(evaluate({ test_run_id: 'test-1' }).reasonCode).toBe('test_protected');
    expect(evaluate({ environment: 'production' }).reasonCode).toBe('RETENTION_ENVIRONMENT_MISMATCH');
  });
  it('evaluates associated events only when their parent is eligible', () => {
    const event = { id: 'event-1', environment: 'staging', created_at_server: '2024-01-01T00:00:00.000Z' };
    expect(evaluateEventRetentionEligibility(event, { environment: 'staging', policy, now: NOW, draftEvaluation: evaluate() }).eligible).toBe(true);
    expect(evaluateEventRetentionEligibility(event, { environment: 'staging', policy, now: NOW, draftEvaluation: evaluate({ last_saved_at: '2026-08-01T00:00:00.000Z' }) }).reasonCode).toBe('parent_draft_protected');
  });
  it('calculates expiry and emits a content-free dry-run report', async () => {
    expect(calculateRetentionExpiry('2025-01-01T00:00:00.000Z', 365)).toBe('2026-01-01T00:00:00.000Z');
    const report = await buildRetentionDryRunReport({ policyVersion: 1, environment: 'staging',
      batchId: 'batch-1', cutoff: NOW.toISOString(), evaluations: [{ id: 'draft-1', fingerprint: 'a'.repeat(64),
        evaluation: evaluate(), estimatedEventCount: 2, estimatedBytes: 120 }] });
    expect(report.counts).toMatchObject({ eligibleDrafts: 1, estimatedEvents: 2, estimatedBytes: 120 });
    expect(JSON.stringify(report)).not.toMatch(/answer|email/i);
    await expect(buildRetentionDryRunReport({ policyVersion: 1, environment: 'staging',
      batchId: 'batch-1', cutoff: NOW.toISOString(), evaluations: [{ id: 'unsafe email@example.test',
        fingerprint: 'a'.repeat(64), evaluation: evaluate() }] })).rejects.toThrow('RETENTION_REPORT_INVALID');
  });
  it('publishes safe diagnostics', () => expect(getSafeRetentionDiagnostics({})).toMatchObject({
    submittedExcluded: true, clientTimeIgnored: true, maxBatchSize: 200,
    applySecretName: 'PRO_FORM_RETENTION_APPLY_SECRET',
  }));
});
