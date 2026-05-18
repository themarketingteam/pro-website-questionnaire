import { base44 } from '@/api/base44Client';
import { shouldSimulateSubmitFailure } from '@/lib/submitDebugFlags';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 1000;
const MAX_RAW_LENGTH = 500;

const truncateString = (value, maxLength) => {
  const stringValue = typeof value === 'string' ? value : String(value ?? '');
  return stringValue.slice(0, maxLength);
};

const getErrorStatus = (error) => {
  const status = error?.status ?? error?.response?.status ?? null;
  return typeof status === 'number' ? status : Number(status) || null;
};

const getErrorStatusText = (error) => {
  const statusText = error?.statusText ?? error?.response?.statusText ?? '';
  return truncateString(statusText, MAX_MESSAGE_LENGTH);
};

const getErrorMessage = (error) => {
  if (typeof error === 'string') return truncateString(error, MAX_MESSAGE_LENGTH);
  return truncateString(error?.message ?? String(error ?? 'Unknown error'), MAX_MESSAGE_LENGTH);
};

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

export class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
    this.type = 'timeout';
  }
}

const createSimulatedSubmitError = (mode) => {
  if (mode === 'network_timeout') {
    return new TimeoutError('DEV_ONLY_SIMULATED_SUBMIT_FAILURE: network_timeout');
  }

  const error = new Error(`DEV_ONLY_SIMULATED_SUBMIT_FAILURE: ${mode}`);
  error.name = 'DevOnlySimulatedSubmitFailure';
  error.code = mode === 'primary_create' ? 'SIMULATED_PRIMARY_CREATE' : 'SIMULATED_FALLBACK_CREATE';
  error.type = mode === 'primary_create' ? 'server' : 'fallback';
  error.status = mode === 'primary_create' ? 503 : 500;
  return error;
};

export const classifySubmitError = (error) => {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error).toLowerCase();
  const name = String(error?.name ?? '').toLowerCase();
  const code = String(error?.code ?? error?.response?.data?.code ?? '').toLowerCase();
  const statusText = getErrorStatusText(error).toLowerCase();

  if (name.includes('timeout') || code.includes('timeout') || message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) {
    return 'timeout';
  }

  if (
    status === 401 ||
    /unauthorized|auth|session|login|token|jwt|expired session|not authenticated|authentication required/.test(message) ||
    /unauthorized/.test(statusText) ||
    /auth|session|token|jwt|unauthorized/.test(code)
  ) {
    return 'auth';
  }

  if (
    status === 403 ||
    /forbidden|permission|rls|policy|access denied|insufficient privileges|not allowed/.test(message) ||
    /forbidden/.test(statusText) ||
    /permission|forbidden|rls|policy|access/.test(code)
  ) {
    return 'permission';
  }

  if (status === 429 || /rate limit|too many requests/.test(message) || code.includes('rate')) {
    return 'rate_limit';
  }

  if (status === 400 || status === 422) {
    if (/schema|column|field type|invalid input syntax|shape/.test(message) || /schema/.test(code)) return 'schema';
    if (/validation|invalid|required|must be|expected/.test(message)) return 'validation';
    return 'validation';
  }

  if (
    /failed to fetch|networkerror|network error|network request failed|load failed|cors|offline|fetch failed/.test(message) ||
    code.includes('network')
  ) {
    return 'network';
  }

  if ([500, 502, 503, 504].includes(status)) {
    return 'server';
  }

  return 'unknown';
};

export const serializeSubmitError = (error) => {
  const failureKind = classifySubmitError(error);

  return {
    name: truncateString(error?.name ?? '', MAX_MESSAGE_LENGTH),
    message: getErrorMessage(error),
    status: getErrorStatus(error),
    statusText: getErrorStatusText(error),
    code: truncateString(error?.code ?? error?.response?.data?.code ?? '', MAX_MESSAGE_LENGTH),
    type: truncateString(error?.type ?? '', MAX_MESSAGE_LENGTH),
    failureKind,
    isAuthLike: failureKind === 'auth',
    isPermissionLike: failureKind === 'permission',
    isNetworkLike: failureKind === 'network',
    isTimeoutLike: failureKind === 'timeout',
    isServerLike: failureKind === 'server',
    isRateLimitLike: failureKind === 'rate_limit',
    stackSnippet: truncateString(error?.stack ?? '', MAX_STACK_LENGTH),
    rawString: truncateString(typeof error === 'string' ? error : String(error ?? ''), MAX_RAW_LENGTH)
  };
};

