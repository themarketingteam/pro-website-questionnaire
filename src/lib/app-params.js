const EMPTY_LOCATION_SNAPSHOT = Object.freeze({
  hash: '',
  href: '',
  pathname: '',
  search: '',
});

const appParamDiagnosticState = {
  hasWindow: false,
  locationAvailable: false,
  storageAvailable: false,
  storageReadSucceeded: null,
  storageWriteSucceeded: null,
  tokenRemovalAttempted: false,
  tokenRemovalSucceeded: null,
  urlParseSucceeded: null,
};

const safeEnvironment = () => {
  try {
    // @ts-expect-error Vite injects ImportMeta.env during the browser build.
    return import.meta.env || {};
  } catch {
    return {};
  }
};

const normalizeParamValue = (value) => {
  if (value === null || typeof value === 'undefined') return null;
  const normalized = String(value);
  return normalized.length > 0 ? normalized : null;
};

export const toSnakeCase = (value) => String(value || '')
  .replace(/([A-Z])/g, '_$1')
  .toLowerCase();

export const safeGetWindowObject = () => {
  try {
    const windowObject = typeof window === 'undefined' ? null : window;
    appParamDiagnosticState.hasWindow = Boolean(windowObject);
    return windowObject;
  } catch {
    appParamDiagnosticState.hasWindow = false;
    return null;
  }
};

const safeLocationProperty = (location, property) => {
  try {
    return typeof location?.[property] === 'string' ? location[property] : '';
  } catch {
    return '';
  }
};

export const safeGetLocationSnapshot = (windowObject = safeGetWindowObject()) => {
  try {
    const location = windowObject?.location;
    if (!location) {
      appParamDiagnosticState.locationAvailable = false;
      return { ...EMPTY_LOCATION_SNAPSHOT };
    }
    const snapshot = {
      hash: safeLocationProperty(location, 'hash'),
      href: safeLocationProperty(location, 'href'),
      pathname: safeLocationProperty(location, 'pathname'),
      search: safeLocationProperty(location, 'search'),
    };
    appParamDiagnosticState.locationAvailable = Boolean(
      snapshot.href || snapshot.pathname || snapshot.search || snapshot.hash,
    );
    return snapshot;
  } catch {
    appParamDiagnosticState.locationAvailable = false;
    return { ...EMPTY_LOCATION_SNAPSHOT };
  }
};

export const safeGetLocalStorageForAppParams = (
  windowObject = safeGetWindowObject(),
) => {
  try {
    const storage = windowObject?.localStorage || null;
    appParamDiagnosticState.storageAvailable = Boolean(storage);
    return storage;
  } catch {
    appParamDiagnosticState.storageAvailable = false;
    return null;
  }
};

export const safeReadAppParamStorage = (
  storageKey,
  windowObject = safeGetWindowObject(),
) => {
  if (typeof storageKey !== 'string' || storageKey.length === 0) return null;
  const storage = safeGetLocalStorageForAppParams(windowObject);
  if (!storage) {
    appParamDiagnosticState.storageReadSucceeded = false;
    return null;
  }
  try {
    const value = storage.getItem(storageKey);
    appParamDiagnosticState.storageReadSucceeded = true;
    return normalizeParamValue(value);
  } catch {
    appParamDiagnosticState.storageReadSucceeded = false;
    return null;
  }
};

export const safeWriteAppParamStorage = (
  storageKey,
  value,
  windowObject = safeGetWindowObject(),
) => {
  const normalized = normalizeParamValue(value);
  if (typeof storageKey !== 'string' || storageKey.length === 0 || normalized === null) {
    return false;
  }
  const storage = safeGetLocalStorageForAppParams(windowObject);
  if (!storage) {
    appParamDiagnosticState.storageWriteSucceeded = false;
    return false;
  }
  try {
    storage.setItem(storageKey, normalized);
    appParamDiagnosticState.storageWriteSucceeded = true;
    return true;
  } catch {
    appParamDiagnosticState.storageWriteSucceeded = false;
    return false;
  }
};

const safeSearchParameters = (search) => {
  try {
    const parameters = new URLSearchParams(typeof search === 'string' ? search : '');
    appParamDiagnosticState.urlParseSucceeded = true;
    return parameters;
  } catch {
    appParamDiagnosticState.urlParseSucceeded = false;
    return null;
  }
};

