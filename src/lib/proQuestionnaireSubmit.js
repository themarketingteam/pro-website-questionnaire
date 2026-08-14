import { base44 } from '@/api/base44Client';
import {
  transformResponsesToPayload,
  validateSubmissionPayload
} from '@/components/pro-form/submissionPayload';
import { trackClarityEvent } from '@/lib/clarity';
import {
  createProFormSubmissionWithFallback,
  serializeSubmitError
} from '@/lib/proSubmissionResilience';
import { repairProSubmissionPayload } from '@/lib/proPayloadRepair';
import { getSubmitDebugFailureMode, shouldSimulateSubmitFailure } from '@/lib/submitDebugFlags';
import {
  getSafeSubmitContext,
  safeJsonStringify,
  safeLocalStorageSet,
  safeNowIso
} from '@/lib/browserSafety';

export { serializeSubmitError } from '@/lib/proSubmissionResilience';


export const writeFailedSubmissionBackup = ({
  questionnaireSessionId,
  responseSnapshot,
  transformedPayload,
  error
}) => {
  try {
    safeLocalStorageSet(
      `failed_pro_submission_${Date.now()}`,
      {
        session_id: questionnaireSessionId,
        responses: responseSnapshot,
        transformedPayload,
        error,
        createdAt: safeNowIso()
      }
    );
  } catch (storageError) {
    console.error(
      'Could not write failed submission backup:',
      serializeSubmitError(storageError)
    );
  }
};

export const writeDraftFailureBackup = ({
  questionnaireSessionId,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  error
}) => {
  try {
    safeLocalStorageSet(
      `pro_questionnaire_local_backup_${questionnaireSessionId}`,
      {
        session_id: questionnaireSessionId,
        responses,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        error,
        savedAt: safeNowIso()
      }
    );
  } catch {
    // no-op
  }
};

export const safeDraftSave = async ({
  saveDraftNow,
  questionnaireSessionId,
  responsesSnapshot,
  validationStatusSnapshot,
  touchedQuestionsSnapshot,
  expandedQuestionsSnapshot,
  options = {}
}) => {
  if (typeof saveDraftNow !== 'function') {
    return null;
  }

  try {
    return await saveDraftNow({
      ...options,
      responsesSnapshot,
      validationStatusSnapshot,
      touchedQuestionsSnapshot,
      expandedQuestionsSnapshot
    });
  } catch (error) {
    const serialized = serializeSubmitError(error);

    console.error('Non-fatal draft save failed:', serialized);

    writeDraftFailureBackup({
      questionnaireSessionId,
      responses: responsesSnapshot,
      validationStatus: validationStatusSnapshot,
      touchedQuestions: touchedQuestionsSnapshot,
      expandedQuestions: expandedQuestionsSnapshot,
      error: serialized
    });

    return null;
  }
};

export const createDraftEventSafe = async ({
  createDraftEvent,
  eventType,
  questionId = '',
  value = {}
}) => {
  if (typeof createDraftEvent !== 'function') {
    return null;
  }

  try {
    return await createDraftEvent({
      eventType,
      questionId,
      value
    });
  } catch (error) {
    console.error('Non-fatal draft event failed:', serializeSubmitError(error));
    return null;
  }
};

