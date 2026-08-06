import { sha256Hex } from '../proDraftSecurity/entry.ts';

export const PRO_DRAFT_RETENTION_POLICY_VERSION = 1;
export const RETENTION_DECISIONS = Object.freeze({
  ELIGIBLE: 'eligible',
  PROTECTED: 'protected',
  MANUAL_REVIEW: 'manual_review',
});
export const RETENTION_ERROR_CODES = Object.freeze({
  INVALID_RECORD: 'RETENTION_INVALID_RECORD',
  INVALID_DATE: 'RETENTION_INVALID_DATE',
  ENVIRONMENT_MISMATCH: 'RETENTION_ENVIRONMENT_MISMATCH',
  HOLD_REASON_REQUIRED: 'RETENTION_HOLD_REASON_REQUIRED',
  REPORT_INVALID: 'RETENTION_REPORT_INVALID',
});

const DAY_MS = 86_400_000;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ELIGIBLE_STATUSES = new Set(['active', 'submit_failed', 'cleared_superseded']);
const SUBMITTED_STATUSES = new Set(['submitted', 'completed']);
const SUPPORT_FIELDS = Object.freeze([
  'ai_repair_last_attempt_at', 'ai_diagnosis_last_attempt_at',
  'last_ai_repair_at', 'last_ai_diagnosis_at', 'submit_attempted_at',
  'retry_attempted_at', 'last_retry_attempt_at', 'submission_retry_last_attempt_at',
  'admin_edit_at', 'last_admin_edit_at', 'recovery_issue_updated_at',
]);
const CLIENT_TIME_FIELDS = Object.freeze(['client_updated_at', 'client_saved_at', 'client_timestamp']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const readEnv = (source, name) => typeof source === 'function' ? source(name)
  : typeof source?.get === 'function' ? source.get(name) : source?.[name];
const boundedInt = (source, name, fallback, min, max) => {
  const raw = readEnv(source, name);
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};
const parseDate = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : false;
};
const result = (decision, reasonCode, extra = {}) => Object.freeze({
  decision,
  eligible: decision === RETENTION_DECISIONS.ELIGIBLE,
  reasonCode,
  ...extra,
});

export function getRetentionPolicy(source = {}) {
  return Object.freeze({
    version: PRO_DRAFT_RETENTION_POLICY_VERSION,
    draftRetentionDays: boundedInt(source, 'PRO_FORM_DRAFT_RETENTION_DAYS', 365, 365, 3650),
    eventRetentionDays: boundedInt(source, 'PRO_FORM_DRAFT_EVENT_RETENTION_DAYS', 365, 365, 3650),
    dryRun: String(readEnv(source, 'PRO_FORM_DRAFT_RETENTION_DRY_RUN') ?? 'true').toLowerCase() !== 'false',
    batchSize: boundedInt(source, 'PRO_FORM_DRAFT_RETENTION_BATCH_SIZE', 50, 1, 200),
    recentSupportDays: boundedInt(source, 'PRO_FORM_DRAFT_RETENTION_RECENT_SUPPORT_DAYS', 30, 1, 365),
  });
}

export function calculateRetentionExpiry(activityAt, retentionDays = 365) {
  const parsed = parseDate(activityAt);
  if (!parsed || !Number.isInteger(retentionDays) || retentionDays < 365) return null;
  return new Date(parsed.getTime() + retentionDays * DAY_MS).toISOString();
}

