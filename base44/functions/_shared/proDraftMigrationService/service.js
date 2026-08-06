import {
  assertSafeLegacyMigrationReport,
  buildLegacyDraftUpgradePatch,
  buildLegacyEventUpgradePatch,
  buildLegacyMigrationAnalysisReport,
} from '../proDraftLegacyMigration/entry.ts';
import { issueMigrationApplyToken, verifyMigrationApplyToken } from '../proDraftMigrationAuthorization/entry.ts';
import { sha256Hex } from '../proDraftSecurity/entry.ts';

export class MigrationServiceError extends Error {
  constructor(code) {
    super('The migration request could not be completed.');
    this.name = 'MigrationServiceError';
    this.code = code;
  }
}
const fail = (code) => { throw new MigrationServiceError(code); };
const identity = (input) => ({ migrationName: input.migrationName, environment: input.environment, migrationVersion: input.migrationVersion, batchId: input.batchId });
const timestamp = (options) => (options.now?.() ?? new Date()).toISOString();

export async function analyzeMigrationPage(repository, input, options) {
  if (input.dryRun !== true) fail('MIGRATION_DRY_RUN_REQUIRED');
  const checkpoint = await repository.getOrCreateCheckpoint(identity(input), {
    status: 'running', mode: 'dry_run', phase: 'analyze_drafts', started_at: timestamp(options), requested_by_grant_token_hash: input.adminGrantTokenIdHash,
  });
  if (checkpoint.status === 'completed' && checkpoint.phase === 'ready_to_apply' && checkpoint.dry_run_report_hash) {
    if (typeof options.secret !== 'string' || new TextEncoder().encode(options.secret).byteLength < 32) {
      return Object.freeze({ dryRun: true, complete: true, phase: 'ready_to_apply', reportHash: checkpoint.dry_run_report_hash, analyzedCount: checkpoint.analyzed_count, manualReviewCount: checkpoint.manual_review_count, applyAuthorizationReady: false });
    }
    const issued = await issueMigrationApplyToken({ ...identity(input), reportHash: checkpoint.dry_run_report_hash, maxRecordCount: checkpoint.approved_record_count, adminGrantTokenIdHash: input.adminGrantTokenIdHash }, options);
    await repository.updateCheckpoint(checkpoint.id, { apply_token_hash: issued.tokenHash });
    return Object.freeze({ dryRun: true, complete: true, phase: 'ready_to_apply', reportHash: checkpoint.dry_run_report_hash, analyzedCount: checkpoint.analyzed_count, manualReviewCount: checkpoint.manual_review_count, applyAuthorizationReady: true, applyToken: issued.token });
  }
  if (['apply_drafts', 'apply_events', 'complete', 'rollback'].includes(checkpoint.phase)) fail('MIGRATION_ANALYSIS_ALREADY_APPLYING');
  const phase = checkpoint.phase === 'analyze_events' ? 'analyze_events' : 'analyze_drafts';
  const batch = phase === 'analyze_drafts'
    ? await repository.listLegacyDraftBatch({ cursor: checkpoint.draft_cursor, pageSize: input.pageSize })
    : await repository.listLegacyEventBatch({ cursor: checkpoint.event_cursor, pageSize: input.pageSize });
  const drafts = phase === 'analyze_drafts' ? batch.items : [];
  const events = phase === 'analyze_events' ? batch.items : [];
  const report = await buildLegacyMigrationAnalysisReport({ drafts, events, batchId: input.batchId, environment: input.environment, analyzedAt: timestamp(options) });
  assertSafeLegacyMigrationReport(report, drafts);
  const pageHash = await sha256Hex(JSON.stringify(report), options.cryptoProvider);
  const rollingHash = await sha256Hex(`${checkpoint.dry_run_report_hash || 'start'}:${pageHash}`, options.cryptoProvider);
  const analyzedCount = Number(checkpoint.analyzed_count || 0) + drafts.length + events.length;
  const manualReviewCount = Number(checkpoint.manual_review_count || 0) + report.counts.manualReview;
  let nextPhase = phase;
  const patch = { mode: 'dry_run', entity_name: phase === 'analyze_drafts' ? 'ProFormDraft' : 'ProFormDraftEvent', cursor: batch.nextCursor, records_scanned: analyzedCount, records_planned: Math.max(0, analyzedCount - manualReviewCount), records_failed: 0, updated_at: timestamp(options), report_json: JSON.stringify({ counts: report.counts, warnings: report.warnings }), dry_run_report_hash: rollingHash, analyzed_count: analyzedCount, manual_review_count: manualReviewCount, last_record_id: batch.items.at(-1)?.id, last_record_fingerprint: report[phase === 'analyze_drafts' ? 'drafts' : 'events'].at(-1)?.beforeFingerprint };
  if (phase === 'analyze_drafts') {
    patch.draft_cursor = batch.nextCursor;
    if (!batch.nextCursor) nextPhase = input.includeEvents === false ? 'ready_to_apply' : 'analyze_events';
  } else patch.event_cursor = batch.nextCursor;
  const complete = (phase === 'analyze_events' && !batch.nextCursor)
    || (phase === 'analyze_drafts' && !batch.nextCursor && input.includeEvents === false);
  patch.phase = complete ? 'ready_to_apply' : nextPhase;
  patch.status = complete ? 'completed' : 'running';
  patch.approved_record_count = analyzedCount;
  let applyToken = null;
  if (complete && typeof options.secret === 'string' && new TextEncoder().encode(options.secret).byteLength >= 32) {
    const issued = await issueMigrationApplyToken({ ...identity(input), reportHash: rollingHash, maxRecordCount: analyzedCount, adminGrantTokenIdHash: input.adminGrantTokenIdHash }, options);
    applyToken = issued.token;
    patch.apply_token_hash = issued.tokenHash;
  }
  await repository.updateCheckpoint(checkpoint.id, patch);
  return Object.freeze({ dryRun: true, complete, phase: patch.phase, reportHash: rollingHash, pageReport: report, nextCursor: batch.nextCursor, analyzedCount, manualReviewCount, applyAuthorizationReady: Boolean(applyToken), ...(applyToken ? { applyToken } : {}) });
}

