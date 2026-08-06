import { createMutationId } from '@/components/store/formMutationFactory';

const DELETE_FIELDS = Object.freeze({
  deleteResponseKeys: 'responses',
  deleteValidationKeys: 'validationStatus',
  deleteTouchedKeys: 'touchedQuestions',
  deleteExpandedKeys: 'expandedQuestions',
  deleteTextValidationMetaKeys: 'textValidationMeta',
  deleteUiDraftStateKeys: 'uiDraftState',
});

const SET_FIELDS = Object.freeze({
  setResponses: 'responses',
  setValidationStatus: 'validationStatus',
  setTouchedQuestions: 'touchedQuestions',
  setExpandedQuestions: 'expandedQuestions',
  setTextValidationMeta: 'textValidationMeta',
  setUiDraftState: 'uiDraftState',
});

const baseQuestionId = (value) => {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/_(?:other|primary)$/u, '') || null;
};

const change = (fieldPath, operation = 'set') => ({ fieldPath, operation });

const mapAtomicMutation = (action) => {
  const payload = action.payload || {};
  const changes = [];
  for (const [field, prefix] of Object.entries(DELETE_FIELDS)) {
    for (const key of payload[field] || []) changes.push(change(`${prefix}.${key}`, 'delete'));
  }
  for (const [field, prefix] of Object.entries(SET_FIELDS)) {
    for (const key of Object.keys(payload[field] || {})) changes.push(change(`${prefix}.${key}`));
  }
  if (payload.setCredentials) {
    for (const key of Object.keys(payload.setCredentials)) changes.push(change(`credentials.${key}`));
  }
  if (Object.hasOwn(payload, 'currentQuestionId')) changes.push(change('currentQuestionId'));
  if (Object.hasOwn(payload, 'lastChangedQuestionId')) changes.push(change('lastChangedQuestionId'));
  return {
    changes,
    reason: payload.mutationMetadata?.reason || 'system',
    mutationType: payload.mutationMetadata?.mutationType || 'form_mutation',
    mutationId: payload.mutationMetadata?.mutationId || null,
    questionId: baseQuestionId(payload.lastChangedQuestionId),
    alreadyRecorded: true,
  };
};

const mapReset = (payload = {}) => {
  const fields = [
    ['responseKeys', 'responses'],
    ['validationKeys', 'validationStatus'],
    ['touchedKeys', 'touchedQuestions'],
    ['expandedKeys', 'expandedQuestions'],
    ['textValidationMetaKeys', 'textValidationMeta'],
    ['uiDraftScopeKeys', 'uiDraftState'],
  ];
  return {
    changes: fields.flatMap(([field, prefix]) => (
      (payload[field] || []).map((key) => change(`${prefix}.${key}`, 'delete'))
    )),
    reason: 'question_reset',
    mutationType: 'question_reset',
    questionId: baseQuestionId(payload.responseKeys?.[0]),
  };
};

