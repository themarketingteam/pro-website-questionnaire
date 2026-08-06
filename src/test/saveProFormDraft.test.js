import { describe, expect, it } from 'vitest';
import {
  calculateCanonicalDraftStateHash,
} from '../../base44/functions/_shared/proDraftBootstrapLoad/entry.ts';
import {
  call,
  createAuthoritativeHarness,
  nextCanonicalState,
  saveBody,
} from './proDraftSaveEventTestHarness.js';
import { request } from './proDraftFunctionTestHarness.js';

describe('saveProFormDraft authoritative writes', () => {
  it('fails closed when the durable server runtime is disabled', async () => {
    const harness = await createAuthoritativeHarness({
      operationDependencies: { environment: { PRO_DRAFT_V2_SERVER_ENABLED: 'false' } },
    });
    const { response, json } = await call(harness.saveHandler, saveBody(harness));
    expect(response.status).toBe(503);
    expect(json.errorCode).toBe('FEATURE_DISABLED');
  });

  it.each([
    ['wrong method', () => new Request('https://synthetic.invalid', { method: 'GET' }), 405],
    ['wrong content type', () => new Request('https://synthetic.invalid', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    }), 415],
  ])('rejects %s', async (_name, makeRequest, status) => {
    const harness = await createAuthoritativeHarness();
    expect((await harness.saveHandler(makeRequest())).status).toBe(status);
    expect(harness.memory.records[0].server_revision).toBe(0);
  });

  it.each([
    ['missing expected revision', (body) => { delete body.expectedServerRevision; }],
    ['unknown request field', (body) => { body.unknown = true; }],
    ['new anonymous authorization', (body) => { body.authorization = {}; }],
    ['invalid idempotency key', (body) => { body.idempotencyKey = 'short'; }],
    ['invalid sync reason', (body) => { body.syncReason = 'mystery'; }],
  ])('rejects %s before persistence', async (_name, mutate) => {
    const harness = await createAuthoritativeHarness();
    const body = saveBody(harness);
    mutate(body);
    const { response } = await call(harness.saveHandler, body);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.memory.records[0].server_revision).toBe(0);
    expect(harness.memory.sdk.asServiceRole.entities.ProFormDraft.updateMany)
      .not.toHaveBeenCalled();
  });

  it('accepts a complete canonical save and atomically increments once', async () => {
    const harness = await createAuthoritativeHarness();
    const body = saveBody(harness);
    const { response, json } = await call(harness.saveHandler, body);
    expect(response.status, JSON.stringify(json)).toBe(200);
    expect(json).toMatchObject({
      success: true, idempotent: false,
      acceptedClientRevision: 1, acceptedServerRevision: 1,
    });
    expect(harness.memory.records[0]).toMatchObject({
      client_revision: 1, server_revision: 1, status: 'active',
      last_sync_reason: 'autosave',
    });
    expect(harness.memory.records[0].last_save_idempotency_key_hash)
      .toMatch(/^[0-9a-f]{64}$/u);
    expect(harness.memory.records[0]).toMatchObject({
      responses_json: JSON.stringify({ syntheticQuestion: 'synthetic-value' }),
      userdata_json: JSON.stringify({ syntheticQuestion: 'synthetic-value' }),
      current_question_id: null, last_changed_question_id: null,
    });
    expect(harness.memory.records[0].state_hash).toBe(json.stateHash);
    expect(JSON.stringify(json)).not.toContain('last_save_idempotency_key_hash');
    expect(JSON.stringify(json)).not.toMatch(
      /(?:resume_token_hash|recovery_email_lookup_hash|identity_key_hash|signedDraftAccessToken|recoverySessionToken)/u,
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects a request bound to a different draft', async () => {
    const harness = await createAuthoritativeHarness();
    const state = nextCanonicalState(harness, { draftId: 'draft-synthetic-999' });
    const { response } = await call(harness.saveHandler, saveBody(harness, {
      draftId: 'draft-synthetic-999', canonicalState: state,
    }));
    expect(response.status).toBe(401);
    expect(harness.memory.records[0].server_revision).toBe(0);
  });

  it('denies a submitted read-only resume token before mutation', async () => {
    const harness = await createAuthoritativeHarness();
    harness.memory.records[0].status = 'submitted';
    const state = nextCanonicalState(harness, { draftStatus: 'submitted' });
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      canonicalState: state, requestedStatus: 'submitted', syncReason: 'submitted',
    }));
    expect(response.status).toBe(403);
    expect(json.errorCode).toBe('WRITE_SCOPE_REQUIRED');
  });

  it('returns exact-repeat success without another write or increment', async () => {
    const harness = await createAuthoritativeHarness();
    const body = saveBody(harness);
    await call(harness.saveHandler, body);
    const writes = harness.memory.sdk.asServiceRole.entities.ProFormDraft.updateMany;
    const { response, json } = await call(harness.saveHandler, body);
    expect(response.status).toBe(200);
    expect(json.idempotent).toBe(true);
    expect(json.acceptedServerRevision).toBe(1);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of an idempotency key for different state', async () => {
    const harness = await createAuthoritativeHarness();
    await call(harness.saveHandler, saveBody(harness));
    const changed = nextCanonicalState(harness, {
      responses: { syntheticQuestion: 'different' },
    });
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      canonicalState: changed,
      expectedServerRevision: 1,
    }));
    expect(response.status).toBe(409);
    expect(json).toMatchObject({ errorCode: 'IDEMPOTENCY_CONFLICT', mergeRequired: true });
  });

  it('rejects the same client revision with a different state hash', async () => {
    const harness = await createAuthoritativeHarness();
    await call(harness.saveHandler, saveBody(harness));
    const state = nextCanonicalState(harness, {
      clientRevision: 1,
      responses: { syntheticQuestion: 'different' },
    });
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      idempotencyKey: 'save.synthetic.0002', canonicalState: state,
    }));
    expect(response.status).toBe(409);
    expect(json.errorCode).toBe('REVISION_CONFLICT');
  });

  it('rejects a stale client revision with an authorized conflict projection', async () => {
    const harness = await createAuthoritativeHarness();
    await call(harness.saveHandler, saveBody(harness));
    const state = nextCanonicalState(harness, { clientRevision: 0 });
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      idempotencyKey: 'save.synthetic.0002', canonicalState: state,
    }));
    expect(response.status).toBe(409);
    expect(json.conflict).toMatchObject({
      draftId: harness.draftId, clientRevision: 1, serverRevision: 1,
    });
    expect(json.conflict.canonicalState.responses.syntheticQuestion).toBe('synthetic-value');
  });

  it('rejects a mismatched expected server revision', async () => {
    const harness = await createAuthoritativeHarness();
    const state = nextCanonicalState(harness, { serverRevision: 4 });
    const { response } = await call(harness.saveHandler, saveBody(harness, {
      expectedServerRevision: 4, canonicalState: state,
    }));
    expect(response.status).toBe(409);
    expect(harness.memory.records[0].server_revision).toBe(0);
  });

  it.each([
    ['draft id', (harness, state) => { state.draftId = 'draft-other'; }, 'INVALID_REQUEST'],
    ['session id', (_harness, state) => { state.sessionId = 'session-other'; }, 'CANONICAL_STATE_ERROR'],
    ['form type', (_harness, state) => { state.formType = 'other-form'; }, 'INVALID_REQUEST'],
    ['canonical server revision', (_harness, state) => { state.serverRevision = 99; }, 'CANONICAL_STATE_ERROR'],
  ])('rejects canonical %s binding mismatch', async (_name, mutate, errorCode) => {
    const harness = await createAuthoritativeHarness();
    const state = nextCanonicalState(harness);
    mutate(harness, state);
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      canonicalState: state,
    }));
    expect(response.status).toBe(400);
    expect(json.errorCode).toBe(errorCode);
  });

  it('rejects active-to-submitted status skipping submit_attempted', async () => {
    const harness = await createAuthoritativeHarness();
    const state = nextCanonicalState(harness, { draftStatus: 'submitted' });
    const hash = await calculateCanonicalDraftStateHash(state);
    state.submission = {
      ...state.submission,
      finalSubmissionId: 'submission-1', submittedAt: state.savedAtClient,
      submittedStateHash: hash, pdfSourceStateHash: hash,
    };
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      canonicalState: state, requestedStatus: 'submitted', syncReason: 'submitted',
    }));
    expect(response.status).toBe(409);
    expect(json.errorCode).toBe('STATUS_TRANSITION_INVALID');
  });

  it('persists terminal submission identity only after submit_attempted', async () => {
    const harness = await createAuthoritativeHarness();
    const attempted = nextCanonicalState(harness, { draftStatus: 'submit_attempted' });
    await call(harness.saveHandler, saveBody(harness, {
      canonicalState: attempted, requestedStatus: 'submit_attempted',
      syncReason: 'submit_attempt',
    }));
    const submitted = nextCanonicalState(harness, { draftStatus: 'submitted' });
    submitted.submission = {
      ...submitted.submission,
      finalSubmissionId: 'submission-1', submittedAt: submitted.savedAtClient,
      submittedStateHash: '0'.repeat(64), pdfSourceStateHash: '0'.repeat(64),
    };
    const hash = await calculateCanonicalDraftStateHash(submitted);
    submitted.submission.submittedStateHash = hash;
    submitted.submission.pdfSourceStateHash = hash;
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      idempotencyKey: 'save.synthetic.0002', canonicalState: submitted,
      requestedStatus: 'submitted', syncReason: 'submitted',
    }));
    expect(response.status).toBe(200);
    expect(json.draft).toMatchObject({ readOnly: true, finalSubmissionId: 'submission-1' });
    expect(harness.memory.records[0]).toMatchObject({
      status: 'submitted', final_submission_id: 'submission-1',
      submitted_state_hash: hash, pdf_source_state_hash: hash,
    });
  });

  it('supports submit_attempted to submit_failed', async () => {
    const harness = await createAuthoritativeHarness();
    const attempted = nextCanonicalState(harness, { draftStatus: 'submit_attempted' });
    await call(harness.saveHandler, saveBody(harness, {
      canonicalState: attempted, requestedStatus: 'submit_attempted',
      syncReason: 'submit_attempt',
    }));
    const failed = nextCanonicalState(harness, { draftStatus: 'submit_failed' });
    const { response } = await call(harness.saveHandler, saveBody(harness, {
      idempotencyKey: 'save.synthetic.0002', canonicalState: failed,
      requestedStatus: 'submit_failed', syncReason: 'submit_failed',
    }));
    expect(response.status).toBe(200);
    expect(harness.memory.records[0].status).toBe('submit_failed');
  });

  it('rejects submitted transition when final submission identity is incomplete', async () => {
    const harness = await createAuthoritativeHarness();
    const attempted = nextCanonicalState(harness, { draftStatus: 'submit_attempted' });
    await call(harness.saveHandler, saveBody(harness, {
      canonicalState: attempted, requestedStatus: 'submit_attempted',
      syncReason: 'submit_attempt',
    }));
    const submitted = nextCanonicalState(harness, { draftStatus: 'submitted' });
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      idempotencyKey: 'save.synthetic.0002', canonicalState: submitted,
      requestedStatus: 'submitted', syncReason: 'submitted',
    }));
    expect(response.status).toBe(409);
    expect(json.errorCode).toBe('STATUS_TRANSITION_INVALID');
  });

  it('rejects a final submission ID mismatch against existing attempt metadata', async () => {
    const harness = await createAuthoritativeHarness();
    const attempted = nextCanonicalState(harness, { draftStatus: 'submit_attempted' });
    await call(harness.saveHandler, saveBody(harness, {
      canonicalState: attempted, requestedStatus: 'submit_attempted',
      syncReason: 'submit_attempt',
    }));
    harness.memory.records[0].final_submission_id = 'submission-existing';
    harness.memory.records[0].submitted_at = attempted.savedAtClient;
    const submitted = nextCanonicalState(harness, { draftStatus: 'submitted' });
    submitted.submission = {
      ...submitted.submission,
      finalSubmissionId: 'submission-changed', submittedAt: attempted.savedAtClient,
      submittedStateHash: '0'.repeat(64), pdfSourceStateHash: '0'.repeat(64),
    };
    const hash = await calculateCanonicalDraftStateHash(submitted);
    submitted.submission.submittedStateHash = hash;
    submitted.submission.pdfSourceStateHash = hash;
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      idempotencyKey: 'save.synthetic.0002', canonicalState: submitted,
      requestedStatus: 'submitted', syncReason: 'submitted',
    }));
    expect(response.status).toBe(409);
    expect(json.errorCode).toBe('STATUS_TRANSITION_INVALID');
    expect(harness.memory.records[0].final_submission_id).toBe('submission-existing');
  });

  it('reconstructs a normalized legacy record before an authorized save', async () => {
    const harness = await createAuthoritativeHarness();
    const state = nextCanonicalState(harness);
    delete harness.memory.records[0].draft_state_json;
    delete harness.memory.records[0].state_hash;
    const { response, json } = await call(harness.saveHandler, saveBody(harness, {
      canonicalState: state,
    }));
    expect(response.status).toBe(200);
    expect(json.acceptedServerRevision).toBe(1);
    expect(harness.memory.records[0].draft_state_json).toContain('syntheticQuestion');
  });

  it('rejects oversized canonical state without overwriting the good record', async () => {
    const harness = await createAuthoritativeHarness();
    const before = harness.memory.records[0].state_hash;
    const state = nextCanonicalState(harness, {
      responses: { huge: 'x'.repeat(770_000) },
    });
    const { response } = await call(harness.saveHandler, saveBody(harness, {
      canonicalState: state,
    }));
    expect(response.status).toBe(413);
    expect(harness.memory.records[0].state_hash).toBe(before);
  });

  it('turns a lost compare-and-swap race into a conflict without fallback', async () => {
    const harness = await createAuthoritativeHarness();
    harness.controls.conditionalMode = 'conflict';
    const { response, json } = await call(harness.saveHandler, saveBody(harness));
    expect(response.status).toBe(409);
    expect(json.mergeRequired).toBe(true);
    expect(harness.memory.sdk.asServiceRole.entities.ProFormDraft.update).not.toHaveBeenCalled();
  });

  it.each(['unsupported', 'post-read-mismatch'])(
    'fails closed for %s conditional update semantics',
    async (conditionalMode) => {
      const harness = await createAuthoritativeHarness();
      harness.controls.conditionalMode = conditionalMode;
      const { response, json } = await call(harness.saveHandler, saveBody(harness));
      expect(response.status).toBe(500);
      expect(json.errorCode).toBe('CONDITIONAL_UPDATE_UNSUPPORTED');
    },
  );

  it('allows only one of two concurrent writers to increment the revision', async () => {
    const harness = await createAuthoritativeHarness();
    const bodyA = saveBody(harness, { idempotencyKey: 'save.concurrent.0001' });
    const stateB = nextCanonicalState(harness, {
      responses: { syntheticQuestion: 'concurrent-b' },
    });
    const bodyB = saveBody(harness, {
      idempotencyKey: 'save.concurrent.0002', canonicalState: stateB,
    });
    const results = await Promise.all([
      harness.saveHandler(request(bodyA)), harness.saveHandler(request(bodyB)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(harness.memory.records[0].server_revision).toBe(1);
  });
});
