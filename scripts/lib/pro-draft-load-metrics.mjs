export const LOAD_METRIC_NAMES = Object.freeze([
  'bootstrap',
  'local_save',
  'server_save',
  'load',
  'recovery_code',
  'recovery_email',
  'conflict',
  'submission_lock',
  'cleanup',
]);

export const LOAD_RELEASE_THRESHOLDS = Object.freeze({
  successfulPathErrorRateExclusive: 0.001,
  lostAcknowledgedStateMaximum: 0,
  crossClientLeakageMaximum: 0,
  submittedRegressionMaximum: 0,
  securityBoundaryFailureMaximum: 0,
  serverSaveP95MillisecondsMaximum: 2_500,
  serverSaveP99MillisecondsMaximum: 5_000,
  loadP95MillisecondsMaximum: 3_000,
  bootstrapP95MillisecondsMaximum: 4_000,
  conflictInvariantFailureMaximum: 0,
  eventRowsPerLogicalMutationMaximum: 2,
  cleanupUnresolvedRecordsMaximum: 0,
});

const finiteNonnegative = (value) => (
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
);

export const calculatePercentile = (values, percentile) => {
  const sorted = values.map(finiteNonnegative).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const rank = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)];
};

export const summarizeLatency = (values) => Object.freeze({
  count: values.length,
  p50: calculatePercentile(values, 50),
  p90: calculatePercentile(values, 90),
  p95: calculatePercentile(values, 95),
  p99: calculatePercentile(values, 99),
  max: values.length === 0 ? null : Math.max(...values.map(finiteNonnegative)),
});

export const createLoadMetricsCollector = ({ now = () => Date.now() } = {}) => {
  const startedAt = now();
  const latencies = Object.fromEntries(LOAD_METRIC_NAMES.map((name) => [name, []]));
  const counters = {
    attempts: 0,
    successfulAttempts: 0,
    unexpectedErrors: 0,
    retryCount: 0,
    fourXxCount: 0,
    fiveXxCount: 0,
    timeoutCount: 0,
    authorizationFailureCount: 0,
    rlsFailureCount: 0,
    conflictCount: 0,
    automaticMergeCount: 0,
    userChoiceConflictCount: 0,
    submittedRegressionCount: 0,
    lostAcknowledgedStateCount: 0,
    crossClientLeakageCount: 0,
    conflictInvariantFailureCount: 0,
    cleanupFailureCount: 0,
    dataIntegrityMismatchCount: 0,
    eventRows: 0,
    logicalMutations: 0,
    requests: 0,
    maxActiveSessions: 0,
  };

  const record = ({
    operation,
    durationMs = 0,
    status = 200,
    success = true,
    expectedFailure = false,
    retried = false,
    timedOut = false,
    errorCode = '',
    eventRows = 0,
    logicalMutations = 0,
    requests = 1,
    activeSessions = 0,
  }) => {
    if (latencies[operation]) latencies[operation].push(finiteNonnegative(durationMs));
    counters.attempts += 1;
    counters.requests += finiteNonnegative(requests);
    counters.eventRows += finiteNonnegative(eventRows);
    counters.logicalMutations += finiteNonnegative(logicalMutations);
    counters.maxActiveSessions = Math.max(counters.maxActiveSessions, finiteNonnegative(activeSessions));
    if (retried) counters.retryCount += 1;
    if (timedOut) counters.timeoutCount += 1;
    if (status >= 400 && status < 500) counters.fourXxCount += 1;
    if (status >= 500) counters.fiveXxCount += 1;
    if (status === 401 || status === 403) counters.authorizationFailureCount += 1;
    if (/RLS|ROW_LEVEL_SECURITY/u.test(String(errorCode))) counters.rlsFailureCount += 1;
    if (success) counters.successfulAttempts += 1;
    else if (!expectedFailure) counters.unexpectedErrors += 1;
  };

  const increment = (name, amount = 1) => {
    if (!Object.hasOwn(counters, name)) throw new Error('LOAD_METRIC_COUNTER_UNKNOWN');
    counters[name] += finiteNonnegative(amount);
  };

  const observeActiveSessions = (amount) => {
    counters.maxActiveSessions = Math.max(
      counters.maxActiveSessions,
      finiteNonnegative(amount),
    );
  };

  const summarize = () => {
    const elapsedMs = Math.max(1, now() - startedAt);
    const successfulPathAttempts = counters.successfulAttempts + counters.unexpectedErrors;
    return Object.freeze({
      counters: Object.freeze({ ...counters }),
      successfulPathErrorRate: successfulPathAttempts === 0
        ? 0
        : counters.unexpectedErrors / successfulPathAttempts,
      eventRowsPerLogicalMutation: counters.logicalMutations === 0
        ? 0
        : counters.eventRows / counters.logicalMutations,
      requestsPerLogicalMutation: counters.logicalMutations === 0
        ? 0
        : counters.requests / counters.logicalMutations,
      throughputPerSecond: counters.successfulAttempts / (elapsedMs / 1_000),
      elapsedMs,
      latency: Object.freeze(Object.fromEntries(Object.entries(latencies)
        .map(([name, values]) => [name, summarizeLatency(values)]))),
    });
  };

  return Object.freeze({ increment, observeActiveSessions, record, summarize });
};

