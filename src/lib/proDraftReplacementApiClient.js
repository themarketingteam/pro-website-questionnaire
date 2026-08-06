import { base44 } from '@/api/base44Client';
import { defaultProDraftCredentialVault } from '@/lib/proDraftCredentialVault';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
} from '@/lib/proDraftRuntimeConfig';
import {
  emitSafeDraftClientMetric,
  normalizeProDraftClientError,
} from '@/lib/proDraftClientErrorPolicy';

export const PRO_DRAFT_REPLACEMENT_CLIENT_VERSION = 1;
export const PRO_DRAFT_REPLACEMENT_FUNCTION_NAMES = Object.freeze({
  clearAll: 'clearAndReplaceProFormDraft',
  startNew: 'startNewProFormDraft',
});

export const PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES = Object.freeze({
  DISABLED: 'DRAFT_REPLACEMENT_CLIENT_DISABLED',
  UNAVAILABLE: 'DRAFT_REPLACEMENT_CLIENT_UNAVAILABLE',
  INVALID_REQUEST: 'DRAFT_REPLACEMENT_CLIENT_INVALID_REQUEST',
  AUTHORIZATION_REQUIRED: 'DRAFT_REPLACEMENT_AUTHORIZATION_REQUIRED',
  INVOCATION_FAILED: 'DRAFT_REPLACEMENT_INVOCATION_FAILED',
  RESPONSE_INVALID: 'DRAFT_REPLACEMENT_RESPONSE_INVALID',
  CRYPTO_UNAVAILABLE: 'DRAFT_REPLACEMENT_CRYPTO_UNAVAILABLE',
});

const SAFE_REQUEST_ID = /^pdrq_[A-Za-z0-9_-]{20,123}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const SAFE_TEST_RUN_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const publicMessage = (status, recoveryRequired = false) => {
  if (recoveryRequired) {
    return 'The replacement is still being confirmed. Your current browser data has been preserved.';
  }
  if (status === 401 || status === 403) return 'Draft authorization could not be verified.';
  if (status === 409) return 'The draft changed before the replacement could be completed.';
  if (status >= 500) return 'The draft replacement service is temporarily unavailable.';
  return 'The draft replacement could not be completed.';
};

class ProDraftReplacementClientError extends Error {
  constructor(details) {
    super(details.message);
    this.name = 'ProDraftReplacementClientError';
    Object.assign(this, details);
  }
}

const boundedStatus = (value) => (
  Number.isSafeInteger(value) && value >= 200 && value <= 599 ? value : 500
);

export function normalizeReplacementApiError(error) {
  const response = isPlainObject(error?.response) ? error.response : {};
  const body = isPlainObject(response.data) ? response.data : {};
  const status = boundedStatus(response.status ?? error?.status);
  const replacementRecoveryRequired = body.replacementRecoveryRequired === true
    || error?.replacementRecoveryRequired === true;
  const normalized = normalizeProDraftClientError(error, {
    fallbackCode: PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.INVOCATION_FAILED,
  });
  return Object.freeze({
    ...normalized,
    status,
    retryable: normalized.retryable,
    replacementRecoveryRequired,
    requestId: typeof body.requestId === 'string' && SAFE_REQUEST_ID.test(body.requestId)
      ? body.requestId : null,
    message: replacementRecoveryRequired
      ? publicMessage(status, true)
      : normalized.message,
  });
}

const fail = (code, status = 400, retryable = false, policy = {}) => {
  throw new ProDraftReplacementClientError(Object.freeze({
    ...policy,
    code, status, retryable, replacementRecoveryRequired: false,
    requestId: null, message: policy.message || publicMessage(status),
  }));
};

const secureValue = (prefix, byteLength, cryptoProvider) => {
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
    return fail(PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.CRYPTO_UNAVAILABLE, 503, true);
  }
  const bytes = new Uint8Array(byteLength);
  cryptoProvider.getRandomValues(bytes);
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64URL[(combined >>> 18) & 63];
    output += BASE64URL[(combined >>> 12) & 63];
    if (second !== undefined) output += BASE64URL[(combined >>> 6) & 63];
    if (third !== undefined) output += BASE64URL[combined & 63];
  }
  return `${prefix}${output}`;
};

export const generateReplacementIdempotencyKey = (
  cryptoProvider = globalThis.crypto,
) => secureValue('pdri_', 24, cryptoProvider);

export const generateReplacementResumeToken = (
  cryptoProvider = globalThis.crypto,
) => secureValue('', 32, cryptoProvider);

const authorizationFromBundle = (bundle) => {
  if (bundle?.recoverySessionToken) {
    return Object.freeze({ recoverySessionToken: bundle.recoverySessionToken });
  }
  if (bundle?.resumeToken) return Object.freeze({ resumeToken: bundle.resumeToken });
  return null;
};

