import { base44 } from '@/api/base44Client';
import { normalizeProDraftClientError } from '@/lib/proDraftClientErrorPolicy';

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

const getTimerApi = () => {
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') return window;
  return globalThis;
};

const delay = (ms) => new Promise((resolve) => getTimerApi().setTimeout(resolve, ms));

const createDevSimulatedError = (mode) => {
  const error = new Error(`DEV_ONLY_SIMULATED_SUBMIT_FAILURE: ${mode}`);
  error.name = 'DevSimulatedSubmitError';
  error.code = `DEV_SIMULATED_${String(mode || '').toUpperCase()}`;
  error.type = mode;
  if (mode === 'primary_create') error.status = 503;
  if (mode === 'network_timeout') error.code = 'TIMEOUT';
  if (mode === 'fallback_create') error.status = 503;
  return error;
};

export class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
    this.type = 'timeout';
  }
}

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
  const draftPolicy = normalizeProDraftClientError(error, {
    fallbackCode: 'SUBMISSION_BACKEND_REQUEST_FAILED',
  });
  const redactProviderDetail = failureKind === 'auth' || failureKind === 'permission';

  return {
    name: truncateString(error?.name ?? '', MAX_MESSAGE_LENGTH),
    message: redactProviderDetail ? draftPolicy.message : getErrorMessage(error),
    status: getErrorStatus(error),
    statusText: getErrorStatusText(error),
    code: redactProviderDetail
      ? draftPolicy.code
      : truncateString(error?.code ?? error?.response?.data?.code ?? '', MAX_MESSAGE_LENGTH),
    type: truncateString(error?.type ?? '', MAX_MESSAGE_LENGTH),
    failureKind,
    isAuthLike: failureKind === 'auth',
    isPermissionLike: failureKind === 'permission',
    isNetworkLike: failureKind === 'network',
    isTimeoutLike: failureKind === 'timeout',
    isServerLike: failureKind === 'server',
    isRateLimitLike: failureKind === 'rate_limit',
    draftFailureKind: draftPolicy.kind,
    preserveLocalState: true,
    stackSnippet: redactProviderDetail ? '' : truncateString(error?.stack ?? '', MAX_STACK_LENGTH),
    rawString: redactProviderDetail
      ? '' : truncateString(typeof error === 'string' ? error : String(error ?? ''), MAX_RAW_LENGTH)
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
  const timerApi = getTimerApi();

  return new Promise((resolve, reject) => {
    timeoutId = timerApi.setTimeout(() => {
      reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(() => promiseFactory())
      .then((result) => {
        timerApi.clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        timerApi.clearTimeout(timeoutId);
        reject(error);
      });
  });
};

const invokeSubmitFallbackWithRetry = async (body, options = {}) => {
  const {
    attempts = 2,
    timeoutMs = 15000,
    baseDelayMs = 750,
    debugFailureMode = null
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (import.meta.env.DEV && debugFailureMode === 'fallback_create') {
        throw createDevSimulatedError('fallback_create');
      }

      return await withTimeout(
        () => base44.functions.invoke('submitProQuestionnaireFallback', body),
        timeoutMs
      );
    } catch (error) {
      lastError = error;
      const willRetry = attempt < attempts && isRetryableSubmitError(error);

      if (!willRetry) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 200);
      await delay(baseDelayMs * attempt + jitter);
    }
  }

  throw lastError || new Error('Fallback submission failed');
};

