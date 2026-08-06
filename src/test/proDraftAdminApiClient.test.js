import { describe, expect, it, vi } from 'vitest';
import { createProDraftAdminApiClient, getSafeAdminApiDiagnostics, normalizeAdminApiError } from '@/lib/proDraftAdminApiClient';

const bundle = { grant: 'payload.signature', deviceId: 'device_123' };
const vault = (status = 'available') => ({ loadAdminRecoveryGrant: vi.fn(async () => ({ status, bundle: status === 'available' ? bundle : null })), removeAdminRecoveryGrant: vi.fn(async () => {}) });

describe('admin API client', () => {
  it('injects the grant, device, and API version into list calls', async () => {
    const invoke = vi.fn(async () => ({ data: { success: true, items: [] } }));
    const client = createProDraftAdminApiClient({ invoke, vault: vault() }); await client.listDrafts({ pageSize: 10 });
    expect(invoke).toHaveBeenCalledWith('listProFormDraftsForRecovery', expect.objectContaining({ pageSize: 10, apiVersion: 1, adminGrant: bundle.grant, deviceId: bundle.deviceId }));
  });
  it('maps all backend-only operations', async () => {
    const invoke = vi.fn(async () => ({ data: { success: true } })); const client = createProDraftAdminApiClient({ invoke, vault: vault() });
    await client.getDraft({}); await client.listDraftEvents({}); await client.updateDraft({}); await client.getDraftLineage({}); await client.listIntakes({}); await client.getIntake({}); await client.retrySubmission({}); await client.repairSubmission({});
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['getProFormDraftForRecovery','listProFormDraftEventsForRecovery','updateProFormDraftForRecovery','getProFormDraftLineageForRecovery','listProFormSubmissionIntakesForRecovery','getProFormSubmissionIntakeForRecovery','retryProQuestionnaireIntakeSubmission','repairProQuestionnaireIntakeSubmission']);
  });
  it('fails before invocation if no persistent credentials exist', async () => {
    const invoke = vi.fn(); const client = createProDraftAdminApiClient({ invoke, vault: vault('missing') });
    await expect(client.getDraft({})).rejects.toMatchObject({ code: 'ADMIN_API_AUTHORIZATION_REQUIRED' }); expect(invoke).not.toHaveBeenCalled();
  });
  it('clears the vault and notifies authorization context on rejection', async () => {
    const v = vault(); const authorization = { getGrantForAuthorizedRequest: vi.fn(async () => bundle.grant), handleAdminGrantRejected: vi.fn(async () => {}) };
    const error = Object.assign(new Error('denied'), { response: { status: 401, data: { errorCode: 'ADMIN_API_AUTHORIZATION_DENIED' } } });
    const client = createProDraftAdminApiClient({ invoke: vi.fn(async () => { throw error; }), vault: v, authorization });
    await expect(client.getDraft({})).rejects.toMatchObject({ authorizationRequired: true, reauthorizeAdmin: true }); expect(v.removeAdminRecoveryGrant).toHaveBeenCalledOnce(); expect(authorization.handleAdminGrantRejected).toHaveBeenCalledOnce();
  });
  it('does not retry failed writes', async () => {
    const invoke = vi.fn(async () => { throw new Error('network'); }); const client = createProDraftAdminApiClient({ invoke, vault: vault() });
    await expect(client.updateDraft({})).rejects.toMatchObject({ kind: 'network', retryable: true }); expect(invoke).toHaveBeenCalledOnce();
  });
  it('normalizes errors and reports no URL or logging transport', () => {
    expect(normalizeAdminApiError({ response: { status: 401, data: { errorCode: 'ADMIN_API_AUTHORIZATION_DENIED', requestId: 'r1' } } })).toMatchObject({ authorizationRequired: true, requestId: 'r1' });
    expect(getSafeAdminApiDiagnostics()).toMatchObject({ grantTransport: 'json_body', usesUrls: false, logsPayloads: false });
  });
});
