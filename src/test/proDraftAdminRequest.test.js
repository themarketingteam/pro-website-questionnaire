import { describe, expect, it, vi } from 'vitest';
import { getAdminRecoveryPolicy, issuePersistentAdminRecoveryGrant, validateAdminDeviceBinding } from '../../base44/functions/_shared/proDraftAdminAuthorization/entry.ts';
import { ADMIN_API_OPERATION_NAMES, authorizeAdminRecoveryRequest, createAdminFunctionHandler, getSafeAdminRequestDiagnostics, readAdminGrantFromRequest, validateAdminApiRequest } from '../../base44/functions/_shared/proDraftAdminRequest/entry.ts';

const SECRET = 'synthetic-admin-request-secret-value-0000000000000000';
const DEVICE_ID = `pdd_${'R'.repeat(22)}`;
const env = (environment = 'test') => (name) => ({ PRO_FORM_ADMIN_GRANT_SECRET: SECRET, PRO_DRAFT_ENVIRONMENT: environment }[name]);

async function grant(environment = 'test') {
  const deviceBindingHash = await validateAdminDeviceBinding({ deviceId: DEVICE_ID, adminGrantSecret: SECRET });
  return issuePersistentAdminRecoveryGrant({ policy: getAdminRecoveryPolicy(env(environment)), deviceBindingHash, adminGrantSecret: SECRET, tokenIdGenerator: () => `pdti_${'Q'.repeat(43)}` });
}

const request = (body, headers = {}) => new Request('https://backend.invalid/function', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('admin request boundary', () => {
  it('accepts the preferred body grant and strips it from business payload', async () => {
    const adminGrant = await grant(); const body = { apiVersion: 1, adminGrant, deviceId: DEVICE_ID, draftId: 'd1' };
    const result = await authorizeAdminRecoveryRequest({ request: request(body), body, operation: ADMIN_API_OPERATION_NAMES.GET_DRAFT, getEnvironmentValue: env() });
    expect(result.payload).toEqual({ draftId: 'd1' }); expect(result).not.toHaveProperty('adminGrant');
  });
  it('accepts an approved Bearer grant', async () => {
    const adminGrant = await grant(); const body = { apiVersion: 1, deviceId: DEVICE_ID, draftId: 'd1' };
    expect(readAdminGrantFromRequest(request(body, { authorization: `Bearer ${adminGrant}` }), body)).toBe(adminGrant);
  });
  it('rejects a missing grant', async () => {
    const body = { apiVersion: 1, deviceId: DEVICE_ID }; await expect(authorizeAdminRecoveryRequest({ request: request(body), body, operation: ADMIN_API_OPERATION_NAMES.GET_DRAFT, getEnvironmentValue: env() })).rejects.toMatchObject({ status: 401 });
  });
  it('rejects conflicting body and header grants', async () => {
    const adminGrant = await grant(); const body = { apiVersion: 1, adminGrant, deviceId: DEVICE_ID };
    expect(() => readAdminGrantFromRequest(request(body, { authorization: 'Bearer other.signature' }), body)).toThrow();
  });
  it('rejects wrong device binding', async () => {
    const adminGrant = await grant(); const body = { apiVersion: 1, adminGrant, deviceId: `pdd_${'S'.repeat(22)}` };
    await expect(authorizeAdminRecoveryRequest({ request: request(body), body, operation: ADMIN_API_OPERATION_NAMES.GET_DRAFT, getEnvironmentValue: env() })).rejects.toMatchObject({ status: 401 });
  });
  it('rejects wrong environment', async () => {
    const adminGrant = await grant('staging'); const body = { apiVersion: 1, adminGrant, deviceId: DEVICE_ID };
    await expect(authorizeAdminRecoveryRequest({ request: request(body), body, operation: ADMIN_API_OPERATION_NAMES.GET_DRAFT, getEnvironmentValue: env('test') })).rejects.toMatchObject({ status: 401 });
  });
  it('rejects API version and frontend authority hints', async () => {
    expect(() => validateAdminApiRequest({ apiVersion: 2, deviceId: DEVICE_ID }, { grant: 'a.b' })).toThrow();
    expect(() => validateAdminApiRequest({ apiVersion: 1, deviceId: DEVICE_ID, isAdmin: true }, { grant: 'a.b' })).toThrow();
    expect(() => validateAdminApiRequest({ apiVersion: 1, deviceId: DEVICE_ID, role: 'admin' }, { grant: 'a.b' })).toThrow();
  });
  it('rejects production test markers', async () => {
    const adminGrant = await grant('production'); const body = { apiVersion: 1, adminGrant, deviceId: DEVICE_ID, testRunId: 'synthetic' };
    await expect(authorizeAdminRecoveryRequest({ request: request(body), body, operation: ADMIN_API_OPERATION_NAMES.GET_DRAFT, getEnvironmentValue: env('production') })).rejects.toMatchObject({ status: 400 });
  });
  it('writes authorization audit before executing business logic and returns no-store', async () => {
    const adminGrant = await grant(); const body = { apiVersion: 1, adminGrant, deviceId: DEVICE_ID };
    const order = []; const create = vi.fn(async () => { order.push('audit'); });
    const handler = createAdminFunctionHandler({ operation: ADMIN_API_OPERATION_NAMES.GET_DRAFT, maxBytes: 4096, getEnvironmentValue: env(), createClientFromRequest: () => ({ asServiceRole: { entities: { ProFormRecoverySecurityEvent: { create } } } }), execute: async () => { order.push('business'); return { draft: { id: 'd1' } }; } });
    const response = await handler(request(body)); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store'); expect(order).toEqual(['audit','business']);
  });
  it('exposes safe diagnostics only', () => {
    expect(getSafeAdminRequestDiagnostics()).toMatchObject({ acceptsPassword: false, acceptsRoleOverride: false, logsRequestBody: false });
  });
});
