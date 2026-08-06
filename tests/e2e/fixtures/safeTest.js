import { test as base, expect } from '@playwright/test';
import { installConsoleCapture } from '../helpers/consoleCapture.js';
import {
  installNetworkCapture,
  installReadOnlyNetworkPolicy,
} from '../helpers/networkCapture.js';
import {
  canRunWriteTests,
  resolveE2ETarget,
} from '../helpers/targetSafety.js';
import { installSensitiveEntityNetworkGuard } from '../helpers/sensitiveEntityNetworkGuard.js';

const target = resolveE2ETarget(process.env);

export const test = base.extend({
  safetyCapture: [async ({ page }, use, testInfo) => {
    const blockedRequests = await installReadOnlyNetworkPolicy(page, target);
    const consoleCapture = installConsoleCapture(page);
    const networkCapture = installNetworkCapture(page);
    const sensitiveEntityGuard = installSensitiveEntityNetworkGuard(page);
    const capture = {
      blockedRequests,
      consoleCapture,
      networkCapture,
      sensitiveEntityGuard,
    };

    await use(capture);

    consoleCapture.stop();
    networkCapture.stop();
    sensitiveEntityGuard.stop();

    await testInfo.attach('safe-console-summary.json', {
      body: Buffer.from(JSON.stringify(consoleCapture.safeSummary(), null, 2)),
      contentType: 'application/json',
    });
    await testInfo.attach('safe-network-summary.json', {
      body: Buffer.from(JSON.stringify({
        ...networkCapture.safeSummary(),
        ...sensitiveEntityGuard.safeSummary(),
        blockedRequestCount: blockedRequests.length,
        blockedRequests,
      }, null, 2)),
      contentType: 'application/json',
    });

    sensitiveEntityGuard.assertNoViolations();
  }, { auto: true }],
});

// Future write-capable specs must import writeTest instead of test. The
// fixture skips automatically unless the exact staging-only write gate passes.
export const writeTest = test.extend({
  writeAccess: [async (_fixtures, use) => {
    writeTest.skip(
      !canRunWriteTests(target),
      'E2E writes require E2E_ALLOW_WRITES=true on a staging target',
    );
    await use(true);
  }, { auto: true }],
});

export { expect };
