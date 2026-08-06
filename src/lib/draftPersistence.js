import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import {
  safeGetUserAgent,
  safeJsonStringify,
  safeNowIso
} from '@/lib/browserSafety';
import { defaultResilientStorage, STORAGE_MODES } from '@/lib/resilientStorage';
import {
  QUESTIONNAIRE_STORAGE_KEY_VERSIONS,
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import { normalizePersistedQuestionnaireState } from '@/components/store/normalization';

export const safeJsonStringifyDraft = (value) => safeJsonStringify(value, '{}');

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
    serviceOptionsGrouped = {},
    currentQuestionId,
    lastChangedQuestionId,
    status = 'draft',
    saveError = '',
    submitError = '',
    finalSubmissionId = ''
  }) => {
    const safeCreds = sanitizeCredentialsForDraft(credentials);
    const now = safeNowIso();
    const businessName = businessNameParam || safeCreds.businessName || '';
    const businessDomain = domainParam || safeCreds.domain || '';
    const mappedPayload = transformResponsesToPayload(
      responses || {},
      businessName,
      businessDomain,
      serviceOptionsGrouped
    );

    const draftRecord = {
      session_id: sessionId,
      business_name: businessName,
      domain: businessDomain,
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
      metadata_json: safeJsonStringifyDraft(mappedPayload.metadata),
      userdata_json: safeJsonStringifyDraft(mappedPayload.userdata),
      mapped_payload_json: safeJsonStringifyDraft(mappedPayload),
      draft_metadata_json: safeJsonStringifyDraft({
        app: 'pro_questionnaire',
        source: 'real_time_draft',
        userAgent: safeGetUserAgent()
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

const safeFormRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const isDurableStorageMode = (mode) => (
  mode === STORAGE_MODES.INDEXEDDB || mode === STORAGE_MODES.LOCALSTORAGE
);

export const writeDraftFailureBackup = async ({
  namespace = deriveQuestionnaireBrowserNamespace(),
  storage = defaultResilientStorage,
  questionnaireSessionId,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  textValidationMeta,
}) => {
  const key = buildQuestionnaireStorageKey({ namespace, purpose: 'failure-backup' });
  const savedAt = safeNowIso();
  try {
    try { await storage.probe?.(); } catch {}
    let storageMode = storage.getMode?.() || STORAGE_MODES.UNKNOWN;
    let backup = {
      namespaceVersion: QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT,
      sessionId: String(questionnaireSessionId || ''),
      savedAt,
      storageMode,
      form: {
        responses: safeFormRecord(responses),
        validationStatus: safeFormRecord(validationStatus),
        touchedQuestions: safeFormRecord(touchedQuestions),
        expandedQuestions: safeFormRecord(expandedQuestions),
        textValidationMeta: safeFormRecord(textValidationMeta),
      },
    };
    await storage.setJson(key, backup);

    const actualMode = storage.getMode?.() || storageMode;
    if (actualMode !== storageMode) {
      storageMode = actualMode;
      backup = { ...backup, storageMode };
      await storage.setJson(key, backup);
    }
    return Object.freeze({
      written: true,
      storageMode,
      durable: isDurableStorageMode(storageMode),
    });
  } catch {
    return Object.freeze({
      written: false,
      storageMode: storage.getMode?.() || STORAGE_MODES.UNKNOWN,
      durable: false,
    });
  }
};

export const readDraftFailureBackup = async ({
  namespace = deriveQuestionnaireBrowserNamespace(),
  storage = defaultResilientStorage,
} = {}) => {
  const key = buildQuestionnaireStorageKey({ namespace, purpose: 'failure-backup' });
  try {
    const backup = await storage.getJson(key, null);
    if (
      !backup
      || backup.namespaceVersion !== QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT
      || typeof backup.sessionId !== 'string'
      || typeof backup.savedAt !== 'string'
      || !Object.values(STORAGE_MODES).includes(backup.storageMode)
      || !backup.form
      || typeof backup.form !== 'object'
      || Array.isArray(backup.form)
    ) return null;
    return Object.freeze({
      namespaceVersion: backup.namespaceVersion,
      sessionId: backup.sessionId,
      savedAt: backup.savedAt,
      storageMode: backup.storageMode,
      form: normalizePersistedQuestionnaireState(backup.form),
    });
  } catch {
    return null;
  }
};
