import { base44 } from '@/api/base44Client';
import { defaultProDraftAdminGrantVault } from '@/lib/proDraftAdminGrantVault';
import {
  emitSafeDraftClientMetric,
  normalizeProDraftClientError,
} from '@/lib/proDraftClientErrorPolicy';

export const PRO_DRAFT_ADMIN_API_VERSION = 1;

const FUNCTIONS = Object.freeze({
  listDrafts: 'listProFormDraftsForRecovery',
  getDraft: 'getProFormDraftForRecovery',
  listDraftEvents: 'listProFormDraftEventsForRecovery',
  updateDraft: 'updateProFormDraftForRecovery',
  getDraftLineage: 'getProFormDraftLineageForRecovery',
  listIntakes: 'listProFormSubmissionIntakesForRecovery',
  getIntake: 'getProFormSubmissionIntakeForRecovery',
  retrySubmission: 'retryProQuestionnaireIntakeSubmission',
  repairSubmission: 'repairProQuestionnaireIntakeSubmission',
});

const unwrap = (response) => response && typeof response === 'object' && 'data' in response
  ? response.data : response;

export function normalizeAdminApiError(error) {
  const payload = unwrap(error?.response) ?? error?.response?.data ?? {};
  const normalized = normalizeProDraftClientError(error, {
    audience: 'admin',
    fallbackCode: 'ADMIN_API_REQUEST_FAILED',
  });
  return Object.freeze({
    ...normalized,
    code: normalized.code,
    message: normalized.message,
    requestId: typeof payload?.requestId === 'string' ? payload.requestId : null,
  });
}

class ProDraftAdminApiError extends Error {
  constructor(details) {
    super(details.message);
    this.name = 'ProDraftAdminApiError';
    Object.assign(this, details);
  }
}

export function getSafeAdminApiDiagnostics() {
  return Object.freeze({ apiVersion: PRO_DRAFT_ADMIN_API_VERSION, functions: { ...FUNCTIONS }, grantTransport: 'json_body', usesUrls: false, logsPayloads: false, automaticPasswordRetry: false });
}

export function createProDraftAdminApiClient(options = {}) {
  const invoke = options.invoke ?? ((name, body) => base44.functions.invoke(name, body));
  const vault = options.vault ?? defaultProDraftAdminGrantVault;
  const authorization = options.authorization ?? null;
  const onSafeMetric = options.onSafeMetric;

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
      const normalized = normalizeAdminApiError(error);
      if (normalized.authorizationRequired) {
        await vault.removeAdminRecoveryGrant();
        await authorization?.handleAdminGrantRejected?.();
      }
      emitSafeDraftClientMetric(onSafeMetric, { operation: name, ...normalized });
      throw new ProDraftAdminApiError(normalized);
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
export const listIntakes = (...args) => proDraftAdminApiClient.listIntakes(...args);
export const getIntake = (...args) => proDraftAdminApiClient.getIntake(...args);
