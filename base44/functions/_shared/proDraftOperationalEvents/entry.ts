/** Versioned, PII-free operational event contract. */

export const PRO_DRAFT_OPERATIONAL_EVENT_VERSION = 1;
export const OPERATIONAL_EVENT_TYPES = Object.freeze({
  DRAFT_BOOTSTRAP: 'draft_bootstrap', DRAFT_LOAD: 'draft_load', DRAFT_SAVE: 'draft_save', DRAFT_SAVE_CONFLICT: 'draft_save_conflict', DRAFT_SAVE_RETRY: 'draft_save_retry', DRAFT_OFFLINE: 'draft_offline', DRAFT_RECONNECTED: 'draft_reconnected', DRAFT_RECOVERED_BY_EMAIL: 'draft_recovered_by_email', DRAFT_RECOVERED_BY_CODE: 'draft_recovered_by_code', DRAFT_RECOVERY_FAILED: 'draft_recovery_failed', CAPTCHA_REQUIRED: 'captcha_required', CAPTCHA_FAILED: 'captcha_failed', RECOVERY_LOCKED: 'recovery_locked', CLEAR_ALL_STARTED: 'clear_all_started', CLEAR_ALL_COMPLETED: 'clear_all_completed', CLEAR_ALL_PARTIAL_FAILURE: 'clear_all_partial_failure', START_NEW_COMPLETED: 'start_new_completed', SUBMISSION_STARTED: 'submission_started', SUBMISSION_COMPLETED: 'submission_completed', SUBMISSION_FAILED: 'submission_failed', SUBMITTED_REGRESSION_BLOCKED: 'submitted_regression_blocked', PDF_GENERATED: 'pdf_generated', PDF_FAILED: 'pdf_failed', RECOVERY_EMAIL_SENT: 'recovery_email_sent', RECOVERY_EMAIL_FAILED: 'recovery_email_failed', ZAPIER_DELIVERED: 'zapier_delivered', ZAPIER_SUPPRESSED: 'zapier_suppressed', ZAPIER_FAILED: 'zapier_failed', ADMIN_AUTHORIZATION_SUCCESS: 'admin_authorization_success', ADMIN_AUTHORIZATION_FAILED: 'admin_authorization_failed', ADMIN_OPERATION: 'admin_operation', RLS_DENIAL_EXPECTED: 'rls_denial_expected', RLS_BOUNDARY_FAILURE: 'rls_boundary_failure', MIGRATION_STARTED: 'migration_started', MIGRATION_COMPLETED: 'migration_completed', MIGRATION_CONFLICT: 'migration_conflict', RETENTION_DRY_RUN: 'retention_dry_run', RETENTION_APPLY: 'retention_apply', SYNTHETIC_PROBE: 'synthetic_probe', HEALTH_CHECK: 'health_check', CRITICAL_INVARIANT_FAILURE: 'critical_invariant_failure',
} as const);
export const OPERATIONAL_SEVERITIES = Object.freeze({DEBUG: 'debug', INFO: 'info', WARNING: 'warning', ERROR: 'error', CRITICAL: 'critical'} as const);
export const OPERATIONAL_ERROR_CODES = Object.freeze({INVALID_EVENT: 'OPERATIONAL_EVENT_INVALID', INVALID_METADATA: 'OPERATIONAL_METADATA_INVALID', WRITE_FAILED: 'OPERATIONAL_EVENT_WRITE_FAILED', CONFIGURATION_INVALID: 'OPERATIONAL_CONFIGURATION_INVALID', AUTHORIZATION_DENIED: 'OPERATIONAL_AUTHORIZATION_DENIED'} as const);

export type OperationalEventType = typeof OPERATIONAL_EVENT_TYPES[keyof typeof OPERATIONAL_EVENT_TYPES];
export type OperationalSeverity = typeof OPERATIONAL_SEVERITIES[keyof typeof OPERATIONAL_SEVERITIES];
export type OperationalEvent = Readonly<Record<string, unknown> & {event_id: string; event_type: OperationalEventType; environment: string; severity: OperationalSeverity}>;
type Entity = {create: (event: Record<string, unknown>) => Promise<unknown>};

