import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import {
  safeGetUserAgent,
  safeJsonStringify,
  safeLocalStorageGet,
  safeLocalStorageSet,
  safeNowIso
} from '@/lib/browserSafety';
import { appParams } from '@/lib/app-params';

const SAVE_FUNCTION = 'syncProQuestionnaireDraft';
const MAX_ATTEMPTS = 3;

const getTimerApi = () => (typeof window !== 'undefined' ? window : globalThis);
const delay = (ms) => new Promise((resolve) => getTimerApi().setTimeout(resolve, ms));

export const getDraftErrorStatus = (error) => Number(
  error?.status || error?.response?.status || 0
);

export const isRetryableDraftError = (error) => {
  const status = getDraftErrorStatus(error);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = String(error?.message || '').toLowerCase();
  return !status || /network|timeout|timed out|failed to fetch|load failed|offline/.test(message);
};

const invokeDraftFunction = async (functions, payload, { attempts = MAX_ATTEMPTS } = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await functions.invoke(SAVE_FUNCTION, payload);
      if (!response?.data?.success) {
        const error = new Error(response?.data?.error || 'Draft persistence failed.');
        error.status = response?.status || 500;
        throw error;
      }
      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableDraftError(error)) throw error;
      const baseDelay = import.meta.env.MODE === 'test' ? 0 : 250 * (2 ** (attempt - 1));
      await delay(baseDelay + (import.meta.env.MODE === 'test' ? 0 : Math.floor(Math.random() * 120)));
    }
  }
  throw lastError || new Error('Draft persistence failed.');
};

export const bootstrapServerDraft = async ({
  functions,
  resumeCredential,
  legacySessionId,
  credentials
}) => invokeDraftFunction(functions, {
  action: 'bootstrap',
  resumeCredential,
  legacySessionId,
  credentials: sanitizeCredentialsForDraft(credentials)
});

export const createServerDraftMutationPayload = ({
  resumeCredential,
  clientInstanceId,
  mutationId,
  clientSequence,
  baseRevision,
  responses,
  changedKeys,
  deletedKeys,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  credentials,
  currentQuestionId,
  lastChangedQuestionId,
  progressPercent,
  status = 'draft',
  submitError = '',
  finalSubmissionId = '',
  intakeId = '',
  mappedPayload,
  source = 'autosave'
}) => ({
  action: 'save',
  resumeCredential,
  clientInstanceId,
  mutationId,
  clientSequence,
  baseRevision,
  clientChangedAt: safeNowIso(),
  responses,
  changedKeys,
  deletedKeys,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  credentials: sanitizeCredentialsForDraft(credentials),
  currentQuestionId,
  lastChangedQuestionId,
  progressPercent,
  status,
  submitError,
  finalSubmissionId,
  intakeId,
  mappedPayload,
  source
});

export const saveServerDraftMutation = async ({
  functions,
  resumeCredential,
  clientInstanceId,
  mutationId,
  clientSequence,
  baseRevision,
  responses,
  changedKeys,
  deletedKeys,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  credentials,
  currentQuestionId,
  lastChangedQuestionId,
  progressPercent,
  status = 'draft',
  submitError = '',
  finalSubmissionId = '',
  intakeId = '',
  mappedPayload,
  source = 'autosave'
}) => invokeDraftFunction(functions, createServerDraftMutationPayload({
  resumeCredential,
  clientInstanceId,
  mutationId,
  clientSequence,
  baseRevision,
  responses,
  changedKeys,
  deletedKeys,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  credentials,
  currentQuestionId,
  lastChangedQuestionId,
  progressPercent,
  status,
  submitError,
  finalSubmissionId,
  intakeId,
  mappedPayload,
  source
}));

const KEEPALIVE_MAX_BYTES = 60_000;

export const flushDraftMutationKeepalive = ({ payload, fetchImpl = globalThis.fetch } = {}) => {
  if (!payload || typeof fetchImpl !== 'function') return false;
  const body = safeJsonStringify(payload, '');
  if (!body || new TextEncoder().encode(body).byteLength > KEEPALIVE_MAX_BYTES) return false;
  const serverUrl = String(appParams.serverUrl || '').replace(/\/+$/, '');
  const appId = String(appParams.appId || '').trim();
  if (!serverUrl || !appId) return false;

  try {
    void fetchImpl(`${serverUrl}/api/apps/${encodeURIComponent(appId)}/functions/${SAVE_FUNCTION}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Id': appId
      },
      body,
      keepalive: true,
      mode: 'cors',
      credentials: 'omit'
    }).catch(() => null);
    return true;
  } catch {
    return false;
  }
};

export const createSecureDraftEvent = async ({
  functions,
  resumeCredential,
  event
}) => invokeDraftFunction(functions, {
  action: 'event',
  resumeCredential,
  event
}, { attempts: 2 });

export const getDraftLocalBackup = (sessionId) => {
  if (!sessionId) return null;
  const raw = safeLocalStorageGet(`pro_questionnaire_local_backup_${sessionId}`);
  if (!raw) return null;
  try {
    const backup = JSON.parse(raw);
    return backup && typeof backup === 'object' ? backup : null;
  } catch {
    return null;
  }
};

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

export const writeDraftFailureBackup = ({
  questionnaireSessionId,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  changedKeys = [],
  deletedKeys = [],
  baseRevision = 0,
  error
}) => {
  try {
    return safeLocalStorageSet(
      `pro_questionnaire_local_backup_${questionnaireSessionId}`,
      {
        session_id: questionnaireSessionId,
        responses,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        changedKeys,
        deletedKeys,
        baseRevision,
        error,
        savedAt: safeNowIso()
      }
    );
  } catch {
    return false;
  }
};
