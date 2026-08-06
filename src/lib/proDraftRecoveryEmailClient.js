import { base44 } from '@/api/base44Client';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
} from '@/lib/proDraftRuntimeConfig';
import {
  emitSafeDraftClientMetric,
  normalizeProDraftClientError,
} from '@/lib/proDraftClientErrorPolicy';

export const PRO_DRAFT_RECOVERY_EMAIL_CLIENT_VERSION = 1;
export const PRO_DRAFT_RECOVERY_EMAIL_FUNCTION_NAME =
  'sendProFormDraftRecoveryCodeEmail';

const SAFE_REQUEST_ID = /^pdrq_[A-Za-z0-9_-]{20,123}$/u;
const SAFE_ERROR_CODES = new Set([
  'FEATURE_DISABLED',
  'INVALID_REQUEST',
  'PURPOSE_NOT_ALLOWED',
  'AUTHORIZATION_DENIED',
  'RECOVERY_EMAIL_DELIVERY_DENIED',
  'DRAFT_RELATIONSHIP_INVALID',
  'RECOVERY_EMAIL_UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'DELIVERY_IN_PROGRESS',
  'RETRY_BACKOFF',
  'MAX_ATTEMPTS',
  'RECOVERY_EMAIL_DELIVERY_FAILED',
  'RECOVERY_EMAIL_DELIVERY_UNCERTAIN',
]);
const SAFE_STATUSES = new Set(['sent', 'delivery_uncertain']);
const GENERIC_MESSAGE = 'Recovery email delivery could not be completed.';
const REQUEST_KEYS = new Set([
  'authorization',
  'draftId',
  'recoveryCode',
  'purpose',
  'idempotencyKey',
  'testRunId',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeRequestId(value) {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value) ? value : null;
}

function retrySeconds(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 3600 ? value : 0;
}

export function normalizeRecoveryEmailDeliveryError(value = {}, normalized = null) {
  const body = isPlainObject(value) ? value : {};
  return Object.freeze({
    success: false,
    requestId: safeRequestId(body.requestId),
    errorCode: typeof body.errorCode === 'string' && SAFE_ERROR_CODES.has(body.errorCode)
      ? body.errorCode
      : 'RECOVERY_EMAIL_DELIVERY_FAILED',
    message: GENERIC_MESSAGE,
    delivered: false,
    canRetry: body.canRetry === true,
    retryAfterSeconds: retrySeconds(body.retryAfterSeconds),
    deliveryUncertain: body.deliveryUncertain === true,
    failureKind: normalized?.kind || 'unknown',
    authorizationRequired: normalized?.authorizationRequired === true,
    configurationError: normalized?.configurationError === true,
    preserveLocalState: true,
  });
}

function normalizeSuccess(value) {
  if (!isPlainObject(value)
    || value.success !== true
    || !safeRequestId(value.requestId)
    || typeof value.delivered !== 'boolean'
    || typeof value.redirected !== 'boolean'
    || typeof value.suppressed !== 'boolean'
    || typeof value.idempotent !== 'boolean'
    || typeof value.deliveryUncertain !== 'boolean'
    || typeof value.status !== 'string'
    || !SAFE_STATUSES.has(value.status)) return null;
  return Object.freeze({
    success: true,
    requestId: value.requestId,
    delivered: value.delivered,
    redirected: value.redirected,
    suppressed: value.suppressed,
    idempotent: value.idempotent,
    deliveryUncertain: value.deliveryUncertain,
    status: value.status,
    canRetry: value.canRetry === true,
    retryAfterSeconds: retrySeconds(value.retryAfterSeconds),
  });
}

export function createProDraftRecoveryEmailClient({
  client = base44,
  runtimeConfig = frontendRuntimeConfig,
  onSafeMetric = undefined,
} = {}) {
  const invoke = client?.functions?.invoke;
  const available = typeof invoke === 'function';
  const enabled = isDurableDraftClientEnabled(runtimeConfig);

  const call = async (request) => {
    if (!available
      || !enabled
      || !isPlainObject(request)
      || Object.keys(request).some((key) => !REQUEST_KEYS.has(key))) {
      const normalized = normalizeProDraftClientError({}, {
        audience: 'recovery',
        featureDisabled: !enabled,
        killSwitchEnabled: runtimeConfig?.killSwitchEnabled === true,
        fallbackCode: 'RECOVERY_EMAIL_DELIVERY_FAILED',
      });
      return normalizeRecoveryEmailDeliveryError({}, normalized);
    }
    const input = Object.freeze({ ...request, apiVersion: 1 });
    try {
      const response = await invoke.call(
        client.functions,
        PRO_DRAFT_RECOVERY_EMAIL_FUNCTION_NAME,
        input,
      );
      const body = isPlainObject(response) && isPlainObject(response.data)
        ? response.data
        : null;
      if (!body) return normalizeRecoveryEmailDeliveryError();
      return body.success === true
        ? normalizeSuccess(body) ?? normalizeRecoveryEmailDeliveryError(body)
        : normalizeRecoveryEmailDeliveryError(body);
    } catch (error) {
      const body = isPlainObject(error?.response)
        && isPlainObject(error.response.data)
        ? error.response.data
        : {};
      const normalized = normalizeProDraftClientError(error, {
        audience: 'recovery',
        fallbackCode: 'RECOVERY_EMAIL_DELIVERY_FAILED',
      });
      emitSafeDraftClientMetric(onSafeMetric, {
        operation: PRO_DRAFT_RECOVERY_EMAIL_FUNCTION_NAME,
        ...normalized,
      });
      return normalizeRecoveryEmailDeliveryError(body, normalized);
    }
  };

  return Object.freeze({
    sendRecoveryCodeEmail: call,
    retryRecoveryCodeEmail: call,
    getDiagnostics() {
      return Object.freeze({
        version: PRO_DRAFT_RECOVERY_EMAIL_CLIENT_VERSION,
        functionName: PRO_DRAFT_RECOVERY_EMAIL_FUNCTION_NAME,
        available,
        enabled,
        exposesGeneralSendControl: false,
        storesRecoveryCode: false,
        storesRecoveryEmail: false,
        persistsRequest: false,
        dispatchesReduxActions: false,
        acceptsRecipientOverride: false,
      });
    },
  });
}

export const proDraftRecoveryEmailClient = createProDraftRecoveryEmailClient();

export function sendRecoveryCodeEmail(request) {
  return proDraftRecoveryEmailClient.sendRecoveryCodeEmail(request);
}

export function retryRecoveryCodeEmail(request) {
  return proDraftRecoveryEmailClient.retryRecoveryCodeEmail(request);
}

export function getSafeRecoveryEmailClientDiagnostics(
  client = proDraftRecoveryEmailClient,
) {
  return client.getDiagnostics();
}
