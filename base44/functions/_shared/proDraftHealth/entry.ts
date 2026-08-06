/** Safe health-result contract shared by public and administrative endpoints. */

export const PRO_DRAFT_HEALTH_VERSION = 1;
export const HEALTH_COMPONENTS = Object.freeze({
  FRONTEND: 'frontend', RUNTIME_CONFIG: 'runtime_config', DRAFT_BOOTSTRAP: 'draft_bootstrap', DRAFT_SAVE: 'draft_save', DRAFT_LOAD: 'draft_load', PUBLIC_RECOVERY: 'public_recovery', ADMIN_RECOVERY: 'admin_recovery', OPERATIONAL_EVENTS: 'operational_events', SES: 'ses', EXTERNAL_SUBMISSION: 'external_submission', PDF: 'pdf', MIGRATION: 'migration', RETENTION: 'retention', DATABASE: 'database', RLS: 'rls',
} as const);
export const HEALTH_STATUSES = Object.freeze({HEALTHY: 'healthy', DEGRADED: 'degraded', UNHEALTHY: 'unhealthy', DISABLED: 'disabled', UNKNOWN: 'unknown'} as const);
export const HEALTH_ERROR_CODES = Object.freeze({INVALID_COMPONENT: 'HEALTH_COMPONENT_INVALID', INVALID_STATUS: 'HEALTH_STATUS_INVALID', INVALID_RESULT: 'HEALTH_RESULT_INVALID', CHECK_FAILED: 'HEALTH_CHECK_FAILED', TIMEOUT: 'HEALTH_CHECK_TIMEOUT', AUTHORIZATION_REQUIRED: 'HEALTH_AUTHORIZATION_REQUIRED'} as const);
export type HealthComponent = typeof HEALTH_COMPONENTS[keyof typeof HEALTH_COMPONENTS];
export type HealthStatus = typeof HEALTH_STATUSES[keyof typeof HEALTH_STATUSES];
export type HealthComponentResult = Readonly<{component: HealthComponent; status: HealthStatus; errorCode: string | null; latencyMs: number | null; checkedAt: string; details: Readonly<Record<string, string | number | boolean | null>>}>;
const COMPONENTS = new Set<string>(Object.values(HEALTH_COMPONENTS));
const STATUSES = new Set<string>(Object.values(HEALTH_STATUSES));
const DETAIL_KEYS = new Set(['available', 'configured', 'enabled', 'version', 'mode', 'recentCriticalCount', 'pendingCount', 'failureCount', 'lastSuccessAt', 'p95LatencyMs', 'p99LatencyMs']);
const METRIC_KEYS = new Set(['saveP95LatencyMs', 'saveP99LatencyMs', 'saveFailureRate', 'recoveryFailureRate', 'conflictRate', 'submissionFailureRate', 'sesFailureRate', 'recentCriticalCount', 'pendingMigrationConflicts', 'pendingReplacementTransactions', 'cleanupFailureCount']);
const FLAG_KEYS = new Set(['durableDraftV2Enabled', 'killSwitchEnabled', 'publicEmailRecoveryEnabled', 'emailOtpEnabled', 'magicLinkEnabled', 'diagnosticsEnabled', 'externalSideEffectsMode']);
const PROBE_KEYS = new Set(['status', 'checkedAt', 'errorCode']);
const CRITICAL_EVENT_KEYS = new Set(['eventType', 'severity', 'status', 'requestId', 'draftFingerprint', 'checkedAt', 'errorCode']);
const SAFE = /^[A-Za-z0-9 ._:/-]{0,128}$/u;
const safeText = (value: unknown) => typeof value === 'string' && SAFE.test(value) && !value.includes('@');
function safeRecord(input: Readonly<Record<string, unknown>> | undefined, keys: ReadonlySet<string>, value: (input: unknown) => boolean) {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input ?? {})) {
    if (!keys.has(key) || !value(item)) throw new Error(HEALTH_ERROR_CODES.INVALID_RESULT);
    result[key] = item;
  }
  return Object.freeze(result);
}

