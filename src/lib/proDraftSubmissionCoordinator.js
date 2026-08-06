import { transformResponsesToPayload, validateSubmissionPayload } from '@/components/pro-form/submissionPayload';
import { selectCanonicalDraftState } from '@/components/store/draftSelectors';
import { applyFormMutation, setDraftSubmitted } from '@/components/store/formSlice';
import { createDraftMutationMetadata } from '@/components/store/formMutationFactory';
import {
  cloneCanonicalDraftState,
  hashCanonicalDraftState,
  normalizeCanonicalDraftState,
  sanitizeDraftSerializableValue,
} from '@/lib/questionnaireDraftState';
import { repairProSubmissionPayload } from '@/lib/proPayloadRepair';
import { buildQuestionnaireStorageKey } from '@/lib/questionnaireBrowserNamespace';

export const PRO_DRAFT_SUBMISSION_VERSION = 1;

export const SUBMISSION_PHASES = Object.freeze([
  'idle',
  'validating',
  'saving_validation_state',
  'flushing_draft',
  'locking_submit_attempted',
  'submitting',
  'saving_submitted',
  'saving_submit_failed',
  'completed',
  'failed',
]);

export const SUBMISSION_ERROR_CODES = Object.freeze({
  ALREADY_RUNNING: 'SUBMISSION_ALREADY_RUNNING',
  CANONICAL_STATE_INVALID: 'SUBMISSION_CANONICAL_STATE_INVALID',
  EXTERNAL_FAILED: 'SUBMISSION_EXTERNAL_FAILED',
  FINAL_LOCK_PENDING: 'SUBMISSION_FINAL_LOCK_PENDING',
  INVALID: 'SUBMISSION_VALIDATION_FAILED',
  PAYLOAD_INVALID: 'SUBMISSION_PAYLOAD_INVALID',
  SUBMIT_ATTEMPT_NOT_CONFIRMED: 'SUBMISSION_ATTEMPT_NOT_CONFIRMED',
  VALIDATION_SAVE_FAILED: 'SUBMISSION_VALIDATION_SAVE_FAILED',
});

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/u;
const PHASE_SET = new Set(SUBMISSION_PHASES);

const deepFreeze = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
};

const safeCode = (value, fallback) => (
  typeof value === 'string' && /^[A-Z0-9_.:-]{1,160}$/u.test(value) ? value : fallback
);

const safeFinalSubmissionId = (result) => {
  const direct = result?.savedSubmission?.id;
  if (typeof direct === 'string' && SAFE_ID.test(direct)) return direct;
  const intakeId = result?.intakeId;
  if (result?.receivedViaIntake === true && typeof intakeId === 'string' && SAFE_ID.test(intakeId)) {
    return `intake:${intakeId}`.slice(0, 256);
  }
  return null;
};

const selectedCanonical = (store, selector = selectCanonicalDraftState) => {
  const selected = selector(store.getState());
  if (!selected?.ok || !selected.state) {
    throw Object.assign(new Error('Canonical draft state is unavailable.'), {
      code: SUBMISSION_ERROR_CODES.CANONICAL_STATE_INVALID,
    });
  }
  return normalizeCanonicalDraftState(selected.state);
};