export async function applyMigrationPage(repository, input, options) {
  const checkpoint = await repository.getOrCreateCheckpoint(identity(input));
  if (!((checkpoint.status === 'completed' && checkpoint.phase === 'ready_to_apply') || (checkpoint.status === 'running' && ['apply_drafts', 'apply_events'].includes(checkpoint.phase)))) fail('MIGRATION_DRY_RUN_NOT_COMPLETE');
  if (checkpoint.dry_run_report_hash !== input.reportHash) fail('MIGRATION_REPORT_HASH_MISMATCH');
  const verified = await verifyMigrationApplyToken(input.applyToken, { ...identity(input), reportHash: input.reportHash }, options);
  if (verified.claims.maxRecordCount !== checkpoint.approved_record_count || verified.tokenHash !== checkpoint.apply_token_hash) fail('MIGRATION_APPLY_TOKEN_CHECKPOINT_MISMATCH');
  const now = timestamp(options);
  const phase = checkpoint.phase === 'apply_events' ? 'apply_events' : 'apply_drafts';
  const batch = phase === 'apply_drafts'
    ? await repository.listLegacyDraftBatch({ cursor: checkpoint.apply_draft_cursor, pageSize: input.pageSize })
    : await repository.listLegacyEventBatch({ cursor: checkpoint.apply_event_cursor, pageSize: input.pageSize });
  let applied = 0; let skipped = 0; let manualReview = 0;
  for (const current of batch.items) {
    const analysis = phase === 'apply_drafts'
      ? await buildLegacyDraftUpgradePatch(current, { batchId: input.batchId, environment: input.environment, analyzedAt: now })
      : await buildLegacyEventUpgradePatch(current, { batchId: input.batchId, environment: input.environment, analyzedAt: now });
    if (analysis.manualReview) { manualReview += 1; continue; }
    const result = phase === 'apply_drafts'
      ? await repository.applyDraftUpgradePatch(current.id, analysis.beforeFingerprint, analysis.patch, { batchId: input.batchId, migrationVersion: input.migrationVersion, migratedAt: now })
      : await repository.applyEventUpgradePatch(current.id, analysis.beforeFingerprint, analysis.patch, { batchId: input.batchId, migrationVersion: input.migrationVersion, migratedAt: now });
    if (result.outcome === 'applied') applied += 1; else skipped += 1;
  }
  const totalProcessed = Number(checkpoint.apply_processed_count || 0) + batch.items.length;
  if (totalProcessed > verified.claims.maxRecordCount) fail('MIGRATION_APPROVED_COUNT_EXCEEDED');
  const patch = {
    status: 'running', mode: 'apply', phase, entity_name: phase === 'apply_drafts' ? 'ProFormDraft' : 'ProFormDraftEvent', cursor: batch.nextCursor, updated_at: now, apply_token_used_at: checkpoint.apply_token_used_at || now,
    applied_count: Number(checkpoint.applied_count || 0) + applied,
    skipped_count: Number(checkpoint.skipped_count || 0) + skipped,
    manual_review_count: Number(checkpoint.manual_review_count || 0),
    apply_processed_count: totalProcessed,
    records_updated: Number(checkpoint.records_updated || 0) + applied,
    records_skipped: Number(checkpoint.records_skipped || 0) + skipped + manualReview,
    records_failed: Number(checkpoint.records_failed || 0),
    last_record_id: batch.items.at(-1)?.id,
  };
  if (phase === 'apply_drafts') {
    patch.apply_draft_cursor = batch.nextCursor;
    if (!batch.nextCursor) patch.phase = 'apply_events';
  } else patch.apply_event_cursor = batch.nextCursor;
  const complete = phase === 'apply_events' && !batch.nextCursor;
  if (complete) Object.assign(patch, { status: 'completed', phase: 'complete', completed_at: now });
  await repository.updateCheckpoint(checkpoint.id, patch);
  return Object.freeze({ complete, phase: patch.phase, page: { applied, skipped, manualReview }, totals: { applied: patch.applied_count, skipped: patch.skipped_count, manualReview: patch.manual_review_count } });
}

