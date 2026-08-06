/** Deterministic evaluation of aggregate operational metrics into safe alerts. */

export const PRO_DRAFT_ALERT_POLICY_VERSION = 1;
export const ALERT_SEVERITIES = Object.freeze({WARNING: 'warning', URGENT: 'urgent', CRITICAL: 'critical'} as const);
export const ALERT_TYPES = Object.freeze({SAVE_ERROR_RATE: 'save_error_rate', SAVE_P95_LATENCY: 'save_p95_latency', SAVE_P99_LATENCY: 'save_p99_latency', RECOVERY_FAILURE_RATE: 'recovery_failure_rate', CROSS_CLIENT_LEAKAGE: 'cross_client_leakage', RLS_BOUNDARY_FAILURE: 'rls_boundary_failure', SUBMITTED_REGRESSION: 'submitted_regression', LOST_ACKNOWLEDGED_STATE: 'lost_acknowledged_state', SES_FAILURE_RATE: 'ses_failure_rate', SUBMISSION_FAILURE_RATE: 'submission_failure_rate', SYNTHETIC_PROBE_FAILURE: 'synthetic_probe_failure', MIGRATION_INTEGRITY_FAILURE: 'migration_integrity_failure', CLEANUP_FAILURE: 'cleanup_failure', OPERATIONAL_INGEST_UNAVAILABLE: 'operational_ingest_unavailable', ADMIN_LOCKOUT_SPIKE: 'admin_lockout_spike'} as const);
export type AlertSeverity = typeof ALERT_SEVERITIES[keyof typeof ALERT_SEVERITIES];
export type AlertType = typeof ALERT_TYPES[keyof typeof ALERT_TYPES];
export type AlertDecision = Readonly<{type: AlertType; severity: AlertSeverity; threshold: number; observed: number; windowMinutes: number; reasonCode: string}>;
export type AlertMetrics = Readonly<{saveErrorRate?: number; saveP95Ms?: number; saveP99Ms?: number; recoveryFailureRate?: number; expectedRecoveryFailureRate?: number; crossClientLeakageCount?: number; rlsBoundaryFailureCount?: number; submittedRegressionCount?: number; lostAcknowledgedStateCount?: number; sesFailureRate?: number; submissionFailureRate?: number; consecutiveSyntheticProbeFailures?: number; migrationIntegrityFailureCount?: number; cleanupFailureCount?: number; operationalIngestUnavailable?: boolean; adminLockoutCount?: number; adminLockoutSpikeThreshold?: number}>;

export function evaluateProDraftAlertPolicy(metrics: AlertMetrics): readonly AlertDecision[] {
  const alerts: AlertDecision[] = [];
  const add = (type: AlertType, severity: AlertSeverity, threshold: number, observed: number, windowMinutes: number) => alerts.push(Object.freeze({type, severity, threshold, observed, windowMinutes, reasonCode: `ALERT_${type.toUpperCase()}`}));
  if ((metrics.saveErrorRate ?? 0) > .01) add(ALERT_TYPES.SAVE_ERROR_RATE, 'urgent', .01, metrics.saveErrorRate!, 5);
  if ((metrics.saveP95Ms ?? 0) > 5000) add(ALERT_TYPES.SAVE_P95_LATENCY, 'warning', 5000, metrics.saveP95Ms!, 5);
  if ((metrics.saveP99Ms ?? 0) > 10000) add(ALERT_TYPES.SAVE_P99_LATENCY, 'urgent', 10000, metrics.saveP99Ms!, 5);
  const recoveryThreshold = Math.max(metrics.expectedRecoveryFailureRate ?? .05, .01);
  if ((metrics.recoveryFailureRate ?? 0) > recoveryThreshold) add(ALERT_TYPES.RECOVERY_FAILURE_RATE, 'warning', recoveryThreshold, metrics.recoveryFailureRate!, 15);
  if ((metrics.crossClientLeakageCount ?? 0) > 0) add(ALERT_TYPES.CROSS_CLIENT_LEAKAGE, 'critical', 0, metrics.crossClientLeakageCount!, 5);
  if ((metrics.rlsBoundaryFailureCount ?? 0) > 0) add(ALERT_TYPES.RLS_BOUNDARY_FAILURE, 'critical', 0, metrics.rlsBoundaryFailureCount!, 5);
  if ((metrics.submittedRegressionCount ?? 0) > 0) add(ALERT_TYPES.SUBMITTED_REGRESSION, 'critical', 0, metrics.submittedRegressionCount!, 5);
  if ((metrics.lostAcknowledgedStateCount ?? 0) > 0) add(ALERT_TYPES.LOST_ACKNOWLEDGED_STATE, 'critical', 0, metrics.lostAcknowledgedStateCount!, 5);
  if ((metrics.sesFailureRate ?? 0) > .05) add(ALERT_TYPES.SES_FAILURE_RATE, 'urgent', .05, metrics.sesFailureRate!, 15);
  if ((metrics.submissionFailureRate ?? 0) > .02) add(ALERT_TYPES.SUBMISSION_FAILURE_RATE, 'urgent', .02, metrics.submissionFailureRate!, 15);
  if ((metrics.consecutiveSyntheticProbeFailures ?? 0) >= 2) add(ALERT_TYPES.SYNTHETIC_PROBE_FAILURE, 'urgent', 2, metrics.consecutiveSyntheticProbeFailures!, 30);
  if ((metrics.migrationIntegrityFailureCount ?? 0) > 0) add(ALERT_TYPES.MIGRATION_INTEGRITY_FAILURE, 'critical', 0, metrics.migrationIntegrityFailureCount!, 5);
  if ((metrics.cleanupFailureCount ?? 0) > 0) add(ALERT_TYPES.CLEANUP_FAILURE, 'urgent', 0, metrics.cleanupFailureCount!, 15);
  if (metrics.operationalIngestUnavailable === true) add(ALERT_TYPES.OPERATIONAL_INGEST_UNAVAILABLE, 'urgent', 0, 1, 5);
  const lockoutThreshold = metrics.adminLockoutSpikeThreshold ?? 10;
  if ((metrics.adminLockoutCount ?? 0) > lockoutThreshold) add(ALERT_TYPES.ADMIN_LOCKOUT_SPIKE, 'warning', lockoutThreshold, metrics.adminLockoutCount!, 15);
  return Object.freeze(alerts);
}

export function getSafeAlertPolicyDiagnostics() { return Object.freeze({version: PRO_DRAFT_ALERT_POLICY_VERSION, ruleCount: Object.keys(ALERT_TYPES).length, usesAggregatesOnly: true, containsPii: false}); }