export const prepareFinalSubmissionSnapshot = async ({
  canonicalState,
  businessName,
  domain,
  serviceOptionsGrouped = {},
  environment = 'unknown',
  testRunId = null,
  transform = transformResponsesToPayload,
  repair = repairProSubmissionPayload,
  validatePayload = validateSubmissionPayload,
  crypto,
  TextEncoder,
} = {}) => {
  const canonical = cloneCanonicalDraftState(canonicalState);
  const canonicalSnapshotHash = await hashCanonicalDraftState(canonical, {
    ...(crypto !== undefined ? { crypto } : {}),
    ...(TextEncoder ? { TextEncoder } : {}),
  });
  const transformed = transform(
    canonical.responses,
    businessName || canonical.credentials?.businessName || '',
    domain || canonical.credentials?.domain || '',
    serviceOptionsGrouped,
  );
  const repaired = repair(transformed);
  const mappedPayload = repaired?.payload || transformed;
  const validation = validatePayload(mappedPayload);
  if (repaired?.ok === false || validation?.ok === false) {
    throw Object.assign(new Error('Submission payload is invalid.'), {
      code: SUBMISSION_ERROR_CODES.PAYLOAD_INVALID,
      issueCount: (repaired?.errors?.length || 0) + (validation?.errors?.length || 0),
    });
  }
  const linkedPayload = {
    ...mappedPayload,
    questionnaire_session_id: canonical.sessionId,
    source_draft_id: canonical.draftId,
    submitted_state_hash: canonicalSnapshotHash,
    pdf_source_state_hash: canonicalSnapshotHash,
    environment,
    ...(testRunId ? { test_run_id: testRunId } : {}),
  };
  return deepFreeze({
    version: PRO_DRAFT_SUBMISSION_VERSION,
    canonicalState: canonical,
    responseSnapshot: sanitizeDraftSerializableValue(canonical.responses),
    mappedPayload: linkedPayload,
    canonicalSnapshotHash,
    businessName: businessName || canonical.credentials?.businessName || '',
    domain: domain || canonical.credentials?.domain || '',
    repairWarnings: Array.isArray(repaired?.warnings) ? [...repaired.warnings] : [],
  });
};

const normalizeValidationResult = (result) => ({
  valid: result?.valid === true,
  validationStatus: result?.validationStatus || {},
  touchedQuestions: result?.touchedQuestions || {},
  expandedQuestions: result?.expandedQuestions || {},
  textValidationMeta: result?.textValidationMeta || {},
  firstInvalidQuestionId: typeof result?.firstInvalidQuestionId === 'string'
    ? result.firstInvalidQuestionId : null,
});

const receiptKey = (namespace) => buildQuestionnaireStorageKey({
  namespace,
  purpose: 'submitted-receipt',
});

const persistReceipt = async (storage, namespace, receipt) => {
  if (!storage?.setItem || !namespace) return false;
  try {
    await storage.setItem(receiptKey(namespace), JSON.stringify(receipt));
    return true;
  } catch {
    return false;
  }
};

export const executeAuthoritativeSubmission = async (input = {}) => {
  const coordinator = createProDraftSubmissionCoordinator(input);
  return coordinator.execute(input);
};

export const recoverFailedSubmissionState = async ({
  syncManager,
  errorCode = SUBMISSION_ERROR_CODES.EXTERNAL_FAILED,
} = {}) => {
  const status = await syncManager?.markSubmitFailed?.(errorCode);
  return Object.freeze({
    recovered: status?.state === 'server_saved' || status?.state === 'retrying',
    errorCode: safeCode(status?.errorCode, errorCode),
    status: status?.state || null,
  });
};

export const getSafeSubmissionDiagnostics = (value = {}) => Object.freeze({
  version: PRO_DRAFT_SUBMISSION_VERSION,
  phase: PHASE_SET.has(value.phase) ? value.phase : 'idle',
  running: value.running === true,
  completed: value.phase === 'completed',
  errorCode: safeCode(value.errorCode, null),
  canonicalSnapshotHashPresent: HASH_PATTERN.test(value.canonicalSnapshotHash || ''),
  finalSubmissionIdPresent: typeof value.finalSubmissionId === 'string',
  submissionLockPending: value.submissionLockPending === true,
  exposesAnswers: false,
  exposesCredentials: false,
});