export const isRetryableSubmitError = (error) => {
  const failureKind = classifySubmitError(error);
  const status = getErrorStatus(error);

  if (['timeout', 'network', 'rate_limit', 'server'].includes(failureKind)) {
    return true;
  }

  if (failureKind === 'unknown' && !status) {
    return true;
  }

  return false;
};

export const withTimeout = (promiseFactory, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  let timeoutId;

  return new Promise((resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(() => promiseFactory())
      .then((result) => {
        window.clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
};

export const createProFormSubmissionResilient = async (payload, options = {}) => {
  const {
    maxAttempts = 3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseDelayMs = 750,
    onAttempt = null,
    onFailure = null
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (typeof onAttempt === 'function') {
      onAttempt({ attempt, maxAttempts });
    }

    try {
      if (shouldSimulateSubmitFailure('primary_create')) {
        throw createSimulatedSubmitError('primary_create');
      }

      if (shouldSimulateSubmitFailure('network_timeout')) {
        throw createSimulatedSubmitError('network_timeout');
      }

      const submission = await withTimeout(
        () => base44.entities.ProFormSubmission.create(payload),
        timeoutMs
      );

      return {
        ok: true,
        submission,
        error: null,
        attempts: attempt,
        usedFallback: false,
        failureKind: null
      };
    } catch (error) {
      const serializedError = serializeSubmitError(error);
      const failureKind = serializedError.failureKind;
      const willRetry = attempt < maxAttempts && isRetryableSubmitError(error);

      if (typeof onFailure === 'function') {
        onFailure({ attempt, error, serializedError, failureKind, willRetry });
      }

      if (!willRetry) {
        return {
          ok: false,
          submission: null,
          error: serializedError,
          attempts: attempt,
          usedFallback: false,
          failureKind
        };
      }

      const jitter = Math.floor(Math.random() * 200);
      await delay(baseDelayMs * Math.pow(2, attempt - 2 < 0 ? 0 : attempt - 2) + jitter);
    }
  }

  return {
    ok: false,
    submission: null,
    error: serializeSubmitError(new Error('Submission failed after retries')),
    attempts: maxAttempts,
    usedFallback: false,
    failureKind: 'unknown'
  };
};

export const getBrowserOnlineStatus = () => {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
      return null;
    }

    return navigator.onLine;
  } catch {
    return null;
  }
};

const getSafeWindowLocationHref = () => {
  try {
    return typeof window !== 'undefined' && window.location?.href ? window.location.href : '';
  } catch {
    return '';
  }
};

const getSafeUserAgent = () => {
  try {
    return typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '';
  } catch {
    return '';
  }
};

const safeCountArray = (value) => (Array.isArray(value) ? value.filter(Boolean).length : 0);

export const buildPayloadFeatureSummary = (payload) => {
  const metadata = payload && typeof payload === 'object' ? payload.metadata || {} : {};
  const userdata = payload && typeof payload === 'object' ? payload.userdata || {} : {};
  const additionalPagesList = userdata && typeof userdata.additional_pages_list === 'object' && !Array.isArray(userdata.additional_pages_list)
    ? userdata.additional_pages_list
    : {};
  const teamPhoto = additionalPagesList?.meet_the_team_page?.team_photo_with_tags;
  const certifications = Array.isArray(userdata.certifications_partnerships) ? userdata.certifications_partnerships : [];
  const guarantees = Array.isArray(userdata.service_guarantee_items) ? userdata.service_guarantee_items : [];
  const geographicAreas = Array.isArray(userdata.geographic_areas) ? userdata.geographic_areas : [];
  const serviceOfferings = Array.isArray(userdata.service_offerings) ? userdata.service_offerings : [];
  const industries = Array.isArray(userdata.target_industries) ? userdata.target_industries : [];

  return {
    hasTeamPhotoWithTags: Boolean(teamPhoto && typeof teamPhoto === 'object'),
    certificationFileCount: certifications.reduce((count, item) => {
      const files = Array.isArray(item?.cert_item_files) ? item.cert_item_files.filter(Boolean).length : 0;
      return count + files;
    }, 0),
    guaranteeFileCount: guarantees.reduce((count, item) => count + (item?.guarantee_file_url ? 1 : 0), 0),
    additionalPagesCount: Object.values(additionalPagesList).filter(Boolean).length,
    geographicAreaCount: geographicAreas.length,
    serviceOfferingCount: serviceOfferings.length,
    industryCount: industries.length,
    locationCount: geographicAreas.length,
    payloadSizeChars: (() => {
      try {
        return JSON.stringify({ metadata, userdata }).length;
      } catch {
        return null;
      }
    })()
  };
};

export const buildSubmitDiagnostics = ({
  questionnaireSessionId,
  businessName,
  domain,
  draftId,
  primaryResult,
  fallbackResult,
  submitContext,
  payloadSummary
}) => ({
  questionnaireSessionId: questionnaireSessionId || '',
  businessNamePresent: Boolean(String(businessName || '').trim()),
  domainPresent: Boolean(String(domain || '').trim()),
  draftIdPresent: Boolean(draftId),
  primaryOk: Boolean(primaryResult?.ok),
  primaryFailureKind: primaryResult?.failureKind || primaryResult?.error?.failureKind || null,
  primaryStatus: primaryResult?.error?.status ?? null,
  primaryCode: primaryResult?.error?.code || null,
  fallbackAttempted: Boolean(fallbackResult || primaryResult?.usedFallback),
  fallbackOk: fallbackResult ? Boolean(fallbackResult?.ok) : null,
  fallbackFailureKind: fallbackResult?.failureKind || fallbackResult?.error?.failureKind || null,
  fallbackStatus: fallbackResult?.error?.status ?? null,
  usedFallback: Boolean(fallbackResult?.ok || fallbackResult?.usedFallback || primaryResult?.usedFallback),
  browserOnline: getBrowserOnlineStatus(),
  pageUrlPresent: Boolean(getSafeWindowLocationHref()),
  userAgentPresent: Boolean(getSafeUserAgent()),
  appVersionPresent: Boolean(submitContext?.app_version || import.meta.env?.VITE_APP_VERSION || import.meta.env?.MODE),
  payloadSizeChars: payloadSummary?.payloadSizeChars ?? null,
  payloadFeatureSummary: payloadSummary || buildPayloadFeatureSummary(null),
  timestamp: new Date().toISOString()
});

export const createProFormSubmissionWithFallback = async (payload, options = {}) => {
  const {
    responseSnapshot,
    rawResponses,
    transformFailed = false,
    transformError = null,
    validationFailed = false,
    validationError = null,
    questionnaireSessionId,
    draftId,
    submitContext,
    onPrimaryFailure,
    onFallbackAttempt,
    onFallbackSuccess,
    onFallbackFailure,
    ...resilientOptions
  } = options;

  if (!payload || typeof payload !== 'object') {
    if (!transformFailed && !validationFailed) {
      const error = serializeSubmitError(new Error('Invalid submission payload'));
      return {
        ok: false,
        submission: null,
        error,
        attempts: 0,
        usedFallback: false,
        failureKind: error.failureKind,
        primaryError: null
      };
    }

    try {
      if (shouldSimulateSubmitFailure('fallback_create')) {
        throw createSimulatedSubmitError('fallback_create');
      }

      const response = await base44.functions.invoke('submitProQuestionnaireFallback', {
        transformedPayload: null,
        responseSnapshot,
        rawResponses,
        transformFailed,
        transformError,
        validationFailed,
        validationError,
        questionnaireSessionId,
        draftId,
        primaryError: transformError || validationError,
        submitContext,
        diagnostics: null
      });

      const data = response?.data;
      if (data?.success && data?.received && data?.submissionCreated === false && data?.intakeId) {
        return {
          ok: true,
          submission: null,
          intakeId: data.intakeId,
          receivedViaIntake: true,
          error: null,
          attempts: 0,
          usedFallback: true,
          failureKind: null,
          primaryError: transformError || validationError,
          zapierSent: Boolean(data?.zapierSent)
        };
      }
      if (data?.success && data?.submission) {
        return {
          ok: true,
          submission: data.submission,
          error: null,
          attempts: 0,
          usedFallback: true,
          failureKind: null,
          primaryError: transformError || validationError,
          zapierSent: Boolean(data?.zapierSent)
        };
      }

      const fallbackError = serializeSubmitError(data?.error || new Error('Fallback submission failed'));
      return {
        ok: false,
        submission: null,
        error: fallbackError,
        attempts: 0,
        usedFallback: true,
        failureKind: fallbackError.failureKind,
        primaryError: transformError || validationError
      };
    } catch (error) {
      const fallbackError = serializeSubmitError(error);
      return {
        ok: false,
        submission: null,
        error: fallbackError,
        attempts: 0,
        usedFallback: true,
        failureKind: fallbackError.failureKind,
        primaryError: transformError || validationError
      };
    }
  }

  const primaryResult = await createProFormSubmissionResilient(payload, resilientOptions);

  if (primaryResult.ok) {
    return primaryResult;
  }

  if (typeof onPrimaryFailure === 'function') {
    onPrimaryFailure(primaryResult);
  }

  if (typeof onFallbackAttempt === 'function') {
    onFallbackAttempt({ primaryError: primaryResult.error, failureKind: primaryResult.failureKind });
  }

  try {
    if (shouldSimulateSubmitFailure('fallback_create')) {
      throw createSimulatedSubmitError('fallback_create');
    }

    const response = await base44.functions.invoke('submitProQuestionnaireFallback', {
      transformedPayload: payload,
      responseSnapshot,
      rawResponses,
      questionnaireSessionId,
      draftId,
      primaryError: primaryResult.error,
      submitContext,
      diagnostics: null
    });

    const data = response?.data;

    if (data?.success && data?.received && data?.submissionCreated === false && data?.intakeId) {
      const result = {
        ok: true,
        submission: null,
        intakeId: data.intakeId,
        receivedViaIntake: true,
        error: null,
        attempts: primaryResult.attempts,
        usedFallback: true,
        failureKind: null,
        primaryError: primaryResult.error,
        zapierSent: Boolean(data?.zapierSent)
      };

      if (typeof onFallbackSuccess === 'function') {
        onFallbackSuccess(result);
      }

      return result;
    }

    if (data?.success && data?.submission) {
      const result = {
        ok: true,
        submission: data.submission,
        error: null,
        attempts: primaryResult.attempts,
        usedFallback: true,
        failureKind: null,
        primaryError: primaryResult.error,
        zapierSent: Boolean(data?.zapierSent)
      };

      if (typeof onFallbackSuccess === 'function') {
        onFallbackSuccess(result);
      }

      return result;
    }

    const fallbackError = serializeSubmitError(data?.error || new Error('Fallback submission failed'));
    const failedResult = {
      ok: false,
      submission: null,
      error: fallbackError,
      attempts: primaryResult.attempts,
      usedFallback: true,
      failureKind: fallbackError.failureKind,
      primaryError: primaryResult.error
    };

    if (typeof onFallbackFailure === 'function') {
      onFallbackFailure(failedResult);
    }

    return failedResult;
  } catch (error) {
    const fallbackError = serializeSubmitError(error);
    const failedResult = {
      ok: false,
      submission: null,
      error: fallbackError,
      attempts: primaryResult.attempts,
      usedFallback: true,
      failureKind: fallbackError.failureKind,
      primaryError: primaryResult.error
    };

    if (typeof onFallbackFailure === 'function') {
      onFallbackFailure(failedResult);
    }

    return failedResult;
  }
};