const withClientTimeout = (promiseFactory, timeoutMs = 5000) => {
  let timeoutId;
  const timerApi = typeof window !== 'undefined' ? window : globalThis;

  return new Promise((resolve, reject) => {
    timeoutId = timerApi.setTimeout(() => {
      reject(new Error(`Client operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(() => promiseFactory())
      .then((result) => {
        timerApi.clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        timerApi.clearTimeout(timeoutId);
        reject(error);
      });
  });
};

export const sendZapierSafe = async (transformedPayload, options = {}) => {
  const timeoutMs = options.timeoutMs || 5000;

  try {
    const response = await withClientTimeout(
      () => base44.functions.invoke('sendToZapier', transformedPayload),
      timeoutMs
    );

    if (response?.data?.success === false) {
      return {
        ok: false,
        error: serializeSubmitError(response.data.error || new Error('Zapier function returned success:false'))
      };
    }

    return { ok: true };
  } catch (error) {
    console.error(
      'Zapier webhook failed after successful database save:',
      serializeSubmitError(error)
    );

    return {
      ok: false,
      error: serializeSubmitError(error)
    };
  }
};

export class SubmitFlowError extends Error {
  constructor({
    userMessage,
    recoveryCode,
    failureKind,
    stage,
    serializedError
  }) {
    super(userMessage || 'Questionnaire submission could not complete.');
    this.name = 'SubmitFlowError';
    this.userMessage = userMessage || 'Questionnaire submission could not complete.';
    this.recoveryCode = recoveryCode || 'unknown-session';
    this.failureKind = failureKind || 'unknown';
    this.stage = stage || 'submit_failed';
    this.serializedError = serializedError || null;
  }
}

export const safePayloadSize = (value) => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
};

const sanitizeStageDetails = (details = {}) => {
  const safeDetails = { ...details };
  delete safeDetails.rawResponses;
  delete safeDetails.responses;
  delete safeDetails.responseSnapshot;
  delete safeDetails.transformedPayload;
  delete safeDetails.payload;
  if (safeDetails.error && typeof safeDetails.error === 'object') {
    safeDetails.error = {
      name: safeDetails.error.name || '',
      message: safeDetails.error.message || '',
      status: safeDetails.error.status ?? null,
      code: safeDetails.error.code || '',
      type: safeDetails.error.type || '',
      failureKind: safeDetails.error.failureKind || 'unknown'
    };
  }
  return safeDetails;
};

const buildResponseSnapshotMetadata = (responses = {}, validationStatus = {}) => {
  const safeResponses = responses && typeof responses === 'object' && !Array.isArray(responses) ? responses : {};
  const questionIds = Object.keys(safeResponses).filter((key) => !key.endsWith('_other') && !key.endsWith('_primary'));
  const answeredRequiredCount = Object.values(validationStatus || {}).filter((status) => status === 'complete' || status === 'needs_work').length;
  const certifications = Array.isArray(safeResponses['12.1']) ? safeResponses['12.1'] : [];
  const guarantees = Array.isArray(safeResponses['14.1']) ? safeResponses['14.1'] : [];
  const geographicAreas = Array.isArray(safeResponses['5']) ? safeResponses['5'] : safeResponses['5'] ? [safeResponses['5']] : [];

  return {
    questionCount: questionIds.length,
    answeredRequiredCount,
    hasTeamPhoto: Boolean(safeResponses['2.2']),
    hasCertificationFiles: certifications.some((item) => Array.isArray(item?.files) ? item.files.length > 0 : Boolean(item?.file || item?.fileUrl)),
    hasGuaranteeFiles: guarantees.some((item) => Boolean(item?.file || item?.fileUrl)),
    hasGeographicAreas: geographicAreas.length > 0
  };
};

export const submitProQuestionnaire = async ({
  businessName,
  domain,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  credentials,
  domainParam,
  questionnaireSessionId,
  saveDraftNow,
  createDraftEvent,
  onFinalSubmitSuccess,
  onFinalSubmitFailure,
  serviceOptionsGrouped = {}
}) => {
  const responseSnapshot = responses && typeof responses === 'object' && !Array.isArray(responses)
    ? { ...responses }
    : {};
  const recoveryCode = questionnaireSessionId || 'unknown-session';
  const resolvedDomain = domain || credentials?.domain || domainParam || 'unknown';
  const submitContext = getSafeSubmitContext({
    business_name: businessName,
    domain: domain || credentials?.domain || domainParam || null,
    user_email: credentials?.userEmail || credentials?.email || null,
    user_id: credentials?.userId || credentials?.id || null
  });
  const responseSnapshotMetadata = buildResponseSnapshotMetadata(responseSnapshot, validationStatus);
  const submitDebugMode = getSubmitDebugFailureMode();

  const recordSubmitStage = async (stage, details = {}) => {
    const safeDetails = sanitizeStageDetails(details);

    await createDraftEventSafe({
      createDraftEvent,
      eventType: 'submit_stage',
      questionId: stage,
      value: {
        stage,
        timestamp: safeNowIso(),
        failureKind: safeDetails.failureKind || '',
        usedFallback: Boolean(safeDetails.usedFallback),
        ...safeDetails
      }
    });

    try {
      trackClarityEvent(`pro_questionnaire_${stage}`, {
        business_domain: resolvedDomain,
        stage,
        failure_kind: safeDetails.failureKind || '',
        used_fallback: String(Boolean(safeDetails.usedFallback))
      });
    } catch {
      // no-op
    }

    if (import.meta.env.DEV) {
      console.log('[submit stage]', stage, safeDetails);
    }
  };

  await recordSubmitStage('submit_started');
  await createDraftEventSafe({
    createDraftEvent,
    eventType: 'submit_attempted',
    value: {
      status: 'submit_attempted'
    }
  });

  let activeDraftId = '';
  try {
    const durableDraft = await saveDraftNow({
      status: 'submit_attempted',
      responsesSnapshot: responseSnapshot,
      validationStatusSnapshot: validationStatus,
      touchedQuestionsSnapshot: touchedQuestions,
      expandedQuestionsSnapshot: expandedQuestions,
      required: true,
      source: 'final_submission_barrier'
    });
    activeDraftId = durableDraft?.draftId || durableDraft?.id || '';
    if (!activeDraftId) throw new Error('The database did not confirm the final draft save.');
  } catch (error) {
    const serializedError = serializeSubmitError(error);
    throw new SubmitFlowError({
      userMessage: `Your answers are still on this page, but the database did not confirm the final save. Please try again before submitting. Recovery code: ${recoveryCode}`,
      recoveryCode,
      failureKind: serializedError.failureKind,
      stage: 'final_draft_save_failed',
      serializedError
    });
  }

  const persistDurableOutcome = async ({ submission, intakeId = '', receivedViaIntake = false }) => {
    return saveDraftNow({
      status: receivedViaIntake ? 'received_intake' : 'submitted',
      finalSubmissionId: receivedViaIntake ? '' : (submission?.id || ''),
      intakeId: receivedViaIntake ? intakeId : '',
      responsesSnapshot: responseSnapshot,
      validationStatusSnapshot: validationStatus,
      touchedQuestionsSnapshot: touchedQuestions,
      expandedQuestionsSnapshot: expandedQuestions,
      required: true,
      source: receivedViaIntake ? 'durable_intake_link' : 'durable_submission_link'
    });
  };

  let transformedPayload;

  try {
    await recordSubmitStage('before_payload_transform');
    if (shouldSimulateSubmitFailure('transform')) {
      const transformError = new Error('DEV_ONLY_SIMULATED_SUBMIT_FAILURE: transform');
      transformError.name = 'DevSimulatedTransformError';
      transformError.code = 'DEV_SIMULATED_TRANSFORM';
      transformError.type = 'transform';
      throw transformError;
    }

    transformedPayload = transformResponsesToPayload(
      responseSnapshot,
      businessName,
      domain,
      serviceOptionsGrouped
    );
    transformedPayload.metadata = {
      ...(transformedPayload.metadata || {}),
      questionnaire_session_id: questionnaireSessionId,
      source_draft_id: activeDraftId
    };
    await recordSubmitStage('payload_transform_success', {
      payloadSizeChars: safePayloadSize(transformedPayload)
    });
  } catch (error) {
    const serializedError = serializeSubmitError(error);

    await recordSubmitStage('payload_transform_failed', {
      error: serializedError,
      failureKind: serializedError.failureKind
    });

    await createDraftEventSafe({
      createDraftEvent,
      eventType: 'submit_transform_failed',
      value: {
        stage: 'payload_transform_failed',
        failureKind: serializedError.failureKind,
        recovery_code: recoveryCode,
        responseSnapshotMetadata
      }
    });

    await safeDraftSave({
      saveDraftNow,
      questionnaireSessionId,
      responsesSnapshot: responseSnapshot,
      validationStatusSnapshot: validationStatus,
      touchedQuestionsSnapshot: touchedQuestions,
      expandedQuestionsSnapshot: expandedQuestions,
      options: {
        status: 'submit_failed',
        submitError: safeJsonStringify({
          stage: 'payload_transform_failed',
          serializedError,
          responseSnapshotMetadata
        })
      }
    });

    writeFailedSubmissionBackup({
      questionnaireSessionId,
      responseSnapshot,
      transformedPayload: null,
      error: {
        stage: 'payload_transform_failed',
        serializedError,
        responseSnapshotMetadata
      }
    });

    const fallbackResult = await createProFormSubmissionWithFallback(null, {
      responseSnapshot,
      rawResponses: responseSnapshot,
      transformFailed: true,
      transformError: serializedError,
      questionnaireSessionId,
      draftId: activeDraftId,
      submitContext
    });

    if (fallbackResult?.ok) {
      await persistDurableOutcome({
        submission: fallbackResult.submission,
        intakeId: fallbackResult.intakeId || '',
        receivedViaIntake: Boolean(fallbackResult.receivedViaIntake)
      });
      await recordSubmitStage('fallback_success', { usedFallback: true });
      await recordSubmitStage('submit_success', { usedFallback: true });
      if (typeof onFinalSubmitSuccess === 'function') {
        onFinalSubmitSuccess({
          savedSubmission: fallbackResult.submission,
          intakeId: fallbackResult.intakeId || '',
          receivedViaIntake: Boolean(fallbackResult.receivedViaIntake),
          responseSnapshot,
          transformedPayload: null
        });
      }
      return {
        savedSubmission: fallbackResult.submission,
        intakeId: fallbackResult.intakeId || '',
        receivedViaIntake: Boolean(fallbackResult.receivedViaIntake),
        responseSnapshot,
        transformedPayload: null
      };
    }

    await recordSubmitStage('fallback_failed', {
      failureKind: fallbackResult?.failureKind || serializedError.failureKind,
      usedFallback: true
    });
    await recordSubmitStage('submit_failed', {
      failureKind: serializedError.failureKind,
      usedFallback: true
    });

    const submitFailure = new SubmitFlowError({
      userMessage: `We saved your progress, but final submission could not complete. Please try again and share this recovery code with support if needed: ${recoveryCode}`,
      recoveryCode,
      failureKind: serializedError.failureKind,
      stage: 'payload_transform_failed',
      serializedError
    });

    if (typeof onFinalSubmitFailure === 'function') {
      onFinalSubmitFailure({
        error: submitFailure,
        serialized: serializedError,
        responseSnapshot,
        transformedPayload: null,
        recoveryCode
      });
    }

    throw submitFailure;
  }

  const repairResult = repairProSubmissionPayload(transformedPayload);
  transformedPayload = repairResult.payload;

  await recordSubmitStage('payload_repair_completed', {
    warningCount: repairResult.warnings.length,
    warningCodes: repairResult.warnings,
    payloadSizeChars: safePayloadSize(transformedPayload),
    featureSummary: responseSnapshotMetadata
  });

  let validation;
  try {
    await recordSubmitStage('before_payload_validation', {
      debugMode: submitDebugMode || ''
    });

    if (!repairResult.ok) {
      const repairError = new Error(`Invalid questionnaire payload: ${(repairResult.errors || []).join(' ')}`);
      repairError.name = 'PayloadRepairError';
      repairError.code = 'PAYLOAD_REPAIR_FAILED';
      throw repairError;
    }

    validation = validateSubmissionPayload(transformedPayload);
    if (shouldSimulateSubmitFailure('validation')) {
      const validationError = new Error('DEV_ONLY_SIMULATED_SUBMIT_FAILURE: validation');
      validationError.name = 'DevSimulatedValidationError';
      validationError.code = 'DEV_SIMULATED_VALIDATION';
      validationError.type = 'validation';
      throw validationError;
    }
    if (!validation?.ok) {
      const validationError = new Error(`Invalid questionnaire payload: ${(validation?.errors || []).join(' ')}`);
      validationError.name = 'PayloadValidationError';
      throw validationError;
    }
    await recordSubmitStage('payload_validation_success', {
      payloadSizeChars: safePayloadSize(transformedPayload)
    });
  } catch (error) {
    const serializedError = serializeSubmitError(error);

    await recordSubmitStage('payload_validation_failed', {
      error: serializedError,
      failureKind: serializedError.failureKind
    });

    await createDraftEventSafe({
      createDraftEvent,
      eventType: 'submit_validation_failed',
      value: {
        stage: 'payload_validation_failed',
        failureKind: serializedError.failureKind,
        recovery_code: recoveryCode,
        responseSnapshotMetadata
      }
    });

    await safeDraftSave({
      saveDraftNow,
      questionnaireSessionId,
      responsesSnapshot: responseSnapshot,
      validationStatusSnapshot: validationStatus,
      touchedQuestionsSnapshot: touchedQuestions,
      expandedQuestionsSnapshot: expandedQuestions,
      options: {
        status: 'submit_failed',
        submitError: safeJsonStringify({
          stage: 'payload_validation_failed',
          serializedError,
          responseSnapshotMetadata
        })
      }
    });

    writeFailedSubmissionBackup({
      questionnaireSessionId,
      responseSnapshot,
      transformedPayload,
      error: {
        stage: 'payload_validation_failed',
        serializedError,
        responseSnapshotMetadata
      }
    });

    const fallbackResult = await createProFormSubmissionWithFallback(transformedPayload, {
      maxAttempts: 3,
      timeoutMs: 15000,
      responseSnapshot,
      rawResponses: responseSnapshot,
      validationFailed: true,
      validationError: serializedError,
      questionnaireSessionId,
      draftId: activeDraftId,
      submitContext
    });

    if (fallbackResult?.ok) {
      await persistDurableOutcome({
        submission: fallbackResult.submission,
        intakeId: fallbackResult.intakeId || '',
        receivedViaIntake: Boolean(fallbackResult.receivedViaIntake)
      });
      await recordSubmitStage('fallback_success', { usedFallback: true });
      await recordSubmitStage('submit_success', { usedFallback: true });
      if (typeof onFinalSubmitSuccess === 'function') {
        onFinalSubmitSuccess({
          savedSubmission: fallbackResult.submission,
          intakeId: fallbackResult.intakeId || '',
          receivedViaIntake: Boolean(fallbackResult.receivedViaIntake),
          responseSnapshot,
          transformedPayload
        });
      }
      return {
        savedSubmission: fallbackResult.submission,
        intakeId: fallbackResult.intakeId || '',
        receivedViaIntake: Boolean(fallbackResult.receivedViaIntake),
        responseSnapshot,
        transformedPayload
      };
    }

    await recordSubmitStage('fallback_failed', {
      failureKind: fallbackResult?.failureKind || serializedError.failureKind,
      usedFallback: true
    });
    await recordSubmitStage('submit_failed', {
      failureKind: serializedError.failureKind,
      usedFallback: true
    });

    const submitFailure = new SubmitFlowError({
      userMessage: `We saved your progress, but final submission could not complete. Please try again and share this recovery code with support if needed: ${recoveryCode}`,
      recoveryCode,
      failureKind: serializedError.failureKind,
      stage: 'payload_validation_failed',
      serializedError
    });

    if (typeof onFinalSubmitFailure === 'function') {
      onFinalSubmitFailure({
        error: submitFailure,
        serialized: serializedError,
        responseSnapshot,
        transformedPayload,
        recoveryCode
      });
    }

    throw submitFailure;
  }

  await recordSubmitStage('before_submission_create');
  const resilientSubmitResult = await createProFormSubmissionWithFallback(
    transformedPayload,
    {
      maxAttempts: 3,
      timeoutMs: 15000,
      responseSnapshot,
      questionnaireSessionId,
      draftId: activeDraftId,
      submitContext,
      debugFailureMode: submitDebugMode
    }
  );

  if (!resilientSubmitResult.ok) {
    const serialized = resilientSubmitResult.error || serializeSubmitError(null);

    await recordSubmitStage('submission_create_failed', {
      failureKind: resilientSubmitResult.failureKind,
      usedFallback: resilientSubmitResult.usedFallback,
      error: serialized
    });

    const submitFailure = new SubmitFlowError({
      userMessage: `We saved your progress, but final submission could not complete. Please try again and share this recovery code with support if needed: ${recoveryCode}`,
      recoveryCode,
      failureKind: resilientSubmitResult.failureKind,
      stage: 'submission_create_failed',
      serializedError: serialized
    });

    await createDraftEventSafe({
      createDraftEvent,
      eventType: 'submit_failed_after_fallback',
      value: {
        status: 'submit_failed',
        recovery_code: recoveryCode
      }
    });

    await safeDraftSave({
      saveDraftNow,
      questionnaireSessionId,
      responsesSnapshot: responseSnapshot,
      validationStatusSnapshot: validationStatus,
      touchedQuestionsSnapshot: touchedQuestions,
      expandedQuestionsSnapshot: expandedQuestions,
      options: {
        status: 'submit_failed',
        submitError: safeJsonStringify(serialized)
      }
    });

    writeFailedSubmissionBackup({
      questionnaireSessionId,
      responseSnapshot,
      transformedPayload,
      error: serialized
    });

    await recordSubmitStage(resilientSubmitResult.usedFallback ? 'fallback_failed' : 'submit_failed', {
      failureKind: resilientSubmitResult.failureKind,
      usedFallback: resilientSubmitResult.usedFallback
    });

    if (typeof onFinalSubmitFailure === 'function') {
      onFinalSubmitFailure({
        error: submitFailure,
        serialized,
        responseSnapshot,
        transformedPayload,
        recoveryCode
      });
    }

    throw submitFailure;
  }

  const savedSubmission = resilientSubmitResult.submission;
  const receivedViaIntake = Boolean(resilientSubmitResult.receivedViaIntake);
  const intakeId = resilientSubmitResult.intakeId || '';
  await recordSubmitStage('submission_create_success', {
    usedFallback: resilientSubmitResult.usedFallback
  });

  if (resilientSubmitResult.usedFallback) {
    await recordSubmitStage('fallback_success', { usedFallback: true });
    await createDraftEventSafe({
      createDraftEvent,
      eventType: receivedViaIntake ? 'submit_received_via_intake' : 'submit_fallback_success',
      value: {
        status: 'submitted',
        used_fallback: true,
        received_via_intake: receivedViaIntake,
        intake_id: intakeId,
        final_submission_id: savedSubmission?.id || ''
      }
    });
  }

  await persistDurableOutcome({
    submission: savedSubmission,
    intakeId,
    receivedViaIntake
  });

  await createDraftEventSafe({
    createDraftEvent,
    eventType: 'submitted',
    value: {
      status: 'submitted',
      final_submission_id: savedSubmission?.id || ''
    }
  });

  if (receivedViaIntake) {
    createDraftEventSafe({
      createDraftEvent,
      eventType: 'submit_received_via_intake',
      value: {
        status: 'received_intake',
        intake_id: intakeId || resilientSubmitResult?.intakeId || '',
        questionnaire_session_id: questionnaireSessionId || '',
        business_name: businessName || '',
        domain: domain || credentials?.domain || domainParam || '',
        used_fallback: true,
        zapier_skipped: true,
        reason: 'Client was allowed to continue because a durable intake record was created instead of a final ProFormSubmission.'
      }
    });
  }

  if (!receivedViaIntake && !resilientSubmitResult.zapierSent && transformedPayload) {
    // Keep the public page alive until the backend accepts or rejects delivery.
    // Fire-and-forget requests can be cancelled when the thank-you view replaces
    // the questionnaire immediately after submission on the published site.
    const zapierResult = await sendZapierSafe(transformedPayload, { timeoutMs: 10000 });
    if (!zapierResult.ok) {
      await createDraftEventSafe({
        createDraftEvent,
        eventType: 'zapier_delivery_failed_after_submit',
        value: {
          status: 'zapier_failed',
          final_submission_id: savedSubmission?.id || '',
          failureKind: zapierResult.error?.failureKind || 'unknown'
        }
      });
    }
  }

  await recordSubmitStage('submit_success', {
    usedFallback: resilientSubmitResult.usedFallback
  });

  if (typeof onFinalSubmitSuccess === 'function') {
    onFinalSubmitSuccess({
      savedSubmission,
      intakeId,
      receivedViaIntake,
      responseSnapshot,
      transformedPayload
    });
  }

  return {
    savedSubmission,
    intakeId,
    receivedViaIntake,
    responseSnapshot,
    transformedPayload
  };
};
