import { describe, expect, it } from 'vitest';
import {
  calculateCanonicalDraftStateHash,
} from '../../base44/functions/_shared/proDraftBootstrapLoad/entry.ts';
import {
  call,
  createAuthoritativeHarness,
  eventsBody,
  nextCanonicalState,
  saveBody,
} from './proDraftSaveEventTestHarness.js';
import { request } from './proDraftFunctionTestHarness.js';

describe('local mocked Base44 save/event integration harness', () => {
  it('permits exactly one conditional update at one expected revision', async () => {
    const harness = await createAuthoritativeHarness();
    const first = saveBody(harness, { idempotencyKey: 'save.race.0000001' });
    const secondState = nextCanonicalState(harness, {
      responses: { syntheticQuestion: 'other-writer' },
    });
    const second = saveBody(harness, {
      idempotencyKey: 'save.race.0000002', canonicalState: secondState,
    });
    const responses = await Promise.all([
      harness.saveHandler(request(first)), harness.saveHandler(request(second)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(harness.memory.records[0].server_revision).toBe(1);
  });

  it('returns the accepted result idempotently for the winning retry', async () => {
    const harness = await createAuthoritativeHarness();
    const body = saveBody(harness);
    expect((await call(harness.saveHandler, body)).json.idempotent).toBe(false);
    const retry = await call(harness.saveHandler, body);
    expect(retry.response.status).toBe(200);
    expect(retry.json).toMatchObject({ idempotent: true, acceptedServerRevision: 1 });
  });

  it('blocks a delayed active write after a submitted transition', async () => {
    const harness = await createAuthoritativeHarness();
    const delayedActive = saveBody(harness, { idempotencyKey: 'save.delayed.0001' });
    const attempted = nextCanonicalState(harness, { draftStatus: 'submit_attempted' });
    await call(harness.saveHandler, saveBody(harness, {
      idempotencyKey: 'save.submit.00001', canonicalState: attempted,
      requestedStatus: 'submit_attempted', syncReason: 'submit_attempt',
    }));
    const submitted = nextCanonicalState(harness, { draftStatus: 'submitted' });
    submitted.submission = {
      ...submitted.submission,
      finalSubmissionId: 'submission-integration-1',
      submittedAt: submitted.savedAtClient,
      submittedStateHash: '0'.repeat(64),
      pdfSourceStateHash: '0'.repeat(64),
    };
    const hash = await calculateCanonicalDraftStateHash(submitted);
    submitted.submission.submittedStateHash = hash;
    submitted.submission.pdfSourceStateHash = hash;
    const accepted = await call(harness.saveHandler, saveBody(harness, {
      idempotencyKey: 'save.submit.00002', canonicalState: submitted,
      requestedStatus: 'submitted', syncReason: 'submitted',
    }));
    expect(accepted.response.status).toBe(200);
    const delayed = await call(harness.saveHandler, delayedActive);
    expect(delayed.response.status).toBe(403);
    expect(harness.memory.records[0]).toMatchObject({
      status: 'submitted', server_revision: 2,
      final_submission_id: 'submission-integration-1',
    });
  });

  it('appends an event without advancing the snapshot server revision', async () => {
    const harness = await createAuthoritativeHarness();
    await call(harness.saveHandler, saveBody(harness));
    const before = harness.memory.records[0].server_revision;
    const result = await call(harness.eventsHandler, eventsBody(harness));
    expect(result.response.status).toBe(200);
    expect(harness.memory.records[0].server_revision).toBe(before);
    expect(result.json.serverRevision).toBe(before);
  });
});
