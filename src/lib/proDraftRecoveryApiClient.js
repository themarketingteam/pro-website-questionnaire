import { base44 } from '@/api/base44Client';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
  isPublicEmailRecoveryClientEnabled,
} from '@/lib/proDraftRuntimeConfig';

export const PRO_DRAFT_RECOVERY_API_CLIENT_VERSION = 1;
export const PRO_DRAFT_RECOVERY_FUNCTION_NAME = 'recoverProFormDraftByCode';

const GENERIC_MESSAGE =
  'We could not recover a questionnaire with the information provided.';
const SAFE_REQUEST_ID = /^pdrq_[A-Za-z0-9_-]{20,123}$/u;
const SAFE_DRAFT_ID = /^[A-Za-z0-9._:-]{1,128}$/u;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedRetry(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 86400 ? value : 0;
}

function failure(body = {}) {
  return Object.freeze({
    success: false,
    recoveryCompleted: false,
    errorCode: 'RECOVERY_NOT_COMPLETED',
    message: GENERIC_MESSAGE,
    captchaRequired: body.captchaRequired === true,
    retryAfterSeconds: boundedRetry(body.retryAfterSeconds),
    requestId: typeof body.requestId === 'string' && SAFE_REQUEST_ID.test(body.requestId)
      ? body.requestId
      : null,
  });
}

function safeDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function success(body) {
  if (!isPlainObject(body) || body.success !== true
    || body.recoveryCompleted !== true
    || typeof body.requestId !== 'string'
    || !SAFE_REQUEST_ID.test(body.requestId)
    || typeof body.recoverySessionToken !== 'string'
    || body.recoverySessionToken.length < 43
    || body.recoverySessionToken.length > 8192
    || !safeDate(body.recoverySessionExpiresAt)
    || !isPlainObject(body.draft)
    || typeof body.draft.draftId !== 'string'
    || !SAFE_DRAFT_ID.test(body.draft.draftId)) return null;
  const draft = Object.freeze({
    draftId: body.draft.draftId,
    status: typeof body.draft.status === 'string' ? body.draft.status : 'active',
    readOnly: body.draft.readOnly === true,
    businessNameDisplay: typeof body.draft.businessNameDisplay === 'string'
      ? body.draft.businessNameDisplay
      : null,
    createdAt: safeDate(body.draft.createdAt),
    lastSavedAt: safeDate(body.draft.lastSavedAt),
    draftGeneration: Number.isSafeInteger(body.draft.draftGeneration)
      && body.draft.draftGeneration >= 0
      ? body.draft.draftGeneration
      : null,
    recoveryCodeHint: typeof body.draft.recoveryCodeHint === 'string'
      && /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/u.test(body.draft.recoveryCodeHint)
      ? body.draft.recoveryCodeHint
      : null,
  });
  return Object.freeze({
    success: true,
    recoveryCompleted: true,
    requestId: body.requestId,
    recoverySessionToken: body.recoverySessionToken,
    recoverySessionExpiresAt: body.recoverySessionExpiresAt,
    draft,
  });
}

function enabled(runtimeConfig) {
  return isDurableDraftClientEnabled(runtimeConfig)
    && isPublicEmailRecoveryClientEnabled(runtimeConfig);
}

export function createProDraftRecoveryApiClient({
  client = base44,
  runtimeConfig = frontendRuntimeConfig,
} = {}) {
  const invoke = client?.functions?.invoke;
  const available = typeof invoke === 'function';
  return Object.freeze({
    async recoverProFormDraftByCode(request) {
      if (!enabled(runtimeConfig) || !available || !isPlainObject(request)) {
        return failure();
      }
      const input = Object.freeze({
        ...request,
        apiVersion: PRO_DRAFT_RECOVERY_API_CLIENT_VERSION,
      });
      try {
        const response = await invoke.call(
          client.functions,
          PRO_DRAFT_RECOVERY_FUNCTION_NAME,
          input,
        );
        const body = isPlainObject(response) && isPlainObject(response.data)
          ? response.data
          : null;
        if (!body) return failure();
        if (body.success === true) return success(body) ?? failure(body);
        return failure(body);
      } catch (error) {
        const body = isPlainObject(error?.response)
          && isPlainObject(error.response.data)
          ? error.response.data
          : {};
        return failure(body);
      }
    },
    getDiagnostics() {
      return Object.freeze({
        version: PRO_DRAFT_RECOVERY_API_CLIENT_VERSION,
        functionName: PRO_DRAFT_RECOVERY_FUNCTION_NAME,
        available,
        enabled: enabled(runtimeConfig),
        storesRecoveryCode: false,
        storesRecoverySessionToken: false,
        dispatchesReduxActions: false,
      });
    },
  });
}

export const proDraftRecoveryApiClient = createProDraftRecoveryApiClient();

export function recoverProFormDraftByCode(request) {
  return proDraftRecoveryApiClient.recoverProFormDraftByCode(request);
}

export function getSafeProDraftRecoveryApiClientDiagnostics(
  client = proDraftRecoveryApiClient,
) {
  return client.getDiagnostics();
}
