import { sha256Hex } from '../proDraftSecurity/entry.ts';
import {
  PRO_DRAFT_RETENTION_POLICY_VERSION, RETENTION_DECISIONS,
  buildRetentionDryRunReport, evaluateDraftRetentionEligibility,
  evaluateEventRetentionEligibility, getRetentionPolicy,
} from '../proDraftRetention/retention.js';
import { issueRetentionApplyToken } from '../proDraftRetentionAuthorization/authorization.js';

export const RETENTION_MIGRATION_NAME = 'pro-form-draft-retention';
const STATUSES = Object.freeze(['active', 'submit_failed', 'cleared_superseded']);
const MAX_APPROVED_DELETIONS = 200;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const nowIso = (options) => (options.now?.() ?? new Date()).toISOString();

export class RetentionServiceError extends Error {
  constructor(code) {
    super('The retention operation could not be completed.');
    this.name = 'RetentionServiceError';
    this.code = code;
  }
}
const fail = (code) => { throw new RetentionServiceError(code); };
const parseReport = (checkpoint) => {
  try {
    const value = JSON.parse(checkpoint.report_json || '{}');
    return value && typeof value === 'object' && Array.isArray(value.approvedRecords) ? value : null;
  } catch { return null; }
};
const safePageSize = (value, policy) => value == null ? policy.batchSize
  : Number.isInteger(value) && value >= 1 ? Math.min(value, 200) : fail('RETENTION_PAGE_SIZE_INVALID');
const requestId = (input, prefix) => SAFE_ID.test(input.requestId || '') ? input.requestId : `${prefix}-${input.batchId}`;
const adminEditTimestamp = (events) => events
  .filter((event) => ['admin_edit', 'admin_draft_update'].includes(String(event.event_type || '').toLowerCase()))
  .map((event) => event.created_at_server ?? event.created_date)
  .filter(Boolean)
  .sort()
  .at(-1);

async function audit(repository, input, attemptType, outcome, draftId, options) {
  await repository.createAuditEvent({ requestId: requestId(input, 'retention'), environment: input.environment,
    attemptType, outcome, draftId, createdAt: nowIso(options),
    policyVersion: PRO_DRAFT_RETENTION_POLICY_VERSION, testRunId: input.testRunId });
}