const check = (id, observed, operator, threshold, passed) => Object.freeze({
  id,
  observed,
  operator,
  threshold,
  passed,
});

export const evaluateLoadThresholds = ({ metrics, cleanup }, thresholds = LOAD_RELEASE_THRESHOLDS) => {
  const counters = metrics.counters;
  const checks = [
    check('successful_path_error_rate', metrics.successfulPathErrorRate, '<', thresholds.successfulPathErrorRateExclusive, metrics.successfulPathErrorRate < thresholds.successfulPathErrorRateExclusive),
    check('lost_acknowledged_state', counters.lostAcknowledgedStateCount, '<=', thresholds.lostAcknowledgedStateMaximum, counters.lostAcknowledgedStateCount <= thresholds.lostAcknowledgedStateMaximum),
    check('cross_client_leakage', counters.crossClientLeakageCount, '<=', thresholds.crossClientLeakageMaximum, counters.crossClientLeakageCount <= thresholds.crossClientLeakageMaximum),
    check('submitted_regression', counters.submittedRegressionCount, '<=', thresholds.submittedRegressionMaximum, counters.submittedRegressionCount <= thresholds.submittedRegressionMaximum),
    check('security_boundary_failure', counters.rlsFailureCount, '<=', thresholds.securityBoundaryFailureMaximum, counters.rlsFailureCount <= thresholds.securityBoundaryFailureMaximum),
    check('server_save_p95_ms', metrics.latency.server_save.p95, '<=', thresholds.serverSaveP95MillisecondsMaximum, metrics.latency.server_save.p95 === null || metrics.latency.server_save.p95 <= thresholds.serverSaveP95MillisecondsMaximum),
    check('server_save_p99_ms', metrics.latency.server_save.p99, '<=', thresholds.serverSaveP99MillisecondsMaximum, metrics.latency.server_save.p99 === null || metrics.latency.server_save.p99 <= thresholds.serverSaveP99MillisecondsMaximum),
    check('draft_load_p95_ms', metrics.latency.load.p95, '<=', thresholds.loadP95MillisecondsMaximum, metrics.latency.load.p95 === null || metrics.latency.load.p95 <= thresholds.loadP95MillisecondsMaximum),
    check('bootstrap_p95_ms', metrics.latency.bootstrap.p95, '<=', thresholds.bootstrapP95MillisecondsMaximum, metrics.latency.bootstrap.p95 === null || metrics.latency.bootstrap.p95 <= thresholds.bootstrapP95MillisecondsMaximum),
    check('conflict_invariant_failure', counters.conflictInvariantFailureCount, '<=', thresholds.conflictInvariantFailureMaximum, counters.conflictInvariantFailureCount <= thresholds.conflictInvariantFailureMaximum),
    check('event_amplification', metrics.eventRowsPerLogicalMutation, '<=', thresholds.eventRowsPerLogicalMutationMaximum, metrics.eventRowsPerLogicalMutation <= thresholds.eventRowsPerLogicalMutationMaximum),
    check('cleanup_unresolved_records', cleanup.unresolvedRecords, '<=', thresholds.cleanupUnresolvedRecordsMaximum, cleanup.unresolvedRecords <= thresholds.cleanupUnresolvedRecordsMaximum),
  ];
  return Object.freeze({
    checks: Object.freeze(checks),
    passed: checks.every((entry) => entry.passed),
    thresholds,
  });
};
