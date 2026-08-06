import { base44 } from '@/api/base44Client';
import { defaultProDraftAdminGrantVault } from '@/lib/proDraftAdminGrantVault';

const unwrap = (response) => response && typeof response === 'object' && 'data' in response ? response.data : response;
export function normalizeHealthError(error) {
  const data = error?.response?.data ?? {};
  return Object.freeze({code: typeof data.errorCode === 'string' ? data.errorCode : 'HEALTH_REQUEST_FAILED', message: 'Health information could not be loaded.', requestId: typeof data.requestId === 'string' ? data.requestId : null, retryable: Number(error?.response?.status ?? 0) >= 500, containsSensitiveData: false});
}

export function createProDraftHealthClient(options = {}) {
  const invoke = options.invoke ?? ((name, body) => base44.functions.invoke(name, body)); const vault = options.vault ?? defaultProDraftAdminGrantVault; const authorization = options.authorization;
  const adminCredentials = async () => { const grant = await authorization?.getGrantForAuthorizedRequest?.(); const loaded = await vault.loadAdminRecoveryGrant(); if (!grant || loaded.status !== 'available' || loaded.bundle?.grant !== grant) throw Object.assign(new Error('Authorization required.'), {response: {status: 401, data: {errorCode: 'HEALTH_AUTHORIZATION_REQUIRED'}}}); return {adminGrant: loaded.bundle.grant, deviceId: loaded.bundle.deviceId}; };
  const call = async (name, body) => { try { const data = unwrap(await invoke(name, body)); if (!data?.success) throw Object.assign(new Error('Health request failed.'), {response: {data, status: data?.status === 'unhealthy' ? 503 : 400}}); return data; } catch (error) { throw Object.assign(new Error(normalizeHealthError(error).message), normalizeHealthError(error)); } };
  const adminCall = async (name, payload = {}) => call(name, {apiVersion: 1, ...await adminCredentials(), ...payload});
  return Object.freeze({getPublicHealth: () => call('getProDraftPublicHealth', {apiVersion: 1}), getAdminHealth: (payload) => adminCall('getProDraftAdminHealth', payload), runSyntheticProbe: (payload) => adminCall('runProDraftSyntheticProbe', payload), getOperationalSummary: (payload) => adminCall('getProDraftOperationalSummary', payload)});
}

export const defaultProDraftHealthClient = createProDraftHealthClient();
export const getPublicHealth = () => defaultProDraftHealthClient.getPublicHealth();
export const getAdminHealth = (payload) => defaultProDraftHealthClient.getAdminHealth(payload);
export const runSyntheticProbe = (payload) => defaultProDraftHealthClient.runSyntheticProbe(payload);
export const getOperationalSummary = (payload) => defaultProDraftHealthClient.getOperationalSummary(payload);
