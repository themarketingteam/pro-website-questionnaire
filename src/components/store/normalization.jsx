import { QUESTIONS } from '@/components/pro-form/questionData';
import { getAllQuestionIds, getQuestionById } from '@/components/pro-form/questionUtils';
import {
  DRAFT_STATE_SOURCE_TYPES,
  DEFAULT_DRAFT_IDENTITY_CONTEXT,
  PRO_FORM_DRAFT_SCHEMA_VERSION,
  createEmptyCanonicalDraftState,
  normalizeCanonicalDraftState,
} from '@/lib/questionnaireDraftState';

function uniqArray(arr) {
  return Array.from(new Set(arr || []));
}

export const createEmptyPersistedQuestionnaireState = () => ({
  responses: {},
  validationStatus: {},
  touchedQuestions: {},
  expandedQuestions: {},
  textValidationMeta: {},
  credentials: {},
  uiDraftState: {},
  fieldChangeMetadata: {},
  draftContext: {
    draftId: null,
    sessionId: null,
    draftStatus: 'active',
    schemaVersion: PRO_FORM_DRAFT_SCHEMA_VERSION,
    clientRevision: 0,
    serverRevision: 0,
    sourceTabId: null,
    namespace: null,
    restoredFrom: null,
    lastStateHash: null,
    ...DEFAULT_DRAFT_IDENTITY_CONTEXT,
  },
  currentQuestionId: null,
  lastChangedQuestionId: null,
  lastMutation: null,
  submittedReceipt: null,
});

