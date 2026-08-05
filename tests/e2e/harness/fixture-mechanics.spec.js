import { test, expect } from '../fixtures/safeTest.js';
import {
  dispatchBeforeUnload,
  dispatchPageHide,
  installLifecycleShim,
  setVisibilityState,
} from '../fixtures/lifecycleFixtures.js';
import {
  createTwoIndependentContexts,
  createTwoPagesInContext,
  getBroadcastChannelCapability,
  installBroadcastChannelUnavailable,
} from '../fixtures/multiTabFixtures.js';
import { installNetworkScenario } from '../fixtures/networkFixtures.js';
import {
  getStorageCapabilityDiagnostics,
  installStorageFailureMode,
  STORAGE_MODES,
} from '../fixtures/storageFixtures.js';
import { redactUrl } from '../helpers/redaction.js';
import {
  isDocumentedProductionHostname,
  resolveE2ETarget,
} from '../helpers/targetSafety.js';

const target = resolveE2ETarget(process.env);
const harnessUrl = (name) => new URL(`/__e2e_harness__/${name}`, target.baseURL).toString();

const installHarnessDocument = async (page) => {
  await page.route('**/__e2e_harness__/**', async (route) => {
    await route.fulfill({
      body: `<!doctype html>
        <html>
          <head><meta charset="utf-8"><title>E2E Fixture Harness</title></head>
          <body>
            <main data-testid="fixture-harness">Synthetic fixture harness</main>
            <script>
              window.__beforeAppStorageProbe = (() => {
                try {
                  return { available: Boolean(window.localStorage), error: null };
                } catch (error) {
                  return { available: false, error: error.name };
                }
              })();
            </script>
          </body>
        </html>`,
      contentType: 'text/html',
      headers: { 'cache-control': 'no-store' },
      status: 200,
    });
  });
};

