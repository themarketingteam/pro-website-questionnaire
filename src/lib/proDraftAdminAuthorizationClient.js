import { base44 } from '@/api/base44Client';
import { defaultProDraftAdminGrantVault } from '@/lib/proDraftAdminGrantVault';

const FUNCTION_NAME = 'verifyDraftRecoveryAccess';

const safeState = (status, value = {}) => Object.freeze({
  status,
  authorized: status === 'authorized',
  locked: status === 'locked',
  requestId: typeof value.requestId === 'string' ? value.requestId : null,
  retryAfterSeconds: Number.isFinite(value.retryAfterSeconds)
    ? Math.max(0, Math.trunc(value.retryAfterSeconds)) : 0,
  storageMode: typeof value.storageMode === 'string' ? value.storageMode : 'unknown',
  storageNotice: typeof value.storageNotice === 'string' ? value.storageNotice : '',
});

function responseData(response) {
  return response && typeof response === 'object' && 'data' in response
    ? response.data : response;
}

export function normalizeAdminAuthorizationError(error) {
  const payload = responseData(error?.response) ?? {};
  if (payload?.locked === true || error?.response?.status === 429) {
    return safeState('locked', payload);
  }
  return safeState('error', payload);
}

export function createProDraftAdminAuthorizationClient(options = {}) {
  const invoke = options.invoke ?? ((name, body) => base44.functions.invoke(name, body));
  const vault = options.vault ?? defaultProDraftAdminGrantVault;

  return Object.freeze({
    async authorizeWithRecoveryPassword(password, requestOptions = {}) {
      try {
        const deviceId = await vault.getOrCreateDeviceId();
        const data = responseData(await invoke(FUNCTION_NAME, {
          mode: 'password', password, deviceId,
          ...(requestOptions.testRunId ? { testRunId: requestOptions.testRunId } : {}),
        }));
        if (!data?.success || !data?.authorized || typeof data.grant !== 'string') {
          return safeState(data?.locked ? 'locked' : 'password_required', data);
        }
        const saved = await vault.saveAdminRecoveryGrant({
          grant: data.grant,
          deviceId,
          grantVersion: data.grantVersion,
          passwordVersion: data.passwordVersion,
          recoveryPolicyVersion: data.recoveryPolicyVersion,
        });
        return safeState('authorized', {
          ...data,
          storageMode: saved.storageMode,
          storageNotice: saved.persistentNotice,
        });
      } catch (error) {
        return normalizeAdminAuthorizationError(error);
      }
    },

    async validateStoredAdminRecoveryGrant(requestOptions = {}) {
      const loaded = await vault.loadAdminRecoveryGrant();
      if (loaded.status !== 'available' || !loaded.bundle) {
        if (loaded.status === 'malformed') await vault.removeAdminRecoveryGrant();
        return safeState('password_required', {
          storageMode: loaded.storageMode,
          storageNotice: loaded.persistentNotice,
        });
      }
      try {
        const data = responseData(await invoke(FUNCTION_NAME, {
          mode: 'grant', grant: loaded.bundle.grant, deviceId: loaded.bundle.deviceId,
          ...(requestOptions.testRunId ? { testRunId: requestOptions.testRunId } : {}),
        }));
        if (!data?.success || !data?.authorized) {
          await vault.removeAdminRecoveryGrant();
          return safeState(data?.locked ? 'locked' : 'password_required', data);
        }
        const saved = await vault.markAdminRecoveryGrantValidated(loaded.bundle);
        return safeState('authorized', {
          ...data,
          storageMode: saved.storageMode,
          storageNotice: saved.persistentNotice,
        });
      } catch (error) {
        await vault.removeAdminRecoveryGrant();
        return normalizeAdminAuthorizationError(error);
      }
    },

    async forgetAdminRecoveryDevice(requestOptions = {}) {
      const loaded = await vault.loadAdminRecoveryGrant();
      try {
        if (loaded.status === 'available' && loaded.bundle) {
          await invoke(FUNCTION_NAME, {
            mode: 'forget_device', grant: loaded.bundle.grant,
            deviceId: loaded.bundle.deviceId,
            ...(requestOptions.testRunId ? { testRunId: requestOptions.testRunId } : {}),
          });
        }
      } catch {
        // Revocation audit is best effort; local credentials are always cleared.
      } finally {
        try {
          await vault.removeAdminRecoveryGrant();
        } finally {
          await vault.clearAdminRecoveryDevice();
        }
      }
      return safeState('password_required', vault.getSafeAdminGrantVaultDiagnostics());
    },

    async getGrantForAuthorizedRequest() {
      const loaded = await vault.loadAdminRecoveryGrant();
      return loaded.status === 'available' ? loaded.bundle?.grant ?? null : null;
    },

    getSafeAdminAuthorizationClientDiagnostics() {
      return Object.freeze({
        functionName: FUNCTION_NAME,
        passwordBackendVerified: true,
        exposesGrantInUiState: false,
        storesInRedux: false,
        storesInUrl: false,
        logsCredentials: false,
        vault: vault.getSafeAdminGrantVaultDiagnostics(),
      });
    },
  });
}

const defaultClient = createProDraftAdminAuthorizationClient();
export const authorizeWithRecoveryPassword = (...args) => (
  defaultClient.authorizeWithRecoveryPassword(...args)
);
export const validateStoredAdminRecoveryGrant = (...args) => (
  defaultClient.validateStoredAdminRecoveryGrant(...args)
);
export const forgetAdminRecoveryDevice = (...args) => (
  defaultClient.forgetAdminRecoveryDevice(...args)
);
export const getSafeAdminAuthorizationClientDiagnostics = () => (
  defaultClient.getSafeAdminAuthorizationClientDiagnostics()
);
