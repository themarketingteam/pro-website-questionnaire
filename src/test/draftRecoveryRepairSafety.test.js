import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts'),
  'utf8',
);

describe('draft recovery repair-and-retry safety contract', () => {
  it('never falls back to the original draft payload after repair failure', () => {
    expect(source).not.toContain('repairResult.payload || rawPayload');
    expect(source).toContain('if (!repairResult.ok || !repairResult.payload)');
    expect(source).toContain('Nothing was retried and the draft remains available for review.');
    expect(source).toContain('zapierResult = await sendToZapierSafe(repairResult.payload);');
  });

  it('blocks AI repair-and-retry when a final submission is already linked', () => {
    expect(source).toContain("mode === 'repair_and_retry' && draft.final_submission_id && !forceRetry");
    expect(source).toContain('AI Repair + Retry was not run.');
  });
});
