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
  getSafeSubmitContext
} from '@/lib/browserSafety';
import { defaultResilientStorage } from '@/lib/resilientStorage';
import { deriveQuestionnaireBrowserNamespace } from '@/lib/questionnaireBrowserNamespace';
import { writeDraftFailureBackup as writeScopedDraftFailureBackup } from '@/lib/draftPersistence';

export { serializeSubmitError } from '@/lib/proSubmissionResilience';


export const writeFailedSubmissionBackup = async ({
  namespace = deriveQuestionnaireBrowserNamespace(),
  storage = defaultResilientStorage,
  questionnaireSessionId,
  responseSnapshot,
  validationStatus = {},
  touchedQuestions = {},
  expandedQuestions = {},
  textValidationMeta = {},
}) => writeScopedDraftFailureBackup({
  namespace,
  storage,
  questionnaireSessionId,
  responses: responseSnapshot,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  textValidationMeta,
});

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

    const data = response?.data || {};
    if (data.success === false) {
      return {
        ok: false,
        delivered: false,
        redirected: false,
        suppressed: false,
        status: 'failed',
        externalStatus: data.externalStatus ?? null,
        environment: data.environment || 'unknown',
        mode: data.mode || 'disabled',
        destinationClass: data.destinationClass || 'none',
        errorCode: data.errorCode || '',
        error: serializeSubmitError(data.error || new Error(data.message || 'Zapier function returned success:false'))
      };
    }

    const hasStructuredOutcome =
      typeof data.delivered === 'boolean' ||
      typeof data.redirected === 'boolean' ||
      typeof data.suppressed === 'boolean';
    const delivered = hasStructuredOutcome
      ? data.delivered === true
      : data.success === true;
    const redirected = data.redirected === true;
    const suppressed = data.suppressed === true;

    return {
      ok: true,
      delivered,
      redirected,
      suppressed,
      status: suppressed ? 'suppressed' : redirected ? 'redirected' : delivered ? 'delivered' : 'unknown',
      externalStatus: data.externalStatus ?? null,
      environment: data.environment || 'unknown',
      mode: data.mode || 'disabled',
      destinationClass: data.destinationClass || 'none',
      errorCode: data.errorCode || ''
    };
  } catch (error) {
    console.error(
      'Zapier webhook failed after successful database save:',
      serializeSubmitError(error)
    );

    return {
      ok: false,
      delivered: false,
      redirected: false,
      suppressed: false,
      status: 'failed',
      externalStatus: null,
      environment: 'unknown',
      mode: 'disabled',
      destinationClass: 'none',
      errorCode: '',
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
  textValidationMeta,
  credentials,
  domainParam,
  questionnaireSessionId,
  browserNamespace = deriveQuestionnaireBrowserNamespace(),
  browserStorage = defaultResilientStorage,
  localFailureBackupEnabled = false,
  onFinalSubmitSuccess,
  onFinalSubmitFailure,
  serviceOptionsGrouped = {},
  preparedSubmissionSnapshot = null,
}) => {
  const authoritativeResponses = preparedSubmissionSnapshot?.responseSnapshot || responses;
  const responseSnapshot = authoritativeResponses
    && typeof authoritativeResponses === 'object'
    && !Array.isArray(authoritativeResponses)
    ? { ...authoritativeResponses }
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
  const writeFailedSubmissionBackupForSubmission = (options) => (
    localFailureBackupEnabled ? writeFailedSubmissionBackup({
      namespace: browserNamespace,
      storage: browserStorage,
      validationStatus,
      touchedQuestions,
      expandedQuestions,
      textValidationMeta,
      ...options,
    }) : Promise.resolve(null)
  );

  const recordSubmitStage = async (stage, details = {}) => {
    const safeDetails = sanitizeStageDetails(details);

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

    transformedPayload = preparedSubmissionSnapshot?.mappedPayload
      || transformResponsesToPayload(
        responseSnapshot,
        businessName,
        domain,
        serviceOptionsGrouped
      );
    await recordSubmitStage('payload_transform_success', {
      payloadSizeChars: safePayloadSize(transformedPayload)
    });
  } catch (error) {
    const serializedError = serializeSubmitError(error);

    await recordSubmitStage('payload_transform_failed', {
      error: serializedError,
      failureKind: serializedError.failureKind
    });

    await writeFailedSubmissionBackupForSubmission({
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
      draftId: null,
      submitContext
    });

    if (fallbackResult?.ok) {
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

    await writeFailedSubmissionBackupForSubmission({
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
      draftId: null,
      submitContext
    });

    if (fallbackResult?.ok) {
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
      draftId: null,
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

    await writeFailedSubmissionBackupForSubmission({
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
  }

  let zapierDelivery = null;
  if (!receivedViaIntake && !resilientSubmitResult.zapierSent && transformedPayload) {
    // Keep the public page alive until the backend accepts or rejects delivery.
    // Fire-and-forget requests can be cancelled when the thank-you view replaces
    // the questionnaire immediately after submission on the published site.
    zapierDelivery = await sendZapierSafe(transformedPayload, { timeoutMs: 10000 });
  } else if (resilientSubmitResult.zapierSent) {
    zapierDelivery = {
      ok: true,
      delivered: true,
      redirected: Boolean(resilientSubmitResult.zapierRedirected),
      suppressed: false,
      status: resilientSubmitResult.zapierRedirected ? 'redirected' : 'delivered',
      externalStatus: resilientSubmitResult.zapierStatus ?? null,
      environment: resilientSubmitResult.environment || 'unknown',
      mode: resilientSubmitResult.externalSideEffectsMode || 'disabled',
      destinationClass: resilientSubmitResult.destinationClass || 'none',
      errorCode: ''
    };
  }

  await recordSubmitStage('submit_success', {
    usedFallback: resilientSubmitResult.usedFallback
  });

  if (typeof onFinalSubmitSuccess === 'function') {
    onFinalSubmitSuccess({
      savedSubmission,
      intakeId,
      receivedViaIntake,
      zapierDelivery,
      responseSnapshot,
      transformedPayload
    });
  }

  return {
    savedSubmission,
    intakeId,
    receivedViaIntake,
    zapierDelivery,
    responseSnapshot,
    transformedPayload
  };
};
