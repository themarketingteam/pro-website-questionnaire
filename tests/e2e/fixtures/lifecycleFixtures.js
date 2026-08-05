export const LIFECYCLE_EVENTS = Object.freeze([
  'visibilitychange',
  'pagehide',
  'beforeunload',
]);

export const installLifecycleShim = async (
  context,
  { initialVisibility = 'visible' } = {},
) => {
  if (!['hidden', 'visible'].includes(initialVisibility)) {
    throw new Error(`INVALID_E2E_VISIBILITY_STATE:${initialVisibility}`);
  }

  await context.addInitScript(({ visibility }) => {
    let currentVisibility = visibility;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => currentVisibility,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => currentVisibility === 'hidden',
    });
    Object.defineProperty(window, '__E2E_LIFECYCLE_SHIM__', {
      configurable: false,
      enumerable: false,
      value: {
        getVisibility: () => currentVisibility,
        setVisibility: (nextVisibility) => {
          currentVisibility = nextVisibility;
          document.dispatchEvent(new Event('visibilitychange'));
        },
      },
      writable: false,
    });
  }, { visibility: initialVisibility });
};

export const setVisibilityState = async (page, visibility) => {
  if (!['hidden', 'visible'].includes(visibility)) {
    throw new Error(`INVALID_E2E_VISIBILITY_STATE:${visibility}`);
  }
  return page.evaluate((nextVisibility) => {
    if (!window.__E2E_LIFECYCLE_SHIM__) {
      throw new Error('E2E_LIFECYCLE_SHIM_NOT_INSTALLED');
    }
    window.__E2E_LIFECYCLE_SHIM__.setVisibility(nextVisibility);
    return {
      hidden: document.hidden,
      visibilityState: document.visibilityState,
    };
  }, visibility);
};

export const dispatchPageHide = async (page, { persisted = false } = {}) => (
  page.evaluate((isPersisted) => {
    let event;
    try {
      event = new PageTransitionEvent('pagehide', { persisted: isPersisted });
    } catch {
      event = new Event('pagehide');
      Object.defineProperty(event, 'persisted', { value: isPersisted });
    }
    return window.dispatchEvent(event);
  }, persisted)
);

export const dispatchBeforeUnload = async (page) => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true });
  const dispatchResult = window.dispatchEvent(event);
  return {
    defaultPrevented: event.defaultPrevented,
    dispatchResult,
    simulated: true,
  };
});

export const closePage = async (page, options = {}) => page.close(options);

export const closeContext = async (context) => context.close();

export const captureReusableStorageState = async (
  context,
  { includeIndexedDB = true } = {},
) => context.storageState({ indexedDB: includeIndexedDB });

export const openFreshContextWithStorageState = async (
  browser,
  storageState,
  options = {},
) => browser.newContext({ ...options, storageState });

export const goBack = async (page, options = {}) => page.goBack(options);

export const goForward = async (page, options = {}) => page.goForward(options);

export const simulateMobileBackgroundAndReopen = async (
  page,
  {
    viewport = { height: 844, width: 390 },
  } = {},
) => {
  await page.setViewportSize(viewport);
  const hidden = await setVisibilityState(page, 'hidden');
  const visible = await setVisibilityState(page, 'visible');
  return { hidden, viewport, visible };
};