const normalizeResponse = (body) => {
  if (!isPlainObject(body) || typeof body.success !== 'boolean') {
    return fail(PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.RESPONSE_INVALID, 502, true);
  }
  if (body.success !== true) {
    if (body.replacementRecoveryRequired !== true) {
      throw new ProDraftReplacementClientError(normalizeReplacementApiError({
        status: 409,
        response: { status: 409, data: body },
      }));
    }
    return Object.freeze({
      ...body,
      success: false,
      replacementRecoveryRequired: true,
    });
  }
  if (!isPlainObject(body.sourceDraft) || !isPlainObject(body.replacementDraft)
    || typeof body.replacementDraft.draftId !== 'string'
    || !SAFE_ID.test(body.replacementDraft.draftId)
    || typeof body.replacementDraft.sessionId !== 'string'
    || !SAFE_ID.test(body.replacementDraft.sessionId)) {
    return fail(PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.RESPONSE_INVALID, 502, true);
  }
  return Object.freeze({ ...body });
};

export function createProDraftReplacementApiClient({
  client = base44,
  runtimeConfig = frontendRuntimeConfig,
  credentialVault = defaultProDraftCredentialVault,
  cryptoProvider = globalThis.crypto,
  onSafeMetric = undefined,
} = {}) {
  const invoke = client?.functions?.invoke;
  const available = typeof invoke === 'function';

  async function call(functionName, input = {}) {
    if (!isDurableDraftClientEnabled(runtimeConfig)) {
      const policy = normalizeProDraftClientError({}, {
        featureDisabled: true,
        killSwitchEnabled: runtimeConfig?.killSwitchEnabled === true,
      });
      return fail(PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.DISABLED, 503, false, policy);
    }
    if (!available) return fail(PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.UNAVAILABLE, 503, true);
    if (!isPlainObject(input) || typeof input.browserNamespace !== 'string'
      || typeof input.sourceDraftId !== 'string' || !SAFE_ID.test(input.sourceDraftId)
      || !Number.isSafeInteger(input.expectedServerRevision)
      || input.expectedServerRevision < 0
      || (input.testRunId !== undefined && !SAFE_TEST_RUN_ID.test(input.testRunId))) {
      return fail(PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.INVALID_REQUEST, 400);
    }
    const activeVault = /** @type {any} */ (credentialVault);
    const load = activeVault?.loadDraftCredentialBundle || activeVault?.load;
    const loaded = await load?.call(activeVault, {
      namespace: input.browserNamespace,
      browserNamespace: input.browserNamespace,
      storage: input.storage,
      environment: runtimeConfig.environment,
    });
    const authorization = authorizationFromBundle(loaded?.bundle);
    if (!loaded?.ok || !authorization || loaded.bundle.draftId !== input.sourceDraftId) {
      return fail(PRO_DRAFT_REPLACEMENT_CLIENT_ERROR_CODES.AUTHORIZATION_REQUIRED, 401);
    }
    const request = Object.freeze({
      apiVersion: PRO_DRAFT_REPLACEMENT_CLIENT_VERSION,
      authorization,
      sourceDraftId: input.sourceDraftId,
      expectedServerRevision: input.expectedServerRevision,
      idempotencyKey: input.idempotencyKey || generateReplacementIdempotencyKey(cryptoProvider),
      clientReplacementResumeToken: input.clientReplacementResumeToken
        || generateReplacementResumeToken(cryptoProvider),
      ...(input.testRunId ? { testRunId: input.testRunId } : {}),
    });
    try {
      const response = await invoke.call(client.functions, functionName, request);
      return normalizeResponse(response?.data);
    } catch (error) {
      if (error instanceof ProDraftReplacementClientError) throw error;
      const normalized = normalizeReplacementApiError(error);
      emitSafeDraftClientMetric(onSafeMetric, { operation: functionName, ...normalized });
      throw new ProDraftReplacementClientError(normalized);
    }
  }

  return Object.freeze({
    clearAndReplaceProFormDraft: (request) => call(
      PRO_DRAFT_REPLACEMENT_FUNCTION_NAMES.clearAll, request,
    ),
    startNewProFormDraft: (request) => call(
      PRO_DRAFT_REPLACEMENT_FUNCTION_NAMES.startNew, request,
    ),
    getDiagnostics: () => Object.freeze({
      version: PRO_DRAFT_REPLACEMENT_CLIENT_VERSION,
      available,
      enabled: isDurableDraftClientEnabled(runtimeConfig),
      environment: runtimeConfig?.environment ?? 'unknown',
      functionNames: PRO_DRAFT_REPLACEMENT_FUNCTION_NAMES,
      readsAuthorizationFromCredentialVault: true,
      storesCredentials: false,
      dispatchesReduxActions: false,
      logsCredentials: false,
    }),
  });
}

export const proDraftReplacementApiClient = createProDraftReplacementApiClient();

export function clearAndReplaceProFormDraft(request) {
  return proDraftReplacementApiClient.clearAndReplaceProFormDraft(request);
}

export function startNewProFormDraft(request) {
  return proDraftReplacementApiClient.startNewProFormDraft(request);
}

export function getSafeReplacementClientDiagnostics(
  client = proDraftReplacementApiClient,
) {
  return client?.getDiagnostics?.() || Object.freeze({
    version: PRO_DRAFT_REPLACEMENT_CLIENT_VERSION,
    available: false,
    enabled: false,
    environment: 'unknown',
    functionNames: PRO_DRAFT_REPLACEMENT_FUNCTION_NAMES,
    readsAuthorizationFromCredentialVault: true,
    storesCredentials: false,
    dispatchesReduxActions: false,
    logsCredentials: false,
  });
}
