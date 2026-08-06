import { createClient } from '@base44/sdk';
import {
  appParams,
  safeGetLocalStorageForAppParams,
  safeGetWindowObject,
} from '@/lib/app-params';

export const BASE44_CLIENT_ERROR_CODES = Object.freeze({
  CLIENT_CREATION_FAILED: 'client_creation_failed',
  MISSING_APP_ID: 'missing_app_id',
});

const createInitializationDiagnostics = (params, overrides = {}) => Object.freeze({
  success: false,
  hasAppId: Boolean(params?.appId),
  hasServerUrl: Boolean(params?.serverUrl),
  hasToken: Boolean(params?.token),
  hasFunctionsVersion: Boolean(params?.functionsVersion),
  errorCode: null,
  ...overrides,
});

const createProtectedStorageFacade = (storage) => ({
  get length() {
    try { return Number(storage?.length) || 0; } catch { return 0; }
  },
  clear() {
    try { storage?.clear(); } catch {}
  },
  getItem(key) {
    try { return storage?.getItem(key) ?? null; } catch { return null; }
  },
  key(index) {
    try { return storage?.key(index) ?? null; } catch { return null; }
  },
  removeItem(key) {
    try { storage?.removeItem(key); } catch {}
  },
  setItem(key, value) {
    try { storage?.setItem(key, value); } catch {}
  },
});

// The current Base44 SDK reads the localStorage property before its operation
// guard. Protect only its synchronous construction, then restore the exact
// browser descriptor. No storage object or fallback client is retained here.
export const createBase44ClientWithSafeStorage = (
  config,
  createClientImplementation = createClient,
  windowObject = safeGetWindowObject(),
) => {
  if (!windowObject) return createClientImplementation(config);

  let originalDescriptor;
  let facadeInstalled = false;
  try {
    originalDescriptor = Object.getOwnPropertyDescriptor(windowObject, 'localStorage');
    const storage = safeGetLocalStorageForAppParams(windowObject);
    Object.defineProperty(windowObject, 'localStorage', {
      configurable: true,
      enumerable: originalDescriptor?.enumerable ?? true,
      value: createProtectedStorageFacade(storage),
    });
    facadeInstalled = true;
  } catch {
    facadeInstalled = false;
  }

  try {
    return createClientImplementation(config);
  } finally {
    if (facadeInstalled) {
      try {
        if (originalDescriptor) {
          Object.defineProperty(windowObject, 'localStorage', originalDescriptor);
        } else {
          delete windowObject.localStorage;
        }
      } catch {
        // Client construction has settled; never expose restoration details.
      }
    }
  }
};

export const initializeBase44Client = (
  params = appParams,
  createClientImplementation = createClient,
) => {
  if (!params?.appId) {
    return Object.freeze({
      client: null,
      diagnostics: createInitializationDiagnostics(params, {
        errorCode: BASE44_CLIENT_ERROR_CODES.MISSING_APP_ID,
      }),
    });
  }

  try {
    const client = createBase44ClientWithSafeStorage({
      appId: params.appId,
      serverUrl: params.serverUrl,
      token: params.token,
      functionsVersion: params.functionsVersion,
      requiresAuth: false,
    }, createClientImplementation);
    if (!client) throw new Error(BASE44_CLIENT_ERROR_CODES.CLIENT_CREATION_FAILED);

    return Object.freeze({
      client,
      diagnostics: createInitializationDiagnostics(params, {
        success: true,
      }),
    });
  } catch {
    return Object.freeze({
      client: null,
      diagnostics: createInitializationDiagnostics(params, {
        errorCode: BASE44_CLIENT_ERROR_CODES.CLIENT_CREATION_FAILED,
      }),
    });
  }
};

const initializationResult = initializeBase44Client();

export const base44 = initializationResult.client;
export const base44ClientInitialization = initializationResult.diagnostics;