export async function resolveDuplicate(repository, input, options) {
  if (!Array.isArray(input.recordIds) || input.recordIds.length < 2 || !input.recordIds.includes(input.canonicalRecordId)
    || !input.fingerprints || input.reason !== 'legacy_duplicate_resolution' || !input.idempotencyKey) fail('MIGRATION_DUPLICATE_INPUT_INVALID');
  const checkpoint = await repository.getOrCreateCheckpoint(identity(input));
  const verified = await verifyMigrationApplyToken(input.applyToken, { ...identity(input), reportHash: input.reportHash }, options);
  if (checkpoint.dry_run_report_hash !== input.reportHash || checkpoint.apply_token_hash !== verified.tokenHash) fail('MIGRATION_DUPLICATE_CHECKPOINT_MISMATCH');
  const now = timestamp(options); const outcomes = [];
  if (!checkpoint.apply_token_used_at) await repository.updateCheckpoint(checkpoint.id, { apply_token_used_at: now });
  for (const recordId of input.recordIds) {
    const current = await repository.getDraft(recordId);
    if (recordId !== input.canonicalRecordId && current.replacement_draft_id === input.canonicalRecordId && current.superseded_reason === 'legacy_duplicate_resolution') {
      outcomes.push({ outcome: 'already_applied', record: current });
      continue;
    }
    if (await repository.getMigrationRecordFingerprint(current) !== input.fingerprints[recordId]) fail('MIGRATION_DUPLICATE_FINGERPRINT_MISMATCH');
    if (recordId !== input.canonicalRecordId) outcomes.push(await repository.markDuplicateCandidate({ recordId, canonicalRecordId: input.canonicalRecordId, batchId: input.batchId, migrationVersion: input.migrationVersion, migratedAt: now }));
  }
  await repository.createAuditEventIdempotent({ draft_id: input.canonicalRecordId, session_id: `migration:${input.batchId}`, event_id: `duplicate_${await sha256Hex(input.idempotencyKey, options.cryptoProvider)}`, event_type: 'legacy_duplicate_resolution', value_summary: 'duplicate lineage marked; no merge or delete', redaction_level: 'omitted', migration_batch_id: input.batchId, migration_version: input.migrationVersion, migrated_at: now });
  return Object.freeze({ canonicalRecordId: input.canonicalRecordId, markedCount: outcomes.filter((item) => item.outcome === 'applied').length, skippedCount: outcomes.filter((item) => item.outcome !== 'applied').length, deletedCount: 0 });
}