export const createProDraftSubmissionCoordinator = (options = {}) => {
  const store = options.store;
  const syncManager = options.syncManager;
  if (!store?.getState || !store?.dispatch || !syncManager) {
    throw new TypeError('PRO_DRAFT_SUBMISSION_DEPENDENCIES_REQUIRED');
  }
  let state = {
    phase: 'idle',
    running: false,
    errorCode: null,
    canonicalSnapshotHash: null,
    finalSubmissionId: null,
    submissionLockPending: false,
  };
  const update = (patch) => {
    state = { ...state, ...patch };
    options.onPhaseChange?.(getSafeSubmissionDiagnostics(state));
  };

  const execute = async (execution = {}) => {
    if (state.running) return Object.freeze({
      ok: false,
      errorCode: SUBMISSION_ERROR_CODES.ALREADY_RUNNING,
      diagnostics: getSafeSubmissionDiagnostics(state),
    });
    update({ phase: 'validating', running: true, errorCode: null });
    try {
      const beforeValidation = selectedCanonical(store, options.canonicalStateSelector);
      const validation = normalizeValidationResult(await (execution.validateFinal
        || options.validateFinal)?.(cloneCanonicalDraftState(beforeValidation)));
      store.dispatch(applyFormMutation({
        setValidationStatus: validation.validationStatus,
        setTouchedQuestions: validation.touchedQuestions,
        setExpandedQuestions: validation.expandedQuestions,
        setTextValidationMeta: validation.textValidationMeta,
        ...(execution.businessName || execution.domain ? {
          setCredentials: {
            ...beforeValidation.credentials,
            ...(execution.businessName ? { businessName: execution.businessName } : {}),
            ...(execution.domain ? { domain: execution.domain } : {}),
          },
        } : {}),
        mutationMetadata: createDraftMutationMetadata({
          mutationType: 'final_validation',
          reason: 'submission_attempt',
          sourceTabId: beforeValidation.sourceTabId,
          baseServerRevision: beforeValidation.serverRevision,
        }),
      }));
      update({ phase: 'saving_validation_state' });
      const validationSave = await syncManager.flush({ reason: 'final_validation', force: true });
      if (!['server_saved', 'submitted'].includes(validationSave?.state)) {
        throw Object.assign(new Error('Validation state was not accepted.'), {
          code: SUBMISSION_ERROR_CODES.VALIDATION_SAVE_FAILED,
        });
      }
      if (!validation.valid) {
        execution.focusInvalidQuestion?.(validation.firstInvalidQuestionId);
        update({ phase: 'failed', running: false, errorCode: SUBMISSION_ERROR_CODES.INVALID });
        return Object.freeze({
          ok: false,
          invalid: true,
          firstInvalidQuestionId: validation.firstInvalidQuestionId,
          errorCode: SUBMISSION_ERROR_CODES.INVALID,
          diagnostics: getSafeSubmissionDiagnostics(state),
        });
      }

      update({ phase: 'flushing_draft' });
      await syncManager.flush({ reason: 'pre_submit_flush', force: true });
      syncManager.cancelPendingOrdinaryWork?.({ preserveEvents: false });
      const canonical = selectedCanonical(store, options.canonicalStateSelector);
      const snapshot = await prepareFinalSubmissionSnapshot({
        canonicalState: canonical,
        businessName: execution.businessName,
        domain: execution.domain,
        serviceOptionsGrouped: execution.serviceOptionsGrouped,
        environment: execution.environment || options.environment,
        testRunId: execution.testRunId || options.testRunId,
        ...(options.snapshotDependencies || {}),
      });
      update({ canonicalSnapshotHash: snapshot.canonicalSnapshotHash });

      update({ phase: 'locking_submit_attempted' });
      const attempted = await syncManager.markSubmitAttempted();
      if (attempted?.state !== 'server_saved') {
        throw Object.assign(new Error('Submit attempt was not accepted.'), {
          code: SUBMISSION_ERROR_CODES.SUBMIT_ATTEMPT_NOT_CONFIRMED,
        });
      }
      syncManager.queueEvent?.({
        eventType: 'submit_attempted',
        metadata: { status: 'submit_attempted' },
      });
      await syncManager.flushEvents?.({ force: true });

      update({ phase: 'submitting' });
      const externalSubmit = execution.externalSubmit || options.externalSubmit;
      if (typeof externalSubmit !== 'function') throw Object.assign(new Error('External submit missing.'), {
        code: SUBMISSION_ERROR_CODES.EXTERNAL_FAILED,
      });
      let result;
      try {
        result = await externalSubmit(snapshot);
      } catch (error) {
        update({ phase: 'saving_submit_failed' });
        await recoverFailedSubmissionState({ syncManager, errorCode: error?.code });
        syncManager.queueEvent?.({
          eventType: 'submit_failed',
          metadata: { errorCode: safeCode(error?.code, SUBMISSION_ERROR_CODES.EXTERNAL_FAILED) },
        });
        await syncManager.flushEvents?.({ force: true });
        throw Object.assign(error instanceof Error ? error : new Error('External submit failed.'), {
          code: safeCode(error?.code, SUBMISSION_ERROR_CODES.EXTERNAL_FAILED),
        });
      }
      const finalSubmissionId = safeFinalSubmissionId(result);
      if (!finalSubmissionId) throw Object.assign(new Error('Final submission identifier missing.'), {
        code: SUBMISSION_ERROR_CODES.EXTERNAL_FAILED,
      });

      update({ phase: 'saving_submitted', finalSubmissionId });
      syncManager.queueEvent?.({
        eventType: 'submitted',
        metadata: { finalSubmissionId },
      });
      await syncManager.flushEvents?.({ force: true });
      let locked;
      try {
        locked = await syncManager.markSubmitted(finalSubmissionId);
      } catch {
        locked = { state: 'error' };
      }
      const lockAccepted = locked?.state === 'submitted'
        && HASH_PATTERN.test(locked?.confirmedStateHash || '');
      const submittedCanonical = selectedCanonical(store, options.canonicalStateSelector);
      const submittedHash = lockAccepted
        ? locked.confirmedStateHash
        : await hashCanonicalDraftState(submittedCanonical);
      const submittedAt = submittedCanonical.submission?.submittedAt || new Date().toISOString();
      const receipt = {
        draftId: submittedCanonical.draftId,
        finalSubmissionId,
        submittedAt,
        submittedStateHash: submittedHash,
        pdfSourceStateHash: submittedHash,
        pdfAvailable: true,
        submissionLockPending: !lockAccepted,
      };
      store.dispatch(setDraftSubmitted(receipt));
      await syncManager.flush({ localOnly: true, reason: 'submitted_cache' });
      await persistReceipt(execution.storage || options.storage, execution.namespace || options.namespace, receipt);
      if (!lockAccepted) {
        update({
          phase: 'failed',
          running: false,
          errorCode: SUBMISSION_ERROR_CODES.FINAL_LOCK_PENDING,
          submissionLockPending: true,
        });
        return Object.freeze({
          ok: true,
          submitted: true,
          submissionLockPending: true,
          finalSubmissionId,
          snapshot,
          result,
          errorCode: SUBMISSION_ERROR_CODES.FINAL_LOCK_PENDING,
          diagnostics: getSafeSubmissionDiagnostics(state),
        });
      }
      update({ phase: 'completed', running: false, submissionLockPending: false });
      return Object.freeze({
        ok: true,
        submitted: true,
        submissionLockPending: false,
        finalSubmissionId,
        snapshot,
        result,
        diagnostics: getSafeSubmissionDiagnostics(state),
      });
    } catch (error) {
      const errorCode = safeCode(error?.code, SUBMISSION_ERROR_CODES.EXTERNAL_FAILED);
      if (state.phase === 'submitting') {
        update({ phase: 'saving_submit_failed' });
        await recoverFailedSubmissionState({ syncManager, errorCode });
        syncManager.queueEvent?.({ eventType: 'submit_failed', metadata: { errorCode } });
        await syncManager.flushEvents?.({ force: true });
      }
      update({ phase: 'failed', running: false, errorCode });
      return Object.freeze({
        ok: false,
        errorCode,
        diagnostics: getSafeSubmissionDiagnostics(state),
      });
    }
  };

  return Object.freeze({
    execute,
    getDiagnostics: () => getSafeSubmissionDiagnostics(state),
  });
};

export default createProDraftSubmissionCoordinator;
