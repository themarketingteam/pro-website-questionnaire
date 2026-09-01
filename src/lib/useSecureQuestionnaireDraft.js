import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInitialState } from '@/components/store/formSlice';
import { normalizePersistedStateV3 } from '@/components/store/normalization';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { serializeError } from '@/components/pro-form/submissionPayload';
import {
  bootstrapServerDraft,
  createServerDraftMutationPayload,
  createSecureDraftEvent,
  flushDraftMutationKeepalive,
  getDraftErrorStatus,
  getDraftLocalBackup,
  isRetryableDraftError,
  saveServerDraftMutation,
  writeDraftFailureBackup
} from '@/lib/draftPersistence';
import {
  clearQuestionnaireSessionId,
  getOrCreateDraftClientInstanceId,
  getOrCreateQuestionnaireSessionId,
  getStoredResumeCredential,
  persistResumeCredential
} from '@/lib/sessionId';
import { safeNowIso } from '@/lib/browserSafety';
import { trackClarityEvent } from '@/lib/clarity';

const MAX_RETRY_DELAY_MS = 30_000;
const MAX_BACKGROUND_SAVE_RETRIES = 8;
const retryDelayForAttempt = (attempt) => Math.min(
  MAX_RETRY_DELAY_MS,
  1000 * (2 ** Math.max(0, attempt - 1))
);

const safeErrorSummary = (error) => ({
  status: getDraftErrorStatus(error) || 'network',
  name: String(error?.name || 'Error').slice(0, 80),
  message: String(error?.response?.data?.error || error?.message || 'Draft request failed.').slice(0, 180)
});

const isNonEmptyValue = (value) => {
  if (value === null || typeof value === 'undefined') return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

const sameValue = (left, right) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
};

