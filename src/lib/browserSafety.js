import {
  tryGetLocalStorage,
  tryGetSessionStorage,
} from '@/lib/resilientStorage';

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

// Deprecated for authoritative draft state, but retained for compatibility callers.
// New draft persistence should use resilientStorage for fallback diagnostics.
export const safeLocalStorageSet = (key, value) => {
  const storage = tryGetLocalStorage();
  if (!storage || !key) return false;
  try {
    const normalizedValue = typeof value === 'string' ? value : safeJsonStringify(value, '');
    storage.setItem(key, normalizedValue);
    return true;
  } catch {
    return false;
  }
};

export const safeLocalStorageGet = (key) => {
  const storage = tryGetLocalStorage();
  if (!storage || !key) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const safeLocalStorageRemove = (key) => {
  const storage = tryGetLocalStorage();
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const safeSessionStorageSet = (key, value) => {
  const storage = tryGetSessionStorage();
  if (!storage || !key) return false;
  try {
    const normalizedValue = typeof value === 'string' ? value : safeJsonStringify(value, '');
    storage.setItem(key, normalizedValue);
    return true;
  } catch {
    return false;
  }
};

export const safeSessionStorageGet = (key) => {
  const storage = tryGetSessionStorage();
  if (!storage || !key) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const safeSessionStorageRemove = (key) => {
  const storage = tryGetSessionStorage();
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
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
