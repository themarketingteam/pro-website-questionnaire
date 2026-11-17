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
  getDraftErrorCode,
  getDraftLocalBackup,
  isRetryableDraftError,
  saveServerDraftMutation,
  startServerDraftRevision,
  reloadForDraftRevision,
  writeDraftFailureBackup
} from '@/lib/draftPersistence';
import {
  clearQuestionnaireSessionId,
  getFragmentResumeCredential,
  getOrCreateDraftClientInstanceId,
  getOrCreateQuestionnaireSessionId,
  getStoredResumeCredential,
  persistResumeCredential
} from '@/lib/sessionId';
import { safeLocalStorageGet, safeLocalStorageSet, safeNowIso } from '@/lib/browserSafety';
import { validatePageStructure } from '@/lib/pageOrganizerModel';
import { trackClarityEvent } from '@/lib/clarity';
import {
  removeIncomingIdentityParams,
  removeNewClientLaunchParams
} from '@/lib/clientIdentityLaunch';

const MAX_RETRY_DELAY_MS = 30_000;
const MAX_BACKGROUND_SAVE_RETRIES = 8;
const retryDelayForAttempt = (attempt) => Math.min(
  MAX_RETRY_DELAY_MS,
  1000 * (2 ** Math.max(0, attempt - 1))
);

const safeErrorSummary = (error) => ({
  status: getDraftErrorStatus(error) || 'network',
  code: getDraftErrorCode(error).slice(0, 100),
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

const canonicalResponseValue = (value) => Array.isArray(value) ? value.map(canonicalResponseValue)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalResponseValue(value[key])])) : value;

export const equivalentCompletedResponses = (left, right) => {
  try {
    const normalize = (responses) => canonicalResponseValue(normalizePersistedStateV3({ responses: responses || {} }).responses);
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  } catch { return false; }
};

const normalizeIdentityValue = (value, type = 'text') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (type !== 'domain') return normalized.replace(/\s+/g, ' ');
  return normalized
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .replace(/\.$/, '');
};

const identityFieldsInConflict = (incoming = {}, server = {}) => {
  const conflicts = new Set();
  const incomingBusinessName = normalizeIdentityValue(incoming.businessName);
  const serverBusinessName = normalizeIdentityValue(server.businessName);
  const incomingDomain = normalizeIdentityValue(incoming.domain, 'domain');
  const serverDomain = normalizeIdentityValue(server.domain, 'domain');
  if (incomingBusinessName && serverBusinessName && incomingBusinessName !== serverBusinessName) {
    conflicts.add('businessName');
  }
  if (incomingDomain && serverDomain && incomingDomain !== serverDomain) {
    conflicts.add('domain');
  }
  return conflicts;
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
    && !key.endsWith('_structure')
    && isNonEmptyValue(value)
  )).length;
  return totalQuestionCount > 0
    ? Math.max(0, Math.min(100, Math.round((answered / totalQuestionCount) * 100)))
    : 0;
};

const organizerResponseKeys = (questionId) => [questionId, `${questionId}_other`, `${questionId}_structure`];
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const organizedBackupConflict = (serverDraft, localBackup) => {
  if (!localBackup) return null;
  const serverRevision = Number(serverDraft?.revision) || 0;
  const matchingRevision = Number.isInteger(localBackup.baseRevision) && localBackup.baseRevision === serverRevision;
  const serverResponses = serverDraft?.responses || {};
  const localResponses = localBackup.responses || {};
  const changedKeys = Array.isArray(localBackup.changedKeys) ? localBackup.changedKeys : Object.keys(localResponses);
  const deletedKeys = Array.isArray(localBackup.deletedKeys) ? localBackup.deletedKeys : [];
  const questionIds = ['3', '4'].filter((id) => {
    const structureKey = `${id}_structure`;
    const adopted = owns(serverResponses, structureKey);
    const supplied = owns(localResponses, structureKey);
    if (!adopted && !supplied) return false;
    if (supplied && !validatePageStructure(localResponses[structureKey]).ok) return true;
    if (adopted && deletedKeys.includes(structureKey)) return true;
    const legacyChanged = [id, `${id}_other`].some((key) => (
      (changedKeys.includes(key) && owns(localResponses, key) && !sameValue(serverResponses[key], localResponses[key]))
      || deletedKeys.includes(key)
    ));
    if (adopted && legacyChanged && (!supplied || !changedKeys.includes(structureKey))) return true;
    if (matchingRevision) return false;
    return organizerResponseKeys(id).some((key) => (
      (changedKeys.includes(key) && owns(localResponses, key) && !sameValue(serverResponses[key], localResponses[key]))
      || (deletedKeys.includes(key) && owns(serverResponses, key))
    ));
  });
  return questionIds.length ? {
    questionIds,
    baseRevision: localBackup.baseRevision ?? null,
    serverRevision,
    backup: JSON.parse(JSON.stringify(localBackup))
  } : null;
};

