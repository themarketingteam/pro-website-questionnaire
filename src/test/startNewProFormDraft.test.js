import { describe, expect, it } from 'vitest';
import { REPLACEMENT_OPERATION_TYPES } from '../../base44/functions/_shared/proDraftReplacement/entry.ts';
import {
  invokeReplacement,
  replacementHarness,
} from './proDraftReplacementTestHarness.js';

const startHarness = (options = {}) => replacementHarness({
  operation: REPLACEMENT_OPERATION_TYPES.START_NEW_AFTER_SUBMISSION,
  status: 'submitted',
  ...options,
});

describe('startNewProFormDraft transaction', () => {
  it('creates a distinct active draft from a submitted source', async () => {
    const harness = await startHarness();
    const { json } = await invokeReplacement(harness);
    expect(json).toMatchObject({
      success: true,
      operation: 'start_new_after_submission',
      sourceDraft: { status: 'submitted', serverRevision: 3 },
      replacementDraft: { status: 'active', draftGeneration: 2 },
    });
    expect(harness.records[1]).toMatchObject({
      draft_origin: 'start_new_after_submission',
      previous_draft_id: harness.records[0].id,
      replacement_transaction_status: 'committed',
    });
  });

  it('rejects an active source', async () => {
    const harness = await startHarness({ status: 'active' });
    const result = await invokeReplacement(harness);
    expect(result.response.status).toBe(401);
    expect(harness.records).toHaveLength(1);
  });

  it('does not edit submitted status, final ID, revision, or canonical identity', async () => {
    const harness = await startHarness();
    const before = { ...harness.records[0] };
    await invokeReplacement(harness);
    expect(harness.records[0]).toEqual(before);
    expect(harness.records[0].final_submission_id).toBe('submission-synthetic-final');
  });

  it('is idempotent and does not create a second replacement', async () => {
    const harness = await startHarness();
    await invokeReplacement(harness);
    const retry = await invokeReplacement(harness);
    expect(retry.json.idempotent).toBe(true);
    expect(harness.records).toHaveLength(2);
  });

  it('increments a non-default source generation', async () => {
    const harness = await startHarness({ generation: 7 });
    const { json } = await invokeReplacement(harness);
    expect(json.replacementDraft.draftGeneration).toBe(8);
  });

  it('records a safe committed security event with no credentials', async () => {
    const harness = await startHarness();
    const { json } = await invokeReplacement(harness);
    const event = harness.events.find((candidate) => (
      candidate.event_type === 'draft_replacement_committed'
    ));
    expect(event).toBeTruthy();
    expect(JSON.stringify(event)).not.toContain(json.recoveryCode);
    expect(JSON.stringify(event)).not.toContain(json.resumeToken);
  });
});
