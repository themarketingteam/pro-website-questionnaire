import { base44 } from '@/api/base44Client';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
} from '@/lib/proDraftRuntimeConfig';

export const PRO_DRAFT_API_CLIENT_VERSION = 1;

export const PRO_DRAFT_API_FUNCTION_NAMES = Object.freeze({
  bootstrap: 'bootstrapProFormDraft',
  load: 'loadProFormDraft',
  save: 'saveProFormDraft',
  events: 'appendProFormDraftEvents',
});

export const PRO_DRAFT_API_CLIENT_ERROR_CODES = Object.freeze({
  DISABLED: 'DRAFT_API_CLIENT_DISABLED',
  UNAVAILABLE: 'DRAFT_API_CLIENT_UNAVAILABLE',
  INVALID_REQUEST: 'DRAFT_API_CLIENT_INVALID_REQUEST',
  INVOCATION_FAILED: 'DRAFT_API_INVOCATION_FAILED',
  RESPONSE_INVALID: 'DRAFT_API_RESPONSE_INVALID',
  CRYPTO_UNAVAILABLE: 'DRAFT_API_CRYPTO_UNAVAILABLE',
});

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,95}$/u;
const SAFE_REQUEST_ID = /^pdrq_[A-Za-z0-9_-]{20,123}$/u;
const SAFE_TEST_RUN_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_CONFLICT_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