const isPlainRecord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export function normalizePersistedState(state) {
  if (!state || typeof state !== 'object') {
    return createEmptyPersistedQuestionnaireState();
  }

  const knownIds = new Set(getAllQuestionIds(QUESTIONS));
  const allowedResponseKeys = new Set();
  knownIds.forEach((id) => {
    allowedResponseKeys.add(id);
    allowedResponseKeys.add(`${id}_other`);
    allowedResponseKeys.add(`${id}_primary`);
  });

  const next = { ...state };
  next.responses = { ...(state.responses || {}) };
  next.validationStatus = { ...(state.validationStatus || {}) };
  next.touchedQuestions = { ...(state.touchedQuestions || {}) };
  next.expandedQuestions = { ...(state.expandedQuestions || {}) };

  // Dev-only guardrails: capture pre-state and define self-checks to prevent regression of migration order
  const __pre = {
    responses: { ...(state.responses || {}) },
  };
  const __isDev = (() => {
    try {
      // Prefer Vite env flag; also allow URL opt-in for manual checks
      const byUrl = typeof window !== 'undefined' && /(?:redux-data|norm-debug)=true/.test(window.location.search || '');
      return Boolean(byUrl);
    } catch { return false; }
  })();
  const __shallowEqual = (a, b) => {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
  };

  // STAGE 1 — Pre-cleanup legacy certification migration
  // IMPORTANT: Question 1.2.1 was removed from the active schema, so unknown-key cleanup would delete
  // responses['1.2.1'] before we could use it. We must migrate into canonical 12/12.1 first, then strip
  // legacy mirrors. This order protects against accidental reordering in future edits.
  const legacyCertList = next.responses?.['1.2.1'];
  const canonicalCertList = next.responses?.['12.1'];
  if (Array.isArray(legacyCertList) && legacyCertList.length > 0) {
    if (!Array.isArray(canonicalCertList) || canonicalCertList.length === 0) {
      next.responses['12.1'] = legacyCertList;
    }
  }
  const legacyCertYesNo = next.responses?.['1.2'];
  const canonicalYesNo = next.responses?.['12'];
  if (legacyCertYesNo === 'yes' || legacyCertYesNo === 'no') {
    if (canonicalYesNo !== 'yes' && canonicalYesNo !== 'no') {
      next.responses['12'] = legacyCertYesNo;
    }
  }
  // Remove legacy mirror fields post-migration across all slices
  ['1.2', '1.2.1'].forEach((legacyId) => {
    if (legacyId in next.responses) delete next.responses[legacyId];
    if (legacyId in next.validationStatus) delete next.validationStatus[legacyId];
    if (legacyId in next.touchedQuestions) delete next.touchedQuestions[legacyId];
    if (legacyId in next.expandedQuestions) delete next.expandedQuestions[legacyId];
  });

  // STAGE 2 — Schema cleanup: remove unknown keys across slices (after migration)
  Object.keys(next.responses).forEach((k) => {
    if (!allowedResponseKeys.has(k)) delete next.responses[k];
  });
  Object.keys(next.validationStatus).forEach((k) => {
    if (!knownIds.has(k)) delete next.validationStatus[k];
  });
  Object.keys(next.touchedQuestions).forEach((k) => {
    if (!knownIds.has(k)) delete next.touchedQuestions[k];
  });
  Object.keys(next.expandedQuestions).forEach((k) => {
    if (!knownIds.has(k)) delete next.expandedQuestions[k];
  });

  // Helpers for type checks
  const getType = (id) => getQuestionById(QUESTIONS, id)?.type;
  const getOptions = (id) => getQuestionById(QUESTIONS, id)?.options || [];
  const getShowOther = (id) => !!getQuestionById(QUESTIONS, id)?.showOther;

  // STAGE 3 — Type/value normalization by schema
  knownIds.forEach((id) => {
    const type = getType(id);
    if (!type) return;

    let val = next.responses[id];

    switch (type) {
      case 'yes_no': {
        if (val !== 'yes' && val !== 'no') {
          delete next.responses[id];
        }
        break;
      }

      case 'radio': {
        const opts = getOptions(id);
        const showOther = getShowOther(id);
        if (typeof val === 'string' && opts.includes(val)) {
          // ok
        } else if (showOther && typeof val === 'string' && val.trim() && !opts.includes(val)) {
          // Move legacy custom value to _other and set main to Other
          if (!next.responses[`${id}_other`] || !String(next.responses[`${id}_other`]).trim()) {
            next.responses[`${id}_other`] = String(val);
          }
          next.responses[id] = 'Other';
        } else if (val === 'Other') {
          // Ensure _other key exists (even if empty) so UI treats as incomplete
          if (next.responses[`${id}_other`] == null) next.responses[`${id}_other`] = '';
        } else if (val == null || val === '') {
          // leave empty
        } else {
          // invalid -> clear
          delete next.responses[id];
        }
        break;
      }

      case 'checkbox': {
        const opts = new Set(getOptions(id));
        const arr = Array.isArray(val) ? val.slice() : [];
        const keep = [];
        arr.forEach((v) => {
          if (typeof v !== 'string') return;
          if (id === '3' && v.startsWith('CATEGORY:')) { keep.push(v); return; }
          if (opts.has(v)) keep.push(v);
        });
        next.responses[id] = uniqArray(keep);
        // _other may be string or array; normalize to array of non-empty strings when max is set in UI else keep string
        // Here, just coerce array types safely if exists
        const otherKey = `${id}_other`;
        if (otherKey in next.responses) {
          const o = next.responses[otherKey];
          if (Array.isArray(o)) {
            next.responses[otherKey] = o.map(s => String(s || '').trim()).filter(Boolean);
          } else if (typeof o === 'string') {
            next.responses[otherKey] = String(o);
          } else {
            delete next.responses[otherKey];
          }
        }
        break;
      }

      case 'multi_certification':
      case 'multi_guarantee':
      case 'multi_text': {
        if (!Array.isArray(val)) next.responses[id] = [];
        break;
      }

      case 'image_tagging': {
        // Must be an object with url/tags; if malformed leave as-is (UI can handle) or clear when nonsense
        if (val && typeof val === 'object') {
          // ok
        } else if (val != null) {
          delete next.responses[id];
        }
        break;
      }

      default:
        // textarea, numeric_range, file_upload: leave as-is
        break;
    }
  });

  // 6) Conditional children clean-up if parent !== 'yes'
  QUESTIONS.forEach((q) => {
    if (Array.isArray(q.conditionalChildren)) {
      q.conditionalChildren.forEach((child) => {
        const parentVal = next.responses[q.id];
        if (parentVal !== 'yes') {
          // Clear validation, collapse UI
          if (child.id in next.validationStatus) next.validationStatus[child.id] = '';
          next.expandedQuestions[child.id] = false;
        }
      });
    }
  });

  // Finally, ensure child keys present in slices are only for known child ids
  Object.keys(next.validationStatus).forEach((k) => {
    if (!knownIds.has(k)) delete next.validationStatus[k];
  });

  // Dev-only self-checks to ensure migration happened before cleanup and canonical preservation
  if (__isDev) {
    try {
      const hadLegacyList = Array.isArray(__pre.responses['1.2.1']) && __pre.responses['1.2.1'].length > 0;
      const hadLegacyYesNo = __pre.responses['1.2'] === 'yes' || __pre.responses['1.2'] === 'no';
      const preCanonListEmpty = !Array.isArray(__pre.responses['12.1']) || __pre.responses['12.1'].length === 0;
      const preCanonYesNoEmpty = !(__pre.responses['12'] === 'yes' || __pre.responses['12'] === 'no');

      if (hadLegacyList && preCanonListEmpty) {
        if (!(Array.isArray(next.responses['12.1']) && next.responses['12.1'].length > 0)) {
          console.warn('[normalizePersistedState][guard] Expected legacy 1.2.1 to migrate into 12.1, but 12.1 is empty.');
        }
        if ('1.2.1' in next.responses) {
          console.warn('[normalizePersistedState][guard] Legacy key 1.2.1 survived post-migration cleanup.');
        }
      }
      if (hadLegacyYesNo && preCanonYesNoEmpty) {
        if (!(next.responses['12'] === 'yes' || next.responses['12'] === 'no')) {
          console.warn('[normalizePersistedState][guard] Expected legacy 1.2 to migrate into 12.');
        }
        if ('1.2' in next.responses) {
          console.warn('[normalizePersistedState][guard] Legacy key 1.2 survived post-migration cleanup.');
        }
      }
      // Canonical preservation when already populated
      if (Array.isArray(__pre.responses['12.1']) && __pre.responses['12.1'].length > 0 && '1.2.1' in (__pre.responses)) {
        if (!__shallowEqual(next.responses['12.1'], __pre.responses['12.1'])) {
          console.warn('[normalizePersistedState][guard] Canonical 12.1 changed despite being pre-populated (should be preserved).');
        }
      }
      if ((__pre.responses['12'] === 'yes' || __pre.responses['12'] === 'no') && '1.2' in (__pre.responses)) {
        if (next.responses['12'] !== __pre.responses['12']) {
          console.warn('[normalizePersistedState][guard] Canonical 12 changed despite being pre-populated (should be preserved).');
        }
      }
    } catch {
      // Never break production behavior
    }
  }

  return next;
}