function supportActivity(record, now, policy, options) {
  if (record.retention_hold === true) {
    if (typeof record.retention_hold_reason !== 'string' || !record.retention_hold_reason.trim()) {
      return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.HOLD_REASON_REQUIRED);
    }
    return result(RETENTION_DECISIONS.PROTECTED, 'retention_hold');
  }
  if (['open', 'pending', 'investigating'].includes(String(record.recovery_issue_status || '').toLowerCase())) {
    return result(RETENTION_DECISIONS.PROTECTED, 'open_recovery_issue');
  }
  const threshold = now.getTime() - policy.recentSupportDays * DAY_MS;
  const adminEdit = parseDate(options.recentAdminEditAt);
  if (adminEdit === false) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_DATE, { field: 'recentAdminEditAt' });
  if (adminEdit && adminEdit.getTime() >= threshold) {
    return result(RETENTION_DECISIONS.PROTECTED, 'recent_support_activity', { field: 'admin_edit_event' });
  }
  for (const field of SUPPORT_FIELDS) {
    const parsed = parseDate(record[field]);
    if (parsed === false) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_DATE, { field });
    if (parsed && parsed.getTime() >= threshold) return result(RETENTION_DECISIONS.PROTECTED, 'recent_support_activity', { field });
  }
  return null;
}

function activityTimestamp(record, status) {
  if (status === 'cleared_superseded') {
    const superseded = parseDate(record.superseded_at);
    if (superseded === false || superseded === null) return { invalid: true, field: 'superseded_at' };
    return { value: superseded, field: 'superseded_at' };
  }
  for (const field of ['last_saved_at', 'updated_date', 'created_date']) {
    if (record[field] == null || record[field] === '') continue;
    const parsed = parseDate(record[field]);
    if (parsed === false) return { invalid: true, field };
    return { value: parsed, field };
  }
  return { invalid: true, field: 'last_saved_at' };
}

export function evaluateDraftRetentionEligibility(record, options = {}) {
  if (!isRecord(record)) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_RECORD);
  const policy = options.policy ?? getRetentionPolicy(options.environmentValues ?? {});
  const environment = options.environment;
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_DATE);
  if (!environment || record.environment !== environment) {
    return result(RETENTION_DECISIONS.PROTECTED, RETENTION_ERROR_CODES.ENVIRONMENT_MISMATCH);
  }
  const status = String(record.status || '').toLowerCase();
  if (record.submitted_at || record.final_submission_id || SUBMITTED_STATUSES.has(status)) {
    return result(RETENTION_DECISIONS.PROTECTED, 'submitted_record');
  }
  if (record.test_run_id) return result(RETENTION_DECISIONS.PROTECTED, 'test_protected');
  if (!ELIGIBLE_STATUSES.has(status)) return result(RETENTION_DECISIONS.PROTECTED, 'status_not_eligible');
  const support = supportActivity(record, now, policy, options);
  if (support) return support;
  const replacementStatus = String(record.replacement_transaction_status || '').toLowerCase();
  if (record.replacement_transaction_id && !['committed', 'completed'].includes(replacementStatus)) {
    return result(RETENTION_DECISIONS.PROTECTED, replacementStatus === 'orphaned' ? 'orphaned_replacement' : 'pending_replacement');
  }
  if (record.migration_rollback_required === true
    || (record.migration_batch_id && !options.migrationRollbackReleasedRecordIds?.has?.(record.id))
    || ['required', 'pending'].includes(String(record.migration_dependency_status || '').toLowerCase())
    || options.migrationDependentRecordIds?.has?.(record.id)) {
    return result(RETENTION_DECISIONS.PROTECTED, 'migration_rollback_dependency');
  }
  const activity = activityTimestamp(record, status);
  if (activity.invalid) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_DATE, { field: activity.field });
  const expiry = calculateRetentionExpiry(activity.value.toISOString(), policy.draftRetentionDays);
  if (!expiry) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_DATE, { field: activity.field });
  if (Date.parse(expiry) > now.getTime()) {
    return result(RETENTION_DECISIONS.PROTECTED, 'retention_window_active', { activityAt: activity.value.toISOString(), expiresAt: expiry });
  }
  return result(RETENTION_DECISIONS.ELIGIBLE, 'retention_expired', {
    activityAt: activity.value.toISOString(), expiresAt: expiry,
    ignoredClientTimeFields: CLIENT_TIME_FIELDS.filter((field) => Object.hasOwn(record, field)),
  });
}

