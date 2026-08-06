export const PRO_DRAFT_CLIENT_FAILURE_KINDS = Object.freeze({
  AUTHORIZATION: 'authorization_required',
  SERVICE_CONFIGURATION: 'service_configuration',
  FEATURE_DISABLED: 'feature_disabled',
  KILL_SWITCH: 'kill_switch',
  NETWORK: 'network',
  CONFLICT: 'conflict',
  LOCKED: 'submitted_or_superseded_lock',
  RATE_LIMIT: 'rate_limit',
  INVALID_REQUEST: 'invalid_request',
  UNKNOWN: 'unknown',
});

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,95}$/u;
const SAFE_REQUEST_ID = /^pdrq_[A-Za-z0-9_-]{20,123}$/u;

const isObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);

const boundedStatus = (value) => (
  Number.isSafeInteger(value) && value >= 400 && value <= 599 ? value : 500
);

const boundedRetry = (value) => (
  Number.isSafeInteger(value) && value >= 0 && value <= 86_400 ? value : 0
);

const signalText = (error, body) => [
  error?.name,
  error?.code,
  error?.message,
  error?.statusText,
  body?.errorCode,
  body?.code,
  body?.message,
].filter((value) => typeof value === 'string').join(' ').toLowerCase();

function classify({ status, signal, killSwitchEnabled, featureDisabled, hasResponse }) {
  if (killSwitchEnabled) return PRO_DRAFT_CLIENT_FAILURE_KINDS.KILL_SWITCH;
  if (featureDisabled || /feature[_ -]?disabled|client[_ -]?disabled/u.test(signal)) {
    return PRO_DRAFT_CLIENT_FAILURE_KINDS.FEATURE_DISABLED;
  }
  if (/row[_ -]?level|\brls\b|service[_ -]?role|permission[_ -]?configuration|policy[_ -]?(?:denied|error)/u.test(signal)) {
    return PRO_DRAFT_CLIENT_FAILURE_KINDS.SERVICE_CONFIGURATION;
  }
  if (status === 401 || status === 403 || /unauthori[sz]ed|authorization[_ -]?(?:denied|required)|invalid[_ -]?grant|expired[_ -]?(?:session|token)/u.test(signal)) {
    return PRO_DRAFT_CLIENT_FAILURE_KINDS.AUTHORIZATION;
  }
  if (/submitted|superseded|read[_ -]?only|draft[_ -]?locked|submission[_ -]?lock/u.test(signal)) {
    return PRO_DRAFT_CLIENT_FAILURE_KINDS.LOCKED;
  }
  if (status === 409 || /conflict|revision[_ -]?mismatch/u.test(signal)) {
    return PRO_DRAFT_CLIENT_FAILURE_KINDS.CONFLICT;
  }
  if (status === 429 || /rate[_ -]?limit|too many requests|retry[_ -]?backoff/u.test(signal)) {
    return PRO_DRAFT_CLIENT_FAILURE_KINDS.RATE_LIMIT;
  }
  if (status === 400 || status === 413 || status === 422 || /invalid[_ -]?request/u.test(signal)) {
    return PRO_DRAFT_CLIENT_FAILURE_KINDS.INVALID_REQUEST;
  }
  if (!hasResponse || /network|failed to fetch|timeout|timed out|offline|load failed/u.test(signal)) {
    return PRO_DRAFT_CLIENT_FAILURE_KINDS.NETWORK;
  }
  if (status >= 500) return PRO_DRAFT_CLIENT_FAILURE_KINDS.NETWORK;
  return PRO_DRAFT_CLIENT_FAILURE_KINDS.UNKNOWN;
}

function safeCode(kind, candidate, fallbackCode) {
  if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.SERVICE_CONFIGURATION) {
    return 'DRAFT_SERVICE_CONFIGURATION_ERROR';
  }
  if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.AUTHORIZATION) {
    return 'DRAFT_AUTHORIZATION_REQUIRED';
  }
  if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.KILL_SWITCH) {
    return 'DRAFT_KILL_SWITCH_ENABLED';
  }
  if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.FEATURE_DISABLED) {
    return 'DRAFT_FEATURE_DISABLED';
  }
  return typeof candidate === 'string' && SAFE_CODE.test(candidate)
    ? candidate
    : fallbackCode;
}

function publicMessage(kind, audience) {
  if (audience === 'recovery') {
    return 'We could not recover a questionnaire with the information provided.';
  }
  if (audience === 'admin') {
    if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.AUTHORIZATION) {
      return 'Administrative recovery authorization is required.';
    }
    if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.SERVICE_CONFIGURATION) {
      return 'The administrative recovery service is not configured correctly.';
    }
    return 'The administrative recovery request failed.';
  }
  if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.AUTHORIZATION) {
    return 'Draft authorization could not be verified.';
  }
  if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.CONFLICT) {
    return 'The draft changed and must be refreshed before retrying.';
  }
  if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.LOCKED) {
    return 'This questionnaire is read-only because it was submitted or replaced.';
  }
  if (kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.KILL_SWITCH
    || kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.FEATURE_DISABLED) {
    return 'Server draft saving is paused. Your browser data has been preserved.';
  }
  return 'The draft service is temporarily unavailable.';
}

export function normalizeProDraftClientError(error = {}, options = {}) {
  const response = isObject(error?.response) ? error.response : {};
  const body = isObject(response.data) ? response.data : {};
  const status = boundedStatus(response.status ?? error?.status);
  const signal = signalText(error, body);
  const kind = classify({
    status,
    signal,
    killSwitchEnabled: options.killSwitchEnabled === true,
    featureDisabled: options.featureDisabled === true,
    hasResponse: isObject(error?.response),
  });
  const retryAfterSeconds = boundedRetry(body.retryAfterSeconds);
  const retryable = kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.NETWORK
    || kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.RATE_LIMIT;
  return Object.freeze({
    code: safeCode(kind, body.errorCode ?? error?.code, options.fallbackCode || 'DRAFT_REQUEST_FAILED'),
    kind,
    status,
    message: publicMessage(kind, options.audience || 'draft'),
    retryable,
    retryAfterSeconds,
    requestId: typeof body.requestId === 'string' && SAFE_REQUEST_ID.test(body.requestId)
      ? body.requestId : null,
    authorizationRequired: kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.AUTHORIZATION,
    reauthorizeAdmin: options.audience === 'admin'
      && kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.AUTHORIZATION,
    recoveryRequired: options.audience !== 'admin'
      && kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.AUTHORIZATION,
    configurationError: kind === PRO_DRAFT_CLIENT_FAILURE_KINDS.SERVICE_CONFIGURATION,
    preserveLocalState: true,
    exposeRawError: false,
  });
}

export function emitSafeDraftClientMetric(onSafeMetric, details) {
  if (typeof onSafeMetric !== 'function') return false;
  onSafeMetric(Object.freeze({
    operation: typeof details?.operation === 'string' ? details.operation : 'unknown',
    kind: Object.values(PRO_DRAFT_CLIENT_FAILURE_KINDS).includes(details?.kind)
      ? details.kind : PRO_DRAFT_CLIENT_FAILURE_KINDS.UNKNOWN,
    status: boundedStatus(details?.status),
    retryable: details?.retryable === true,
  }));
  return true;
}
