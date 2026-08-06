import { base44 } from '@/api/base44Client';
import { defaultProDraftAdminGrantVault } from '@/lib/proDraftAdminGrantVault';

export const PRO_DRAFT_ADMIN_API_VERSION = 1;

const FUNCTIONS = Object.freeze({
  listDrafts: 'listProFormDraftsForRecovery',
  getDraft: 'getProFormDraftForRecovery',
  listDraftEvents: 'listProFormDraftEventsForRecovery',
  updateDraft: 'updateProFormDraftForRecovery',
  getDraftLineage: 'getProFormDraftLineageForRecovery',
  retrySubmission: 'retryProQuestionnaireIntakeSubmission',
  repairSubmission: 'repairProQuestionnaireIntakeSubmission',
});

const unwrap = (response) => response && typeof response === 'object' && 'data' in response
  ? response.data : response;

export function normalizeAdminApiError(error) {
  const payload = unwrap(error?.response) ?? error?.response?.data ?? {};
  return Object.freeze({
    code: typeof payload?.errorCode === 'string' ? payload.errorCode : 'ADMIN_API_REQUEST_FAILED',
    message: typeof payload?.message === 'string' ? payload.message : 'The administrative recovery request failed.',
    requestId: typeof payload?.requestId === 'string' ? payload.requestId : null,
    authorizationRequired: error?.response?.status === 401 || payload?.errorCode === 'ADMIN_API_AUTHORIZATION_DENIED',
  });
}

export function getSafeAdminApiDiagnostics() {
  return Object.freeze({ apiVersion: PRO_DRAFT_ADMIN_API_VERSION, functions: { ...FUNCTIONS }, grantTransport: 'json_body', usesUrls: false, logsPayloads: false, automaticPasswordRetry: false });
}

export function createProDraftAdminApiClient(options = {}) {
  const invoke = options.invoke ?? ((name, body) => base44.functions.invoke(name, body));
  const vault = options.vault ?? defaultProDraftAdminGrantVault;
  const authorization = options.authorization ?? null;

  async function credentials() {
    const grant = await authorization?.getGrantForAuthorizedRequest?.();
    const loaded = await vault.loadAdminRecoveryGrant();
    if (loaded.status !== 'available' || !loaded.bundle
      || (authorization && (!grant || grant !== loaded.bundle.grant))) {
      const error = new Error('Administrative recovery authorization is required.');
      error.code = 'ADMIN_API_AUTHORIZATION_REQUIRED';
      throw error;
    }
    return loaded.bundle;
  }

  async function call(name, payload = {}) {
    const bundle = await credentials();
    try {
      const data = unwrap(await invoke(name, {
        ...payload,
        apiVersion: PRO_DRAFT_ADMIN_API_VERSION,
        adminGrant: bundle.grant,
        deviceId: bundle.deviceId,
      }));
      if (!data?.success) {
        const error = new Error(data?.message || 'The administrative recovery request failed.');
        error.code = data?.errorCode || 'ADMIN_API_REQUEST_FAILED';
        error.response = { data };
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.response?.status === 401 || error?.response?.data?.errorCode === 'ADMIN_API_AUTHORIZATION_DENIED') {
        await vault.removeAdminRecoveryGrant();
        await authorization?.handleAdminGrantRejected?.();
      }
      throw error;
    }
  }

  return Object.freeze(Object.fromEntries(Object.entries(FUNCTIONS).map(([method, name]) => [
    method, (payload) => call(name, payload),
  ])));
}

export const proDraftAdminApiClient = createProDraftAdminApiClient();
export const listDrafts = (...args) => proDraftAdminApiClient.listDrafts(...args);
export const getDraft = (...args) => proDraftAdminApiClient.getDraft(...args);
export const listDraftEvents = (...args) => proDraftAdminApiClient.listDraftEvents(...args);
export const updateDraft = (...args) => proDraftAdminApiClient.updateDraft(...args);
export const getDraftLineage = (...args) => proDraftAdminApiClient.getDraftLineage(...args);
export const retrySubmission = (...args) => proDraftAdminApiClient.retrySubmission(...args);
export const repairSubmission = (...args) => proDraftAdminApiClient.repairSubmission(...args);