export const mergeNewerLocalBackup = ({
  serverDraft,
  localBackup,
  currentLocalState,
  allowLegacyCurrentStateMigration = false
}) => {
  const serverSavedAt = Date.parse(serverDraft?.lastSavedAt || '') || 0;
  const backupSavedAt = Date.parse(localBackup?.savedAt || '') || 0;
  const serverResponses = serverDraft?.responses || {};
  const recoveryConflict = organizedBackupConflict(serverDraft, localBackup);
  const blockedQuestions = new Set(recoveryConflict?.questionIds || []);
  const blockedKeys = new Set([...blockedQuestions].flatMap(organizerResponseKeys));
  const mayUseCurrentStateAsLegacyMigration = (
    allowLegacyCurrentStateMigration
    &&
    Object.keys(serverResponses).length === 0
    && Object.keys(currentLocalState?.responses || {}).length > 0
  );
  const hasLedger = Array.isArray(localBackup?.changedKeys) && Array.isArray(localBackup?.deletedKeys);
  const sameBase = Number.isInteger(localBackup?.baseRevision) && localBackup.baseRevision === serverDraft?.revision;
  // Bootstrap may rematerialize the same revision and advance its timestamp.
  // A versioned pending ledger records intent; an acknowledged snapshot does not.
  const useBackup = localBackup && localBackup.pending !== false && (
    (hasLedger && (localBackup.outboxVersion === 2 || sameBase)) || backupSavedAt > serverSavedAt
  );
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
      deletedKeys: [],
      recoveryConflict
    };
  }

  const local = useBackup ? localBackup : currentLocalState;
  const mergedResponses = { ...serverResponses };
  const changedKeys = [];
  const deletedKeys = (Array.isArray(local?.deletedKeys) ? local.deletedKeys : []).filter((key) => !blockedKeys.has(key));
  const explicitChangedKeys = Array.isArray(local?.changedKeys)
    ? local.changedKeys
    : Object.keys(local?.responses || {}).filter((key) => (
      Object.keys(serverResponses).length === 0
      || !Object.prototype.hasOwnProperty.call(serverResponses, key)
    ));
  explicitChangedKeys.forEach((key) => {
    if (blockedKeys.has(key)) return;
    if (!Object.prototype.hasOwnProperty.call(local?.responses || {}, key)) return;
    const value = local.responses[key];
    if (hasLedger || isNonEmptyValue(value) || !Object.prototype.hasOwnProperty.call(serverResponses, key)) {
      if (!sameValue(serverResponses[key], value)) changedKeys.push(key);
      mergedResponses[key] = value;
    }
  });
  deletedKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(mergedResponses, key)) changedKeys.push(key);
    delete mergedResponses[key];
  });

  const mergeUiState = (key) => ({
    ...(serverDraft?.[key] || {}),
    ...Object.fromEntries(Object.entries(local?.[key] || {}).filter(([id]) => !blockedQuestions.has(id)))
  });
  return {
    state: {
      responses: mergedResponses,
      validationStatus: mergeUiState('validationStatus'),
      touchedQuestions: mergeUiState('touchedQuestions'),
      expandedQuestions: mergeUiState('expandedQuestions'),
      textValidationMeta: currentLocalState?.textValidationMeta || {}
    },
    changedKeys: [...new Set(changedKeys)],
    deletedKeys: [...new Set(deletedKeys)],
    recoveryConflict
  };
};

const organizerRecoveryStorageKey = (sessionId) => `pro_questionnaire_organizer_recovery_${sessionId}`;

export const readOrganizerRecoveryArchive = (sessionId) => {
  if (!sessionId) return null;
  try {
    const archive = JSON.parse(safeLocalStorageGet(organizerRecoveryStorageKey(sessionId)) || 'null');
    return archive?.format === 'page-organizer-recovery-v1' && archive.sessionId === sessionId && Array.isArray(archive.conflicts)
      ? archive : null;
  } catch {
    return null;
  }
};

