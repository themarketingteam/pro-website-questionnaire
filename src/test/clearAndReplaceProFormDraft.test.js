import { describe, expect, it } from 'vitest';
import {
  invokeReplacement,
  replacementBody,
  replacementHarness,
} from './proDraftReplacementTestHarness.js';

describe('clearAndReplaceProFormDraft transaction', () => {
  it('clears an active draft and commits a distinct blank replacement', async () => {
    const harness = await replacementHarness();
    const { response, json } = await invokeReplacement(harness);
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      operation: 'clear_all',
      idempotent: false,
      sourceDraft: { status: 'cleared_superseded', serverRevision: 4 },
      replacementDraft: { status: 'active', draftGeneration: 2 },
    });
    expect(harness.records).toHaveLength(2);
    expect(JSON.parse(harness.records[1].draft_state_json).responses).toEqual({});
    expect(harness.records[0].replacement_draft_id).toBe(harness.records[1].id);
  });

  it('clears a submit-failed draft', async () => {
    const harness = await replacementHarness({ status: 'submit_failed' });
    expect((await invokeReplacement(harness)).json.success).toBe(true);
    expect(harness.records[0].status).toBe('cleared_superseded');
  });

  it.each(['submitted', 'cleared_superseded', 'expired', 'deleted'])(
    'rejects source status %s without creating a record',
    async (status) => {
      const harness = await replacementHarness({ status });
      const { response, json } = await invokeReplacement(harness);
      expect(response.status).toBe(status === 'submitted' ? 401 : 409);
      expect(json.success).toBe(false);
      expect(harness.records).toHaveLength(1);
    },
  );

  it('returns idempotent success without reissuing credentials or duplicating', async () => {
    const harness = await replacementHarness();
    const first = await invokeReplacement(harness);
    const second = await invokeReplacement(harness);
    expect(first.json.recoveryCode).toBeTruthy();
    expect(second.json).toMatchObject({
      success: true,
      idempotent: true,
      recoveryCode: null,
      resumeToken: null,
      recoverySessionToken: null,
      credentialsReissueRequired: true,
    });
    expect(harness.records).toHaveLength(2);
  });

  it('leaves the source active and sends no email when create fails', async () => {
    const harness = await replacementHarness({ failCreate: true, recoveryEmail: true });
    const { response, json } = await invokeReplacement(harness);
    expect(response.status).toBe(500);
    expect(json.errorCode).toBe('REPLACEMENT_CREATE_FAILED');
    expect(harness.records[0].status).toBe('active');
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('marks a source-update conflict replacement orphaned and emails nothing', async () => {
    const harness = await replacementHarness({
      sourceConflictCount: 1,
      recoveryEmail: true,
    });
    const { response, json } = await invokeReplacement(harness);
    expect(response.status).toBe(409);
    expect(json.errorCode).toBe('SOURCE_UPDATE_CONFLICT');
    expect(harness.records[0].status).toBe('active');
    expect(harness.records[1].replacement_transaction_status).toBe('orphaned');
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('recovers an orphaned transaction on the same idempotency key', async () => {
    const harness = await replacementHarness({ sourceConflictCount: 1 });
    await invokeReplacement(harness);
    const retry = await invokeReplacement(harness);
    expect(retry.json.success).toBe(true);
    expect(harness.records).toHaveLength(2);
    expect(harness.records[1].replacement_transaction_status).toBe('committed');
    expect(retry.json.recoveryCode).toBeNull();
  });

  it('returns a recoverable partial result if the new commit marker fails', async () => {
    const harness = await replacementHarness({ commitFailureCount: 1 });
    const partial = await invokeReplacement(harness);
    expect(partial.response.status).toBe(202);
    expect(partial.json).toMatchObject({
      success: false,
      replacementRecoveryRequired: true,
      errorCode: 'REPLACEMENT_COMMIT_FAILED',
    });
    expect(harness.records[0].status).toBe('cleared_superseded');
    expect(harness.records[1].replacement_transaction_status).toBe('pending');
    const recovered = await invokeReplacement(harness);
    expect(recovered.json.success).toBe(true);
    expect(harness.records).toHaveLength(2);
  });

  it('rejects a stale expected revision before creation', async () => {
    const harness = await replacementHarness();
    const result = await invokeReplacement(harness, replacementBody({
      expectedServerRevision: 2,
    }));
    expect(result.response.status).toBe(409);
    expect(result.json.errorCode).toBe('REVISION_CONFLICT');
    expect(harness.records).toHaveLength(1);
  });

  it('makes the retained source reject a later stale save by status and revision', async () => {
    const harness = await replacementHarness();
    await invokeReplacement(harness);
    expect(harness.records[0]).toMatchObject({
      status: 'cleared_superseded',
      server_revision: 4,
    });
    expect(harness.drafts.updateMany({
      id: harness.records[0].id,
      status: 'active',
      server_revision: 3,
    }, { $set: { business_name: 'stale' } })).resolves.toEqual({ updated: 0 });
  });

  it('uses POST/JSON/bounds, exact keys, and no-store responses', async () => {
    const harness = await replacementHarness();
    const wrongMethod = await invokeReplacement(harness, replacementBody(), { method: 'PUT' });
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.get('cache-control')).toContain('no-store');
    const unknown = await invokeReplacement(harness, replacementBody({ recoveryEmail: 'x@y.z' }));
    expect(unknown.response.status).toBe(400);
    expect(harness.records).toHaveLength(1);
  });

  it('stores hashes only and returns no hash fields', async () => {
    const harness = await replacementHarness();
    const { json } = await invokeReplacement(harness);
    expect(JSON.stringify(json)).not.toMatch(/(?:_hash|Hash)/u);
    expect(harness.records[1].recovery_code_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(harness.records[1].resume_token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(harness.records[1])).not.toContain(json.recoveryCode);
    expect(JSON.stringify(harness.records[1])).not.toContain(json.resumeToken);
  });
});
