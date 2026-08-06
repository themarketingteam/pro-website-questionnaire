import { base44 } from '@/api/base44Client';

const MAX_QUEUE_SIZE = 50;
const PUBLIC_TYPES = new Set(['draft_bootstrap', 'draft_load', 'draft_save', 'draft_save_conflict', 'draft_save_retry', 'draft_offline', 'draft_reconnected', 'draft_recovered_by_email', 'draft_recovered_by_code', 'draft_recovery_failed', 'captcha_required', 'captcha_failed', 'recovery_locked', 'clear_all_started', 'clear_all_completed', 'clear_all_partial_failure', 'start_new_completed', 'submission_started', 'submission_completed', 'submission_failed', 'submitted_regression_blocked', 'pdf_generated', 'pdf_failed', 'critical_invariant_failure']);
const EVENT_KEYS = new Set(['event_type', 'operation', 'status', 'error_code', 'retryable', 'latency_ms', 'retry_count', 'client_revision', 'server_revision', 'storage_mode', 'browser_family', 'device_class', 'app_build_sha', 'function_version', 'metadata']);
const METADATA_KEYS = new Set(['phase', 'outcome', 'reason', 'probe_name', 'failure_streak', 'http_method', 'route']);
const FORBIDDEN = /(answer|canonical|email|recovery_code|resume_token|session_token|password|secret|credential|admin_grant|captcha_token|bundle|draft_id|session_id|source_tab_id|fingerprint)/iu;
const SAFE_TEXT = /^[A-Za-z0-9 ._:/-]{0,128}$/u;

function safePrimitive(value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && SAFE_TEXT.test(value) && !value.includes('@')) return value;
  throw new Error('CLIENT_OPERATIONAL_METADATA_INVALID');
}

export function sanitizeClientOperationalMetadata(input) {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('CLIENT_OPERATIONAL_METADATA_INVALID');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (!METADATA_KEYS.has(key) || FORBIDDEN.test(key)) throw new Error('CLIENT_OPERATIONAL_METADATA_INVALID');
    result[key] = safePrimitive(value);
  }
  return Object.freeze(result);
}

function sanitizeEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !PUBLIC_TYPES.has(input.event_type)) throw new Error('CLIENT_OPERATIONAL_EVENT_INVALID');
  if (Object.keys(input).some((key) => !EVENT_KEYS.has(key) || FORBIDDEN.test(key))) throw new Error('CLIENT_OPERATIONAL_EVENT_INVALID');
  return Object.freeze({...input, metadata: sanitizeClientOperationalMetadata(input.metadata)});
}

export function createProDraftOperationalTelemetry(options = {}) {
  const queue = [];
  const invoke = options.invoke ?? ((body) => base44.functions.invoke('recordProDraftOperationalEvents', body));
  const maxQueueSize = Math.min(Math.max(options.maxQueueSize ?? MAX_QUEUE_SIZE, 1), MAX_QUEUE_SIZE);
  let dropped = 0; let sent = 0; let failures = 0;
  const record = (event) => { const safe = sanitizeEvent(event); if (queue.length === maxQueueSize) { queue.shift(); dropped += 1; } queue.push(safe); return safe; };
  const flush = async (authorization, testRunId) => {
    if (!queue.length) return {accepted: 0, rejected: 0};
    const batch = queue.splice(0, MAX_QUEUE_SIZE);
    try { const response = await invoke({apiVersion: 1, authorization, events: batch, ...(testRunId ? {testRunId} : {})}); sent += batch.length; return response?.data ?? response; }
    catch { failures += 1; queue.unshift(...batch.slice(-(maxQueueSize - queue.length))); return {accepted: 0, rejected: batch.length}; }
  };
  const recordBestEffort = (event) => { try { record(event); return true; } catch { failures += 1; return false; } };
  const diagnostics = () => Object.freeze({version: 1, queued: queue.length, maxQueueSize, sent, dropped, failures, authoritativeState: false, containsPii: false, containsAnswers: false});
  return Object.freeze({record, recordBestEffort, flush, getSafeDiagnostics: diagnostics});
}

export const defaultProDraftOperationalTelemetry = createProDraftOperationalTelemetry();
export function recordClientOperationalEvent(event) { return defaultProDraftOperationalTelemetry.record(event); }
export function recordClientOperationalEventBestEffort(event) { return defaultProDraftOperationalTelemetry.recordBestEffort(event); }
export function getSafeClientTelemetryDiagnostics() { return defaultProDraftOperationalTelemetry.getSafeDiagnostics(); }