const safeDocumentTitle = () => {
  try {
    return typeof document !== 'undefined' && typeof document?.title === 'string'
      ? document.title
      : '';
  } catch {
    return '';
  }
};

export const safeRemoveSearchParameter = (
  paramName,
  windowObject = safeGetWindowObject(),
) => {
  if (!windowObject || typeof paramName !== 'string' || paramName.length === 0) {
    return false;
  }
  const snapshot = safeGetLocationSnapshot(windowObject);
  const parameters = safeSearchParameters(snapshot.search);
  if (!parameters) return false;

  try {
    if (!parameters.has(paramName)) return true;
    parameters.delete(paramName);
    const query = parameters.toString();
    const nextUrl = `${snapshot.pathname || '/'}${query ? `?${query}` : ''}${snapshot.hash}`;
    const history = windowObject.history;
    if (!history || typeof history.replaceState !== 'function') return false;
    history.replaceState({}, safeDocumentTitle(), nextUrl);
    return true;
  } catch {
    return false;
  }
};

export const getAppParamValue = (
  paramName,
  {
    defaultValue = undefined,
    removeFromUrl = false,
    windowObject = safeGetWindowObject(),
  } = {},
) => {
  const storageKey = `base44_${toSnakeCase(paramName)}`;
  const location = safeGetLocationSnapshot(windowObject);
  const searchParameters = safeSearchParameters(location.search);
  let queryValue = null;
  let parameterPresent = false;

  if (searchParameters) {
    try {
      parameterPresent = searchParameters.has(paramName);
      queryValue = normalizeParamValue(searchParameters.get(paramName));
    } catch {
      appParamDiagnosticState.urlParseSucceeded = false;
    }
  }

  if (removeFromUrl && parameterPresent) {
    appParamDiagnosticState.tokenRemovalAttempted = true;
    appParamDiagnosticState.tokenRemovalSucceeded = safeRemoveSearchParameter(
      paramName,
      windowObject,
    );
  }

  if (queryValue !== null) {
    safeWriteAppParamStorage(storageKey, queryValue, windowObject);
    return queryValue;
  }

  const normalizedDefault = normalizeParamValue(defaultValue);
  if (normalizedDefault !== null) {
    safeWriteAppParamStorage(storageKey, normalizedDefault, windowObject);
    return normalizedDefault;
  }

  return safeReadAppParamStorage(storageKey, windowObject);
};

export const getAppParams = ({
  environment = safeEnvironment(),
  windowObject = safeGetWindowObject(),
} = {}) => {
  const appId = getAppParamValue('app_id', {
    defaultValue: environment?.VITE_BASE44_APP_ID,
    windowObject,
  });
  const serverUrl = getAppParamValue('server_url', {
    defaultValue: environment?.VITE_BASE44_BACKEND_URL,
    windowObject,
  });
  const token = getAppParamValue('access_token', {
    removeFromUrl: true,
    windowObject,
  });
  const fromUrl = getAppParamValue('from_url', {
    defaultValue: safeGetLocationSnapshot(windowObject).href,
    windowObject,
  });
  const functionsVersion = getAppParamValue('functions_version', { windowObject });

  return { appId, serverUrl, token, fromUrl, functionsVersion };
};

export const appParams = getAppParams();

export const getSafeAppParamDiagnostics = (params = appParams) => Object.freeze({
  hasAppId: Boolean(params?.appId),
  hasFromUrl: Boolean(params?.fromUrl),
  hasFunctionsVersion: Boolean(params?.functionsVersion),
  hasServerUrl: Boolean(params?.serverUrl),
  hasToken: Boolean(params?.token),
  hasWindow: appParamDiagnosticState.hasWindow,
  locationAvailable: appParamDiagnosticState.locationAvailable,
  storageAvailable: appParamDiagnosticState.storageAvailable,
  storageReadSucceeded: appParamDiagnosticState.storageReadSucceeded,
  storageWriteSucceeded: appParamDiagnosticState.storageWriteSucceeded,
  tokenRemovalAttempted: appParamDiagnosticState.tokenRemovalAttempted,
  tokenRemovalSucceeded: appParamDiagnosticState.tokenRemovalSucceeded,
  urlParseSucceeded: appParamDiagnosticState.urlParseSucceeded,
});
