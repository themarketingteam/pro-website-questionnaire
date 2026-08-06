import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { getSafeSyntheticProbeDiagnostics, runSyntheticProbeSequence } from '../../base44/functions/_shared/proDraftSyntheticProbe/entry.ts';

const adapter = (overrides = {}) => ({create: vi.fn(async () => ({draftRef: 'internal-synthetic-ref', expectedStateHash: 'hash'})), saveRevision1: vi.fn(async () => {}), load: vi.fn(async () => ({stateHash: 'hash', readOnly: true})), appendEvent: vi.fn(async () => {}), recoverByCode: vi.fn(async () => true), markSubmittedReadOnly: vi.fn(async () => {}), cleanup: vi.fn(async () => {}), recordResult: vi.fn(async () => {}), ...overrides});

describe('synthetic probe sequence', () => {
  it('runs create/save/load/event/recovery/hash/read-only and always cleans up', async () => {
    const subject = adapter(); const result = await runSyntheticProbeSequence(subject, {testRunId: 'synthetic-health-test-1', allowSubmittedStep: true});
    expect(result).toMatchObject({success: true, cleanupAttempted: true, cleanupSucceeded: true, externalEmailSent: false, externalSubmissionSent: false});
    expect(subject.recoverByCode).toHaveBeenCalledOnce(); expect(subject.cleanup).toHaveBeenCalledWith('internal-synthetic-ref'); expect(subject.recordResult).toHaveBeenCalledOnce();
  });
  it('records a safe failure stage and cleans up after a probe error', async () => {
    const subject = adapter({appendEvent: vi.fn(async () => { throw new Error('SYNTHETIC_EVENT_FAILED'); })}); const result = await runSyntheticProbeSequence(subject, {testRunId: 'synthetic-health-test-2'});
    expect(result).toMatchObject({success: false, failedStage: 'append_event', errorCode: 'SYNTHETIC_EVENT_FAILED', cleanupSucceeded: true}); expect(subject.cleanup).toHaveBeenCalledOnce();
  });
  it('escalates cleanup failure and never returns raw code or token material', async () => {
    const result = await runSyntheticProbeSequence(adapter({cleanup: vi.fn(async () => { throw new Error('synthetic cleanup'); })}), {testRunId: 'synthetic-health-test-3'});
    expect(result).toMatchObject({success: false, failedStage: 'cleanup', errorCode: 'CLEANUP_FAILED', cleanupSucceeded: false}); expect(JSON.stringify(result)).not.toMatch(/recoveryCode|resumeToken|adminGrant|@/);
    expect(getSafeSyntheticProbeDiagnostics()).toMatchObject({externalEmailAllowed: false, externalSubmissionAllowed: false, cleanupAlwaysAttempted: true});
  });
  it('has no email, Zapier, intake, or network side-effect dependency', () => {
    const source = readFileSync('base44/functions/runProDraftSyntheticProbe/entry.ts', 'utf8');
    expect(source).not.toMatch(/sendTransactionalEmail|QuestionnaireIntake|Zapier|\bfetch\s*\(/u);
  });
});
