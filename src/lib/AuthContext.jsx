import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { safeGetWindowLocationHref } from '@/lib/browserSafety';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';

const AuthContext = createContext();

export const AUTH_REQUEST_TIMEOUT_MS = 4_000;

const SAFE_AUTH_ERRORS = Object.freeze({
  auth_required: Object.freeze({
    type: 'auth_required',
    message: 'Authentication required',
  }),
  user_not_registered: Object.freeze({
    type: 'user_not_registered',
    message: 'User not registered for this app',
  }),
  public_settings_timeout: Object.freeze({
    type: 'public_settings_timeout',
    message: 'Public questionnaire settings could not be loaded in time',
  }),
  public_settings_unavailable: Object.freeze({
    type: 'public_settings_unavailable',
    message: 'Public questionnaire settings are temporarily unavailable',
  }),
  auth_timeout: Object.freeze({
    type: 'auth_timeout',
    message: 'Authentication could not be checked in time',
  }),
  auth_unavailable: Object.freeze({
    type: 'auth_unavailable',
    message: 'Authentication is temporarily unavailable',
  }),
});

const safeErrorStatus = (error) => {
  try {
    return error?.status || error?.response?.status || null;
  } catch {
    return null;
  }
};

const safeAppErrorReason = (error) => {
  try {
    return error?.data?.extra_data?.reason || error?.response?.data?.extra_data?.reason || null;
  } catch {
    return null;
  }
};

export const withAuthRequestTimeout = async (
  operation,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
  timeoutType = 'auth_timeout',
) => {
  const normalizedTimeout = Number.isFinite(timeoutMs) && timeoutMs >= 0
    ? timeoutMs
    : AUTH_REQUEST_TIMEOUT_MS;
  let timeoutId;

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject({ safeAuthType: timeoutType }), normalizedTimeout);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const sanitizeAuthError = (error, phase = 'auth') => {
  let timeoutType = null;
  try {
    timeoutType = error?.safeAuthType;
  } catch {
    timeoutType = null;
  }

  if (timeoutType && SAFE_AUTH_ERRORS[timeoutType]) {
    return SAFE_AUTH_ERRORS[timeoutType];
  }

  const status = safeErrorStatus(error);
  const reason = safeAppErrorReason(error);
  if (reason === 'user_not_registered') {
    return SAFE_AUTH_ERRORS.user_not_registered;
  }
  if (reason === 'auth_required' || (
    phase === 'auth' && (status === 401 || status === 403)
  )) {
    return SAFE_AUTH_ERRORS.auth_required;
  }

  return phase === 'public'
    ? SAFE_AUTH_ERRORS.public_settings_unavailable
    : SAFE_AUTH_ERRORS.auth_unavailable;
};

export const AuthProvider = ({
  children,
  requestTimeoutMs = AUTH_REQUEST_TIMEOUT_MS,
  base44Client = base44,
  appParamsValue = appParams,
  publicSettingsClientFactory = createAxiosClient,
}) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  const checkAppState = useCallback(async () => {
    setIsLoadingPublicSettings(true);
    setIsLoadingAuth(true);
    setAuthError(null);

    try {
      const appClient = publicSettingsClientFactory({
        baseURL: `${appParamsValue?.serverUrl || ''}/api/apps/public`,
        headers: {
          'X-App-Id': appParamsValue?.appId,
        },
        token: appParamsValue?.token,
        interceptResponses: true,
      });
      const publicSettings = await withAuthRequestTimeout(
        () => appClient.get(`/prod/public-settings/by-id/${appParamsValue?.appId || ''}`),
        requestTimeoutMs,
        'public_settings_timeout',
      );
      setAppPublicSettings(publicSettings);

      if (!appParamsValue?.token) {
        setUser(null);
        setIsAuthenticated(false);
        return;
      }

      try {
        const currentUser = await withAuthRequestTimeout(
          () => base44Client?.auth?.me(),
          requestTimeoutMs,
          'auth_timeout',
        );
        setUser(currentUser || null);
        setIsAuthenticated(Boolean(currentUser));
      } catch (error) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError(sanitizeAuthError(error, 'auth'));
      }
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);
      setAuthError(sanitizeAuthError(error, 'public'));
    } finally {
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  }, [appParamsValue, base44Client, publicSettingsClientFactory, requestTimeoutMs]);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);

    try {
      const logoutMethod = base44Client?.auth?.logout;
      if (typeof logoutMethod !== 'function') return;
      const href = safeGetWindowLocationHref();
      if (shouldRedirect && href) logoutMethod(href);
      else logoutMethod();
    } catch {
      // Authentication cleanup must not crash the application shell.
    }
  };

  const navigateToLogin = () => {
    try {
      const redirectMethod = base44Client?.auth?.redirectToLogin;
      if (typeof redirectMethod !== 'function') return;
      const href = safeGetWindowLocationHref();
      if (href) redirectMethod(href);
      else redirectMethod();
    } catch {
      // The public questionnaire remains available if redirect setup fails.
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
