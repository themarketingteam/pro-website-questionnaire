/** Side-effect-free synthetic probe orchestration with mandatory cleanup. */

export const PRO_DRAFT_SYNTHETIC_PROBE_VERSION = 1;
export const PRO_FORM_SYNTHETIC_PROBE_SECRET = 'PRO_FORM_SYNTHETIC_PROBE_SECRET';
export const SYNTHETIC_PROBE_STAGES = Object.freeze(['create', 'save_revision_1', 'load', 'append_event', 'recover_by_code', 'verify_state_hash', 'submitted_read_only', 'cleanup'] as const);
export type SyntheticProbeStage = typeof SYNTHETIC_PROBE_STAGES[number];
export type SyntheticProbeAdapter = Readonly<{
  create: () => Promise<Readonly<{draftRef: string; expectedStateHash: string}>>;
  saveRevision1: (draftRef: string) => Promise<void>;
  load: (draftRef: string) => Promise<Readonly<{stateHash: string; readOnly?: boolean}>>;
  appendEvent: (draftRef: string) => Promise<void>;
  recoverByCode: (draftRef: string) => Promise<boolean>;
  markSubmittedReadOnly?: (draftRef: string) => Promise<void>;
  cleanup: (draftRef: string | null) => Promise<void>;
  recordResult: (result: Readonly<Record<string, unknown>>) => Promise<void>;
}>;

export async function runSyntheticProbeSequence(adapter: SyntheticProbeAdapter, options: Readonly<{testRunId: string; allowSubmittedStep?: boolean}>): Promise<Readonly<Record<string, unknown>>> {
  let draftRef: string | null = null; let stage: SyntheticProbeStage = 'create'; let failedStage: SyntheticProbeStage | null = null; let errorCode: string | null = null; let success = false; let cleanupSucceeded = false;
  try {
    const created = await adapter.create(); draftRef = created.draftRef;
    stage = 'save_revision_1'; await adapter.saveRevision1(draftRef);
    stage = 'load'; const loaded = await adapter.load(draftRef);
    stage = 'append_event'; await adapter.appendEvent(draftRef);
    stage = 'recover_by_code'; if (!await adapter.recoverByCode(draftRef)) throw new Error('SYNTHETIC_RECOVERY_FAILED');
    stage = 'verify_state_hash'; if (loaded.stateHash !== created.expectedStateHash) throw new Error('SYNTHETIC_STATE_HASH_MISMATCH');
    if (options.allowSubmittedStep && adapter.markSubmittedReadOnly) { stage = 'submitted_read_only'; await adapter.markSubmittedReadOnly(draftRef); const submitted = await adapter.load(draftRef); if (!submitted.readOnly || submitted.stateHash !== created.expectedStateHash) throw new Error('SYNTHETIC_SUBMITTED_READ_ONLY_FAILED'); }
    success = true;
  } catch (error) { failedStage = stage; errorCode = error instanceof Error && /^[A-Z0-9_]{1,128}$/u.test(error.message) ? error.message : 'SYNTHETIC_PROBE_FAILED'; }
  finally { stage = 'cleanup'; try { await adapter.cleanup(draftRef); cleanupSucceeded = true; } catch { cleanupSucceeded = false; failedStage = 'cleanup'; errorCode = 'CLEANUP_FAILED'; success = false; } }
  const result = Object.freeze({success, status: success ? 'healthy' : 'unhealthy', failedStage: success ? null : failedStage, errorCode, cleanupAttempted: true, cleanupSucceeded, testRunId: options.testRunId, externalEmailSent: false, externalSubmissionSent: false, containsRawCredential: false});
  try { await adapter.recordResult(result); } catch { return Object.freeze({...result, operationalEventRecorded: false}); }
  return Object.freeze({...result, operationalEventRecorded: true});
}

export function getSafeSyntheticProbeDiagnostics() { return Object.freeze({version: PRO_DRAFT_SYNTHETIC_PROBE_VERSION, stages: SYNTHETIC_PROBE_STAGES, cleanupAlwaysAttempted: true, externalEmailAllowed: false, externalSubmissionAllowed: false, containsRawCode: false, containsToken: false}); }