const DRAFT_ROLLBACK_FIELDS = ['migration_batch_id','migrated_at','migration_version'];
const EVENT_ROLLBACK_FIELDS = ['migration_batch_id','migrated_at','migration_version'];
export async function rollbackMigrationPage(repository, input, options) {
  if (input.skip !== undefined && (!Number.isInteger(input.skip) || input.skip < 0)) fail('MIGRATION_ROLLBACK_CURSOR_INVALID');
  const checkpoint = await repository.getOrCreateCheckpoint(identity(input));
  const verified = await verifyMigrationApplyToken(input.applyToken, { ...identity(input), reportHash: input.reportHash }, options);
  if (checkpoint.dry_run_report_hash !== input.reportHash || checkpoint.apply_token_hash !== verified.tokenHash) fail('MIGRATION_ROLLBACK_CHECKPOINT_MISMATCH');
  const drafts = await repository.listDraftsByMigrationBatch(input.batchId, input.pageSize, input.skip || 0);
  const events = await repository.listEventsByMigrationBatch(input.batchId, input.pageSize, input.skip || 0);
  let rolledBack = 0; let manualReview = 0; const manualReviewRecordIds = [];
  for (const draft of drafts) {
    if (draft.submitted_at || draft.final_submission_id || draft.draft_schema_version >= 4 || draft.recovery_email_verification_status === 'verified') { manualReview += 1; manualReviewRecordIds.push(draft.id); continue; }
    if ((draft.recovery_email_source === 'migrated_legacy') && (draft.recovery_email_lookup_hash || draft.recovery_email_last_sent_at)) { manualReview += 1; manualReviewRecordIds.push(draft.id); continue; }
    const result = await repository.clearDraftMigrationFields(draft.id, input.batchId, DRAFT_ROLLBACK_FIELDS);
    if (result.outcome === 'rolled_back') rolledBack += 1;
  }
  for (const event of events) {
    const result = await repository.clearEventMigrationFields(event.id, input.batchId, EVENT_ROLLBACK_FIELDS);
    if (result.outcome === 'rolled_back') rolledBack += 1;
  }
  const rollbackPageSize = Math.min(200, Math.max(1, Number.isInteger(input.pageSize) ? input.pageSize : 50));
  const nextSkip = drafts.length === rollbackPageSize || events.length === rollbackPageSize ? (input.skip || 0) + rollbackPageSize : null;
  await repository.updateCheckpoint(checkpoint.id, { mode: 'rollback', status: nextSkip === null ? 'completed' : 'running', phase: 'rollback', entity_name: 'ProFormDraft,ProFormDraftEvent', cursor: nextSkip === null ? null : String(nextSkip), records_scanned: drafts.length + events.length, records_updated: rolledBack, records_skipped: manualReview, records_failed: 0, updated_at: timestamp(options), ...(nextSkip === null ? { completed_at: timestamp(options) } : {}) });
  return Object.freeze({ rolledBack, manualReview, manualReviewRecordIds: Object.freeze(manualReviewRecordIds), deletedCount: 0, preservedAnswerFields: true, nextSkip });
}
