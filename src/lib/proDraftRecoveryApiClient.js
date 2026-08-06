import { base44 } from '@/api/base44Client';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
  isPublicEmailRecoveryClientEnabled,
} from '@/lib/proDraftRuntimeConfig';
import {
  emitSafeDraftClientMetric,
  normalizeProDraftClientError,
} from '@/lib/proDraftClientErrorPolicy';

export const PRO_DRAFT_RECOVERY_API_CLIENT_VERSION = 1;
export const PRO_DRAFT_RECOVERY_FUNCTION_NAME = 'recoverProFormDraftByCode';
export const PRO_DRAFT_RECOVERY_FUNCTION_NAMES = Object.freeze({
  code: PRO_DRAFT_RECOVERY_FUNCTION_NAME,
  email: 'recoverProFormDraftByEmail',
  listChoices: 'listProFormDraftRecoveryChoices',
  selectChoice: 'selectProFormDraftRecoveryChoice',
});

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

function failure(body = {}, normalized = null) {
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
    failureKind: normalized?.kind || 'unknown',
    authorizationRequired: normalized?.authorizationRequired === true,
    recoveryRequired: normalized?.recoveryRequired === true,
    configurationError: normalized?.configurationError === true,
    retryable: normalized?.retryable === true,
    preserveLocalState: true,
  });
}

function safeDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function success(body, { includeOtherEligible = false } = {}) {
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
    ...(includeOtherEligible
      ? { otherEligibleDraftsAvailable: body.otherEligibleDraftsAvailable === true }
      : {}),
  });
}

function choice(value) {
  if (!isPlainObject(value) || typeof value.draftId !== 'string'
    || !SAFE_DRAFT_ID.test(value.draftId)) return null;
  return Object.freeze({
    draftId: value.draftId,
    status: typeof value.status === 'string' ? value.status : 'active',
    readOnly: value.readOnly === true,
    businessNameDisplay: typeof value.businessNameDisplay === 'string'
      ? value.businessNameDisplay : null,
    createdAt: safeDate(value.createdAt),
    lastSavedAt: safeDate(value.lastSavedAt),
    draftGeneration: Number.isSafeInteger(value.draftGeneration)
      && value.draftGeneration >= 0 ? value.draftGeneration : null,
    isCurrentSelection: value.isCurrentSelection === true,
  });
}

function choicesSuccess(body) {
  if (!isPlainObject(body) || body.success !== true
    || typeof body.requestId !== 'string' || !SAFE_REQUEST_ID.test(body.requestId)
    || !Array.isArray(body.choices) || body.choices.length > 25) return null;
  const choices = body.choices.map(choice);
  if (choices.some((item) => item === null)) return null;
  return Object.freeze({
    success: true,
    requestId: body.requestId,
    choices: Object.freeze(choices),
  });
}

function enabled(runtimeConfig, stagingTestOverride) {
  if (!isDurableDraftClientEnabled(runtimeConfig)) return false;
  if (isPublicEmailRecoveryClientEnabled(runtimeConfig)) return true;
  return stagingTestOverride === true
    && ['local', 'test', 'staging'].includes(runtimeConfig?.environment);
}

export function createProDraftRecoveryApiClient({
  client = base44,
  runtimeConfig = frontendRuntimeConfig,
  stagingTestOverride = false,
  onSafeMetric = undefined,
} = {}) {
  const invoke = client?.functions?.invoke;
  const available = typeof invoke === 'function';
  const featureEnabled = enabled(runtimeConfig, stagingTestOverride);
  const invokeRecovery = async (functionName, request) => {
    if (!featureEnabled || !available || !isPlainObject(request)) {
      const normalized = normalizeProDraftClientError({}, {
        audience: 'recovery',
        featureDisabled: !featureEnabled,
        killSwitchEnabled: runtimeConfig?.killSwitchEnabled === true,
        fallbackCode: 'RECOVERY_NOT_COMPLETED',
      });
      return { body: null, failure: failure({}, normalized) };
    }
    const input = Object.freeze({
      ...request,
      apiVersion: PRO_DRAFT_RECOVERY_API_CLIENT_VERSION,
    });
    try {
      const response = await invoke.call(client.functions, functionName, input);
      const body = isPlainObject(response) && isPlainObject(response.data)
        ? response.data : null;
      return { body, failure: body ? null : failure() };
    } catch (error) {
      const body = isPlainObject(error?.response)
        && isPlainObject(error.response.data) ? error.response.data : {};
      const normalized = normalizeProDraftClientError(error, {
        audience: 'recovery',
        fallbackCode: 'RECOVERY_NOT_COMPLETED',
      });
      emitSafeDraftClientMetric(onSafeMetric, { operation: functionName, ...normalized });
      return { body: null, failure: failure(body, normalized) };
    }
  };
  return Object.freeze({
    async recoverProFormDraftByCode(request) {
      const result = await invokeRecovery(PRO_DRAFT_RECOVERY_FUNCTION_NAMES.code, request);
      if (!result.body) return result.failure;
      return result.body.success === true
        ? success(result.body) ?? failure(result.body) : failure(result.body);
    },
    async recoverProFormDraftByEmail(request) {
      const result = await invokeRecovery(PRO_DRAFT_RECOVERY_FUNCTION_NAMES.email, request);
      if (!result.body) return result.failure;
      return result.body.success === true
        ? success(result.body, { includeOtherEligible: true }) ?? failure(result.body)
        : failure(result.body);
    },
    async listProFormDraftRecoveryChoices(request) {
      const result = await invokeRecovery(
        PRO_DRAFT_RECOVERY_FUNCTION_NAMES.listChoices,
        request,
      );
      if (!result.body) return result.failure;
      return result.body.success === true
        ? choicesSuccess(result.body) ?? failure(result.body)
        : failure(result.body);
    },
    async selectProFormDraftRecoveryChoice(request) {
      const result = await invokeRecovery(
        PRO_DRAFT_RECOVERY_FUNCTION_NAMES.selectChoice,
        request,
      );
      if (!result.body) return result.failure;
      return result.body.success === true
        ? success(result.body) ?? failure(result.body)
        : failure(result.body);
    },
    getDiagnostics() {
      return Object.freeze({
        version: PRO_DRAFT_RECOVERY_API_CLIENT_VERSION,
        functionName: PRO_DRAFT_RECOVERY_FUNCTION_NAME,
        functionNames: PRO_DRAFT_RECOVERY_FUNCTION_NAMES,
        available,
        enabled: featureEnabled,
        stagingTestOverride: stagingTestOverride === true,
        storesRecoveryCode: false,
        storesRecoveryEmail: false,
        storesRecoverySessionToken: false,
        sendsEmail: false,
        verifiesEmailOwnership: false,
        dispatchesReduxActions: false,
      });
    },
  });
}

export const proDraftRecoveryApiClient = createProDraftRecoveryApiClient();

export function recoverProFormDraftByCode(request) {
  return proDraftRecoveryApiClient.recoverProFormDraftByCode(request);
}

export function recoverProFormDraftByEmail(request) {
  return proDraftRecoveryApiClient.recoverProFormDraftByEmail(request);
}

export function listProFormDraftRecoveryChoices(request) {
  return proDraftRecoveryApiClient.listProFormDraftRecoveryChoices(request);
}

export function selectProFormDraftRecoveryChoice(request) {
  return proDraftRecoveryApiClient.selectProFormDraftRecoveryChoice(request);
}

export function getSafeProDraftRecoveryApiClientDiagnostics(
  client = proDraftRecoveryApiClient,
) {
  return client.getDiagnostics();
}