export async function analyzeRetentionPage(repository, input, options = {}) {
  const policy = options.policy ?? getRetentionPolicy(options.environmentValues ?? {});
  if (!SAFE_ID.test(input.environment || '') || !SAFE_ID.test(input.batchId || '')) fail('RETENTION_INPUT_INVALID');
  const identity = { migrationName: RETENTION_MIGRATION_NAME, environment: input.environment,
    policyVersion: PRO_DRAFT_RETENTION_POLICY_VERSION, batchId: input.batchId };
  const startedAt = nowIso(options);
  const cutoff = new Date(Date.parse(startedAt) - policy.draftRetentionDays * 86_400_000).toISOString();
  let checkpoint = await repository.getOrCreateCheckpoint(identity, {
    retention_cutoff: cutoff, retention_policy_version: PRO_DRAFT_RETENTION_POLICY_VERSION,
    started_at: startedAt, updated_at: startedAt,
    report_json: JSON.stringify({ version: 1, counts: { eligibleDrafts: 0, protectedDrafts: 0,
      manualReview: 0, estimatedEvents: 0, estimatedBytes: 0 }, approvedRecords: [] }),
  });
  const existing = parseReport(checkpoint);
  if (!existing || checkpoint.retention_policy_version !== PRO_DRAFT_RETENTION_POLICY_VERSION
    || !Number.isFinite(Date.parse(checkpoint.retention_cutoff))
    || !Number.isFinite(Date.parse(checkpoint.started_at))) fail('RETENTION_CHECKPOINT_INVALID');

  if (checkpoint.status === 'completed') {
    if (input.issueApplyToken !== true) return Object.freeze({ dryRun: true, complete: true,
      batchId: input.batchId, cutoff: checkpoint.retention_cutoff,
      reportHash: checkpoint.retention_report_hash, counts: existing.counts, approvedRecords: existing.approvedRecords });
    if (checkpoint.mode === 'apply' || checkpoint.retention_apply_token_hash) fail('RETENTION_APPLY_TOKEN_ALREADY_ISSUED');
    if (await sha256Hex(JSON.stringify(existing), options.cryptoProvider) !== checkpoint.retention_report_hash) {
      fail('RETENTION_REPORT_MISMATCH');
    }
    if (typeof options.secret !== 'string') fail('RETENTION_APPLY_SECRET_UNAVAILABLE');
    const issued = await issueRetentionApplyToken({ environment: input.environment,
      policyVersion: PRO_DRAFT_RETENTION_POLICY_VERSION, cutoff: checkpoint.retention_cutoff,
      reportHash: checkpoint.retention_report_hash,
      maxDeletionCount: existing.approvedRecords.length, batchId: input.batchId,
      adminGrantTokenIdHash: input.adminGrantTokenIdHash }, { secret: options.secret, clock: options.clock });
    checkpoint = await repository.updateCheckpoint(checkpoint.id, {
      retention_apply_token_hash: issued.tokenHash, requested_by_grant_token_hash: input.adminGrantTokenIdHash,
      updated_at: nowIso(options),
    });
    return Object.freeze({ dryRun: true, complete: true, batchId: input.batchId,
      cutoff: checkpoint.retention_cutoff, reportHash: checkpoint.retention_report_hash,
      counts: existing.counts, applyToken: issued.token, applyTokenExpiresAt: issued.claims.expiresAt });
  }

  const phaseIndex = Math.max(0, STATUSES.indexOf(checkpoint.phase));
  const status = STATUSES[phaseIndex];
  const skip = Number.parseInt(checkpoint.cursor || '0', 10);
  if (!Number.isInteger(skip) || skip < 0) fail('RETENTION_CURSOR_INVALID');
  if (input.cursor !== undefined && String(input.cursor) !== `${status}:${skip}`) fail('RETENTION_CURSOR_MISMATCH');
  const remainingApproval = MAX_APPROVED_DELETIONS - existing.approvedRecords.length;
  const page = await repository.listDraftsByStatus(status, safePageSize(input.pageSize, policy), skip);
  const evaluations = [];
  for (const draft of page.items) {
    const eventPage = await repository.listEventsForDraft(draft.id, 200);
    const evaluation = evaluateDraftRetentionEligibility(draft, { environment: input.environment,
      policy, now: new Date(checkpoint.started_at), recentAdminEditAt: adminEditTimestamp(eventPage.items),
      migrationDependentRecordIds: options.migrationDependentRecordIds });
    const fingerprint = await repository.fingerprint(draft);
    const estimatedEventCount = eventPage.items.length + (eventPage.hasMore ? 1 : 0);
    const item = { id: draft.id, fingerprint, evaluation,
      estimatedEventCount, estimatedBytes: repository.estimateBytes(draft) };
    if (eventPage.hasMore && evaluation.eligible) {
      item.evaluation = { decision: RETENTION_DECISIONS.MANUAL_REVIEW, eligible: false,
        reasonCode: 'event_count_exceeds_batch' };
    }
    evaluations.push(item);
    if (item.evaluation.decision === RETENTION_DECISIONS.MANUAL_REVIEW) {
      await audit(repository, input, 'retention_manual_review', 'manual_review', draft.id, options);
    }
  }
  const pageReport = await buildRetentionDryRunReport({ evaluations,
    policyVersion: PRO_DRAFT_RETENTION_POLICY_VERSION, environment: input.environment,
    batchId: input.batchId, cutoff: checkpoint.retention_cutoff });
  const eligible = evaluations.filter((item) => item.evaluation.eligible).slice(0, Math.max(0, remainingApproval))
    .map(({ id, fingerprint, estimatedEventCount }) => ({ id, fingerprint, estimatedEventCount }));
  const counts = {
    eligibleDrafts: existing.counts.eligibleDrafts + pageReport.counts.eligibleDrafts,
    protectedDrafts: existing.counts.protectedDrafts + pageReport.counts.protectedDrafts,
    manualReview: existing.counts.manualReview + pageReport.counts.manualReview,
    estimatedEvents: existing.counts.estimatedEvents + pageReport.counts.estimatedEvents,
    estimatedBytes: existing.counts.estimatedBytes + pageReport.counts.estimatedBytes,
  };
  const approvedRecords = [...existing.approvedRecords, ...eligible];
  const approvalFull = approvedRecords.length >= MAX_APPROVED_DELETIONS;
  const nextPhaseIndex = page.hasMore ? phaseIndex : phaseIndex + 1;
  const complete = approvalFull || nextPhaseIndex >= STATUSES.length;
  const nextStatus = complete ? 'complete' : STATUSES[nextPhaseIndex];
  const nextSkip = page.hasMore ? page.nextSkip : 0;
  const report = { version: 1, policyVersion: PRO_DRAFT_RETENTION_POLICY_VERSION,
    environment: input.environment, batchId: input.batchId, cutoff: checkpoint.retention_cutoff,
    counts, approvedRecords, approvalLimitReached: approvalFull };
  const reportHash = complete ? await sha256Hex(JSON.stringify(report), options.cryptoProvider) : null;
  checkpoint = await repository.updateCheckpoint(checkpoint.id, {
    mode: 'dry_run', status: complete ? 'completed' : 'running', phase: nextStatus,
    cursor: String(nextSkip), records_scanned: Number(checkpoint.records_scanned || 0) + evaluations.length,
    records_planned: approvedRecords.length, records_skipped: counts.protectedDrafts,
    manual_review_count: counts.manualReview, report_json: JSON.stringify(report),
    retention_report_hash: reportHash, dry_run_report_hash: reportHash,
    completed_at: complete ? nowIso(options) : undefined, updated_at: nowIso(options),
  });
  await audit(repository, input, complete ? 'retention_completion' : 'retention_dry_run',
    complete ? 'completed' : 'dry_run_only', undefined, options);
  return Object.freeze({ dryRun: true, complete, batchId: input.batchId,
    cutoff: checkpoint.retention_cutoff, cursor: complete ? null : `${nextStatus}:${nextSkip}`,
    reportHash, counts, approvedRecords: pageReport.records.filter((item) => item.decision === RETENTION_DECISIONS.ELIGIBLE) });
}

