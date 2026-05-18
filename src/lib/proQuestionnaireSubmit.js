import { base44 } from '@/api/base44Client';
import {
  transformResponsesToPayload,
  validateSubmissionPayload
} from '@/components/pro-form/submissionPayload';
import { trackClarityEvent } from '@/lib/clarity';
import {
  createProFormSubmissionResilient,
  serializeSubmitError
} from '@/lib/proSubmissionResilience';

export { serializeSubmitError } from '@/lib/proSubmissionResilience';

const safeJsonStringify = (value) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

export const writeFailedSubmissionBackup = ({
  questionnaireSessionId,
  responseSnapshot,
  transformedPayload,
  error
}) => {
  try {
    localStorage.setItem(
      `failed_pro_submission_${Date.now()}`,
      JSON.stringify({
        session_id: questionnaireSessionId,
        responses: responseSnapshot,
        transformedPayload,
        error,
        createdAt: new Date().toISOString()
      })
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
    localStorage.setItem(
      `pro_questionnaire_local_backup_${questionnaireSessionId}`,
      JSON.stringify({
        session_id: questionnaireSessionId,
        responses,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        error,
        savedAt: new Date().toISOString()
      })
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

export const sendZapierSafe = async (transformedPayload) => {
  try {
    await base44.functions.invoke('sendToZapier', transformedPayload);
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
  const responseSnapshot = { ...responses };

  const transformedPayload = transformResponsesToPayload(
    responseSnapshot,
    businessName,
    domain,
    serviceOptionsGrouped
  );

  const validation = validateSubmissionPayload(transformedPayload);

  if (!validation.ok) {
    const message = `Invalid questionnaire payload: ${validation.errors.join(' ')}`;

    console.error(message, validation.errors);

    trackClarityEvent('pro_questionnaire_validation_failed', {
      validation_failed_question_id: 'submission_payload',
      business_domain: domain || credentials?.domain || domainParam || 'unknown'
    });

    throw new Error(message);
  }

  trackClarityEvent('pro_questionnaire_submit_attempt', {
    completed_questions: Object.keys(responseSnapshot).length,
    submit_status: 'attempted',
    business_domain: domain || credentials?.domain || domainParam || 'unknown'
  });

  await createDraftEventSafe({
    createDraftEvent,
    eventType: 'submit_attempted',
    value: {
      status: 'submit_attempted'
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
      status: 'submit_attempted'
    }
  });

  let savedSubmission;

  const resilientSubmitResult = await createProFormSubmissionResilient(
    transformedPayload,
    {
      maxAttempts: 3,
      timeoutMs: 15000
    }
  );

  if (!resilientSubmitResult.ok) {
    const serialized = resilientSubmitResult.error || serializeSubmitError(null);
    const submitFailure = new Error('Questionnaire submission failed');
    submitFailure.name = 'ProSubmissionCreateFailed';
    submitFailure.failureKind = resilientSubmitResult.failureKind;
    submitFailure.attempts = resilientSubmitResult.attempts;

    console.error('ProFormSubmission.create failed:', serialized);

    await createDraftEventSafe({
      createDraftEvent,
      eventType: 'submit_failed',
      value: {
        status: 'submit_failed',
        error_message: serialized?.message || 'unknown'
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

    trackClarityEvent('pro_questionnaire_submit_failed', {
      completed_questions: Object.keys(responseSnapshot).length,
      submit_status: 'failed',
      business_domain: domain || credentials?.domain || domainParam || 'unknown',
      error_message: serialized?.message || 'unknown'
    });

    if (typeof onFinalSubmitFailure === 'function') {
      onFinalSubmitFailure({
        error: submitFailure,
        serialized,
        responseSnapshot,
        transformedPayload
      });
    }

    throw submitFailure;
  }

  savedSubmission = resilientSubmitResult.submission;

  await safeDraftSave({
    saveDraftNow,
    questionnaireSessionId,
    responsesSnapshot: responseSnapshot,
    validationStatusSnapshot: validationStatus,
    touchedQuestionsSnapshot: touchedQuestions,
    expandedQuestionsSnapshot: expandedQuestions,
    options: {
      status: 'submitted',
      finalSubmissionId: savedSubmission?.id || ''
    }
  });

  await createDraftEventSafe({
    createDraftEvent,
    eventType: 'submitted',
    value: {
      status: 'submitted',
      final_submission_id: savedSubmission?.id || ''
    }
  });

  await sendZapierSafe(transformedPayload);

  try {
    trackClarityEvent('pro_questionnaire_submit_success', {
      completed_questions: Object.keys(responseSnapshot).length,
      submit_status: 'success',
      business_domain: domain || credentials?.domain || domainParam || 'unknown'
    });
  } catch (error) {
    console.error('Non-fatal clarity submit success tracking failed:', serializeSubmitError(error));
  }

  if (typeof onFinalSubmitSuccess === 'function') {
    onFinalSubmitSuccess({
      savedSubmission,
      responseSnapshot,
      transformedPayload
    });
  }

  return {
    savedSubmission,
    responseSnapshot,
    transformedPayload
  };
};