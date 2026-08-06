import { describe, expect, it, vi } from 'vitest';
import { HEALTH_COMPONENTS, aggregateHealthStatus, buildHealthComponentResult, getSafeAdminHealthProjection, getSafePublicHealthProjection } from '../../base44/functions/_shared/proDraftHealth/entry.ts';
import { createGetProDraftPublicHealthHandler } from '../../base44/functions/getProDraftPublicHealth/entry.ts';
import { buildSecretPresence, createGetProDraftAdminHealthHandler } from '../../base44/functions/getProDraftAdminHealth/entry.ts';

const envValues = {PRO_DRAFT_ENVIRONMENT: 'test', PRO_DRAFT_V2_SERVER_ENABLED: 'true', PRO_DRAFT_V2_KILL_SWITCH: 'false', PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'disabled', PRO_DRAFT_BUILD_SHA: 'build-synthetic'};
const env = (name) => envValues[name];
const request = (body) => new Request('https://backend.invalid/health', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});

describe('draft health contract and functions', () => {
  it('defines all components and deterministic aggregate precedence', () => {
    expect(Object.values(HEALTH_COMPONENTS)).toHaveLength(15);
    const healthy = buildHealthComponentResult({component: 'frontend', status: 'healthy', checkedAt: '2026-08-06T00:00:00Z'});
    const degraded = buildHealthComponentResult({component: 'ses', status: 'degraded', checkedAt: '2026-08-06T00:00:00Z'});
    expect(aggregateHealthStatus([healthy])).toBe('healthy'); expect(aggregateHealthStatus([healthy, degraded])).toBe('degraded');
  });
  it('public projection exposes only the six approved fields', () => {
    const projection = getSafePublicHealthProjection({components: [buildHealthComponentResult({component: 'frontend', status: 'healthy'})], environment: 'test', buildSha: 'build', checkedAt: '2026-08-06T00:00:00Z', requestId: 'request'});
    expect(Object.keys(projection)).toEqual(['success', 'status', 'environment', 'buildSha', 'checkedAt', 'requestId']);
    expect(JSON.stringify(projection)).not.toMatch(/secret|component|count|appId|recovery/i);
  });
  it('public function is bounded, no-store, and returns no details', async () => {
    const handler = createGetProDraftPublicHealthHandler({getEnvironmentValue: env, now: () => new Date('2026-08-06T00:00:00Z'), createRequestId: () => `pdrq_${'H'.repeat(43)}`});
    const response = await handler(request({apiVersion: 1})); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store'); expect(body).toMatchObject({success: true, status: 'healthy', environment: 'test', buildSha: 'build-synthetic'}); expect(body).not.toHaveProperty('components');
  });
  it('admin projection contains only presence booleans, safe components, and aggregate metrics', () => {
    const projection = getSafeAdminHealthProjection({components: [buildHealthComponentResult({component: 'database', status: 'healthy'})], environment: 'test', buildSha: 'build', checkedAt: '2026-08-06T00:00:00Z', requestId: 'request', secrets: {SYNTHETIC_SECRET: true}, metrics: {saveFailureRate: 0}, criticalEvents: []});
    expect(projection).toMatchObject({requiredSecretsPresent: {SYNTHETIC_SECRET: true}, containsSecretValues: false, containsPii: false});
    expect(() => getSafeAdminHealthProjection({components: [], environment: 'test', buildSha: 'build', checkedAt: '2026-08-06T00:00:00Z', requestId: 'request', metrics: {rawSecret: 'not-safe'}})).toThrow('HEALTH_RESULT_INVALID');
  });
  it('checks secret presence without returning values', () => {
    const presence = buildSecretPresence((name) => name === 'PRO_FORM_SYNTHETIC_PROBE_SECRET' ? 's'.repeat(32) : undefined);
    expect(presence.PRO_FORM_SYNTHETIC_PROBE_SECRET).toBe(true); expect(Object.values(presence).every((value) => typeof value === 'boolean')).toBe(true); expect(JSON.stringify(presence)).not.toContain('ssss');
  });
  it('admin health rejects requests without a password-issued grant before queries', async () => {
    const filter = vi.fn(); const handler = createGetProDraftAdminHealthHandler({getEnvironmentValue: env, createClientFromRequest: () => ({asServiceRole: {entities: {ProFormOperationalEvent: {filter}}}})});
    const response = await handler(request({apiVersion: 1, deviceId: `pdd_${'D'.repeat(22)}`})); expect(response.status).toBe(401); expect(filter).not.toHaveBeenCalled();
  });
});