const storageOutcome = async (page, mode) => page.evaluate(async (selectedMode) => {
  const attempt = (callback) => {
    try {
      callback();
      return null;
    } catch (error) {
      return error.name;
    }
  };

  if (selectedMode === 'normal') {
    return { available: Boolean(localStorage && sessionStorage && indexedDB) };
  }
  if (selectedMode === 'localstorage_getter_throws') {
    return window.__beforeAppStorageProbe;
  }
  if (selectedMode === 'localstorage_read_throws') {
    return {
      readError: attempt(() => localStorage.getItem('__e2e_read__')),
      writeError: attempt(() => localStorage.setItem('__e2e_write__', 'synthetic')),
    };
  }
  if (
    selectedMode === 'localstorage_write_throws'
    || selectedMode === 'localstorage_quota_exceeded'
  ) {
    return {
      readError: attempt(() => localStorage.getItem('__e2e_read__')),
      writeError: attempt(() => localStorage.setItem('__e2e_write__', 'synthetic')),
    };
  }
  if (selectedMode === 'sessionstorage_getter_throws') {
    return { getterError: attempt(() => Boolean(sessionStorage)) };
  }
  if (selectedMode === 'sessionstorage_unavailable') {
    return { available: typeof sessionStorage !== 'undefined' };
  }
  if (selectedMode === 'indexeddb_unavailable') {
    return { available: typeof indexedDB !== 'undefined' };
  }
  if (selectedMode === 'indexeddb_open_throws') {
    return { openError: attempt(() => indexedDB.open('__e2e_open__')) };
  }
  if (selectedMode === 'indexeddb_transaction_fails') {
    return new Promise((resolve) => {
      const request = indexedDB.open('__e2e_transaction__', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('items');
      request.onerror = () => resolve({ openError: request.error?.name || 'Error' });
      request.onsuccess = () => {
        const database = request.result;
        const transactionError = attempt(() => database.transaction('items', 'readonly'));
        database.close();
        resolve({ transactionError });
      };
    });
  }
  if (selectedMode === 'all_persistent_storage_unavailable') {
    return {
      indexedDBAvailable: typeof indexedDB !== 'undefined',
      localStorageError: attempt(() => Boolean(localStorage)),
      sessionStorageAvailable: typeof sessionStorage !== 'undefined',
    };
  }
  throw new Error(`UNHANDLED_E2E_STORAGE_MODE:${selectedMode}`);
}, mode);

const expectedStorageOutcome = {
  all_persistent_storage_unavailable: {
    indexedDBAvailable: false,
    localStorageError: 'SecurityError',
    sessionStorageAvailable: false,
  },
  indexeddb_open_throws: { openError: 'InvalidStateError' },
  indexeddb_transaction_fails: { transactionError: 'InvalidStateError' },
  indexeddb_unavailable: { available: false },
  localstorage_getter_throws: { available: false, error: 'SecurityError' },
  localstorage_quota_exceeded: { readError: null, writeError: 'QuotaExceededError' },
  localstorage_read_throws: { readError: 'SecurityError', writeError: null },
  localstorage_write_throws: { readError: null, writeError: 'SecurityError' },
  normal: { available: true },
  sessionstorage_getter_throws: { getterError: 'SecurityError' },
  sessionstorage_unavailable: { available: false },
};

for (const mode of STORAGE_MODES) {
  test(`[HARNESS] storage mode ${mode} is injected before page code`, async ({
    context,
    page,
  }) => {
    await installStorageFailureMode(context, mode);
    await installHarnessDocument(page);
    await page.goto(harnessUrl(`storage-${mode}`));

    expect(await storageOutcome(page, mode)).toMatchObject(expectedStorageOutcome[mode]);
    const diagnostics = await getStorageCapabilityDiagnostics(page);
    expect(diagnostics.mode).toBe(mode);
    expect(JSON.stringify(diagnostics)).not.toContain('synthetic questionnaire answer');
  });
}

test('[HARNESS] offline draft requests fail and reconnect restores routing', async ({
  context,
  page,
}) => {
  await installHarnessDocument(page);
  await page.goto(harnessUrl('network-offline'));
  await page.route('**/api/e2e/drafts/save', (route) => route.fulfill({
    body: JSON.stringify({ synthetic: true }),
    contentType: 'application/json',
    status: 200,
  }));
  const controller = await installNetworkScenario(page, context, 'offline_after_load');

  try {
    await controller.goOffline();
    const offlineResult = await page.evaluate(async () => {
      try {
        await fetch('/api/e2e/drafts/save', { method: 'POST' });
        return 'unexpected-success';
      } catch {
        return 'offline';
      }
    });
    expect(offlineResult).toBe('offline');

    await controller.reconnect();
    const onlineStatus = await page.evaluate(async () => (
      fetch('/api/e2e/drafts/save', { method: 'POST' }).then((response) => response.status)
    ));
    expect(onlineStatus).toBe(200);
    expect(controller.safeSummary().requests.map((request) => request.status)).toContain('offline');
  } finally {
    await controller.dispose();
  }
});

test('[HARNESS] delayed draft routes are manually releasable', async ({ context, page }) => {
  await installHarnessDocument(page);
  await page.goto(harnessUrl('network-delay'));
  const controller = await installNetworkScenario(page, context, 'draft_save_timeout');

  try {
    const responsePromise = page.evaluate(async () => (
      fetch('/api/e2e/drafts/save', { method: 'POST' }).then((response) => response.status)
    ));
    await expect.poll(() => controller.pendingCount).toBe(1);
    await controller.releaseNext({ marker: 'manual-release', status: 202 });
    await expect(responsePromise).resolves.toBe(202);
  } finally {
    await controller.dispose();
  }
});

test('[HARNESS] two tabs can be controlled independently', async ({ context }) => {
  const tabs = await createTwoPagesInContext(context, { target });
  try {
    await Promise.all([
      installHarnessDocument(tabs.tabA),
      installHarnessDocument(tabs.tabB),
    ]);
    await Promise.all([
      tabs.tabA.goto(harnessUrl('tab-a')),
      tabs.tabB.goto(harnessUrl('tab-b')),
    ]);
    await tabs.runInTabA(() => { window.name = 'synthetic-tab-a'; });
    await tabs.runInTabB(() => { window.name = 'synthetic-tab-b'; });

    await expect.poll(() => tabs.runInTabA(() => window.name)).toBe('synthetic-tab-a');
    await expect.poll(() => tabs.runInTabB(() => window.name)).toBe('synthetic-tab-b');
  } finally {
    await tabs.close();
  }
});

test('[HARNESS] independent contexts do not share local storage', async ({ browser }) => {
  const isolated = await createTwoIndependentContexts(browser, { target });
  try {
    await Promise.all([
      installHarnessDocument(isolated.tabA),
      installHarnessDocument(isolated.tabB),
    ]);
    await Promise.all([
      isolated.tabA.goto(harnessUrl('context-a')),
      isolated.tabB.goto(harnessUrl('context-b')),
    ]);
    await isolated.runInTabA(() => localStorage.setItem('__e2e_isolation__', 'client-a'));
    expect(await isolated.runInTabB(() => localStorage.getItem('__e2e_isolation__'))).toBeNull();
  } finally {
    await isolated.close();
  }
});

test('[HARNESS] lifecycle shim controls visibility and dispatches bounded events', async ({
  context,
  page,
}) => {
  await installLifecycleShim(context);
  await installHarnessDocument(page);
  await page.goto(harnessUrl('lifecycle'));
  await page.evaluate(() => {
    window.__e2eLifecycleEvents = [];
    document.addEventListener('visibilitychange', () => {
      window.__e2eLifecycleEvents.push(`visibility:${document.visibilityState}`);
    });
    window.addEventListener('pagehide', () => window.__e2eLifecycleEvents.push('pagehide'));
    window.addEventListener('beforeunload', () => window.__e2eLifecycleEvents.push('beforeunload'));
  });

  expect(await setVisibilityState(page, 'hidden')).toMatchObject({
    hidden: true,
    visibilityState: 'hidden',
  });
  await dispatchPageHide(page);
  await dispatchBeforeUnload(page);
  expect(await page.evaluate(() => window.__e2eLifecycleEvents)).toEqual([
    'visibility:hidden',
    'pagehide',
    'beforeunload',
  ]);
});

test('[HARNESS] BroadcastChannel can be made unavailable before navigation', async ({
  context,
  page,
}) => {
  await installBroadcastChannelUnavailable(context);
  await installHarnessDocument(page);
  await page.goto(harnessUrl('broadcast-channel'));
  expect(await getBroadcastChannelCapability(page)).toEqual({ available: false });
});

test('[HARNESS] redaction removes every sensitive query field', async () => {
  const redacted = redactUrl(
    'https://staging.example.test/?access_token=one&recoveryCode=two&draftAccessToken=three&userEmail=four',
  );
  expect(redacted).not.toContain('one');
  expect(redacted).not.toContain('two');
  expect(redacted).not.toContain('three');
  expect(redacted).not.toContain('four');
});

test('[HARNESS] documented production hostnames remain blocked', async () => {
  expect(isDocumentedProductionHostname('forms.mspsuccesswebsites.com')).toBe(true);
  expect(() => resolveE2ETarget({
    E2E_BASE_URL: 'https://forms.mspsuccesswebsites.com',
    E2E_TARGET_ENVIRONMENT: 'staging',
  })).toThrow('PRODUCTION_E2E_NOT_ALLOWED');
});