export const createProFormSubmissionResilient = async (payload, options = {}) => {
  const {
    maxAttempts = 3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseDelayMs = 750,
    onAttempt = null,
    onFailure = null,
    debugFailureMode = null
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (typeof onAttempt === 'function') {
      onAttempt({ attempt, maxAttempts });
    }

    try {
      if (import.meta.env.DEV && debugFailureMode === 'primary_create') {
        throw createDevSimulatedError('primary_create');
      }

      if (import.meta.env.DEV && debugFailureMode === 'network_timeout') {
        throw new TimeoutError('DEV_ONLY_SIMULATED_SUBMIT_FAILURE: network_timeout');
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

const getZapierOutcomeFields = (data) => ({
  zapierSent: Boolean(data?.zapierSent || data?.delivered),
  zapierSuppressed: Boolean(data?.zapierSuppressed || data?.suppressed),
  zapierRedirected: Boolean(data?.zapierRedirected || data?.redirected),
  zapierStatus: data?.zapierStatus ?? data?.externalStatus ?? null,
  environment: data?.environment || 'unknown',
  externalSideEffectsMode: data?.externalSideEffectsMode || data?.mode || 'disabled',
  destinationClass: data?.destinationClass || 'none'
});

const getSubmissionOutcomeDefaults = () => ({
  intakeId: '',
  receivedViaIntake: false,
  ...getZapierOutcomeFields(null)
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
    debugFailureMode = null,
    ...resilientOptions
  } = options;

  if (!payload || typeof payload !== 'object') {
    if (!transformFailed && !validationFailed) {
      const error = serializeSubmitError(new Error('Invalid submission payload'));
      return {
        ...getSubmissionOutcomeDefaults(),
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
      const response = await invokeSubmitFallbackWithRetry({
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
      }, {
        attempts: 2,
        timeoutMs: resilientOptions.timeoutMs || DEFAULT_TIMEOUT_MS,
        debugFailureMode
      });

      const data = response?.data;
      if (data?.success && data?.received && data?.submissionCreated === false && data?.intakeId) {
        return {
          ...getSubmissionOutcomeDefaults(),
          ok: true,
          submission: null,
          intakeId: data.intakeId,
          receivedViaIntake: true,
          error: null,
          attempts: 0,
          usedFallback: true,
          failureKind: null,
          primaryError: transformError || validationError,
          ...getZapierOutcomeFields(data)
        };
      }
      if (data?.success && data?.submission) {
        return {
          ...getSubmissionOutcomeDefaults(),
          ok: true,
          submission: data.submission,
          error: null,
          attempts: 0,
          usedFallback: true,
          failureKind: null,
          primaryError: transformError || validationError,
          ...getZapierOutcomeFields(data)
        };
      }

      const fallbackError = serializeSubmitError(data?.error || new Error('Fallback submission failed'));
      return {
        ...getSubmissionOutcomeDefaults(),
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
        ...getSubmissionOutcomeDefaults(),
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

  const primaryResult = await createProFormSubmissionResilient(payload, {
    ...resilientOptions,
    debugFailureMode
  });

  if (primaryResult.ok) {
    return {
      ...getSubmissionOutcomeDefaults(),
      ...primaryResult
    };
  }

  if (typeof onPrimaryFailure === 'function') {
    onPrimaryFailure(primaryResult);
  }

  if (typeof onFallbackAttempt === 'function') {
    onFallbackAttempt({ primaryError: primaryResult.error, failureKind: primaryResult.failureKind });
  }

  try {
    const response = await invokeSubmitFallbackWithRetry({
      transformedPayload: payload,
      responseSnapshot,
      rawResponses,
      transformFailed,
      transformError,
      validationFailed,
      validationError,
      questionnaireSessionId,
      draftId,
      primaryError: primaryResult.error || transformError || validationError,
      submitContext,
      diagnostics: null
    }, {
      attempts: 2,
      timeoutMs: resilientOptions.timeoutMs || DEFAULT_TIMEOUT_MS,
      debugFailureMode
    });

    const data = response?.data;

    if (data?.success && data?.received && data?.submissionCreated === false && data?.intakeId) {
      const result = {
        ...getSubmissionOutcomeDefaults(),
        ok: true,
        submission: null,
        intakeId: data.intakeId,
        receivedViaIntake: true,
        error: null,
        attempts: primaryResult.attempts,
        usedFallback: true,
        failureKind: null,
        primaryError: primaryResult.error,
        ...getZapierOutcomeFields(data)
      };

      if (typeof onFallbackSuccess === 'function') {
        onFallbackSuccess(result);
      }

      return result;
    }

    if (data?.success && data?.submission) {
      const result = {
        ...getSubmissionOutcomeDefaults(),
        ok: true,
        submission: data.submission,
        error: null,
        attempts: primaryResult.attempts,
        usedFallback: true,
        failureKind: null,
        primaryError: primaryResult.error,
        ...getZapierOutcomeFields(data)
      };

      if (typeof onFallbackSuccess === 'function') {
        onFallbackSuccess(result);
      }

      return result;
    }

    const fallbackError = serializeSubmitError(data?.error || new Error('Fallback submission failed'));
    const failedResult = {
      ...getSubmissionOutcomeDefaults(),
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
      ...getSubmissionOutcomeDefaults(),
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
