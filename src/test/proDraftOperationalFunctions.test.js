import { describe, expect, it, vi } from 'vitest';
import { createRecordProDraftOperationalEventsHandler } from '../../base44/functions/recordProDraftOperationalEvents/entry.ts';
import { filterOperationalSummaryRows } from '../../base44/functions/getProDraftOperationalSummary/entry.ts';

const envValues = {PRO_DRAFT_ENVIRONMENT: 'test', PRO_DRAFT_V2_SERVER_ENABLED: 'true', PRO_DRAFT_V2_KILL_SWITCH: 'false', PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'disabled', PRO_DRAFT_BUILD_SHA: 'synthetic-sha', PRO_FORM_OPERATIONAL_FINGERPRINT_SECRET: 'o'.repeat(32)};
const request = (body) => new Request('https://backend.invalid/operational', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});

describe('operational ingest and summary boundaries', () => {
  it('requires authorization matching the event class and uses service role only after it', async () => {
    const create = vi.fn().mockResolvedValue({}); const authorize = vi.fn().mockResolvedValue({kind: 'public', draftId: 'synthetic-draft'});
    const requestId = `pdrq_${'R'.repeat(43)}`;
    const handler = createRecordProDraftOperationalEventsHandler({getEnvironmentValue: (name) => envValues[name], createClientFromRequest: () => ({asServiceRole: {entities: {ProFormOperationalEvent: {create}}}}), authorize, createRequestId: () => requestId});
    const response = await handler(request({apiVersion: 1, authorization: {method: 'synthetic'}, events: [{event_type: 'draft_save', latency_ms: 15, metadata: {phase: 'save'}}], testRunId: 'run_1'}));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({accepted: 1, rejected: 0}); expect(authorize).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({environment: 'test', request_id: requestId, test_run_id: 'run_1', draft_fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/)});
  });
  it('rejects mixed/publicly forbidden types and client-supplied fingerprints before a write', async () => {
    const create = vi.fn(); const authorize = vi.fn(); const handler = createRecordProDraftOperationalEventsHandler({getEnvironmentValue: (name) => envValues[name], createClientFromRequest: () => ({asServiceRole: {entities: {ProFormOperationalEvent: {create}}}}), authorize});
    for (const [events, status] of [[[{event_type: 'draft_save'}, {event_type: 'migration_started'}], 403], [[{event_type: 'draft_save', draft_fingerprint: 'abcdefabcdef'}], 400]]) {
      const response = await handler(request({apiVersion: 1, authorization: {}, events})); expect(response.status).toBe(status);
    }
    expect(authorize).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it('enforces test-run isolation before aggregate calculation', () => {
    const rows = [{environment: 'test', event_type: 'draft_save', severity: 'info', created_at_server: '2026-08-06T10:00:00Z', test_run_id: 'run_a'}, {environment: 'test', event_type: 'draft_save', severity: 'info', created_at_server: '2026-08-06T10:00:00Z', test_run_id: 'run_b'}];
    expect(filterOperationalSummaryRows(rows, {environment: 'test', from: '2026-08-06T00:00:00Z', to: '2026-08-07T00:00:00Z', testRunId: 'run_a'}, 'test')).toEqual([rows[0]]);
  });
});