export const preserveOrganizerRecoveryConflict = (sessionId, conflict, previousArchive = null) => {
  const archive = { format: 'page-organizer-recovery-v1', sessionId, conflicts: [] };
  [readOrganizerRecoveryArchive(sessionId), previousArchive].forEach((source) => {
    if (source?.sessionId !== sessionId || !Array.isArray(source.conflicts)) return;
    source.conflicts.forEach((saved) => {
      if (!archive.conflicts.some((item) => sameValue(item.backup, saved.backup))) archive.conflicts.push(saved);
    });
  });
  if (!archive.conflicts.some((item) => sameValue(item.backup, conflict.backup))) {
    archive.conflicts.push({ ...conflict, detectedAt: safeNowIso() });
  }
  // This separate append-only archive survives replacement of the normal outbox.
  return { archive, storageSaved: safeLocalStorageSet(organizerRecoveryStorageKey(sessionId), JSON.stringify(archive)) };
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
  newClientLaunch = { active: false, requestId: '' },
  serviceOptionsGrouped,
  totalQuestionCount,
  isTestMode = false
}) => {
  const [isDraftReady, setIsDraftReady] = useState(false);
  const [draftSaveState, setDraftSaveState] = useState('loading');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [lastConfirmedRevision, setLastConfirmedRevision] = useState(0);
  const [hasLocalRecoveryCopy, setHasLocalRecoveryCopy] = useState(null);
  const [organizerRecoveryConflict, setOrganizerRecoveryConflict] = useState(null);
  const [draftConnection, setDraftConnection] = useState({
    attempt: 0,
    error: '',
    nextRetryAt: ''
  });
  const [questionnaireSessionId, setQuestionnaireSessionId] = useState(() => getOrCreateQuestionnaireSessionId());
  const [restoredQuestionId, setRestoredQuestionId] = useState('');
  const [identityConflict, setIdentityConflict] = useState(null);
  const [completedDraft, setCompletedDraft] = useState(null);
  const [isStartingRevision, setIsStartingRevision] = useState(false);
  const [revisionStartError, setRevisionStartError] = useState('');
  const [revisionRetryPending, setRevisionRetryPending] = useState(false);
  const completedDraftRef = useRef(null);
  const completedRecoveryRef = useRef(null);
  const revisionAttemptRef = useRef(null);
  const revisionInFlightRef = useRef(false);
  const authoritativeReadyRef = useRef(false);
  const organizerArchiveRef = useRef(null);
  const resumeCredentialRef = useRef(getStoredResumeCredential());
  const clientInstanceIdRef = useRef(null);
  if (!clientInstanceIdRef.current) {
    clientInstanceIdRef.current = getOrCreateDraftClientInstanceId();
  }
  const clientSequenceRef = useRef(0);
  const revisionRef = useRef(0);
  const organizerGenerationRef = useRef({ '3': 0, '4': 0 });
  const authoritativeOrganizerRef = useRef({});
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
  const blockedUrlIdentityFieldsRef = useRef(new Set());
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
    businessName: (
      blockedUrlIdentityFieldsRef.current.has('businessName') ? '' : businessNameParam
    ) || snapshotCredentials?.businessName || '',
    domain: (
      blockedUrlIdentityFieldsRef.current.has('domain') ? '' : domainParam
    ) || snapshotCredentials?.domain || ''
  }), [businessNameParam, domainParam]);

  const writeLocalOutbox = useCallback((error = '') => {
    if (!questionnaireSessionId) return false;
    if (!authoritativeReadyRef.current && getDraftLocalBackup(questionnaireSessionId)) { setHasLocalRecoveryCopy(true); return true; }
    const changed = new Set(pendingChangedKeysRef.current);
    const deleted = new Set(pendingDeletedKeysRef.current);
    unconfirmedMutationsRef.current.forEach((mutation) => {
      mutation.changedKeys.forEach((key) => changed.add(key));
      mutation.deletedKeys.forEach((key) => deleted.add(key));
    });
    deleted.forEach((key) => changed.delete(key));
    const retainedCompleted = completedDraftRef.current?.hasUnsavedChanges && completedRecoveryRef.current;
    const stored = writeDraftFailureBackup({
      questionnaireSessionId,
      responses: retainedCompleted ? retainedCompleted.responses : latestRef.current.responses,
      validationStatus: retainedCompleted ? retainedCompleted.validationStatus : latestRef.current.validationStatus,
      touchedQuestions: retainedCompleted ? retainedCompleted.touchedQuestions : latestRef.current.touchedQuestions,
      expandedQuestions: retainedCompleted ? retainedCompleted.expandedQuestions : latestRef.current.expandedQuestions,
      changedKeys: retainedCompleted ? retainedCompleted.changedKeys : [...changed],
      deletedKeys: retainedCompleted ? retainedCompleted.deletedKeys : [...deleted],
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

  const archiveConcurrentOrganizerCopy = useCallback((questionIds, snapshot, changedKeys, deletedKeys, baseRevision, serverRevision) => {
    const sessionId = resumeCredentialRef.current?.split('.')[0] || questionnaireSessionId;
    const preserved = preserveOrganizerRecoveryConflict(sessionId, {
      questionIds,
      baseRevision,
      serverRevision,
      backup: {
        session_id: sessionId,
        ...snapshot,
        changedKeys,
        deletedKeys,
        baseRevision,
        savedAt: safeNowIso(),
        source: 'concurrent_organizer_update'
      }
    }, organizerArchiveRef.current);
    organizerArchiveRef.current = preserved.archive;
    setOrganizerRecoveryConflict({
      questionIds: [...new Set(preserved.archive.conflicts.flatMap((conflict) => conflict.questionIds))],
      archive: preserved.archive,
      storageSaved: preserved.storageSaved
    });
  }, [questionnaireSessionId]);

  const holdCompletedDraft = useCallback((serverDraft) => {
    const sessionId = serverDraft.sessionId || resumeCredentialRef.current?.split('.')[0] || questionnaireSessionId;
    const recovery = {
      format: 'completed-questionnaire-recovery-v1', sessionId, draftId: serverDraft.draftId,
      finalSubmissionId: serverDraft.finalSubmissionId || '', savedAt: safeNowIso(),
      ...structuredClone(latestRef.current), baseRevision: revisionRef.current,
      changedKeys: [...pendingChangedKeysRef.current], deletedKeys: [...pendingDeletedKeysRef.current]
    };
    const retained = completedDraftRef.current?.hasUnsavedChanges && completedRecoveryRef.current?.sessionId === sessionId
      ? completedRecoveryRef.current : recovery;
    completedRecoveryRef.current = retained;
    safeLocalStorageSet(`pro_questionnaire_completed_recovery_${sessionId}`, retained);
    const completed = {
      draftId: serverDraft.draftId, sessionId, finalSubmissionId: serverDraft.finalSubmissionId || '',
      status: 'submitted', lastSavedAt: serverDraft.lastSavedAt || '',
      hasUnsavedChanges: !equivalentCompletedResponses(retained.responses, serverDraft.responses)
    };
    completedDraftRef.current = completed;
    setCompletedDraft(completed);
    try {
      const attempt = JSON.parse(safeLocalStorageGet(`pro_questionnaire_revision_attempt_${sessionId}`) || 'null');
      setRevisionRetryPending(Boolean(attempt && attempt.draftId === completed.draftId && !attempt.acknowledged));
    } catch { setRevisionRetryPending(false); }
    setDraftSaveState('completed');
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (saveRetryTimerRef.current) { clearTimeout(saveRetryTimerRef.current); saveRetryTimerRef.current = null; }
    writeLocalOutbox('completed_draft_edits_retained');
    const authoritative = normalizePersistedStateV3(serverDraft);
    latestRef.current = { ...authoritative, credentials: serverDraft.credentials || latestRef.current.credentials };
    dispatch(loadInitialState(latestRef.current));
  }, [dispatch, questionnaireSessionId, writeLocalOutbox]);

  const refreshOrganizerConflict = useCallback(async (snapshot, changedKeys, deletedKeys, baseRevision) => {
    const result = await bootstrapServerDraft({ functions: base44.functions, resumeCredential: resumeCredentialRef.current, legacySessionId: '', credentials: {}, incomingIdentity: {} });
    const serverDraft = result.draft;
    if (serverDraft.status === 'submitted') { holdCompletedDraft(serverDraft); return false; }
    const returned = normalizePersistedStateV3({ responses: serverDraft.responses }).responses;
    const differs = (left, right, id) => organizerResponseKeys(id).some((key) => !sameValue(left?.[key], right?.[key]));
    const invalidated = ['3', '4'].filter((id) => (
      (owns(returned, `${id}_structure`) || owns(snapshot.responses, `${id}_structure`) || owns(latestRef.current.responses, `${id}_structure`))
      && (differs(returned, snapshot.responses, id) || differs(returned, latestRef.current.responses, id))
    ));
    if (invalidated.length) {
      archiveConcurrentOrganizerCopy(invalidated, snapshot, changedKeys, deletedKeys, baseRevision, serverDraft.revision);
      if (!sameValue(snapshot.responses, latestRef.current.responses)) archiveConcurrentOrganizerCopy(
        invalidated, latestRef.current, [...pendingChangedKeysRef.current], [...pendingDeletedKeysRef.current], baseRevision, serverDraft.revision
      );
    }
    const next = { ...latestRef.current, responses: { ...latestRef.current.responses } };
    ['3', '4'].forEach((id) => {
      authoritativeOrganizerRef.current[id] = Object.fromEntries(organizerResponseKeys(id).filter((key) => owns(returned, key)).map((key) => [key, returned[key]]));
      if (!invalidated.includes(id)) return;
      organizerGenerationRef.current[id] += 1;
      organizerResponseKeys(id).forEach((key) => {
        pendingChangedKeysRef.current.delete(key); pendingDeletedKeysRef.current.delete(key); delete next.responses[key];
      });
      Object.assign(next.responses, authoritativeOrganizerRef.current[id]);
      ['validationStatus', 'touchedQuestions', 'expandedQuestions'].forEach((slice) => {
        next[slice] = { ...next[slice] };
        if (owns(serverDraft[slice], id)) next[slice][id] = serverDraft[slice][id];
        else delete next[slice][id];
      });
    });
    revisionRef.current = serverDraft.revision;
    setLastConfirmedRevision(serverDraft.revision);
    knownServerKeysRef.current = new Set(Object.keys(serverDraft.responses));
    latestRef.current = next;
    dispatch(loadInitialState(next));
    setLastSavedAt(serverDraft.lastSavedAt || '');
    writeLocalOutbox('organizer_conflict_recovered');
    const pending = pendingChangedKeysRef.current.size > 0 || pendingDeletedKeysRef.current.size > 0;
    setDraftSaveState(pending ? 'pending' : 'saved');
    if (pending) saveRetryTimerRef.current = setTimeout(() => {
      saveRetryTimerRef.current = null;
      if (mountedRef.current && !completedDraftRef.current) executeSaveRef.current?.({ source: 'organizer_conflict_recovery' });
    }, isTestMode ? 0 : 100);
    return true;
  }, [archiveConcurrentOrganizerCopy, base44.functions, dispatch, holdCompletedDraft, isTestMode, writeLocalOutbox]);

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
    let changedKeys = [...pendingChangedKeysRef.current];
    let deletedKeys = [...pendingDeletedKeysRef.current];
    const queuedOrganizerGeneration = { ...organizerGenerationRef.current };
    const queuedBaseRevision = revisionRef.current;
    pendingChangedKeysRef.current.clear();
    pendingDeletedKeysRef.current.clear();
    const mutationId = randomMutationId();
    const clientSequence = ++clientSequenceRef.current;
    const currentQuestionId = lastChangedQuestionIdRef.current || '';
    unconfirmedMutationsRef.current.set(mutationId, { changedKeys, deletedKeys });
    setDraftSaveState('saving');

    const operation = async () => {
      try {
        if (completedDraftRef.current) throw Object.assign(new Error('Start a new revision before editing this submitted questionnaire.'), { status: 409, code: 'DRAFT_ALREADY_SUBMITTED' });
        const invalidatedQuestions = ['3', '4'].filter((id) => (
          queuedOrganizerGeneration[id] !== organizerGenerationRef.current[id]
          && (owns(snapshot.responses, `${id}_structure`) || owns(authoritativeOrganizerRef.current[id], `${id}_structure`))
        ));
        if (invalidatedQuestions.length) {
          const changedOrganizers = invalidatedQuestions.filter((id) => organizerResponseKeys(id).some((key) => changedKeys.includes(key) || deletedKeys.includes(key)));
          if (changedOrganizers.length) archiveConcurrentOrganizerCopy(changedOrganizers, snapshot, changedKeys, deletedKeys, queuedBaseRevision, revisionRef.current);
          const blockedKeys = new Set(invalidatedQuestions.flatMap(organizerResponseKeys));
          changedKeys = changedKeys.filter((key) => !blockedKeys.has(key));
          deletedKeys = deletedKeys.filter((key) => !blockedKeys.has(key));
          snapshot.responses = { ...snapshot.responses };
          invalidatedQuestions.forEach((id) => {
            organizerResponseKeys(id).forEach((key) => delete snapshot.responses[key]);
            Object.assign(snapshot.responses, authoritativeOrganizerRef.current[id] || {});
          });
          unconfirmedMutationsRef.current.set(mutationId, { changedKeys, deletedKeys });
          if (required) {
            const error = Object.assign(new Error('The page organization changed in another tab. Review the current pages before submitting.'), { status: 409, code: 'ORGANIZER_SNAPSHOT_CHANGED' });
            throw error;
          }
        }
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
        const returnedResponses = result?.draft?.responses;
        if (returnedResponses && typeof returnedResponses === 'object') {
          const downgraded = ['3', '4'].filter((id) => owns(snapshot.responses, `${id}_structure`) && !owns(returnedResponses, `${id}_structure`));
          if (downgraded.length) {
            archiveConcurrentOrganizerCopy(downgraded, snapshot, changedKeys, deletedKeys, queuedBaseRevision, Number(result.draft.revision) || revisionRef.current);
            const error = Object.assign(new Error('The draft service did not preserve the page organization. Your local copy is available for download.'), { status: 409, code: 'ORGANIZER_SERVER_SCHEMA_MISMATCH' });
            throw error;
          }
          const remoteChanges = ['3', '4'].filter((id) => (
            (owns(returnedResponses, `${id}_structure`) || owns(snapshot.responses, `${id}_structure`))
            && !sameValue(returnedResponses[`${id}_structure`], snapshot.responses[`${id}_structure`])
          ));
          const normalizedReturned = normalizePersistedStateV3({ responses: returnedResponses }).responses;
          ['3', '4'].forEach((id) => {
            authoritativeOrganizerRef.current[id] = Object.fromEntries(organizerResponseKeys(id)
              .filter((key) => owns(normalizedReturned, key)).map((key) => [key, normalizedReturned[key]]));
          });
          if (remoteChanges.length) {
            const pendingKeys = new Set([...pendingChangedKeysRef.current, ...pendingDeletedKeysRef.current]);
            unconfirmedMutationsRef.current.forEach((mutation, id) => {
              if (id !== mutationId) [...mutation.changedKeys, ...mutation.deletedKeys].forEach((key) => pendingKeys.add(key));
            });
            const conflictingLocal = remoteChanges.filter((id) => (
              (organizerResponseKeys(id).some((key) => pendingKeys.has(key)) || changedKeys.includes(`${id}_structure`))
              && !sameValue(latestRef.current.responses?.[`${id}_structure`], returnedResponses[`${id}_structure`])
            ));
            if (conflictingLocal.length) archiveConcurrentOrganizerCopy(
              conflictingLocal, latestRef.current, [...pendingChangedKeysRef.current, ...pendingKeys],
              [...pendingDeletedKeysRef.current], revisionRef.current, Number(result.draft.revision) || revisionRef.current
            );
            const next = { ...latestRef.current, responses: { ...latestRef.current.responses } };
            remoteChanges.forEach((id) => {
              organizerGenerationRef.current[id] += 1;
              organizerResponseKeys(id).forEach((key) => {
                pendingChangedKeysRef.current.delete(key);
                pendingDeletedKeysRef.current.delete(key);
                delete next.responses[key];
              });
              Object.assign(next.responses, authoritativeOrganizerRef.current[id]);
              ['validationStatus', 'touchedQuestions', 'expandedQuestions'].forEach((key) => {
                next[key] = { ...next[key] };
                if (owns(result.draft[key], id)) next[key][id] = result.draft[key][id];
                else delete next[key][id];
              });
            });
            latestRef.current = next;
            dispatch(loadInitialState(next));
          }
        }
        // Reconcile authoritative organization before a later save can use its revision.
        revisionRef.current = Number(result?.draft?.revision) || revisionRef.current;
        unconfirmedMutationsRef.current.delete(mutationId);
        const laterKeys = new Set();
        unconfirmedMutationsRef.current.forEach((mutation) => [...mutation.changedKeys, ...mutation.deletedKeys].forEach((key) => laterKeys.add(key)));
        pendingChangedKeysRef.current.forEach((key) => {
          if (!laterKeys.has(key) && sameValue(latestRef.current.responses[key], returnedResponses?.[key])) pendingChangedKeysRef.current.delete(key);
        });
        pendingDeletedKeysRef.current.forEach((key) => {
          if (!laterKeys.has(key) && !owns(returnedResponses, key) && !owns(latestRef.current.responses, key)) pendingDeletedKeysRef.current.delete(key);
        });
        setLastConfirmedRevision(revisionRef.current);
        knownServerKeysRef.current = new Set(Object.keys(result?.draft?.responses || snapshot.responses));
        setLastSavedAt(result?.draft?.lastSavedAt || safeNowIso());
        setDraftSaveState('saved');
        writeLocalOutbox('');
        if (result?.draft?.status === 'submitted') holdCompletedDraft(result.draft);
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
        if (getDraftErrorCode(error) === 'DRAFT_ALREADY_SUBMITTED') {
          if (error.draft) holdCompletedDraft(error.draft);
          else setDraftSaveState('completed');
          if (required) throw error;
          return null;
        }
        if (['ORGANIZER_REVISION_CONFLICT', 'ORGANIZER_CLIENT_UPGRADE_REQUIRED', 'ORGANIZER_STRUCTURE_REQUIRED', 'ORGANIZER_DOWNGRADE_REJECTED'].includes(getDraftErrorCode(error))) {
          try {
            await refreshOrganizerConflict(snapshot, changedKeys, deletedKeys, queuedBaseRevision);
            if (required) throw Object.assign(new Error('The saved page organization was refreshed. Your local arrangement was kept for review; review the current pages before submitting.'), { status: 409, code: 'ORGANIZER_REVIEW_REQUIRED' });
            return null;
          } catch (refreshError) {
            if (getDraftErrorCode(refreshError) === 'ORGANIZER_REVIEW_REQUIRED') throw refreshError;
            error = refreshError;
          }
        }
        const summary = safeErrorSummary(error);
        const retryable = isRetryableDraftError(error);
        trackClarityEvent('pro_questionnaire_draft_save_rejected', {
          status: summary.status,
          name: summary.name,
          code: summary.code,
          source,
          retryable: String(retryable)
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
        if (retryable) {
          saveRetryAttemptRef.current += 1;
          if (saveRetryAttemptRef.current <= MAX_BACKGROUND_SAVE_RETRIES) {
            setDraftSaveState('retrying');
            saveRetryTimerRef.current = setTimeout(() => {
              saveRetryTimerRef.current = null;
              if (!mountedRef.current || !resumeCredentialRef.current) return;
              executeSaveRef.current?.({ source: 'background_retry' });
            }, isTestMode ? 0 : retryDelayForAttempt(saveRetryAttemptRef.current));
          } else {
            setDraftSaveState('error');
            trackClarityEvent('pro_questionnaire_draft_retry_exhausted', {
              attempts: saveRetryAttemptRef.current,
              source,
              last_confirmed_revision: revisionRef.current
            });
          }
        } else {
          setDraftSaveState('error');
        }
        if (required) throw error;
        return null;
      }
    };

    saveChainRef.current = saveChainRef.current.catch(() => null).then(operation);
    return saveChainRef.current;
  }, [archiveConcurrentOrganizerCopy, base44.functions, dispatch, effectiveCredentials, holdCompletedDraft, isTestMode, refreshOrganizerConflict, serviceOptionsGrouped, totalQuestionCount, writeLocalOutbox]);

  executeSaveRef.current = executeSave;

  const queueDraftSave = useCallback((changedQuestionIds, nextResponses, options = {}) => {
    if (!isDraftReady || completedDraftRef.current) return;
    const keys = Array.isArray(changedQuestionIds) ? changedQuestionIds : [changedQuestionIds];
    keys.filter(Boolean).forEach((key) => pendingChangedKeysRef.current.add(key));
    (options.deletedKeys || []).forEach((key) => pendingDeletedKeysRef.current.add(key));
    if (nextResponses) {
      const next = { ...nextResponses };
      // Delayed validation/UI callbacks carry full snapshots. They only own the
      // declared changed keys and must not reinstate an older organizer tree.
      ['3', '4'].forEach((id) => {
        if (organizerResponseKeys(id).some((key) => keys.includes(key) || (options.deletedKeys || []).includes(key))) return;
        if (!owns(latestRef.current.responses, `${id}_structure`) && !owns(next, `${id}_structure`)) return;
        organizerResponseKeys(id).forEach((key) => {
          delete next[key];
          if (owns(latestRef.current.responses, key)) next[key] = latestRef.current.responses[key];
        });
      });
      latestRef.current.responses = next;
    }
    if (options.validationStatus) latestRef.current.validationStatus = options.validationStatus;
    if (options.touchedQuestions) latestRef.current.touchedQuestions = options.touchedQuestions;
    if (options.expandedQuestions) latestRef.current.expandedQuestions = options.expandedQuestions;
    if (options.credentials) latestRef.current.credentials = options.credentials;
    lastChangedQuestionIdRef.current = options.currentQuestionId || keys.find(Boolean) || lastChangedQuestionIdRef.current;
    setDraftSaveState('pending');
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

    const initialize = async ({ immediate = false, identityDecision = '' } = {}) => {
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
        let legacySessionId = newClientLaunch.active ? '' : getOrCreateQuestionnaireSessionId();
        let initialResumeCredential = newClientLaunch.active ? '' : getStoredResumeCredential();
        const fragmentResumeCredential = getFragmentResumeCredential();
        const incomingUrlIdentity = {
          businessName: blockedUrlIdentityFieldsRef.current.has('businessName') ? '' : businessNameParam,
          domain: blockedUrlIdentityFieldsRef.current.has('domain') ? '' : domainParam
        };
        let result = await bootstrapServerDraft({
          functions: base44.functions,
          resumeCredential: initialResumeCredential,
          legacySessionId,
          credentials: effectiveCredentials(latestRef.current.credentials),
          incomingIdentity: incomingUrlIdentity,
          newClient: newClientLaunch.active,
          newClientRequestId: newClientLaunch.requestId,
          identityDecision
        });
        if (cancelled) return;
        const persistedCredential = persistResumeCredential(result.resumeCredential);
        if (!persistedCredential) throw new Error('The draft service did not return a valid recovery credential.');
        resumeCredentialRef.current = persistedCredential;
        const initialIdentityConflicts = new Set(
          result?.identityConflict?.fields || identityFieldsInConflict(
          incomingUrlIdentity,
          result.draft?.credentials || {}
          )
        );
        if (initialIdentityConflicts.size > 0 && identityDecision !== 'continue_existing') {
          setIdentityConflict({
            fields: [...initialIdentityConflicts],
            incoming: incomingUrlIdentity,
            existing: result.draft?.credentials || {},
            explicitRecoveryLink: Boolean(fragmentResumeCredential),
            cancelled: false
          });
          setDraftSaveState('conflict');
          setIsDraftReady(false);
          setDraftConnection({ attempt: attemptCount, error: '', nextRetryAt: '' });
          trackClarityEvent('pro_questionnaire_draft_identity_conflict', {
            fields: [...initialIdentityConflicts].join(','),
            source: fragmentResumeCredential ? 'explicit_resume_link' : 'stored_browser_credential'
          });
          return;
        }
        setIdentityConflict(null);
        const serverDraft = result.draft || {};
        const sessionId = serverDraft.sessionId || legacySessionId;
        setQuestionnaireSessionId(sessionId);
        revisionRef.current = Number(serverDraft.revision) || 0;
        setLastConfirmedRevision(revisionRef.current);
        knownServerKeysRef.current = new Set(Object.keys(serverDraft.responses || {}));
        ['3', '4'].forEach((id) => {
          organizerGenerationRef.current[id] += 1;
          authoritativeOrganizerRef.current[id] = Object.fromEntries(organizerResponseKeys(id)
            .filter((key) => owns(serverDraft.responses, key)).map((key) => [key, serverDraft.responses[key]]));
        });
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
            && !newClientLaunch.active
        });
        const preservedRecovery = merged.recoveryConflict
          ? preserveOrganizerRecoveryConflict(sessionId, merged.recoveryConflict)
          : { archive: readOrganizerRecoveryArchive(sessionId), storageSaved: true };
        const recoveryArchive = preservedRecovery.archive;
        organizerArchiveRef.current = recoveryArchive;
        setOrganizerRecoveryConflict(recoveryArchive?.conflicts.length ? {
          questionIds: [...new Set(recoveryArchive.conflicts.flatMap((conflict) => conflict.questionIds))],
          archive: recoveryArchive,
          storageSaved: preservedRecovery.storageSaved
        } : null);
        const normalized = normalizePersistedStateV3(merged.state);
        const effectiveIdentity = effectiveCredentials();
        const mergedCredentials = {
          ...(serverDraft.credentials || {}),
          ...Object.fromEntries(Object.entries(effectiveIdentity).filter(([field, value]) => (
            Boolean(value) && !blockedUrlIdentityFieldsRef.current.has(field)
          )))
        };
        latestRef.current = {
          ...latestRef.current,
          ...normalized,
          credentials: mergedCredentials
        };
        authoritativeReadyRef.current = true;
        // Compare future identity changes with what the server actually returned,
        // not merely with URL/Redux values that have not been persisted yet.
        lastIdentityFingerprintRef.current = JSON.stringify(serverDraft.credentials || {});
        dispatch(loadInitialState({ ...normalized, credentials: mergedCredentials }));
        setRestoredQuestionId(serverDraft.currentQuestionId || serverDraft.lastChangedQuestionId || '');
        setLastSavedAt(serverDraft.lastSavedAt || '');
        setIsDraftReady(true);
        setDraftSaveState('saved');
        setDraftConnection({ attempt: attemptCount, error: '', nextRetryAt: '' });
        if (newClientLaunch.active && result.newClientRequestConfirmed) {
          removeNewClientLaunchParams();
        }
        trackClarityEvent('pro_questionnaire_draft_bootstrap_confirmed', {
          attempt: attemptCount,
          revision: revisionRef.current,
          restored: String(Boolean(Object.keys(serverDraft.responses || {}).length))
        });

        merged.changedKeys.forEach((key) => pendingChangedKeysRef.current.add(key));
        merged.deletedKeys.forEach((key) => pendingDeletedKeysRef.current.add(key));
        if (serverDraft.status === 'submitted') holdCompletedDraft(serverDraft);
        else if (merged.changedKeys.length > 0 || merged.deletedKeys.length > 0) {
          await executeSave({ source: 'local_recovery_merge' });
        }
      } catch (error) {
        if (cancelled) return;
        const summary = safeErrorSummary(error);
        const invalidStoredCredential = ['401', '410'].includes(String(summary.status))
          && Boolean(getStoredResumeCredential());
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

  const resolveIdentityConflict = useCallback((decision) => {
    if (!identityConflict) return;
    if (decision === 'cancel') {
      setIdentityConflict((current) => current ? { ...current, cancelled: true } : current);
      trackClarityEvent('pro_questionnaire_draft_identity_conflict_cancelled', {
        fields: identityConflict.fields.join(',')
      });
      return;
    }
    if (decision !== 'continue_existing') return;
    blockedUrlIdentityFieldsRef.current = new Set(identityConflict.fields);
    removeIncomingIdentityParams();
    setIdentityConflict(null);
    trackClarityEvent('pro_questionnaire_draft_identity_conflict_resolved', {
      decision: 'continue_existing',
      fields: identityConflict.fields.join(',')
    });
    bootstrapRunnerRef.current?.({ immediate: true, identityDecision: 'continue_existing' });
  }, [identityConflict]);

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
    if (!resumeCredentialRef.current || completedDraftRef.current) return false;
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

  const downloadOrganizerRecoveryBackup = useCallback(() => {
    if (!organizerRecoveryConflict?.archive) return false;
    const blob = new Blob([JSON.stringify(organizerRecoveryConflict.archive, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'questionnaire-page-recovery.json';
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }, [organizerRecoveryConflict]);

  const downloadCompletedRecoveryBackup = useCallback(() => {
    if (!completedRecoveryRef.current) return false;
    const url = URL.createObjectURL(new Blob([JSON.stringify(completedRecoveryRef.current, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'completed-questionnaire-unsaved-edits.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }, []);

  const startRevision = useCallback(async ({ includePreservedEdits = false } = {}) => {
    if (!completedDraftRef.current || revisionInFlightRef.current) return null;
    revisionInFlightRef.current = true;
    setIsStartingRevision(true); setRevisionStartError('');
    try {
      // Capture once; retrying a timeout uses the same request ID and seed.
      if (!revisionAttemptRef.current) {
        const storageKey = `pro_questionnaire_revision_attempt_${completedDraftRef.current.sessionId}`;
        let previous;
        try { previous = JSON.parse(safeLocalStorageGet(storageKey) || 'null'); } catch { previous = null; }
        const pending = previous?.draftId === completedDraftRef.current.draftId && !previous.acknowledged;
        const include = pending ? previous.includePreservedEdits : includePreservedEdits;
        const selected = include && completedRecoveryRef.current ? completedRecoveryRef.current : latestRef.current;
        const snapshot = pending ? previous.snapshot : structuredClone({ responses: selected.responses, validationStatus: selected.validationStatus, touchedQuestions: selected.touchedQuestions, expandedQuestions: selected.expandedQuestions, credentials: selected.credentials || latestRef.current.credentials });
        const requestId = pending ? previous.requestId : crypto.randomUUID();
        revisionAttemptRef.current = { requestId, resumeCredential: resumeCredentialRef.current, snapshot, includePreservedEdits: include };
        safeLocalStorageSet(storageKey, { requestId, draftId: completedDraftRef.current.draftId, snapshot, includePreservedEdits: include, acknowledged: false });
      }
      setRevisionRetryPending(true);
      const attempt = revisionAttemptRef.current;
      const snapshot = attempt.snapshot;
      writeLocalOutbox('starting_explicit_revision');
      const result = await startServerDraftRevision({
        functions: base44.functions, resumeCredential: attempt.resumeCredential, newRevisionRequestId: attempt.requestId,
        ...snapshot, currentQuestionId: lastChangedQuestionIdRef.current || '', lastChangedQuestionId: lastChangedQuestionIdRef.current || '',
        progressPercent: calculateProgress(snapshot.responses, totalQuestionCount),
        mappedPayload: transformResponsesToPayload(snapshot.responses, snapshot.credentials.businessName, snapshot.credentials.domain, serviceOptionsGrouped)
      });
      const draft = result.draft;
      if (!mountedRef.current || resumeCredentialRef.current !== attempt.resumeCredential) return null;
      if (draft.draftId === completedDraftRef.current?.draftId || (result.sourceDraftId && result.sourceDraftId !== completedDraftRef.current?.draftId)) {
        throw new Error('The new revision did not confirm a separate working draft. The original recovery link was retained.');
      }
      const normalized = normalizePersistedStateV3(draft);
      // Seed agreement is verified by the client contract before replacing any
      // original URL, refs, or browser answers. The original recovery copy stays.
      const credential = persistResumeCredential(result.resumeCredential);
      if (!credential) throw new Error('The new draft did not return a valid recovery link.');
      writeDraftFailureBackup({ questionnaireSessionId: draft.sessionId, ...normalized, changedKeys: [], deletedKeys: [], baseRevision: draft.revision, error: '' });
      safeLocalStorageSet(`pro_questionnaire_revision_attempt_${completedDraftRef.current.sessionId}`, { requestId: attempt.requestId, draftId: completedDraftRef.current.draftId, acknowledged: true, targetDraftId: draft.draftId, acknowledgedAt: safeNowIso() });
      removeNewClientLaunchParams();
      // Keep every mounted callback scoped to the old completed capability.
      // A fresh document bootstraps the new session from its confirmed seed.
      reloadForDraftRevision();
      return draft;
    } catch (error) {
      setRevisionStartError(error?.message || 'The new revision could not be confirmed. Your existing copy is retained.');
      return null;
    } finally { revisionInFlightRef.current = false; if (mountedRef.current) setIsStartingRevision(false); }
  }, [base44.functions, dispatch, serviceOptionsGrouped, totalQuestionCount, writeLocalOutbox]);

  return {
    isDraftReady,
    draftSaveState,
    lastSavedAt,
    lastConfirmedRevision,
    hasLocalRecoveryCopy,
    organizerRecoveryConflict,
    downloadOrganizerRecoveryBackup,
    draftConnection,
    questionnaireSessionId,
    restoredQuestionId,
    identityConflict,
    completedDraft,
    isStartingRevision,
    revisionStartError,
    revisionRetryPending,
    startRevision,
    downloadCompletedRecoveryBackup,
    queueDraftSave,
    saveDraftNow,
    updateDraftIdentity,
    retryDraftBootstrap,
    resolveIdentityConflict,
    getDraftResumeCredential: () => resumeCredentialRef.current,
    createDraftEvent
  };
};
