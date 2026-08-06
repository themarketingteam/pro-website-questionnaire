import { describe, expect, it, vi } from 'vitest';
import { createProDraftHealthClient, normalizeHealthError } from '@/lib/proDraftHealthClient';

const bundle = {grant: 'synthetic.grant', deviceId: 'synthetic-device'};
const options = (invoke) => ({invoke, vault: {loadAdminRecoveryGrant: vi.fn(async () => ({status: 'available', bundle}))}, authorization: {getGrantForAuthorizedRequest: vi.fn(async () => bundle.grant)}});
describe('health client', () => {
  it('uses backend functions only for public/admin/probe/summary calls', async () => {
    const invoke = vi.fn(async (name) => ({data: {success: true, name}})); const client = createProDraftHealthClient(options(invoke));
    await client.getPublicHealth(); await client.getAdminHealth(); await client.runSyntheticProbe(); await client.getOperationalSummary();
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['getProDraftPublicHealth', 'getProDraftAdminHealth', 'runProDraftSyntheticProbe', 'getProDraftOperationalSummary']);
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('entities');
  });
  it('normalizes errors without retaining payloads', () => expect(normalizeHealthError({response: {status: 503, data: {errorCode: 'HEALTH_FAILED', requestId: 'request'}}})).toEqual({code: 'HEALTH_FAILED', message: 'Health information could not be loaded.', requestId: 'request', retryable: true, containsSensitiveData: false}));
});
