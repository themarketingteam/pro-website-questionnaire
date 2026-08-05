import { redactText, safeUrlSummary } from './redaction.js';
import { isKnownZapierUrl } from './targetSafety.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const classifyUnsafeRequest = (request) => {
  const method = request.method().toUpperCase();
  if (!WRITE_METHODS.has(method)) return null;

  const url = request.url();
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();

  if (isKnownZapierUrl(url) || /sendtozapier|zapier/.test(path)) return 'zapier';
  if (/proformsubmission|submitproquestionnaire|questionnaire.*submit/.test(path)) {
    return 'final-submission';
  }
  if (/sendemail|send-email|\/email(?:\/|$)/.test(path)) return 'email';
  if (/uploadfile|upload-file|\/upload(?:\/|$)/.test(path)) return 'file-upload';
  return null;
};

const safeRequestSummary = (request, extra = {}) => ({
  method: request.method(),
  resourceType: request.resourceType(),
  url: safeUrlSummary(request.url()),
  ...extra,
});

export const installReadOnlyNetworkPolicy = async (page, target) => {
  const blockedRequests = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const knownZapier = isKnownZapierUrl(request.url());
    const blocksWrite = target?.allowWrites !== true && WRITE_METHODS.has(method);
    const crossOrigin = (() => {
      try {
        return new URL(request.url()).origin !== target?.origin;
      } catch {
        return true;
      }
    })();
    const blocksCrossOrigin = target?.allowWrites !== true && crossOrigin;

    if (knownZapier || blocksWrite || blocksCrossOrigin) {
      blockedRequests.push(safeRequestSummary(request, {
        reason: knownZapier
          ? 'zapier-denylist'
          : blocksCrossOrigin
            ? 'cross-origin-denylist'
            : 'writes-disabled',
      }));
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  return blockedRequests;
};

export const installNetworkCapture = (page) => {
  const failedRequests = [];
  const httpErrors = [];
  const unsafeRequests = [];
  const zapierRequests = [];

  const onRequest = (request) => {
    const classification = classifyUnsafeRequest(request);
    if (classification) {
      unsafeRequests.push(safeRequestSummary(request, { classification }));
    }
    if (isKnownZapierUrl(request.url())) {
      zapierRequests.push(safeRequestSummary(request));
    }
  };
  const onRequestFailed = (request) => {
    failedRequests.push(safeRequestSummary(request, {
      failure: redactText(request.failure()?.errorText || 'request failed', 200),
    }));
  };
  const onResponse = (response) => {
    if (response.status() < 400) return;
    httpErrors.push(safeRequestSummary(response.request(), {
      status: response.status(),
    }));
  };

  page.on('request', onRequest);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  return {
    failedRequests,
    httpErrors,
    unsafeRequests,
    zapierRequests,
    safeSummary: () => ({
      failedRequestCount: failedRequests.length,
      failedRequests: [...failedRequests],
      httpErrorCount: httpErrors.length,
      httpErrors: [...httpErrors],
      unsafeRequestCount: unsafeRequests.length,
      unsafeRequests: [...unsafeRequests],
      zapierRequestCount: zapierRequests.length,
      zapierRequests: [...zapierRequests],
    }),
    stop: () => {
      page.off('request', onRequest);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    },
  };
};