export function buildHealthComponentResult(input: Readonly<{component: HealthComponent; status: HealthStatus; errorCode?: string | null; latencyMs?: number | null; checkedAt?: string; details?: Readonly<Record<string, unknown>>}>): HealthComponentResult {
  if (!COMPONENTS.has(input.component)) throw new Error(HEALTH_ERROR_CODES.INVALID_COMPONENT);
  if (!STATUSES.has(input.status)) throw new Error(HEALTH_ERROR_CODES.INVALID_STATUS);
  const details: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input.details ?? {})) {
    if (!DETAIL_KEYS.has(key)) throw new Error(HEALTH_ERROR_CODES.INVALID_RESULT);
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && SAFE.test(value) && !value.includes('@'))) details[key] = value as string | number | boolean | null;
    else throw new Error(HEALTH_ERROR_CODES.INVALID_RESULT);
  }
  const latencyMs = input.latencyMs ?? null;
  if (latencyMs !== null && (!Number.isFinite(latencyMs) || latencyMs < 0)) throw new Error(HEALTH_ERROR_CODES.INVALID_RESULT);
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(checkedAt))) throw new Error(HEALTH_ERROR_CODES.INVALID_RESULT);
  const errorCode = input.errorCode ?? null;
  if (errorCode !== null && !/^[A-Z0-9_]{1,128}$/u.test(errorCode)) throw new Error(HEALTH_ERROR_CODES.INVALID_RESULT);
  return Object.freeze({component: input.component, status: input.status, errorCode, latencyMs, checkedAt, details: Object.freeze(details)});
}

export function aggregateHealthStatus(results: readonly HealthComponentResult[]): HealthStatus {
  if (!Array.isArray(results) || results.length === 0) return HEALTH_STATUSES.UNKNOWN;
  if (results.some((result) => result.status === HEALTH_STATUSES.UNHEALTHY)) return HEALTH_STATUSES.UNHEALTHY;
  if (results.some((result) => result.status === HEALTH_STATUSES.DEGRADED || result.status === HEALTH_STATUSES.UNKNOWN)) return HEALTH_STATUSES.DEGRADED;
  if (results.every((result) => result.status === HEALTH_STATUSES.DISABLED)) return HEALTH_STATUSES.DISABLED;
  return HEALTH_STATUSES.HEALTHY;
}

export function getSafePublicHealthProjection(input: Readonly<{components: readonly HealthComponentResult[]; environment: string; buildSha: string; checkedAt: string; requestId: string}>) {
  if (!['local', 'test', 'staging', 'production', 'unknown'].includes(input.environment) || !safeText(input.buildSha) || !safeText(input.requestId) || Number.isNaN(Date.parse(input.checkedAt))) throw new Error(HEALTH_ERROR_CODES.INVALID_RESULT);
  return Object.freeze({success: true, status: aggregateHealthStatus(input.components), environment: input.environment, buildSha: input.buildSha, checkedAt: input.checkedAt, requestId: input.requestId});
}

export function getSafeAdminHealthProjection(input: Readonly<{components: readonly HealthComponentResult[]; environment: string; buildSha: string; checkedAt: string; requestId: string; metrics?: Readonly<Record<string, unknown>>; secrets?: Readonly<Record<string, boolean>>; featureFlags?: Readonly<Record<string, boolean | string>>; lastSyntheticProbe?: Readonly<Record<string, unknown>> | null; criticalEvents?: readonly Readonly<Record<string, unknown>>[]; criticalPagination?: Readonly<Record<string, number | boolean>>}>) {
  const common = getSafePublicHealthProjection(input);
  const secrets = safeRecord(input.secrets, new Set(Object.keys(input.secrets ?? {})), (value) => typeof value === 'boolean');
  const metrics = safeRecord(input.metrics, METRIC_KEYS, (value) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0));
  const featureFlags = safeRecord(input.featureFlags, FLAG_KEYS, (value) => typeof value === 'boolean' || safeText(value));
  const lastSyntheticProbe = input.lastSyntheticProbe ? safeRecord(input.lastSyntheticProbe, PROBE_KEYS, (value) => value === null || safeText(value)) : null;
  const criticalEvents = Object.freeze((input.criticalEvents ?? []).map((event) => safeRecord(event, CRITICAL_EVENT_KEYS, (value) => value === null || safeText(value))));
  const criticalPagination = safeRecord(input.criticalPagination, new Set(['offset', 'limit', 'hasMore']), (value) => typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0));
  return Object.freeze({...common, apiVersion: PRO_DRAFT_HEALTH_VERSION, components: Object.freeze(input.components.map((item) => Object.freeze({...item, details: Object.freeze({...item.details})}))), requiredSecretsPresent: secrets, featureFlags, metrics, lastSyntheticProbe, criticalEvents, criticalPagination, containsSecretValues: false, containsPii: false});
}

export function getSafeHealthDiagnostics(results: readonly HealthComponentResult[] = []) { return Object.freeze({version: PRO_DRAFT_HEALTH_VERSION, componentCount: results.length, status: aggregateHealthStatus(results), publicDetailsExposed: false, containsSecretValues: false, containsPii: false, writesEntities: false}); }