const TYPES = new Set<string>(Object.values(OPERATIONAL_EVENT_TYPES));
const SEVERITIES = new Set<string>(Object.values(OPERATIONAL_SEVERITIES));
const CRITICAL = new Set<string>(['rls_boundary_failure', 'critical_invariant_failure']);
const ERROR = new Set<string>(['clear_all_partial_failure', 'submission_failed', 'submitted_regression_blocked', 'pdf_failed', 'zapier_failed', 'admin_authorization_failed']);
const WARNING = new Set<string>(['draft_save_conflict', 'draft_save_retry', 'draft_offline', 'draft_recovery_failed', 'captcha_required', 'captcha_failed', 'recovery_locked', 'migration_conflict']);
const SAFE_METADATA_KEYS = new Set(['phase', 'outcome', 'reason', 'provider', 'probe_name', 'policy_version', 'batch_size', 'accepted_count', 'rejected_count', 'conflict_type', 'retention_class', 'failure_streak', 'http_method', 'route']);
const FORBIDDEN_KEY = /(answer|canonical|email|code|token|password|secret|credential|grant|captcha|zapier_url|bundle|draft_id|session_id|source_tab_id)/iu;
const SIMPLE = /^[A-Za-z0-9 ._:/-]{0,128}$/u;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/u;
const FINGERPRINT = /^[0-9a-f]{12,16}$/u;
const ALLOWED_FIELDS = new Set(['event_id', 'event_type', 'environment', 'severity', 'request_id', 'draft_fingerprint', 'session_fingerprint', 'operation', 'status', 'error_code', 'retryable', 'latency_ms', 'retry_count', 'client_revision', 'server_revision', 'storage_mode', 'browser_family', 'device_class', 'app_build_sha', 'function_version', 'source_tab_fingerprint', 'test_run_id', 'metadata_json', 'created_at_server', 'retention_expires_at', 'retention_hold']);

export function severityForOperationalEvent(eventType: OperationalEventType, input: Readonly<{status?: string; errorCode?: string; failureStreak?: number}> = {}): OperationalSeverity {
  if (CRITICAL.has(eventType) || input.errorCode === 'CROSS_CLIENT_LEAKAGE' || input.errorCode === 'LOST_ACKNOWLEDGED_STATE' || input.errorCode === 'MIGRATION_CONTENT_MISMATCH') return 'critical';
  if ((eventType === 'synthetic_probe' || eventType === 'health_check') && input.status === 'failed') return 'error';
  if (input.status === 'failed' && ['draft_save', 'migration_completed', 'retention_apply'].includes(eventType)) return 'error';
  if (input.errorCode === 'CLEANUP_FAILED') return 'error';
  if (eventType === 'recovery_email_failed') return (input.failureStreak ?? 1) > 1 ? 'error' : 'warning';
  if (ERROR.has(eventType)) return 'error';
  if (WARNING.has(eventType)) return 'warning';
  return 'info';
}

function safeMetadataValue(value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000) return value;
  if (typeof value === 'string' && SIMPLE.test(value) && !/@|[?&](token|code|key|secret)=/iu.test(value)) return value;
  throw new Error(OPERATIONAL_ERROR_CODES.INVALID_METADATA);
}

export function buildSafeOperationalMetadata(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_METADATA);
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!SAFE_METADATA_KEYS.has(key) || FORBIDDEN_KEY.test(key)) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_METADATA);
    result[key] = safeMetadataValue(value);
  }
  const encoded = JSON.stringify(result);
  if (encoded.length > 2048) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_METADATA);
  return encoded;
}

export function validateOperationalEvent(input: unknown): OperationalEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_EVENT);
  const event = input as Record<string, unknown>;
  if (Object.keys(event).some((key) => !ALLOWED_FIELDS.has(key))) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_EVENT);
  if (typeof event.event_id !== 'string' || !ID.test(event.event_id) || typeof event.event_type !== 'string' || !TYPES.has(event.event_type) || typeof event.environment !== 'string' || !['local', 'test', 'staging', 'production'].includes(event.environment)) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_EVENT);
  if (typeof event.severity !== 'string' || !SEVERITIES.has(event.severity)) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_EVENT);
  for (const key of ['draft_fingerprint', 'session_fingerprint', 'source_tab_fingerprint']) if (event[key] !== undefined && (typeof event[key] !== 'string' || !FINGERPRINT.test(event[key]))) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_EVENT);
  for (const key of ['latency_ms', 'retry_count', 'client_revision', 'server_revision']) if (event[key] !== undefined && (typeof event[key] !== 'number' || !Number.isFinite(event[key]) || event[key] < 0)) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_EVENT);
  if (event.metadata_json !== undefined) {
    if (typeof event.metadata_json !== 'string') throw new Error(OPERATIONAL_ERROR_CODES.INVALID_METADATA);
    let decoded: unknown; try { decoded = JSON.parse(event.metadata_json); } catch { throw new Error(OPERATIONAL_ERROR_CODES.INVALID_METADATA); }
    if (buildSafeOperationalMetadata(decoded) !== event.metadata_json) throw new Error(OPERATIONAL_ERROR_CODES.INVALID_METADATA);
  }
  return Object.freeze({...event}) as OperationalEvent;
}