// v3 migration: aggressively sanitize optional conditional children and self-heal bad sessions
export function normalizePersistedStateV3(state) {
  // Guard: if state is completely missing or malformed, return a safe empty baseline
  // so that transformResponsesToPayload never receives undefined/null responses
  if (!state || typeof state !== 'object') {
    return createEmptyPersistedQuestionnaireState();
  }

  const base = normalizePersistedState(state);
  if (!base || typeof base !== 'object') return base;

  const next = {
    ...base,
    responses: { ...(base.responses || {}) },
    validationStatus: { ...(base.validationStatus || {}) },
    touchedQuestions: { ...(base.touchedQuestions || {}) },
    expandedQuestions: { ...(base.expandedQuestions || {}) },
    textValidationMeta: { ...(base.textValidationMeta || {}) },
    uiDraftState: { ...(base.uiDraftState || {}) },
    fieldChangeMetadata: { ...(base.fieldChangeMetadata || {}) },
  };

  const clearHiddenChild = (childId) => {
    delete next.responses[childId];
    delete next.responses[`${childId}_other`];
    delete next.responses[`${childId}_primary`];
    delete next.validationStatus[childId];
    delete next.touchedQuestions[childId];
    delete next.expandedQuestions[childId];
    delete next.textValidationMeta[childId];
    for (const scope of Object.keys(next.uiDraftState)) {
      if (scope === `question:${childId}` || scope.startsWith(`question:${childId}:`)) {
        delete next.uiDraftState[scope];
      }
    }
    for (const fieldPath of Object.keys(next.fieldChangeMetadata)) {
      if (
        fieldPath === `responses.${childId}`
        || fieldPath === `responses.${childId}_other`
        || fieldPath === `responses.${childId}_primary`
        || fieldPath.endsWith(`Questions.${childId}`)
        || fieldPath === `textValidationMeta.${childId}`
      ) delete next.fieldChangeMetadata[fieldPath];
    }
    if (next.currentQuestionId === childId) next.currentQuestionId = null;
    if (next.lastChangedQuestionId === childId) next.lastChangedQuestionId = null;
  };

  // Generic rule set
  QUESTIONS.forEach((parent) => {
    if (!Array.isArray(parent.conditionalChildren)) return;
    const parentVal = next.responses[parent.id];
    parent.conditionalChildren.forEach((child) => {
      const isRequired = !!child.requiredIfParentYes;
      const childVal = next.responses[child.id];
      if (parentVal !== 'yes') {
        clearHiddenChild(child.id);
      } else {
        // Parent is yes
        const childType = getQuestionById(QUESTIONS, child.id)?.type;
        if (!isRequired && childType === 'textarea') {
          const empty = !childVal || (typeof childVal === 'string' && childVal.trim().length === 0);
          if (empty) {
            // Keep neutral and collapsed by default
            if (child.id in next.validationStatus) next.validationStatus[child.id] = '';
            next.expandedQuestions[child.id] = false;
            if (child.id in next.touchedQuestions) delete next.touchedQuestions[child.id];
          }
        }
      }
    });
  });

  // Explicitly ensure recovery for 23.1 and 25.1
  const fixOptional = (parentId, childId) => {
    const parentVal = next.responses[parentId];
    const val = next.responses[childId];
    if (parentVal !== 'yes') {
      clearHiddenChild(childId);
    } else {
      const empty = !val || (typeof val === 'string' && val.trim().length === 0);
      if (empty) {
        if (childId in next.validationStatus) next.validationStatus[childId] = '';
        next.expandedQuestions[childId] = false;
        if (childId in next.touchedQuestions) delete next.touchedQuestions[childId];
      }
    }
  };
  fixOptional('23', '23.1');
  fixOptional('25', '25.1');

  return next;
}

