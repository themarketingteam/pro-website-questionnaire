import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInitialState } from '@/components/store/formSlice';
import { normalizePersistedStateV3 } from '@/components/store/normalization';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { serializeError } from '@/components/pro-form/submissionPayload';
import {
  bootstrapServerDraft,
  createSecureDraftEvent,
  getDraftLocalBackup,
  saveServerDraftMutation,
  writeDraftFailureBackup
} from '@/lib/draftPersistence';
import {
  getOrCreateDraftClientInstanceId,
  getOrCreateQuestionnaireSessionId,
  getStoredResumeCredential,
  persistResumeCredential
} from '@/lib/sessionId';
import { safeNowIso } from '@/lib/browserSafety';

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
    if (!questionnaireSessionId) return;
    writeDraftFailureBackup({
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
    source = 'autosave',
    includeAllResponses = false,
    required = false
  } = {}) => {
    if (!resumeCredentialRef.current) {
      const error = new Error('The secure draft session is not ready.');
      if (required) return Promise.reject(error);
      return Promise.resolve(null);
    }

    const snapshot = {
      responses: responsesSnapshot || latestRef.current.responses || {},
      validationStatus: validationStatusSnapshot || latestRef.current.validationStatus || {},
      touchedQuestions: touchedQuestionsSnapshot || latestRef.current.touchedQuestions || {},
      expandedQuestions: expandedQuestionsSnapshot || latestRef.current.expandedQuestions || {},
      credentials: effectiveCredentials()
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
    const mappedPayload = transformResponsesToPayload(
      snapshot.responses,
      snapshot.credentials.businessName,
      snapshot.credentials.domain,
      serviceOptionsGrouped
    );
    setDraftSaveState('saving');

    const operation = async () => {
      try {
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
        knownServerKeysRef.current = new Set(Object.keys(result?.draft?.responses || snapshot.responses));
        setLastSavedAt(result?.draft?.lastSavedAt || safeNowIso());
        setDraftSaveState('saved');
        return result?.draft || null;
      } catch (error) {
        changedKeys.forEach((key) => pendingChangedKeysRef.current.add(key));
        deletedKeys.forEach((key) => pendingDeletedKeysRef.current.add(key));
        const serialized = serializeError(error);
        writeLocalOutbox(serialized);
        setDraftSaveState('error');
        if (required) throw error;
        return null;
      }
    };

    saveChainRef.current = saveChainRef.current.catch(() => null).then(operation);
    return saveChainRef.current;
  }, [base44.functions, effectiveCredentials, serviceOptionsGrouped, totalQuestionCount, writeLocalOutbox]);

  const queueDraftSave = useCallback((changedQuestionIds, nextResponses, options = {}) => {
    if (!isDraftReady) return;
    const keys = Array.isArray(changedQuestionIds) ? changedQuestionIds : [changedQuestionIds];
    keys.filter(Boolean).forEach((key) => pendingChangedKeysRef.current.add(key));
    (options.deletedKeys || []).forEach((key) => pendingDeletedKeysRef.current.add(key));
    if (nextResponses) latestRef.current.responses = nextResponses;
    if (options.validationStatus) latestRef.current.validationStatus = options.validationStatus;
    if (options.touchedQuestions) latestRef.current.touchedQuestions = options.touchedQuestions;
    if (options.expandedQuestions) latestRef.current.expandedQuestions = options.expandedQuestions;
    lastChangedQuestionIdRef.current = options.currentQuestionId || keys.find(Boolean) || lastChangedQuestionIdRef.current;
    setDraftSaveState('saving');
    writeLocalOutbox('pending_server_save');

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
      source,
      includeAllResponses: true,
      required
    });
  }, [executeSave]);

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

    const initialize = async () => {
      setDraftSaveState('loading');
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
        resumeCredentialRef.current = persistResumeCredential(result.resumeCredential);
        const serverDraft = result.draft || {};
        const sessionId = serverDraft.sessionId || legacySessionId;
        setQuestionnaireSessionId(sessionId);
        revisionRef.current = Number(serverDraft.revision) || 0;
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
        dispatch(loadInitialState({ ...normalized, credentials: mergedCredentials }));
        setRestoredQuestionId(serverDraft.currentQuestionId || serverDraft.lastChangedQuestionId || '');
        setLastSavedAt(serverDraft.lastSavedAt || '');
        setIsDraftReady(true);
        setDraftSaveState('saved');

        merged.changedKeys.forEach((key) => pendingChangedKeysRef.current.add(key));
        merged.deletedKeys.forEach((key) => pendingDeletedKeysRef.current.add(key));
        if (merged.changedKeys.length > 0 || merged.deletedKeys.length > 0) {
          await executeSave({ source: 'local_recovery_merge' });
        }
      } catch (error) {
        if (cancelled) return;
        setDraftSaveState('error');
        setIsDraftReady(true);
        writeLocalOutbox(serializeError(error));
      }
    };
    initialize();

    return () => {
      cancelled = true;
    };
  // Initialization intentionally runs once. Live values are read through latestRef.
  }, []);

  useEffect(() => () => {
    // Every user mutation is copied to the local outbox synchronously when it
    // is queued. Avoid writing again during unload: another open tab may have
    // already saved a newer authoritative server value.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return {
    isDraftReady,
    draftSaveState,
    lastSavedAt,
    questionnaireSessionId,
    restoredQuestionId,
    queueDraftSave,
    saveDraftNow,
    createDraftEvent
  };
};
