const createCircularReplacer = () => {
  const seen = new WeakSet();
  return (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };
};

export const safeJsonStringify = (value, fallback = '') => {
  try {
    if (typeof value === 'undefined') return fallback;
    return JSON.stringify(value, createCircularReplacer());
  } catch {
    return fallback;
  }
};

export const safeGetWindowLocationHref = () => {
  try {
    return typeof window !== 'undefined' && window?.location?.href ? window.location.href : '';
  } catch {
    return '';
  }
};

export const safeGetUserAgent = () => {
  try {
    return typeof navigator !== 'undefined' && navigator?.userAgent ? navigator.userAgent : '';
  } catch {
    return '';
  }
};

export const safeLocalStorageSet = (key, value) => {
  try {
    if (typeof localStorage === 'undefined' || !key) return false;
    const normalizedValue = typeof value === 'string' ? value : safeJsonStringify(value, '');
    localStorage.setItem(key, normalizedValue);
    return true;
  } catch {
    return false;
  }
};

export const safeLocalStorageGet = (key) => {
  try {
    if (typeof localStorage === 'undefined' || !key) return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeSessionStorageSet = (key, value) => {
  try {
    if (typeof sessionStorage === 'undefined' || !key) return false;
    const normalizedValue = typeof value === 'string' ? value : safeJsonStringify(value, '');
    sessionStorage.setItem(key, normalizedValue);
    return true;
  } catch {
    return false;
  }
};

export const safeSessionStorageGet = (key) => {
  try {
    if (typeof sessionStorage === 'undefined' || !key) return null;
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeNowIso = () => {
  try {
    return new Date().toISOString();
  } catch {
    try {
      return String(Date.now());
    } catch {
      return '';
    }
  }
};

export const getSafeSubmitContext = (extra = {}) => ({
  page_url: safeGetWindowLocationHref(),
  user_agent: safeGetUserAgent(),
  app_version: import.meta.env.VITE_APP_VERSION || null,
  submitted_at_client: safeNowIso(),
  ...extra
});