// Redux Persist passes its complete persisted form payload to this boundary.
// Every recoverable category is normalized as one form before Redux sees it.
// Unknown fields and volatile bootstrap/sync state are intentionally excluded.
export function normalizePersistedQuestionnaireState(state) {
  if (!isPlainRecord(state)) return createEmptyPersistedQuestionnaireState();

  const requiredMapFields = [
    'responses',
    'validationStatus',
    'touchedQuestions',
    'expandedQuestions',
    'textValidationMeta',
  ];
  if (requiredMapFields.some((field) => (
    state[field] !== undefined && !isPlainRecord(state[field])
  ))) {
    return createEmptyPersistedQuestionnaireState();
  }

  const approvedState = {
    responses: isPlainRecord(state.responses) ? state.responses : {},
    validationStatus: isPlainRecord(state.validationStatus) ? state.validationStatus : {},
    touchedQuestions: isPlainRecord(state.touchedQuestions) ? state.touchedQuestions : {},
    expandedQuestions: isPlainRecord(state.expandedQuestions) ? state.expandedQuestions : {},
    textValidationMeta: isPlainRecord(state.textValidationMeta) ? state.textValidationMeta : {},
    credentials: isPlainRecord(state.credentials) ? state.credentials : {},
    uiDraftState: isPlainRecord(state.uiDraftState) ? state.uiDraftState : {},
    fieldChangeMetadata: isPlainRecord(state.fieldChangeMetadata)
      ? state.fieldChangeMetadata
      : {},
    draftContext: isPlainRecord(state.draftContext) ? state.draftContext : {},
    currentQuestionId: state.currentQuestionId ?? null,
    lastChangedQuestionId: state.lastChangedQuestionId ?? null,
    lastMutation: isPlainRecord(state.lastMutation) ? state.lastMutation : null,
    submittedReceipt: isPlainRecord(state.submittedReceipt) ? state.submittedReceipt : null,
  };

  try {
    const normalized = normalizePersistedStateV3(approvedState);
    if (!isPlainRecord(normalized)) return createEmptyPersistedQuestionnaireState();
    const context = normalized.draftContext || {};
    const receipt = normalized.submittedReceipt;
    const canonical = normalizeCanonicalDraftState({
      ...createEmptyCanonicalDraftState(),
      schemaVersion: context.schemaVersion ?? PRO_FORM_DRAFT_SCHEMA_VERSION,
      draftId: context.draftId ?? null,
      sessionId: context.sessionId ?? null,
      draftStatus: context.draftStatus || 'active',
      clientRevision: context.clientRevision ?? 0,
      serverRevision: context.serverRevision ?? 0,
      sourceTabId: context.sourceTabId ?? null,
      responses: normalized.responses || {},
      validationStatus: normalized.validationStatus || {},
      touchedQuestions: normalized.touchedQuestions || {},
      expandedQuestions: normalized.expandedQuestions || {},
      textValidationMeta: normalized.textValidationMeta || {},
      credentials: normalized.credentials || {},
      identityContext: Object.fromEntries(Object.keys(DEFAULT_DRAFT_IDENTITY_CONTEXT).map(
        (field) => [field, context[field] ?? DEFAULT_DRAFT_IDENTITY_CONTEXT[field]],
      )),
      uiDraftState: normalized.uiDraftState || {},
      fieldChangeMetadata: normalized.fieldChangeMetadata || {},
      currentQuestionId: normalized.currentQuestionId ?? null,
      lastChangedQuestionId: normalized.lastChangedQuestionId ?? null,
      lastMutation: normalized.lastMutation ?? null,
      submission: {
        finalSubmissionId: receipt?.finalSubmissionId ?? null,
        submittedAt: receipt?.submittedAt ?? null,
        submittedStateHash: receipt?.submittedStateHash ?? null,
        pdfSourceStateHash: receipt?.pdfSourceStateHash ?? null,
        lastSubmissionErrorCode: null,
      },
      compatibility: {
        sourceType: state?._persist?.version === 4
          ? DRAFT_STATE_SOURCE_TYPES.REDUX_PERSIST_V4
          : DRAFT_STATE_SOURCE_TYPES.REDUX_PERSIST_V3,
        sourceVersion: Number.isSafeInteger(state?._persist?.version)
          ? state._persist.version
          : 3,
        migratedAtClient: null,
        migrationWarnings: [],
      },
    });
    const namespace = /^ns_[a-f\d]{32}$/.test(String(context.namespace || ''))
      ? context.namespace
      : null;
    const restoredFrom = ['none', 'browser', 'server', 'merged', 'legacy', 'submitted_receipt']
      .includes(context.restoredFrom)
      ? context.restoredFrom
      : null;
    const lastStateHash = /^[a-f0-9]{64}$/.test(String(context.lastStateHash || ''))
      ? context.lastStateHash
      : null;
    return {
      responses: canonical.responses,
      validationStatus: canonical.validationStatus,
      touchedQuestions: canonical.touchedQuestions,
      expandedQuestions: canonical.expandedQuestions,
      textValidationMeta: canonical.textValidationMeta,
      credentials: canonical.credentials,
      uiDraftState: canonical.uiDraftState,
      fieldChangeMetadata: canonical.fieldChangeMetadata,
      draftContext: {
        draftId: canonical.draftId,
        sessionId: canonical.sessionId,
        draftStatus: canonical.draftStatus,
        schemaVersion: canonical.schemaVersion,
        clientRevision: canonical.clientRevision,
        serverRevision: canonical.serverRevision,
        sourceTabId: canonical.sourceTabId,
        namespace,
        restoredFrom,
        lastStateHash,
        ...canonical.identityContext,
      },
      currentQuestionId: canonical.currentQuestionId,
      lastChangedQuestionId: canonical.lastChangedQuestionId,
      lastMutation: canonical.lastMutation,
      submittedReceipt: (
        canonical.draftStatus === 'submitted'
        || canonical.submission.finalSubmissionId
        || canonical.submission.submittedAt
      ) ? {
          draftId: canonical.draftId,
          finalSubmissionId: canonical.submission.finalSubmissionId,
          submittedAt: canonical.submission.submittedAt,
          submittedStateHash: canonical.submission.submittedStateHash,
          pdfSourceStateHash: canonical.submission.pdfSourceStateHash,
          pdfAvailable: receipt?.pdfAvailable === true,
          submissionLockPending: receipt?.submissionLockPending === true,
        } : null,
    };
  } catch {
    return createEmptyPersistedQuestionnaireState();
  }
}
