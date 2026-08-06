import { expect, test } from '../fixtures/safeTest.js';
import { assertSafeNavigation, resolveE2ETarget } from '../helpers/targetSafety.js';

const target = resolveE2ETarget(process.env);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__securityBroadcastLeakCount = 0;
    const NativeBroadcastChannel = window.BroadcastChannel;
    if (!NativeBroadcastChannel) return;
    window.BroadcastChannel = class SecurityObservedBroadcastChannel extends NativeBroadcastChannel {
      postMessage(value) {
        let serialized = '';
        try { serialized = JSON.stringify(value); } catch { serialized = '<unserializable>'; }
        if (/(?:resumeToken|recoverySessionToken|recoveryCode|adminGrant|awsSecret)/iu.test(serialized)) {
          window.__securityBroadcastLeakCount += 1;
        }
        return super.postMessage(value);
      }
    };
  });
});

test('[DR-SEC-ADV-001] browser surfaces contain no credential or answer leakage', async ({
  page,
  safetyCapture,
}, testInfo) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  expect(assertSafeNavigation(page.url(), target)).toBe(true);

  const summary = await page.evaluate(async () => {
    const forbiddenKey = /(?:resume.?token|recovery.?session|recovery.?code|admin.?grant|aws.?secret|aws.?access|authorization)/iu;
    const signedToken = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{32,}/u;
    const recoveryCode = /[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}/u;
    const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
    const hasForbiddenValue = (value) => signedToken.test(value) || recoveryCode.test(value)
      || /(?:AKIA|ASIA)[0-9A-Z]{16}/u.test(value)
      || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(value);
    const inspectStorage = (storage) => {
      const violations = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || '';
        const value = storage.getItem(key) || '';
        const approvedVault = /(?:draft-credentials|pro-draft-admin:grant)/u.test(key);
        if (hasForbiddenValue(value) && !approvedVault) violations.push('credential_outside_vault');
        if (email.test(key)) violations.push('email_in_storage_key');
        if (forbiddenKey.test(key) && !approvedVault) violations.push('forbidden_storage_key');
      }
      return violations;
    };
    const inspectTextSurface = (value) => {
      const serialized = String(value || '');
      return Number(hasForbiddenValue(serialized));
    };

    let indexedDbViolationCount = 0;
    let indexedDbStoreCount = 0;
    if (typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      for (const databaseInfo of databases.slice(0, 10)) {
        if (!databaseInfo.name) continue;
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseInfo.name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const storeName of [...database.objectStoreNames].slice(0, 20)) {
          indexedDbStoreCount += 1;
          const values = await new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, 'readonly');
            const request = transaction.objectStore(storeName).getAll(undefined, 100);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          let serialized = '';
          try { serialized = JSON.stringify(values); } catch { serialized = '<unserializable>'; }
          if (hasForbiddenValue(serialized)) indexedDbViolationCount += 1;
        }
        database.close();
      }
    }

    const locationState = JSON.stringify(history.state || {});
    const reduxState = JSON.stringify(window.__REDUX_STATE__ || {});
    const resources = performance.getEntriesByType('resource').map((entry) => String(entry.name));
    const analytics = resources.filter((url) => /analytics|telemetry|track/iu.test(url));
    return {
      urlViolationCount: inspectTextSurface(location.href),
      locationStateViolationCount: inspectTextSurface(locationState),
      domViolationCount: inspectTextSurface(document.documentElement.innerHTML),
      reduxViolationCount: inspectTextSurface(reduxState),
      localStorageViolations: inspectStorage(localStorage),
      sessionStorageViolations: inspectStorage(sessionStorage),
      indexedDbStoreCount,
      indexedDbViolationCount,
      broadcastViolationCount: Number(window.__securityBroadcastLeakCount || 0),
      networkMetadataViolationCount: resources.reduce((count, url) => count + inspectTextSurface(url), 0),
      analyticsViolationCount: analytics.reduce((count, url) => count + inspectTextSurface(url), 0),
      emailInUrl: email.test(location.href),
      canonicalCacheInspected: [...Array(localStorage.length).keys()]
        .map((index) => localStorage.key(index) || '')
        .some((key) => /canonical|questionnaire/u.test(key)),
      containsRawValues: false,
    };
  });

  expect(summary).toMatchObject({
    urlViolationCount: 0,
    locationStateViolationCount: 0,
    domViolationCount: 0,
    reduxViolationCount: 0,
    localStorageViolations: [],
    sessionStorageViolations: [],
    indexedDbViolationCount: 0,
    broadcastViolationCount: 0,
    networkMetadataViolationCount: 0,
    analyticsViolationCount: 0,
    emailInUrl: false,
    containsRawValues: false,
  });
  expect(safetyCapture.consoleCapture.consoleErrors).toEqual([]);
  expect(safetyCapture.consoleCapture.pageErrors).toEqual([]);
  expect(safetyCapture.networkCapture.unsafeRequests).toEqual([]);

  await testInfo.attach('browser-leakage-safe-summary.json', {
    body: Buffer.from(JSON.stringify(summary, null, 2)),
    contentType: 'application/json',
  });
});