/** Maps a Redux action to safe post-reducer mutation metadata. */
export const mapProDraftActionToMutation = (action) => {
  const type = action?.type;
  const payload = action?.payload;
  if (type === 'form/applyFormMutation') return mapAtomicMutation(action);
  if (type === 'form/loadCanonicalDraftState') {
    return { hydration: true, skipSave: true, changes: [], reason: 'restore', mutationType: 'hydration' };
  }
  if (type === 'form/resetQuestionState') return mapReset(payload);
  if (type === 'form/setResponse') {
    return {
      changes: [change(`responses.${payload?.questionId}`)],
      reason: 'response_change',
      mutationType: 'response_set',
      questionId: baseQuestionId(payload?.questionId),
    };
  }
  if (type === 'form/setMultipleResponses') {
    const keys = Object.keys(payload || {});
    return {
      changes: keys.map((key) => change(`responses.${key}`)),
      reason: 'response_change',
      mutationType: 'responses_set',
      questionId: baseQuestionId(keys[0]),
    };
  }
  if (type === 'form/deleteResponse') {
    const questionId = baseQuestionId(payload);
    return {
      changes: [payload, `${payload}_other`, `${payload}_primary`]
        .map((key) => change(`responses.${key}`, 'delete')),
      reason: 'response_change',
      mutationType: 'response_delete',
      questionId,
    };
  }
  const singleMaps = {
    'form/setValidationStatus': ['validationStatus', 'validation_change', 'validation_set'],
    'form/setTouchedQuestion': ['touchedQuestions', 'touch_change', 'touch_set'],
    'form/setExpandedQuestion': ['expandedQuestions', 'expanded_change', 'expanded_set'],
    'form/setTextareaDirtyMeta': ['textValidationMeta', 'validation_change', 'text_validation_set'],
  };
  if (singleMaps[type]) {
    const [prefix, reason, mutationType] = singleMaps[type];
    return {
      changes: [change(`${prefix}.${payload?.questionId}`)],
      reason,
      mutationType,
      questionId: baseQuestionId(payload?.questionId),
    };
  }
  const multipleMaps = {
    'form/setMultipleValidationStatus': ['validationStatus', 'validation_change', 'validations_set'],
    'form/setAllExpanded': ['expandedQuestions', 'expanded_change', 'expanded_all'],
    'form/initializeExpandedQuestions': ['expandedQuestions', 'expanded_change', 'expanded_initialize'],
  };
  if (multipleMaps[type]) {
    const [prefix, reason, mutationType] = multipleMaps[type];
    const keys = Object.keys(payload || {});
    return {
      changes: keys.map((key) => change(`${prefix}.${key}`)),
      reason,
      mutationType,
      questionId: baseQuestionId(keys[0]),
    };
  }
  const uiMaps = {
    'form/setUiDraftState': 'ui_draft_set',
    'form/patchUiDraftState': 'ui_draft_patch',
    'form/clearUiDraftState': 'ui_draft_clear',
  };
  if (uiMaps[type]) {
    const operation = type === 'form/clearUiDraftState' ? 'delete' : 'set';
    const scopeKey = payload?.scopeKey;
    const questionId = /^question:([^:]+)/u.exec(scopeKey || '')?.[1] || null;
    return {
      changes: [change(`uiDraftState.${scopeKey}`, operation)],
      reason: 'ui_draft_change',
      mutationType: uiMaps[type],
      questionId,
    };
  }
  if (type === 'form/clearAllUiDraftState') {
    return {
      changes: [change('uiDraftState', 'delete')],
      reason: 'ui_draft_change',
      mutationType: 'ui_draft_clear_all',
      questionId: null,
    };
  }
  if (type === 'form/setCredentials') {
    return {
      changes: Object.keys(payload || {}).map((key) => change(`credentials.${key}`)),
      reason: 'credentials_change',
      mutationType: 'credentials_set',
      questionId: null,
    };
  }
  return null;
};

const REASON_PRIORITY = Object.freeze({
  question_reset: 7,
  conditional_cleanup: 6,
  response_change: 5,
  ui_draft_change: 4,
  validation_change: 3,
  touch_change: 2,
  expanded_change: 1,
  credentials_change: 1,
  system: 0,
});

/** Coalesces a synchronous action burst into one logical mutation. */
export const coalesceProDraftMutations = (entries, options = {}) => {
  const usable = (entries || []).filter((entry) => entry && !entry.skipSave);
  if (usable.length === 0) return null;
  const primary = usable.reduce((selected, entry) => (
    (REASON_PRIORITY[entry.reason] ?? 0) > (REASON_PRIORITY[selected.reason] ?? 0)
      ? entry : selected
  ), usable[0]);
  const unique = new Map();
  for (const entry of usable) {
    for (const item of entry.changes || []) unique.set(`${item.operation}:${item.fieldPath}`, item);
  }
  const alreadyRecorded = usable.length === 1 && usable[0].alreadyRecorded === true;
  return Object.freeze({
    changes: [...unique.values()],
    reason: primary.reason,
    mutationType: primary.mutationType,
    mutationId: primary.mutationId || createMutationId(options),
    occurredAtClient: new Date((options.now || Date.now)()).toISOString(),
    questionId: primary.questionId || usable.find((entry) => entry.questionId)?.questionId || null,
    alreadyRecorded,
  });
};

export const PRO_DRAFT_RELEVANT_ACTION_TYPES = Object.freeze(new Set([
  'form/setResponse',
  'form/setMultipleResponses',
  'form/deleteResponse',
  'form/setValidationStatus',
  'form/setMultipleValidationStatus',
  'form/setTouchedQuestion',
  'form/setExpandedQuestion',
  'form/setAllExpanded',
  'form/initializeExpandedQuestions',
  'form/setTextareaDirtyMeta',
  'form/setCredentials',
  'form/setUiDraftState',
  'form/patchUiDraftState',
  'form/clearUiDraftState',
  'form/clearAllUiDraftState',
  'form/applyFormMutation',
  'form/resetQuestionState',
  'form/loadCanonicalDraftState',
]));