export function createOperationalEvent(input: Readonly<Record<string, unknown>>, options: Readonly<{now?: () => Date; randomUUID?: () => string}> = {}): OperationalEvent {
  const eventType = input.event_type as OperationalEventType;
  const metadata = input.metadata_json ?? buildSafeOperationalMetadata(input.metadata);
  const event: Record<string, unknown> = {...input, metadata_json: metadata, event_id: input.event_id ?? (options.randomUUID ?? (() => crypto.randomUUID()))(), severity: input.severity ?? severityForOperationalEvent(eventType, {status: input.status as string, errorCode: input.error_code as string, failureStreak: (input.metadata as Record<string, number> | undefined)?.failure_streak}), created_at_server: input.created_at_server ?? (options.now ?? (() => new Date()))().toISOString()};
  delete event.metadata;
  return validateOperationalEvent(event);
}

export async function recordOperationalEvent(entity: Entity, event: OperationalEvent): Promise<unknown> { return entity.create({...validateOperationalEvent(event)}); }
export async function recordOperationalEventBestEffort(entity: Entity, event: OperationalEvent): Promise<Readonly<{recorded: boolean; errorCode: string | null}>> {
  try { await recordOperationalEvent(entity, event); return Object.freeze({recorded: true, errorCode: null}); }
  catch { return Object.freeze({recorded: false, errorCode: OPERATIONAL_ERROR_CODES.WRITE_FAILED}); }
}
export function getSafeOperationalDiagnostics(input: Readonly<{accepted?: number; rejected?: number; writeFailures?: number}> = {}) { return Object.freeze({version: PRO_DRAFT_OPERATIONAL_EVENT_VERSION, accepted: input.accepted ?? 0, rejected: input.rejected ?? 0, writeFailures: input.writeFailures ?? 0, containsPii: false, containsAnswers: false}); }

function percentile(values: number[], fraction: number): number | null { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(fraction * sorted.length) - 1] ?? sorted[0]; }
export function aggregateOperationalSummary(events: readonly Readonly<Record<string, unknown>>[]) {
  const counts: Record<string, number> = {}; let errors = 0; let critical = 0; let retries = 0;
  const failedCounts: Record<string, number> = {};
  const latency: number[] = [];
  for (const event of events) { const type = String(event.event_type ?? 'unknown'); counts[type] = (counts[type] ?? 0) + 1; if (event.status === 'failed') failedCounts[type] = (failedCounts[type] ?? 0) + 1; if (event.severity === 'error') errors += 1; if (event.severity === 'critical') critical += 1; if (typeof event.retry_count === 'number') retries += event.retry_count; if (typeof event.latency_ms === 'number' && Number.isFinite(event.latency_ms)) latency.push(event.latency_ms); }
  const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : 0;
  return Object.freeze({total: events.length, eventCounts: Object.freeze(counts), errorCount: errors, criticalCount: critical, retryCount: retries, latencyMs: Object.freeze({p50: percentile(latency, .5), p95: percentile(latency, .95), p99: percentile(latency, .99)}), rates: Object.freeze({saveFailure: ratio(failedCounts.draft_save ?? 0, counts.draft_save ?? 0), recoveryFailure: ratio(counts.draft_recovery_failed ?? 0, (counts.draft_recovery_failed ?? 0) + (counts.draft_recovered_by_email ?? 0) + (counts.draft_recovered_by_code ?? 0)), sesFailure: ratio(counts.recovery_email_failed ?? 0, (counts.recovery_email_failed ?? 0) + (counts.recovery_email_sent ?? 0)), submissionFailure: ratio(counts.submission_failed ?? 0, (counts.submission_failed ?? 0) + (counts.submission_completed ?? 0)), conflict: ratio(counts.draft_save_conflict ?? 0, (counts.draft_save_conflict ?? 0) + (counts.draft_save ?? 0))}), rlsCriticalFailures: counts.rls_boundary_failure ?? 0, migrationConflicts: counts.migration_conflict ?? 0, syntheticProbeHealthy: (counts.synthetic_probe ?? 0) > 0 && !events.some((event) => event.event_type === 'synthetic_probe' && event.status === 'failed')});
}
