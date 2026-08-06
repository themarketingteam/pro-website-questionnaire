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
  'loading', 'password_required', 'authorized', 'locked', 'error',
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

  const value = useMemo(() => Object.freeze({
    authorizationState,
    authorizeWithPassword,
    validateStoredGrant,
    forgetThisDevice,
    getAdminGrantForAuthorizedRequest,
  }), [
    authorizationState, authorizeWithPassword, validateStoredGrant,
    forgetThisDevice, getAdminGrantForAuthorizedRequest,
  ]);

  return (
    <ProDraftAdminAuthorizationContext.Provider value={value}>
      {children}
    </ProDraftAdminAuthorizationContext.Provider>
  );
}

export default ProDraftAdminAuthorizationProvider;
