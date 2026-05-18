import { base44 } from '@/api/base44Client';

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

export const classifySubmitError = (error) => {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error).toLowerCase();
  const name = String(error?.name ?? '').toLowerCase();

  if (name.includes('timeout') || message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) {
    return 'timeout';
  }

  if (status === 401 || /unauthorized|auth|session|login|token/.test(message)) {
    return 'auth';
  }

  if (status === 403 || /forbidden|permission|rls|policy|access denied/.test(message)) {
    return 'permission';
  }

  if (status === 429) {
    return 'rate_limit';
  }

  if (status === 400 || status === 422) {
    if (/schema/.test(message)) return 'schema';
    if (/validation|invalid|required/.test(message)) return 'validation';
    return 'validation';
  }

  if (/failed to fetch|network|cors|offline/.test(message)) {
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
    code: truncateString(error?.code ?? '', MAX_MESSAGE_LENGTH),
    type: truncateString(error?.type ?? '', MAX_MESSAGE_LENGTH),
    failureKind,
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

export const createProFormSubmissionWithFallback = async (payload, options = {}) => {
  if (!payload || typeof payload !== 'object') {
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

  const {
    responseSnapshot,
    questionnaireSessionId,
    draftId,
    submitContext,
    onPrimaryFailure,
    onFallbackAttempt,
    onFallbackSuccess,
    onFallbackFailure,
    ...resilientOptions
  } = options;

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
    const response = await base44.functions.invoke('submitProQuestionnaireFallback', {
      transformedPayload: payload,
      responseSnapshot,
      questionnaireSessionId,
      draftId,
      primaryError: primaryResult.error,
      submitContext
    });

    const data = response?.data;

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