class ProDraftApiClientError extends Error {
  constructor(details) {
    super(details.message);
    this.name = 'ProDraftApiClientError';
    this.code = details.code;
    this.status = details.status;
    this.retryable = details.retryable;
    this.requestId = details.requestId;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.mergeRequired = details.mergeRequired;
    this.conflict = details.conflict;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeStatus(value) {
  return Number.isSafeInteger(value) && value >= 400 && value <= 599
    ? value
    : 500;
}

function publicMessage(status) {
  if (status === 401 || status === 403) return 'Draft authorization could not be verified.';
  if (status === 409) return 'The draft changed and must be refreshed before retrying.';
  if (status === 413) return 'The draft request is too large.';
  if (status >= 500) return 'The draft service is temporarily unavailable.';
  return 'The draft request could not be completed.';
}

function safeConflictMetadata(value) {
  if (!isPlainObject(value)) return null;
  const output = {};
  if (typeof value.draftId === 'string' && SAFE_CONFLICT_ID.test(value.draftId)) {
    output.draftId = value.draftId;
  }
  if (Number.isSafeInteger(value.clientRevision) && value.clientRevision >= 0) {
    output.clientRevision = value.clientRevision;
  }
  if (Number.isSafeInteger(value.serverRevision) && value.serverRevision >= 0) {
    output.serverRevision = value.serverRevision;
  }
  if (typeof value.status === 'string' && /^[a-z_]{1,64}$/u.test(value.status)) {
    output.status = value.status;
  }
  if (typeof value.stateHash === 'string' && /^[a-f0-9]{64}$/u.test(value.stateHash)) {
    output.stateHash = value.stateHash;
  }
  return Object.keys(output).length > 0 ? Object.freeze(output) : null;
}

function safeRetryAfterSeconds(response, body) {
  const bodyValue = body.retryAfterSeconds;
  if (Number.isSafeInteger(bodyValue) && bodyValue >= 0 && bodyValue <= 86_400) {
    return bodyValue;
  }
  const headerValue = response?.headers?.['retry-after']
    ?? response?.headers?.get?.('retry-after');
  const parsed = Number.parseInt(String(headerValue ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 86_400 ? parsed : 0;
}

export function normalizeDraftApiError(error) {
  const response = isPlainObject(error?.response) ? error.response : {};
  const body = isPlainObject(response.data) ? response.data : {};
  const status = safeStatus(response.status ?? error?.status);
  const retryAfterSeconds = safeRetryAfterSeconds(response, body);
  const conflict = body.mergeRequired === true ? safeConflictMetadata(body.conflict) : null;
  return Object.freeze({
    code: typeof body.errorCode === 'string' && SAFE_ERROR_CODE.test(body.errorCode)
      ? body.errorCode
      : PRO_DRAFT_API_CLIENT_ERROR_CODES.INVOCATION_FAILED,
    status,
    retryable: body.retryable === true || status >= 500,
    requestId: typeof body.requestId === 'string' && SAFE_REQUEST_ID.test(body.requestId)
      ? body.requestId
      : null,
    message: publicMessage(status),
    ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
    ...(body.mergeRequired === true ? { mergeRequired: true } : {}),
    ...(conflict ? { conflict } : {}),
  });
}

function throwClientError(code, status = 503, retryable = false) {
  throw new ProDraftApiClientError(Object.freeze({
    code,
    status,
    retryable,
    requestId: null,
    message: publicMessage(status),
  }));
}

function cryptoOrThrow(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
    return throwClientError(
      PRO_DRAFT_API_CLIENT_ERROR_CODES.CRYPTO_UNAVAILABLE,
      503,
      true,
    );
  }
  return cryptoProvider;
}

function base64Url(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64URL_ALPHABET[(combined >>> 18) & 63];
    output += BASE64URL_ALPHABET[(combined >>> 12) & 63];
    if (second !== undefined) output += BASE64URL_ALPHABET[(combined >>> 6) & 63];
    if (third !== undefined) output += BASE64URL_ALPHABET[combined & 63];
  }
  return output;
}

function secureOpaqueValue(byteLength, cryptoProvider) {
  const bytes = new Uint8Array(byteLength);
  cryptoOrThrow(cryptoProvider).getRandomValues(bytes);
  return base64Url(bytes);
}

export function generateClientBootstrapToken(cryptoProvider = globalThis.crypto) {
  return secureOpaqueValue(32, cryptoProvider);
}

export function generateDraftApiIdempotencyKey(cryptoProvider = globalThis.crypto) {
  return `pdi_${secureOpaqueValue(24, cryptoProvider)}`;
}

function validatedRequest(request) {
  if (!isPlainObject(request)
    || (request.apiVersion !== undefined && request.apiVersion !== 1)) {
    return throwClientError(PRO_DRAFT_API_CLIENT_ERROR_CODES.INVALID_REQUEST, 400);
  }
  return Object.freeze({ ...request, apiVersion: PRO_DRAFT_API_CLIENT_VERSION });
}

function stagingOverrideAllowed(runtimeConfig, request, options) {
  return options?.stagingTestOverride === true
    && runtimeConfig?.environment === 'staging'
    && typeof request?.testRunId === 'string'
    && SAFE_TEST_RUN_ID.test(request.testRunId);
}

export function createProDraftApiClient({
  client = base44,
  runtimeConfig = frontendRuntimeConfig,
} = {}) {
  const invoke = client?.functions?.invoke;
  const available = typeof invoke === 'function';

  async function call(operation, requestInput, options = {}) {
    const request = validatedRequest(requestInput);
    const enabled = isDurableDraftClientEnabled(runtimeConfig);
    if (!enabled && !stagingOverrideAllowed(runtimeConfig, request, options)) {
      return throwClientError(PRO_DRAFT_API_CLIENT_ERROR_CODES.DISABLED, 503);
    }
    if (!available) {
      return throwClientError(
        PRO_DRAFT_API_CLIENT_ERROR_CODES.UNAVAILABLE,
        503,
        true,
      );
    }
    try {
      const response = await invoke.call(client.functions, operation, request);
      if (!isPlainObject(response) || !isPlainObject(response.data)) {
        return throwClientError(
          PRO_DRAFT_API_CLIENT_ERROR_CODES.RESPONSE_INVALID,
          502,
          true,
        );
      }
      return response.data;
    } catch (error) {
      if (error instanceof ProDraftApiClientError) throw error;
      throw new ProDraftApiClientError(normalizeDraftApiError(error));
    }
  }

  const api = Object.freeze({
    bootstrapProFormDraft: (request, options) => call(
      PRO_DRAFT_API_FUNCTION_NAMES.bootstrap,
      request,
      options,
    ),
    loadProFormDraft: (request, options) => call(
      PRO_DRAFT_API_FUNCTION_NAMES.load,
      request,
      options,
    ),
    saveProFormDraft: (request, options) => call(
      PRO_DRAFT_API_FUNCTION_NAMES.save,
      request,
      options,
    ),
    appendProFormDraftEvents: (request, options) => call(
      PRO_DRAFT_API_FUNCTION_NAMES.events,
      request,
      options,
    ),
    getDiagnostics: () => Object.freeze({
      version: PRO_DRAFT_API_CLIENT_VERSION,
      available,
      environment: runtimeConfig?.environment ?? 'unknown',
      enabled: isDurableDraftClientEnabled(runtimeConfig),
      stagingTestOverrideEligible: runtimeConfig?.environment === 'staging',
      functionNames: Object.freeze(Object.values(PRO_DRAFT_API_FUNCTION_NAMES)),
      storesCredentials: false,
      dispatchesReduxActions: false,
    }),
  });
  return api;
}

export const proDraftApiClient = createProDraftApiClient();

export function bootstrapProFormDraft(request, options) {
  return proDraftApiClient.bootstrapProFormDraft(request, options);
}

export function loadProFormDraft(request, options) {
  return proDraftApiClient.loadProFormDraft(request, options);
}

export function saveProFormDraft(request, options) {
  return proDraftApiClient.saveProFormDraft(request, options);
}

export function appendProFormDraftEvents(request, options) {
  return proDraftApiClient.appendProFormDraftEvents(request, options);
}

export function getSafeDraftApiClientDiagnostics(client = proDraftApiClient) {
  const diagnostics = client?.getDiagnostics?.();
  if (!isPlainObject(diagnostics)) {
    return Object.freeze({
      version: PRO_DRAFT_API_CLIENT_VERSION,
      available: false,
      environment: 'unknown',
      enabled: false,
      stagingTestOverrideEligible: false,
      functionNames: Object.freeze(Object.values(PRO_DRAFT_API_FUNCTION_NAMES)),
      storesCredentials: false,
      dispatchesReduxActions: false,
    });
  }
  return diagnostics;
}
