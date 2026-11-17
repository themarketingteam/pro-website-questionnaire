import { validatePageStructure } from '@/lib/pageOrganizerModel';
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
export const getDraftErrorCode = (error) => String(error?.response?.data?.code || error?.code || '');
export const reloadForDraftRevision = () => window.location.reload();
const stableJsonValue = (value) => Array.isArray(value) ? value.map(stableJsonValue)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])])) : value;
const canonicalJson = (value) => JSON.stringify(stableJsonValue(value));

export const isRetryableDraftError = (error) => {
  const status = getDraftErrorStatus(error);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = String(error?.message || '').toLowerCase();
  return !status || /network|timeout|timed out|failed to fetch|load failed|offline/.test(message);
};

/**
 * @param {any} data
 * @param {string} action
 * @param {{resumeCredential?: string, changedKeys?: string[], deletedKeys?: string[], responses?: Record<string, unknown>}} [request]
 */
export const validateDraftAcknowledgement = (data, action, request = {}) => {
  if (!['bootstrap', 'save', 'start_revision'].includes(action)) return;
  const startingRevision = action === 'start_revision';
  const draft = data?.draft;
  const validObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!validObject(draft) || typeof draft.draftId !== 'string' || !draft.draftId
    || !validObject(draft.responses) || !Number.isInteger(draft.revision) || draft.revision < 0
    || (action !== 'save' && (typeof draft.sessionId !== 'string' || !draft.sessionId))) {
    throw Object.assign(new Error('The draft service did not return a complete saved snapshot. Your local answers have been retained.'), { status: 502, code: 'INVALID_DRAFT_ACKNOWLEDGEMENT' });
  }
  const expectedSession = String(request.resumeCredential || '').split('.')[0];
  const returnedSession = String(data.resumeCredential || '').split('.')[0];
  if ((!startingRevision && expectedSession && draft.sessionId !== expectedSession)
    || (action !== 'save' && returnedSession && draft.sessionId !== returnedSession)) {
    throw Object.assign(new Error('The saved snapshot belongs to a different recovery session. Your local answers have been retained.'), { status: 502, code: 'INVALID_DRAFT_ACKNOWLEDGEMENT' });
  }
  const retainedAdvancedRevision = startingRevision && data.reused === true && draft.revision > 1;
  if (startingRevision && (!returnedSession || draft.sessionId === expectedSession
    || !['draft', ...(retainedAdvancedRevision ? ['submitted'] : [])].includes(draft.status)
    || (!retainedAdvancedRevision && canonicalJson(draft.responses) !== canonicalJson(request.responses || {})))) {
    throw Object.assign(new Error('The new working draft did not confirm the complete revision snapshot. Your original answers and recovery link were retained.'), { status: 502, code: 'INVALID_REVISION_ACKNOWLEDGEMENT' });
  }
  for (const id of ['3', '4']) {
    if (Object.prototype.hasOwnProperty.call(draft.responses, `${id}_structure`)
      && !validatePageStructure(draft.responses[`${id}_structure`]).ok) {
      throw Object.assign(new Error('The draft service returned invalid page organization. Your local answers have been retained.'), { status: 502, code: 'INVALID_DRAFT_ACKNOWLEDGEMENT' });
    }
  }
  if (action === 'save' && (data.finalized || data.ignored)) {
    const changed = (request.changedKeys || []).some((key) => (
      Object.prototype.hasOwnProperty.call(request.responses || {}, key)
      && JSON.stringify(request.responses[key]) !== JSON.stringify(draft.responses[key])
    ));
    const deleted = (request.deletedKeys || []).some((key) => Object.prototype.hasOwnProperty.call(draft.responses, key));
    if (changed || deleted) {
      throw Object.assign(new Error('This questionnaire was already submitted. These additional edits were kept locally and were not saved over the completed submission.'), { status: 409, code: 'DRAFT_ALREADY_SUBMITTED', draft, finalized: true });
    }
  }
};

const invokeDraftFunction = async (functions, payload, { attempts = MAX_ATTEMPTS } = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await functions.invoke(SAVE_FUNCTION, payload);
      if (!response?.data?.success) {
        const error = new Error(response?.data?.error || 'Draft persistence failed.');
        error.status = response?.status || 500;
        Object.assign(error, { code: response?.data?.code || '' });
        throw error;
      }
      validateDraftAcknowledgement(response.data, payload.action, payload);
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
  credentials,
  incomingIdentity,
  newClient = false,
  newClientRequestId = '',
  identityDecision = ''
}) => invokeDraftFunction(functions, {
  action: 'bootstrap',
  resumeCredential,
  legacySessionId,
  credentials: sanitizeCredentialsForDraft(credentials),
  incomingIdentity: sanitizeCredentialsForDraft(incomingIdentity || credentials),
  newClient: Boolean(newClient),
  newClientRequestId,
  identityDecision
});

export const startServerDraftRevision = ({ functions, ...payload }) => invokeDraftFunction(functions, {
  ...payload, action: 'start_revision'
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
        outboxVersion: 2,
        pending: changedKeys.length > 0 || deletedKeys.length > 0,
        error,
        savedAt: safeNowIso()
      }
    );
  } catch {
    return false;
  }
};
