import { installReadOnlyNetworkPolicy } from '../helpers/networkCapture.js';
import { resolveE2ETarget } from '../helpers/targetSafety.js';
import { installNetworkScenario } from './networkFixtures.js';

const safeIdentity = (value, field) => {
  const normalized = String(value || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(normalized)) {
    throw new Error(`INVALID_SYNTHETIC_${field}`);
  }
  return normalized;
};

export const createIdentityUrl = (
  baseURL,
  { clientIdentity, draftIdentity },
) => {
  const url = new URL(baseURL);
  url.searchParams.set('e2eClientIdentity', safeIdentity(clientIdentity, 'CLIENT_IDENTITY'));
  url.searchParams.set('e2eDraftIdentity', safeIdentity(draftIdentity, 'DRAFT_IDENTITY'));
  return url.toString();
};

const createControlledTabs = (tabA, tabB, extras = {}) => ({
  ...extras,
  runInTabA: (callback, argument) => tabA.evaluate(callback, argument),
  runInTabB: (callback, argument) => tabB.evaluate(callback, argument),
  tabA,
  tabB,
});

export const createTwoPagesInContext = async (
  context,
  { installSafety = true, target = resolveE2ETarget(process.env) } = {},
) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  const blockedRequests = [];

  if (installSafety) {
    blockedRequests.push(
      await installReadOnlyNetworkPolicy(tabA, target),
      await installReadOnlyNetworkPolicy(tabB, target),
    );
  }

  return createControlledTabs(tabA, tabB, {
    blockedRequests,
    close: async () => Promise.all([tabA.close(), tabB.close()]),
  });
};

export const createTwoIndependentContexts = async (
  browser,
  {
    contextOptions = {},
    installSafety = true,
    target = resolveE2ETarget(process.env),
  } = {},
) => {
  const contextA = await browser.newContext(contextOptions);
  const contextB = await browser.newContext(contextOptions);
  const tabA = await contextA.newPage();
  const tabB = await contextB.newPage();
  const blockedRequests = [];

  if (installSafety) {
    blockedRequests.push(
      await installReadOnlyNetworkPolicy(tabA, target),
      await installReadOnlyNetworkPolicy(tabB, target),
    );
  }

  return createControlledTabs(tabA, tabB, {
    blockedRequests,
    contextA,
    contextB,
    close: async () => Promise.all([contextA.close(), contextB.close()]),
  });
};

export const navigateTabsWithIdentity = async (
  tabs,
  { baseURL, clientIdentityA, clientIdentityB = clientIdentityA, draftIdentity },
) => {
  const urlA = createIdentityUrl(baseURL, {
    clientIdentity: clientIdentityA,
    draftIdentity,
  });
  const urlB = createIdentityUrl(baseURL, {
    clientIdentity: clientIdentityB,
    draftIdentity,
  });

  await Promise.all([tabs.tabA.goto(urlA), tabs.tabB.goto(urlB)]);
  return { urlA, urlB };
};

export const installTwoTabNetworkOrdering = async (
  tabs,
  { mode = 'out_of_order_response', slowDelayMs } = {},
) => {
  const tabA = await installNetworkScenario(
    tabs.tabA,
    tabs.tabA.context(),
    mode,
    { slowDelayMs },
  );
  const tabB = await installNetworkScenario(
    tabs.tabB,
    tabs.tabB.context(),
    mode,
    { slowDelayMs },
  );

  return {
    tabA,
    tabB,
    dispose: async () => Promise.all([tabA.dispose(), tabB.dispose()]),
    release: async (tabName, index = 0, options) => {
      if (!['tabA', 'tabB'].includes(tabName)) {
        throw new Error(`INVALID_E2E_TAB_NAME:${tabName}`);
      }
      await (tabName === 'tabA' ? tabA : tabB).releaseAt(index, options);
    },
  };
};

export const getBroadcastChannelCapability = async (page) => page.evaluate(() => ({
  available: typeof BroadcastChannel === 'function',
}));

export const installBroadcastChannelUnavailable = async (context) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      value: undefined,
      writable: false,
    });
  });
};

export const captureAcceptedRevisionMarker = async (
  page,
  selector = '[data-accepted-revision]',
) => {
  const marker = await page.locator(selector).first().getAttribute('data-accepted-revision');
  if (marker === null) return null;
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(marker) ? marker : '<unsafe-revision-marker>';
};
