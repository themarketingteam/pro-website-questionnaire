import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadBackend } from './utils/loadBackend';
import { memoryEntity } from './utils/memoryEntities';

const source = readFileSync(
  resolve(process.cwd(), 'base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts'),
  'utf8',
);

describe('draft recovery repair-and-retry safety contract', () => {
  it('never falls back to the original draft payload after repair failure', () => {
    expect(source).not.toContain('repairResult.payload || rawPayload');
    expect(source).toContain('if (!repairResult.ok || !repairResult.payload)');
    expect(source).toContain('Nothing was retried and the draft remains available for review.');
    expect(source).toContain('await runProTeamRetry(base44, { draftId: draft.id, forceRetry })');
    expect(source).not.toContain('fetch(');
  });

  it('blocks AI repair-and-retry when a final submission is already linked', () => {
    expect(source).toContain("mode === 'repair_and_retry' && draft.final_submission_id && !forceRetry");
    expect(source).toContain('AI Repair + Retry was not run.');
  });

  it('does not invoke delivery or replace saved answers when organized repair is invalid', async () => {
    const original = { metadata: { business_name: 'Saved Client', businessDomain: 'client-unit.net' }, userdata: { service_offerings_structure: { format: 'page-tree-v1', pages: [{ id: 'incomplete' }] } } };
    const draft = { id: 'repair-source', session_id: 'repair-session', status: 'draft', mapped_payload_json: JSON.stringify(original), responses_json: '{}', business_name: 'Saved Client', domain: 'client-unit.net' };
    const drafts = memoryEntity('draft', [draft]);
    const deliver = vi.fn(async () => { throw new Error('Invalid repair must not deliver'); });
    const fetchImpl = vi.fn();
    const { send } = loadBackend('base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts', {
      base44: { auth: { me: async () => ({ role: 'admin' }) }, asServiceRole: { entities: { ProFormDraft: drafts }, functions: { invoke: async () => ({ data: { success: true, identityResolution: { status: 'confirmed', applied: false } } }) } } },
      fetchImpl,
      modules: {
        '../../shared/proSubmissionRetries.ts': { runProTeamRetry: deliver },
        '../../shared/draftRecoveryAuthorization.ts': { createIdentityResolverInternalGrant: async () => 'test-internal-grant' },
      },
    });
    const result = await send({ draftId: draft.id, mode: 'repair_and_retry' });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ success: false, repairOk: false, zapierSent: false });
    expect(deliver).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(draft.mapped_payload_json).toBe(JSON.stringify(original));
    expect(draft.responses_json).toBe('{}');
    expect(draft.ai_repair_applied).toBe(false);
  });
});
