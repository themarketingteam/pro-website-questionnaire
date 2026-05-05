export const safeJsonStringifyDraft = (value) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

export const sanitizeCredentialsForDraft = (credentials = {}) => ({
  businessName: credentials.businessName || '',
  domain: credentials.domain || '',
  userId: credentials.userId || '',
  userName: credentials.userName || '',
  userEmail: credentials.userEmail || ''
});

export const createFindExistingDraftBySessionId = ({ draftRecordIdRef }) => {
  return async ({ sessionId, entities }) => {
    if (draftRecordIdRef.current) {
      return { id: draftRecordIdRef.current };
    }

    const existingDrafts = await entities.ProFormDraft.filter({
      session_id: sessionId
    });

    if (Array.isArray(existingDrafts) && existingDrafts.length > 0) {
      const sorted = [...existingDrafts].sort((a, b) => {
        const aTime = new Date(a.last_saved_at || a.created_date || 0).getTime();
        const bTime = new Date(b.last_saved_at || b.created_date || 0).getTime();
        return bTime - aTime;
      });

      draftRecordIdRef.current = sorted[0].id;
      return sorted[0];
    }

    return null;
  };
};

export const createSaveDraftSnapshot = ({
  entities,
  draftRecordIdRef,
  findExistingDraftBySessionId
}) => {
  return async ({
    sessionId,
    responses,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    credentials,
    businessNameParam,
    domainParam,
    currentQuestionId,
    lastChangedQuestionId,
    status = 'draft',
    saveError = '',
    submitError = '',
    finalSubmissionId = ''
  }) => {
    const safeCreds = sanitizeCredentialsForDraft(credentials);
    const now = new Date().toISOString();

    const draftRecord = {
      session_id: sessionId,
      business_name: businessNameParam || safeCreds.businessName || '',
      domain: domainParam || safeCreds.domain || '',
      user_id: safeCreds.userId || '',
      user_name: safeCreds.userName || '',
      user_email: safeCreds.userEmail || '',
      status,
      current_question_id: currentQuestionId || '',
      last_changed_question_id: lastChangedQuestionId || '',
      responses_json: safeJsonStringifyDraft(responses),
      validation_status_json: safeJsonStringifyDraft(validationStatus),
      touched_questions_json: safeJsonStringifyDraft(touchedQuestions),
      expanded_questions_json: safeJsonStringifyDraft(expandedQuestions),
      metadata_json: safeJsonStringifyDraft({
        app: 'pro_questionnaire',
        source: 'real_time_draft',
        userAgent: navigator.userAgent,
        pageUrl: window.location.href
      }),
      save_error: saveError,
      submit_error: submitError,
      final_submission_id: finalSubmissionId,
      submit_attempted_at: status === 'submit_attempted' || status === 'submit_failed' ? now : '',
      submitted_at: status === 'submitted' ? now : '',
      last_changed_at: now,
      last_saved_at: now
    };

    const existingDraft = await findExistingDraftBySessionId({
      sessionId,
      entities
    });

    if (existingDraft?.id) {
      draftRecordIdRef.current = existingDraft.id;
      return entities.ProFormDraft.update(existingDraft.id, draftRecord);
    }

    const saved = await entities.ProFormDraft.create(draftRecord);

    if (saved?.id) {
      draftRecordIdRef.current = saved.id;
    }

    return saved;
  };
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