const randomMutationId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `mutation_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const calculateProgress = (responses, totalQuestionCount) => {
  const answered = Object.entries(responses || {}).filter(([key, value]) => (
    !key.endsWith('_other')
    && !key.endsWith('_primary')
    && isNonEmptyValue(value)
  )).length;
  return totalQuestionCount > 0
    ? Math.max(0, Math.min(100, Math.round((answered / totalQuestionCount) * 100)))
    : 0;
};

const mergeNewerLocalBackup = ({
  serverDraft,
  localBackup,
  currentLocalState,
  allowLegacyCurrentStateMigration = false
}) => {
  const serverSavedAt = Date.parse(serverDraft?.lastSavedAt || '') || 0;
  const backupSavedAt = Date.parse(localBackup?.savedAt || '') || 0;
  const serverResponses = serverDraft?.responses || {};
  const mayUseCurrentStateAsLegacyMigration = (
    allowLegacyCurrentStateMigration
    &&
    Object.keys(serverResponses).length === 0
    && Object.keys(currentLocalState?.responses || {}).length > 0
  );
  const useBackup = localBackup && backupSavedAt > serverSavedAt;
  if (!useBackup && !mayUseCurrentStateAsLegacyMigration) {
    return {
      state: {
        responses: serverResponses,
        validationStatus: serverDraft?.validationStatus || {},
        touchedQuestions: serverDraft?.touchedQuestions || {},
        expandedQuestions: serverDraft?.expandedQuestions || {},
        textValidationMeta: {}
      },
      changedKeys: [],
      deletedKeys: []
    };
  }

  const local = useBackup ? localBackup : currentLocalState;
  const mergedResponses = { ...serverResponses };
  const changedKeys = [];
  const deletedKeys = Array.isArray(local?.deletedKeys) ? local.deletedKeys : [];
  const explicitChangedKeys = Array.isArray(local?.changedKeys)
    ? local.changedKeys
    : Object.keys(local?.responses || {}).filter((key) => (
      Object.keys(serverResponses).length === 0
      || !Object.prototype.hasOwnProperty.call(serverResponses, key)
    ));
  explicitChangedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(local?.responses || {}, key)) return;
    const value = local.responses[key];
    if (isNonEmptyValue(value) || !Object.prototype.hasOwnProperty.call(serverResponses, key)) {
      if (!sameValue(serverResponses[key], value)) changedKeys.push(key);
      mergedResponses[key] = value;
    }
  });
  deletedKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(mergedResponses, key)) changedKeys.push(key);
    delete mergedResponses[key];
  });

  return {
    state: {
      responses: mergedResponses,
      validationStatus: {
        ...(serverDraft?.validationStatus || {}),
        ...(local?.validationStatus || {})
      },
      touchedQuestions: {
        ...(serverDraft?.touchedQuestions || {}),
        ...(local?.touchedQuestions || {})
      },
      expandedQuestions: {
        ...(serverDraft?.expandedQuestions || {}),
        ...(local?.expandedQuestions || {})
      },
      textValidationMeta: currentLocalState?.textValidationMeta || {}
    },
    changedKeys: [...new Set(changedKeys)],
    deletedKeys: [...new Set(deletedKeys)]
  };
};

export const useSecureQuestionnaireDraft = ({
  base44,
  dispatch,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  textValidationMeta,
  credentials,
  businessNameParam,
  domainParam,
  serviceOptionsGrouped,
  totalQuestionCount,
  isTestMode = false
}) => {
  const [isDraftReady, setIsDraftReady] = useState(false);
  const [draftSaveState, setDraftSaveState] = useState('loading');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [lastConfirmedRevision, setLastConfirmedRevision] = useState(0);
  const [hasLocalRecoveryCopy, setHasLocalRecoveryCopy] = useState(null);
  const [draftConnection, setDraftConnection] = useState({
    attempt: 0,
    error: '',
    nextRetryAt: ''
  });
  const [questionnaireSessionId, setQuestionnaireSessionId] = useState(() => getOrCreateQuestionnaireSessionId());
  const [restoredQuestionId, setRestoredQuestionId] = useState('');
  const resumeCredentialRef = useRef(getStoredResumeCredential());
  const clientInstanceIdRef = useRef(null);
  if (!clientInstanceIdRef.current) {
    clientInstanceIdRef.current = getOrCreateDraftClientInstanceId();
  }
  const clientSequenceRef = useRef(0);
  const revisionRef = useRef(0);
  const saveTimerRef = useRef(null);
  const saveRetryTimerRef = useRef(null);
  const bootstrapRetryTimerRef = useRef(null);
  const bootstrapRunnerRef = useRef(null);
  const executeSaveRef = useRef(null);
  const mountedRef = useRef(true);
  const saveRetryAttemptRef = useRef(0);
  const unconfirmedMutationsRef = useRef(new Map());
  const storageFailureTrackedRef = useRef(false);
  const lastIdentityFingerprintRef = useRef('');
  const saveChainRef = useRef(Promise.resolve(null));
  const pendingChangedKeysRef = useRef(new Set());
  const pendingDeletedKeysRef = useRef(new Set());
  const knownServerKeysRef = useRef(new Set());
  const lastChangedQuestionIdRef = useRef('');
  const initializedRef = useRef(false);
  const latestRef = useRef({
    responses,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    textValidationMeta,
    credentials
  });

  useEffect(() => {
    latestRef.current = {
      responses,
      validationStatus,
      touchedQuestions,
      expandedQuestions,
      textValidationMeta,
      credentials
    };
  }, [responses, validationStatus, touchedQuestions, expandedQuestions, textValidationMeta, credentials]);

  const effectiveCredentials = useCallback((snapshotCredentials = latestRef.current.credentials) => ({
    ...(snapshotCredentials || {}),
    businessName: businessNameParam || snapshotCredentials?.businessName || '',
    domain: domainParam || snapshotCredentials?.domain || ''
  }), [businessNameParam, domainParam]);

  const writeLocalOutbox = useCallback((error = '') => {
    if (!questionnaireSessionId) return false;
    const stored = writeDraftFailureBackup({
      questionnaireSessionId,
      responses: latestRef.current.responses,
      validationStatus: latestRef.current.validationStatus,
      touchedQuestions: latestRef.current.touchedQuestions,
      expandedQuestions: latestRef.current.expandedQuestions,
      changedKeys: [...pendingChangedKeysRef.current],
      deletedKeys: [...pendingDeletedKeysRef.current],
      baseRevision: revisionRef.current,
      error
    });
    setHasLocalRecoveryCopy(stored);
    if (!stored && !storageFailureTrackedRef.current) {
      storageFailureTrackedRef.current = true;
      trackClarityEvent('pro_questionnaire_draft_storage_blocked', {
        storage: 'localStorage'
      });
    }
    return stored;
  }, [questionnaireSessionId]);

  const executeSave = useCallback(({
    status = 'draft',
    submitError = '',
    finalSubmissionId = '',
    intakeId = '',
    responsesSnapshot,
    validationStatusSnapshot,
    touchedQuestionsSnapshot,
    expandedQuestionsSnapshot,
    credentialsSnapshot,
    source = 'autosave',
    includeAllResponses = false,
    required = false
  } = {}) => {
    if (!resumeCredentialRef.current) {
      const error = new Error('The secure draft session is not ready.');
      setDraftSaveState('error');
      setIsDraftReady(false);
      trackClarityEvent('pro_questionnaire_draft_save_rejected', {
        reason: 'missing_resume_credential',
        source
      });
      bootstrapRunnerRef.current?.({ immediate: true });
      if (required) return Promise.reject(error);
      return Promise.resolve(null);
    }

    const snapshot = {
      responses: responsesSnapshot || latestRef.current.responses || {},
      validationStatus: validationStatusSnapshot || latestRef.current.validationStatus || {},
      touchedQuestions: touchedQuestionsSnapshot || latestRef.current.touchedQuestions || {},
      expandedQuestions: expandedQuestionsSnapshot || latestRef.current.expandedQuestions || {},
      credentials: effectiveCredentials(credentialsSnapshot || latestRef.current.credentials)
    };
    if (includeAllResponses) {
      Object.keys(snapshot.responses).forEach((key) => pendingChangedKeysRef.current.add(key));
      knownServerKeysRef.current.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(snapshot.responses, key)) {
          pendingDeletedKeysRef.current.add(key);
        }
      });
    }
    const changedKeys = [...pendingChangedKeysRef.current];
    const deletedKeys = [...pendingDeletedKeysRef.current];
    pendingChangedKeysRef.current.clear();
    pendingDeletedKeysRef.current.clear();
    const mutationId = randomMutationId();
    const clientSequence = ++clientSequenceRef.current;
    const currentQuestionId = lastChangedQuestionIdRef.current || '';
    unconfirmedMutationsRef.current.set(mutationId, { changedKeys, deletedKeys });
    setDraftSaveState('saving');

    const operation = async () => {
      try {
        const mappedPayload = transformResponsesToPayload(
          snapshot.responses,
          snapshot.credentials.businessName,
          snapshot.credentials.domain,
          serviceOptionsGrouped
        );
        const result = await saveServerDraftMutation({
          functions: base44.functions,
          resumeCredential: resumeCredentialRef.current,
          clientInstanceId: clientInstanceIdRef.current,
          mutationId,
          clientSequence,
          baseRevision: revisionRef.current,
          responses: snapshot.responses,
          changedKeys,
          deletedKeys,
          validationStatus: snapshot.validationStatus,
          touchedQuestions: snapshot.touchedQuestions,
          expandedQuestions: snapshot.expandedQuestions,
          credentials: snapshot.credentials,
          currentQuestionId,
          lastChangedQuestionId: currentQuestionId,
          progressPercent: calculateProgress(snapshot.responses, totalQuestionCount),
          status,
          submitError,
          finalSubmissionId,
          intakeId,
          mappedPayload,
          source
        });
        revisionRef.current = Number(result?.draft?.revision) || revisionRef.current;
        unconfirmedMutationsRef.current.delete(mutationId);
        setLastConfirmedRevision(revisionRef.current);
        knownServerKeysRef.current = new Set(Object.keys(result?.draft?.responses || snapshot.responses));
        setLastSavedAt(result?.draft?.lastSavedAt || safeNowIso());
        setDraftSaveState('saved');
        saveRetryAttemptRef.current = 0;
        if (saveRetryTimerRef.current) {
          clearTimeout(saveRetryTimerRef.current);
          saveRetryTimerRef.current = null;
        }
        trackClarityEvent('pro_questionnaire_draft_save_confirmed', {
          revision: revisionRef.current,
          source
        });
        return result?.draft || null;
      } catch (error) {
        unconfirmedMutationsRef.current.delete(mutationId);
        changedKeys.forEach((key) => pendingChangedKeysRef.current.add(key));
        deletedKeys.forEach((key) => pendingDeletedKeysRef.current.add(key));
        const serialized = serializeError(error);
        writeLocalOutbox(serialized);
        setDraftSaveState('error');
        const summary = safeErrorSummary(error);
        trackClarityEvent('pro_questionnaire_draft_save_rejected', {
          status: summary.status,
          name: summary.name,
          source,
          retryable: String(isRetryableDraftError(error))
        });
        if (summary.status === 401) {
          clearQuestionnaireSessionId();
          resumeCredentialRef.current = '';
          setIsDraftReady(false);
          setDraftConnection((current) => ({
            ...current,
            error: 'The prior draft credential was rejected. Creating a new secure recovery draft…',
            nextRetryAt: ''
          }));
          trackClarityEvent('pro_questionnaire_draft_credential_recovered', {
            source: 'save_rejection',
            last_confirmed_revision: revisionRef.current
          });
          setTimeout(() => bootstrapRunnerRef.current?.({ immediate: true }), 0);
        }
        if (isRetryableDraftError(error)) {
          saveRetryAttemptRef.current += 1;
          if (saveRetryAttemptRef.current <= MAX_BACKGROUND_SAVE_RETRIES) {
            saveRetryTimerRef.current = setTimeout(() => {
              saveRetryTimerRef.current = null;
              if (!mountedRef.current || !resumeCredentialRef.current) return;
              executeSaveRef.current?.({ source: 'background_retry' });
            }, isTestMode ? 0 : retryDelayForAttempt(saveRetryAttemptRef.current));
          } else {
            trackClarityEvent('pro_questionnaire_draft_retry_exhausted', {
              attempts: saveRetryAttemptRef.current,
              source,
              last_confirmed_revision: revisionRef.current
            });
          }
        }
        if (required) throw error;
        return null;
      }
    };

    saveChainRef.current = saveChainRef.current.catch(() => null).then(operation);
    return saveChainRef.current;
  }, [base44.functions, effectiveCredentials, isTestMode, serviceOptionsGrouped, totalQuestionCount, writeLocalOutbox]);

  executeSaveRef.current = executeSave;

  const queueDraftSave = useCallback((changedQuestionIds, nextResponses, options = {}) => {
    if (!isDraftReady) return;
    const keys = Array.isArray(changedQuestionIds) ? changedQuestionIds : [changedQuestionIds];
    keys.filter(Boolean).forEach((key) => pendingChangedKeysRef.current.add(key));
    (options.deletedKeys || []).forEach((key) => pendingDeletedKeysRef.current.add(key));
    if (nextResponses) latestRef.current.responses = nextResponses;
    if (options.validationStatus) latestRef.current.validationStatus = options.validationStatus;
    if (options.touchedQuestions) latestRef.current.touchedQuestions = options.touchedQuestions;
    if (options.expandedQuestions) latestRef.current.expandedQuestions = options.expandedQuestions;
    if (options.credentials) latestRef.current.credentials = options.credentials;
    lastChangedQuestionIdRef.current = options.currentQuestionId || keys.find(Boolean) || lastChangedQuestionIdRef.current;
    setDraftSaveState('saving');
    writeLocalOutbox('pending_server_save');

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (saveRetryTimerRef.current) {
      clearTimeout(saveRetryTimerRef.current);
      saveRetryTimerRef.current = null;
    }
    const delayMs = isTestMode ? 0 : (options.delayMs ?? 650);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      executeSave({ source: options.source || 'autosave' });
    }, delayMs);
  }, [executeSave, isDraftReady, isTestMode, writeLocalOutbox]);

  const saveDraftNow = useCallback(async ({
    status = 'draft',
    submitError = '',
    finalSubmissionId = '',
    intakeId = '',
    responsesSnapshot = latestRef.current.responses,
    validationStatusSnapshot = latestRef.current.validationStatus,
    touchedQuestionsSnapshot = latestRef.current.touchedQuestions,
    expandedQuestionsSnapshot = latestRef.current.expandedQuestions,
    credentialsSnapshot = latestRef.current.credentials,
    required = false,
    source = 'manual_flush'
  } = {}) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return executeSave({
      status,
      submitError,
      finalSubmissionId,
      intakeId,
      responsesSnapshot,
      validationStatusSnapshot,
      touchedQuestionsSnapshot,
      expandedQuestionsSnapshot,
      credentialsSnapshot,
      source,
      includeAllResponses: true,
      required
    });
  }, [executeSave]);

  const updateDraftIdentity = useCallback((identity = {}, { delayMs = 250 } = {}) => {
    const nextCredentials = {
      ...(latestRef.current.credentials || {}),
      ...(typeof identity.businessName === 'string' ? { businessName: identity.businessName } : {}),
      ...(typeof identity.domain === 'string' ? { domain: identity.domain } : {}),
      ...(typeof identity.userId === 'string' ? { userId: identity.userId } : {}),
      ...(typeof identity.userName === 'string' ? { userName: identity.userName } : {}),
      ...(typeof identity.userEmail === 'string' ? { userEmail: identity.userEmail } : {})
    };
    latestRef.current.credentials = nextCredentials;
    queueDraftSave([], latestRef.current.responses, {
      credentials: nextCredentials,
      delayMs,
      source: 'identity_sync'
    });
  }, [queueDraftSave]);

  const createDraftEvent = useCallback(async ({ eventType, questionId = '', value = {}, eventRecord }) => {
    if (!resumeCredentialRef.current) return null;
    const record = eventRecord || {
      event_type: eventType,
      question_id: questionId,
      question_type: 'unknown',
      value_json: JSON.stringify(value ?? null),
      value_summary: '',
      value_length: JSON.stringify(value ?? null).length,
      selected_option_count: Array.isArray(value) ? value.length : 0
    };
    try {
      return await createSecureDraftEvent({
        functions: base44.functions,
        resumeCredential: resumeCredentialRef.current,
        event: record
      });
    } catch {
      return null;
    }
  }, [base44.functions]);

  useEffect(() => {
    if (initializedRef.current) return undefined;
    initializedRef.current = true;
    let cancelled = false;
    let bootstrapInFlight = false;
    let attemptCount = 0;

    const initialize = async ({ immediate = false } = {}) => {
      if (cancelled || bootstrapInFlight) return;
      if (bootstrapRetryTimerRef.current) {
        clearTimeout(bootstrapRetryTimerRef.current);
        bootstrapRetryTimerRef.current = null;
      }
      bootstrapInFlight = true;
      attemptCount += 1;
      setDraftSaveState('loading');
      setDraftConnection((current) => ({
        ...current,
        attempt: attemptCount,
        nextRetryAt: ''
      }));
      trackClarityEvent('pro_questionnaire_draft_bootstrap_attempt', {
        attempt: attemptCount,
        immediate: String(Boolean(immediate))
      });
      try {
        const legacySessionId = getOrCreateQuestionnaireSessionId();
        const initialResumeCredential = getStoredResumeCredential();
        const result = await bootstrapServerDraft({
          functions: base44.functions,
          resumeCredential: initialResumeCredential,
          legacySessionId,
          credentials: effectiveCredentials(latestRef.current.credentials)
        });
        if (cancelled) return;
        const persistedCredential = persistResumeCredential(result.resumeCredential);
        if (!persistedCredential) throw new Error('The draft service did not return a valid recovery credential.');
        resumeCredentialRef.current = persistedCredential;
        const serverDraft = result.draft || {};
        const sessionId = serverDraft.sessionId || legacySessionId;
        setQuestionnaireSessionId(sessionId);
        revisionRef.current = Number(serverDraft.revision) || 0;
        setLastConfirmedRevision(revisionRef.current);
        knownServerKeysRef.current = new Set(Object.keys(serverDraft.responses || {}));
        const localBackup = getDraftLocalBackup(sessionId);
        const merged = mergeNewerLocalBackup({
          serverDraft,
          localBackup: localBackup?.session_id === sessionId ? localBackup : null,
          currentLocalState: latestRef.current,
          // An explicit capability identifies an existing authoritative draft.
          // Never merge persisted Redux answers from a different browser draft
          // into it. Legacy Redux migration is only for sessions that had no
          // secure resume credential yet.
          allowLegacyCurrentStateMigration: !initialResumeCredential
        });
        const normalized = normalizePersistedStateV3(merged.state);
        const mergedCredentials = {
          ...(serverDraft.credentials || {}),
          ...Object.fromEntries(Object.entries(effectiveCredentials()).filter(([, value]) => Boolean(value)))
        };
        latestRef.current = {
          ...latestRef.current,
          ...normalized,
          credentials: mergedCredentials
        };
        // Compare future identity changes with what the server actually returned,
        // not merely with URL/Redux values that have not been persisted yet.
        lastIdentityFingerprintRef.current = JSON.stringify(serverDraft.credentials || {});
        dispatch(loadInitialState({ ...normalized, credentials: mergedCredentials }));
        setRestoredQuestionId(serverDraft.currentQuestionId || serverDraft.lastChangedQuestionId || '');
        setLastSavedAt(serverDraft.lastSavedAt || '');
        setIsDraftReady(true);
        setDraftSaveState('saved');
        setDraftConnection({ attempt: attemptCount, error: '', nextRetryAt: '' });
        trackClarityEvent('pro_questionnaire_draft_bootstrap_confirmed', {
          attempt: attemptCount,
          revision: revisionRef.current,
          restored: String(Boolean(Object.keys(serverDraft.responses || {}).length))
        });

        merged.changedKeys.forEach((key) => pendingChangedKeysRef.current.add(key));
        merged.deletedKeys.forEach((key) => pendingDeletedKeysRef.current.add(key));
        if (merged.changedKeys.length > 0 || merged.deletedKeys.length > 0) {
          await executeSave({ source: 'local_recovery_merge' });
        }
      } catch (error) {
        if (cancelled) return;
        const summary = safeErrorSummary(error);
        const invalidStoredCredential = summary.status === 401 && Boolean(getStoredResumeCredential());
        if (invalidStoredCredential) {
          clearQuestionnaireSessionId();
          resumeCredentialRef.current = '';
          trackClarityEvent('pro_questionnaire_draft_credential_recovered', {
            attempt: attemptCount
          });
        }
        const retryDelayMs = isTestMode ? 1000 : retryDelayForAttempt(attemptCount);
        const nextRetryAt = new Date(Date.now() + retryDelayMs).toISOString();
        setDraftSaveState('error');
        setIsDraftReady(false);
        setDraftConnection({
          attempt: attemptCount,
          error: summary.message,
          nextRetryAt
        });
        writeLocalOutbox(serializeError(error));
        trackClarityEvent('pro_questionnaire_draft_bootstrap_failed', {
          attempt: attemptCount,
          status: summary.status,
          name: summary.name
        });
        bootstrapRetryTimerRef.current = setTimeout(() => {
          bootstrapRetryTimerRef.current = null;
          initialize();
        }, retryDelayMs);
      } finally {
        bootstrapInFlight = false;
      }
    };
    bootstrapRunnerRef.current = initialize;
    initialize();

    return () => {
      cancelled = true;
      bootstrapRunnerRef.current = null;
      if (bootstrapRetryTimerRef.current) {
        clearTimeout(bootstrapRetryTimerRef.current);
        bootstrapRetryTimerRef.current = null;
      }
    };
  // Initialization intentionally runs once. Live values are read through latestRef.
  }, []);

  const retryDraftBootstrap = useCallback(() => {
    bootstrapRunnerRef.current?.({ immediate: true });
  }, []);

  useEffect(() => {
    if (!isDraftReady) return;
    const identity = effectiveCredentials(credentials);
    const fingerprint = JSON.stringify(identity);
    if (fingerprint === lastIdentityFingerprintRef.current) return;
    lastIdentityFingerprintRef.current = fingerprint;
    updateDraftIdentity(identity, { delayMs: 0 });
  }, [
    businessNameParam,
    credentials.businessName,
    credentials.domain,
    credentials.userEmail,
    credentials.userId,
    credentials.userName,
    domainParam,
    effectiveCredentials,
    isDraftReady,
    updateDraftIdentity
  ]);

  const flushDraftKeepalive = useCallback((source = 'pagehide_flush') => {
    if (!resumeCredentialRef.current) return false;
    const snapshot = {
      responses: latestRef.current.responses || {},
      validationStatus: latestRef.current.validationStatus || {},
      touchedQuestions: latestRef.current.touchedQuestions || {},
      expandedQuestions: latestRef.current.expandedQuestions || {},
      credentials: effectiveCredentials(latestRef.current.credentials)
    };
    const changedKeySet = new Set(pendingChangedKeysRef.current);
    const deletedKeySet = new Set(pendingDeletedKeysRef.current);
    unconfirmedMutationsRef.current.forEach((mutation) => {
      mutation.changedKeys.forEach((key) => changedKeySet.add(key));
      mutation.deletedKeys.forEach((key) => deletedKeySet.add(key));
    });
    deletedKeySet.forEach((key) => changedKeySet.delete(key));
    const changedKeys = [...changedKeySet];
    const deletedKeys = [...deletedKeySet];
    const changedResponses = changedKeys.reduce((result, key) => {
      if (Object.prototype.hasOwnProperty.call(snapshot.responses, key)) {
        result[key] = snapshot.responses[key];
      }
      return result;
    }, {});
    const mutationBase = {
      resumeCredential: resumeCredentialRef.current,
      clientInstanceId: clientInstanceIdRef.current,
      mutationId: randomMutationId(),
      clientSequence: ++clientSequenceRef.current,
      baseRevision: revisionRef.current,
      responses: changedResponses,
      changedKeys,
      deletedKeys,
      validationStatus: snapshot.validationStatus,
      touchedQuestions: snapshot.touchedQuestions,
      expandedQuestions: snapshot.expandedQuestions,
      credentials: snapshot.credentials,
      currentQuestionId: lastChangedQuestionIdRef.current || '',
      lastChangedQuestionId: lastChangedQuestionIdRef.current || '',
      progressPercent: calculateProgress(snapshot.responses, totalQuestionCount),
      source
    };

    let mappedPayload;
    try {
      mappedPayload = transformResponsesToPayload(
        snapshot.responses,
        snapshot.credentials.businessName,
        snapshot.credentials.domain,
        serviceOptionsGrouped
      );
    } catch {
      mappedPayload = undefined;
    }

    writeLocalOutbox('page_lifecycle_flush_pending');
    const queued = flushDraftMutationKeepalive({
      payload: createServerDraftMutationPayload({ ...mutationBase, mappedPayload })
    });
    if (queued) {
      trackClarityEvent('pro_questionnaire_draft_keepalive_queued', { source, mode: 'pending_changes' });
      return true;
    }

    const compactQueued = flushDraftMutationKeepalive({
      payload: createServerDraftMutationPayload({
        ...mutationBase,
        mutationId: randomMutationId(),
        clientSequence: ++clientSequenceRef.current,
        mappedPayload: undefined,
        source: `${source}_compact`
      })
    });
    trackClarityEvent('pro_questionnaire_draft_keepalive_queued', {
      source,
      mode: compactQueued ? 'compact' : 'unavailable'
    });
    return compactQueued;
  }, [effectiveCredentials, serviceOptionsGrouped, totalQuestionCount, writeLocalOutbox]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' || !isDraftReady) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      executeSaveRef.current?.({ source: 'visibility_flush' });
    };
    const handlePageHide = () => {
      if (!isDraftReady) return;
      flushDraftKeepalive('pagehide_flush');
    };
    const handleOnline = () => {
      if (!isDraftReady) retryDraftBootstrap();
      else if (pendingChangedKeysRef.current.size > 0 || pendingDeletedKeysRef.current.size > 0) {
        executeSaveRef.current?.({ source: 'online_retry' });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('online', handleOnline);
    };
  }, [flushDraftKeepalive, isDraftReady, retryDraftBootstrap]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (saveRetryTimerRef.current) clearTimeout(saveRetryTimerRef.current);
    if (bootstrapRetryTimerRef.current) clearTimeout(bootstrapRetryTimerRef.current);
  }, []);

  return {
    isDraftReady,
    draftSaveState,
    lastSavedAt,
    lastConfirmedRevision,
    hasLocalRecoveryCopy,
    draftConnection,
    questionnaireSessionId,
    restoredQuestionId,
    queueDraftSave,
    saveDraftNow,
    updateDraftIdentity,
    retryDraftBootstrap,
    createDraftEvent
  };
};
