import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createProDraftAdminAuthorizationClient } from '@/lib/proDraftAdminAuthorizationClient';

export const ADMIN_AUTHORIZATION_STATES = Object.freeze([
  'loading', 'password_required', 'authenticating', 'authorized', 'rate_limited', 'locked', 'error',
]);

const INITIAL_STATE = Object.freeze({
  status: 'loading', authorized: false, locked: false,
  requestId: null, retryAfterSeconds: 0, storageMode: 'unknown', storageNotice: '',
});

export const ProDraftAdminAuthorizationContext = createContext(null);

export function ProDraftAdminAuthorizationProvider({ children, client: clientProp }) {
  const client = useMemo(
    () => clientProp ?? createProDraftAdminAuthorizationClient(),
    [clientProp],
  );
  const [authorizationState, setAuthorizationState] = useState(INITIAL_STATE);
  const mountedRef = useRef(false);
  const restorePromiseRef = useRef(null);
  const passwordAttemptRef = useRef(null);
  const invalidationHandlerRef = useRef(null);

  const validateStoredGrant = useCallback(async () => {
    if (restorePromiseRef.current) return restorePromiseRef.current;
    const operation = client.validateStoredAdminRecoveryGrant()
      .then((state) => {
        if (mountedRef.current) setAuthorizationState(state);
        return state;
      })
      .finally(() => {
        restorePromiseRef.current = null;
      });
    restorePromiseRef.current = operation;
    return operation;
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    void validateStoredGrant();
    return () => {
      mountedRef.current = false;
    };
  }, [validateStoredGrant]);

  const authorizeWithPassword = useCallback(async (password) => {
    if (passwordAttemptRef.current) return passwordAttemptRef.current;
    if (mountedRef.current) setAuthorizationState((current) => ({ ...current, status: 'authenticating', authorized: false }));
    const operation = client.authorizeWithRecoveryPassword(password)
      .then((state) => {
        if (mountedRef.current) setAuthorizationState(state);
        return state;
      })
      .finally(() => {
        passwordAttemptRef.current = null;
      });
    passwordAttemptRef.current = operation;
    return operation;
  }, [client]);

  const forgetThisDevice = useCallback(async () => {
    const state = await client.forgetAdminRecoveryDevice();
    if (mountedRef.current) setAuthorizationState(state);
    return state;
  }, [client]);

  const getAdminGrantForAuthorizedRequest = useCallback(async () => {
    if (!authorizationState.authorized) return null;
    return client.getGrantForAuthorizedRequest();
  }, [authorizationState.authorized, client]);

  const registerAuthorizationInvalidationHandler = useCallback((handler) => {
    invalidationHandlerRef.current = typeof handler === 'function' ? handler : null;
    return () => { if (invalidationHandlerRef.current === handler) invalidationHandlerRef.current = null; };
  }, []);

  const handleAdminGrantRejected = useCallback(async () => {
    try { await invalidationHandlerRef.current?.(); } finally {
      if (mountedRef.current) setAuthorizationState((current) => ({
        ...current, status: 'password_required', authorized: false, locked: false,
      }));
    }
  }, []);

  const value = useMemo(() => Object.freeze({
    authorizationState,
    authorizeWithPassword,
    validateStoredGrant,
    forgetThisDevice,
    getAdminGrantForAuthorizedRequest,
    handleAdminGrantRejected,
    registerAuthorizationInvalidationHandler,
  }), [
    authorizationState, authorizeWithPassword, validateStoredGrant,
    forgetThisDevice, getAdminGrantForAuthorizedRequest,
    handleAdminGrantRejected, registerAuthorizationInvalidationHandler,
  ]);

  return (
    <ProDraftAdminAuthorizationContext.Provider value={value}>
      {children}
    </ProDraftAdminAuthorizationContext.Provider>
  );
}

export default ProDraftAdminAuthorizationProvider;