export function evaluateEventRetentionEligibility(event, options = {}) {
  if (!isRecord(event)) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_RECORD);
  const policy = options.policy ?? getRetentionPolicy(options.environmentValues ?? {});
  const environment = options.environment;
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (!environment || event.environment !== environment) return result(RETENTION_DECISIONS.PROTECTED, RETENTION_ERROR_CODES.ENVIRONMENT_MISMATCH);
  if (event.test_run_id) return result(RETENTION_DECISIONS.PROTECTED, 'test_protected');
  if (event.retention_hold === true) {
    if (typeof event.retention_hold_reason !== 'string' || !event.retention_hold_reason.trim()) {
      return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.HOLD_REASON_REQUIRED);
    }
    return result(RETENTION_DECISIONS.PROTECTED, 'retention_hold');
  }
  if (!options.draftEvaluation?.eligible) return result(RETENTION_DECISIONS.PROTECTED, 'parent_draft_protected');
  const value = event.created_at_server ?? event.created_date;
  const parsed = parseDate(value);
  if (!parsed) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_DATE, { field: event.created_at_server ? 'created_at_server' : 'created_date' });
  const expiry = calculateRetentionExpiry(parsed.toISOString(), policy.eventRetentionDays);
  if (!expiry) return result(RETENTION_DECISIONS.MANUAL_REVIEW, RETENTION_ERROR_CODES.INVALID_DATE);
  return Date.parse(expiry) <= now.getTime()
    ? result(RETENTION_DECISIONS.ELIGIBLE, 'retention_expired', { activityAt: parsed.toISOString(), expiresAt: expiry })
    : result(RETENTION_DECISIONS.PROTECTED, 'retention_window_active', { activityAt: parsed.toISOString(), expiresAt: expiry });
}

export async function buildRetentionDryRunReport(input, options = {}) {
  if (!isRecord(input) || !Array.isArray(input.evaluations)) throw new Error(RETENTION_ERROR_CODES.REPORT_INVALID);
  if (input.evaluations.some((item) => !SAFE_ID.test(item?.id || '')
    || !HASH.test(item?.fingerprint || '')
    || !Object.values(RETENTION_DECISIONS).includes(item?.evaluation?.decision))) {
    throw new Error(RETENTION_ERROR_CODES.REPORT_INVALID);
  }
  const safe = input.evaluations.map((item) => ({
    id: String(item.id || ''), fingerprint: String(item.fingerprint || ''),
    decision: item.evaluation?.decision, reasonCode: item.evaluation?.reasonCode,
    estimatedEventCount: Number.isInteger(item.estimatedEventCount) ? item.estimatedEventCount : 0,
    estimatedBytes: Number.isFinite(item.estimatedBytes) ? Math.max(0, Math.trunc(item.estimatedBytes)) : null,
  }));
  const report = {
    version: 1, policyVersion: input.policyVersion, environment: input.environment,
    batchId: input.batchId, cutoff: input.cutoff,
    counts: {
      eligibleDrafts: safe.filter((x) => x.decision === RETENTION_DECISIONS.ELIGIBLE).length,
      protectedDrafts: safe.filter((x) => x.decision === RETENTION_DECISIONS.PROTECTED).length,
      manualReview: safe.filter((x) => x.decision === RETENTION_DECISIONS.MANUAL_REVIEW).length,
      estimatedEvents: safe.reduce((sum, x) => sum + x.estimatedEventCount, 0),
      estimatedBytes: safe.reduce((sum, x) => sum + (x.estimatedBytes ?? 0), 0),
    },
    records: safe,
  };
  return Object.freeze({ ...report, reportHash: await sha256Hex(JSON.stringify(report), options.cryptoProvider) });
}

export function getSafeRetentionDiagnostics(source = {}) {
  const policy = getRetentionPolicy(source);
  return Object.freeze({ ...policy, eligibleStatuses: [...ELIGIBLE_STATUSES], submittedExcluded: true,
    clientTimeIgnored: true, eventBeforeDraftDeletion: true, maxBatchSize: 200,
    applySecretName: 'PRO_FORM_RETENTION_APPLY_SECRET' });
}
