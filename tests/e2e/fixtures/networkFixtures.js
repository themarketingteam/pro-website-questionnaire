import { safeUrlSummary } from '../helpers/redaction.js';

export const NETWORK_MODES = Object.freeze([
  'online',
  'offline_before_load',
  'offline_after_load',
  'draft_save_timeout',
  'draft_save_500',
  'draft_save_connection_reset',
  'slow_network',
  'duplicate_response',
  'out_of_order_response',
]);

const NETWORK_MODE_SET = new Set(NETWORK_MODES);

export const DRAFT_API_ROUTE_PATTERN = /\/(?:api\/e2e\/drafts(?:\/|[?#])|api\/(?:apps\/[^/]+\/)?entities\/proformdraft(?:event)?(?:\/|[?#])|api\/apps\/[^/]+\/functions\/[^/?#]*draft[^/?#]*(?:\/|[?#])|functions\/[^/?#]*draft[^/?#]*(?:\/|[?#]))/i;

export const PRODUCTION_EXTERNAL_ROUTE_PATTERN = /^https?:\/\/(?:[^/]+\.)?mspsuccesswebsites\.com(?::\d+)?\/|^https?:\/\/qtrypzzcjebvfcihiynt\.supabase\.co(?::\d+)?\/|^https?:\/\/(?:[^/]+\.)?zapier\.com(?::\d+)?\//i;

export const isNetworkMode = (mode) => NETWORK_MODE_SET.has(mode);

export const isKnownDraftApiUrl = (value) => {
  try {
    return DRAFT_API_ROUTE_PATTERN.test(new URL(String(value)).toString());
  } catch {
    return false;
  }
};

const safeRoute = (value) => {
  const summary = safeUrlSummary(value);
  try {
    const url = new URL(summary);
    return `${url.pathname}${url.search}`;
  } catch {
    return '<invalid-route>';
  }
};

const safeSyntheticResponse = (status = 200, marker = 'released') => ({
  body: JSON.stringify({ marker, synthetic: true }),
  contentType: 'application/json',
  headers: {
    'cache-control': 'no-store',
    'x-e2e-synthetic-response': marker,
  },
  status,
});

export const installNetworkScenario = async (
  page,
  context,
  mode = 'online',
  { slowDelayMs = 1_200 } = {},
) => {
  if (!isNetworkMode(mode)) throw new Error(`INVALID_E2E_NETWORK_MODE:${mode}`);

  const startedAt = Date.now();
  const records = [];
  const recordByRequest = new Map();
  const pending = [];
  let offline = mode === 'offline_before_load';

  const createRecord = (request, initialStatus = 'pending') => {
    const existing = recordByRequest.get(request);
    if (existing) return existing;
    const record = {
      durationMs: null,
      method: request.method(),
      route: safeRoute(request.url()),
      startedAfterMs: Date.now() - startedAt,
      status: initialStatus,
    };
    records.push(record);
    recordByRequest.set(request, record);
    return record;
  };
  const finishRecord = (record, status) => {
    record.durationMs = Date.now() - startedAt - record.startedAfterMs;
    record.status = status;
  };
  const holdRoute = (route, request, record) => new Promise((resolve) => {
    pending.push({ record, request, resolve, route });
  });

  const draftRouteHandler = async (route) => {
    const request = route.request();
    const record = createRecord(request);

    if (offline) {
      finishRecord(record, 'offline');
      await route.abort('internetdisconnected');
      return;
    }

    if (mode === 'draft_save_500') {
      finishRecord(record, 500);
      await route.fulfill(safeSyntheticResponse(500, 'draft-save-500'));
      return;
    }
    if (mode === 'draft_save_connection_reset') {
      finishRecord(record, 'connection-reset');
      await route.abort('connectionreset');
      return;
    }
    if (mode === 'draft_save_timeout' || mode === 'out_of_order_response') {
      await holdRoute(route, request, record);
      return;
    }
    if (mode === 'slow_network') {
      await new Promise((resolve) => setTimeout(resolve, slowDelayMs));
      record.status = 'forwarded-after-delay';
      await route.fallback();
      return;
    }
    if (mode === 'duplicate_response') {
      finishRecord(record, 200);
      await route.fulfill(safeSyntheticResponse(200, 'duplicate-response'));
      return;
    }

    record.status = 'forwarded';
    await route.fallback();
  };

  const productionRouteHandler = async (route) => {
    const record = createRecord(route.request());
    finishRecord(record, 'blocked-production-endpoint');
    await route.abort('blockedbyclient');
  };

  const onResponse = (response) => {
    const record = recordByRequest.get(response.request());
    if (record && String(record.status).startsWith('forwarded')) {
      finishRecord(record, response.status());
    }
  };
  const onRequest = (request) => {
    if (isKnownDraftApiUrl(request.url())) createRecord(request);
  };
  const onRequestFailed = (request) => {
    const record = recordByRequest.get(request);
    if (
      record
      && (record.status === 'pending' || String(record.status).startsWith('forwarded'))
    ) {
      finishRecord(record, offline ? 'offline' : 'request-failed');
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  await page.route(DRAFT_API_ROUTE_PATTERN, draftRouteHandler);
  await page.route(PRODUCTION_EXTERNAL_ROUTE_PATTERN, productionRouteHandler);

  if (offline) await context.setOffline(true);

  const releaseAt = async (
    index,
    { abortError, marker = 'released', status = 200 } = {},
  ) => {
    const item = pending[index];
    if (!item) throw new Error(`NO_PENDING_E2E_REQUEST_AT_INDEX:${index}`);
    pending.splice(index, 1);

    if (abortError) {
      finishRecord(item.record, abortError);
      await item.route.abort(abortError);
    } else {
      finishRecord(item.record, status);
      await item.route.fulfill(safeSyntheticResponse(status, marker));
    }
    item.resolve();
  };

  return {
    get mode() {
      return mode;
    },
    get pendingCount() {
      return pending.length;
    },
    records,
    goOffline: async () => {
      offline = true;
      await context.setOffline(true);
    },
    reconnect: async () => {
      await context.setOffline(false);
      offline = false;
    },
    releaseAt,
    releaseNext: async (options) => releaseAt(0, options),
    safeSummary: () => ({
      mode,
      pendingRequestCount: pending.length,
      requestCount: records.length,
      requests: records.map((record) => ({ ...record })),
    }),
    dispose: async () => {
      while (pending.length > 0) {
        await releaseAt(0, { abortError: 'failed' });
      }
      await context.setOffline(false);
      offline = false;
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
      await page.unroute(DRAFT_API_ROUTE_PATTERN, draftRouteHandler);
      await page.unroute(PRODUCTION_EXTERNAL_ROUTE_PATTERN, productionRouteHandler);
    },
  };
};