export async function applyRetentionPage(repository, input, options = {}) {
  const claims = input.verifiedToken?.claims;
  const tokenHash = input.verifiedToken?.tokenHash;
  if (!claims || !tokenHash || claims.environment !== input.environment || claims.batchId !== input.batchId) {
    fail('RETENTION_APPLY_AUTHORIZATION_INVALID');
  }
  const identity = { migrationName: RETENTION_MIGRATION_NAME, environment: input.environment,
    policyVersion: PRO_DRAFT_RETENTION_POLICY_VERSION, batchId: input.batchId };
  let checkpoint = await repository.getOrCreateCheckpoint(identity);
  const report = parseReport(checkpoint);
  if (!report || claims.policyVersion !== PRO_DRAFT_RETENTION_POLICY_VERSION
    || !['completed', 'running'].includes(checkpoint.status)
    || !['dry_run', 'apply'].includes(checkpoint.mode)
    || checkpoint.retention_report_hash !== claims.reportHash
    || checkpoint.retention_cutoff !== claims.cutoff
    || report.approvedRecords.length !== claims.maxDeletionCount) fail('RETENTION_REPORT_MISMATCH');
  if (await sha256Hex(JSON.stringify(report), options.cryptoProvider) !== checkpoint.retention_report_hash) {
    fail('RETENTION_REPORT_MISMATCH');
  }
  if (checkpoint.retention_apply_token_hash && checkpoint.retention_apply_token_hash !== tokenHash) fail('RETENTION_APPLY_TOKEN_ALREADY_USED');
  const index = Number(checkpoint.retention_apply_index || 0);
  const pageSize = safePageSize(input.pageSize, getRetentionPolicy(options.environmentValues ?? {}));
  const entries = report.approvedRecords.slice(index, index + pageSize);
  if (!checkpoint.retention_apply_token_used_at) {
    checkpoint = await repository.updateCheckpoint(checkpoint.id, { mode: 'apply',
      retention_apply_token_hash: tokenHash, retention_apply_token_used_at: nowIso(options), updated_at: nowIso(options) });
    await audit(repository, input, 'retention_apply_start', 'authorized', undefined, options);
  }
  let deletedDrafts = 0;
  let deletedEvents = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of entries) {
    let draft;
    try { draft = await repository.getDraft(entry.id); } catch {
      skipped += 1;
      await audit(repository, input, 'retention_skip', 'skipped', entry.id, options);
      continue;
    }
    const fingerprint = await repository.fingerprint(draft);
    const eventPage = await repository.listEventsForDraft(entry.id, 200);
    const evaluation = evaluateDraftRetentionEligibility(draft, { environment: input.environment,
      policy: options.policy ?? getRetentionPolicy(options.environmentValues ?? {}), now: options.now?.() ?? new Date(),
      recentAdminEditAt: adminEditTimestamp(eventPage.items) });
    if (fingerprint !== entry.fingerprint || !evaluation.eligible) {
      skipped += 1;
      await audit(repository, input, 'retention_skip', 'skipped', entry.id, options);
      continue;
    }
    if (eventPage.hasMore) {
      failed += 1;
      await audit(repository, input, 'retention_failure', 'failed', entry.id, options);
      continue;
    }
    const eventEvaluations = eventPage.items.map((event) => ({ event,
      evaluation: evaluateEventRetentionEligibility(event, { environment: input.environment,
        policy: options.policy ?? getRetentionPolicy(options.environmentValues ?? {}),
        now: options.now?.() ?? new Date(), draftEvaluation: evaluation }) }));
    if (eventEvaluations.some((item) => !item.evaluation.eligible)) {
      skipped += 1;
      await audit(repository, input, 'retention_skip', 'skipped', entry.id, options);
      continue;
    }
    let eventFailure = false;
    for (const { event } of eventEvaluations) {
      try {
        await repository.deleteEvent(event.id);
        deletedEvents += 1;
        await audit(repository, input, 'retention_event_delete', 'deleted', entry.id, options);
      } catch {
        eventFailure = true; failed += 1;
        await audit(repository, input, 'retention_failure', 'failed', entry.id, options);
        break;
      }
    }
    if (eventFailure) continue;
    const latest = await repository.getDraft(entry.id);
    const remainingEventPage = await repository.listEventsForDraft(entry.id, 200);
    if (remainingEventPage.hasMore || remainingEventPage.items.length > 0) {
      failed += 1;
      await audit(repository, input, 'retention_failure', 'failed', entry.id, options);
      continue;
    }
    const latestFingerprint = await repository.fingerprint(latest);
    const latestEvaluation = evaluateDraftRetentionEligibility(latest, { environment: input.environment,
      policy: options.policy ?? getRetentionPolicy(options.environmentValues ?? {}), now: options.now?.() ?? new Date() });
    if (latestFingerprint !== entry.fingerprint || !latestEvaluation.eligible) {
      skipped += 1;
      await audit(repository, input, 'retention_skip', 'skipped', entry.id, options);
      continue;
    }
    await repository.deleteDraft(entry.id);
    deletedDrafts += 1;
    await audit(repository, input, 'retention_draft_delete', 'deleted', entry.id, options);
  }
  const nextIndex = index + entries.length;
  const complete = nextIndex >= report.approvedRecords.length;
  checkpoint = await repository.updateCheckpoint(checkpoint.id, {
    mode: 'apply', retention_apply_index: nextIndex,
    records_updated: Number(checkpoint.records_updated || 0) + deletedDrafts,
    records_skipped: Number(checkpoint.records_skipped || 0) + skipped,
    records_failed: Number(checkpoint.records_failed || 0) + failed,
    status: complete ? 'completed' : 'running', phase: complete ? 'apply_complete' : 'apply',
    updated_at: nowIso(options), completed_at: complete ? nowIso(options) : undefined,
  });
  if (complete) await audit(repository, input, 'retention_completion', 'completed', undefined, options);
  return Object.freeze({ applied: true, complete, batchId: input.batchId,
    processed: entries.length, deletedDrafts, deletedEvents, skipped, failed,
    nextIndex: complete ? null : nextIndex });
}

export async function runScheduledRetention(repository, input, options = {}) {
  const policy = options.policy ?? getRetentionPolicy(options.environmentValues ?? {});
  if (!policy.dryRun) {
    await audit(repository, input, 'retention_failure', 'dry_run_only', undefined, options);
    return Object.freeze({ dryRun: true, destructiveApplyBlocked: true,
      alertRequired: true, alertType: 'retention_destructive_schedule_blocked',
      reasonCode: 'SCHEDULED_RETENTION_STANDING_AUTHORIZATION_REQUIRED' });
  }
  const report = await analyzeRetentionPage(repository, input, { ...options, policy });
  return Object.freeze({ ...report, alertRequired: true, alertType: 'retention_dry_run_report' });
}
