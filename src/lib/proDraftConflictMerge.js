import {
  cloneCanonicalDraftState,
  normalizeCanonicalDraftState,
} from './questionnaireDraftState.js';

export const PRO_DRAFT_MERGE_VERSION = 1;

export const DRAFT_MERGE_RESULTS = Object.freeze({
  MERGED: 'merged',
  SERVER_WINS: 'server_wins',
  LOCAL_WINS: 'local_wins',
  USER_CHOICE_REQUIRED: 'user_choice_required',
  INCOMPATIBLE: 'incompatible',
  INVALID: 'invalid',
});

export const DRAFT_CONFLICT_TYPES = Object.freeze({
  CONCURRENT_SET: 'concurrent_set',
  DELETE_VERSUS_SET: 'delete_versus_set',
  RESET_VERSUS_SET: 'reset_versus_set',
  CREDENTIAL: 'credential',
});

const MERGE_CATEGORIES = Object.freeze([
  'responses',
  'validationStatus',
  'touchedQuestions',
  'expandedQuestions',
  'textValidationMeta',
  'uiDraftState',
  'credentials',
]);
const TERMINAL_SERVER_STATUSES = new Set([
  'submitted', 'cleared_superseded', 'expired', 'deleted',
]);
const SECRET_PATH = /(?:token|recovery.?code|password|secret|authorization|private.?key)/iu;
const EMAIL_PATH = /email/iu;
const FILE_PATH = /(?:file|upload|attachment|document|url)/iu;
const MISSING = Symbol('missing');
const mergeSources = new WeakMap();

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const deepEqual = (left, right) => {
  if (left === MISSING || right === MISSING) return left === right;
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length
      && left.every((entry, index) => deepEqual(entry, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return deepEqual(leftKeys, rightKeys)
    && leftKeys.every((key) => deepEqual(left[key], right[key]));
};

const hasOwn = (value, key) => isPlainObject(value) && Object.hasOwn(value, key);

const getPath = (state, fieldPath) => {
  const segments = String(fieldPath).split('.');
  let current = state;
  for (const segment of segments) {
    if (!hasOwn(current, segment)) return MISSING;
    current = current[segment];
  }
  return current;
};

const setPath = (state, fieldPath, value) => {
  const segments = String(fieldPath).split('.');
  let current = state;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!isPlainObject(current[segment])) current[segment] = {};
    current = current[segment];
  }
  const leaf = segments.at(-1);
  if (value === MISSING) delete current[leaf];
  else current[leaf] = structuredCloneSafe(value);
};

const structuredCloneSafe = (value) => {
  if (value === MISSING) return MISSING;
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

const metadataFor = (state, fieldPath) => {
  const map = state?.fieldChangeMetadata || {};
  if (map[fieldPath]) return map[fieldPath];
  let parent = fieldPath;
  while (parent.includes('.')) {
    parent = parent.slice(0, parent.lastIndexOf('.'));
    if (map[parent]) return map[parent];
  }
  return null;
};

/**
 * Compare authoritative parts of per-field metadata. Client time is returned as
 * a diagnostic hint only and never decides a merge.
 */
export const compareFieldMetadata = (localMetadata, serverMetadata) => {
  const local = isPlainObject(localMetadata) ? localMetadata : null;
  const server = isPlainObject(serverMetadata) ? serverMetadata : null;
  if (!local && !server) return Object.freeze({ result: 'indeterminate', timestampHint: 0 });
  if (local?.mutationId && local.mutationId === server?.mutationId) {
    return Object.freeze({ result: 'equal', timestampHint: 0 });
  }
  const localServerRevision = Number.isSafeInteger(local?.serverRevision)
    ? local.serverRevision : 0;
  const serverServerRevision = Number.isSafeInteger(server?.serverRevision)
    ? server.serverRevision : 0;
  let result = 'concurrent';
  if (localServerRevision !== serverServerRevision) {
    result = localServerRevision > serverServerRevision ? 'local_newer' : 'server_newer';
  } else if (!local || !server) {
    result = 'indeterminate';
  }
  const localTime = Date.parse(local?.changedAtClient || '');
  const serverTime = Date.parse(server?.changedAtClient || '');
  const timestampHint = Number.isFinite(localTime) && Number.isFinite(serverTime)
    ? Math.sign(localTime - serverTime) : 0;
  return Object.freeze({ result, timestampHint });
};

const nestedMetadataExists = (states, prefix) => states.some((state) => (
  Object.keys(state?.fieldChangeMetadata || {}).some((path) => path.startsWith(`${prefix}.`))
));

const collectNestedPaths = (values, prefix, output) => {
  const keys = new Set();
  for (const value of values) {
    if (isPlainObject(value)) Object.keys(value).forEach((key) => keys.add(key));
  }
  if (keys.size === 0) {
    output.add(prefix);
    return;
  }
  for (const key of [...keys].sort()) {
    const path = `${prefix}.${key}`;
    const children = values.map((value) => (hasOwn(value, key) ? value[key] : MISSING));
    if (children.some(isPlainObject)) collectNestedPaths(children, path, output);
    else output.add(path);
  }
};

/** Return deterministic canonical value paths, excluding server-authoritative headers. */
export const collectChangedFieldPaths = (localInput, serverInput, baseInput = null) => {
  let local;
  let server;
  let base;
  try {
    local = normalizeCanonicalDraftState(localInput);
    server = normalizeCanonicalDraftState(serverInput);
    base = baseInput ? normalizeCanonicalDraftState(baseInput) : null;
  } catch {
    return Object.freeze([]);
  }
  const states = [local, server, ...(base ? [base] : [])];
  const output = new Set();
  for (const category of MERGE_CATEGORIES) {
    const keys = new Set(states.flatMap((state) => Object.keys(state[category] || {})));
    for (const key of [...keys].sort()) {
      const prefix = `${category}.${key}`;
      const values = states.map((state) => getPath(state, prefix));
      const recurse = category === 'uiDraftState'
        || (category === 'responses' && nestedMetadataExists(states, prefix));
      if (recurse && values.some(isPlainObject)) collectNestedPaths(values, prefix, output);
      else output.add(prefix);
    }
  }
  return Object.freeze([...output].sort());
};

const maskEmail = (value) => {
  const [local = '', domain = ''] = String(value).split('@');
  if (!domain) return 'Hidden email value';
  const shown = local.slice(0, 1);
  return `${shown}${'*'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
};

const safePreview = (fieldPath, value) => {
  if (value === MISSING) return 'Not set';
  if (SECRET_PATH.test(fieldPath)) return null;
  if (value === null) return 'Empty';
  if (EMAIL_PATH.test(fieldPath) && typeof value === 'string') return maskEmail(value);
  if (typeof value === 'string') {
    if (FILE_PATH.test(fieldPath) && /^(?:https?:|blob:)/iu.test(value)) {
      try {
        const name = new URL(value).pathname.split('/').filter(Boolean).at(-1);
        return name ? `File: ${decodeURIComponent(name).slice(0, 80)}` : 'File attached';
      } catch {
        return 'File attached';
      }
    }
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  if (Array.isArray(value)) return `List with ${value.length} item${value.length === 1 ? '' : 's'}`;
  if (isPlainObject(value)) return `Object with ${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`;
  return String(value);
};

const conflictTypeFor = (fieldPath, localValue, serverValue, localMetadata, serverMetadata) => {
  if (fieldPath.startsWith('credentials.')) return DRAFT_CONFLICT_TYPES.CREDENTIAL;
  const operations = new Set([localMetadata?.operation, serverMetadata?.operation]);
  if (operations.has('reset') && operations.has('set')) return DRAFT_CONFLICT_TYPES.RESET_VERSUS_SET;
  if ((localValue === MISSING) !== (serverValue === MISSING)) {
    return DRAFT_CONFLICT_TYPES.DELETE_VERSUS_SET;
  }
  return DRAFT_CONFLICT_TYPES.CONCURRENT_SET;
};

const questionIdFromPath = (fieldPath) => {
  if (!fieldPath.startsWith('responses.')) return null;
  return fieldPath.slice('responses.'.length).split('.')[0] || null;
};

const invalidResult = (result, warning) => Object.freeze({
  result,
  mergedState: null,
  conflicts: Object.freeze([]),
  adoptedLocalPaths: Object.freeze([]),
  adoptedServerPaths: Object.freeze([]),
  unchangedPaths: Object.freeze([]),
  warnings: Object.freeze([warning]),
});

const finalize = (payload, sources) => {
  const result = Object.freeze({
    ...payload,
    conflicts: Object.freeze(payload.conflicts.map(Object.freeze)),
    adoptedLocalPaths: Object.freeze([...payload.adoptedLocalPaths].sort()),
    adoptedServerPaths: Object.freeze([...payload.adoptedServerPaths].sort()),
    unchangedPaths: Object.freeze([...payload.unchangedPaths].sort()),
    warnings: Object.freeze([...new Set(payload.warnings)]),
  });
  mergeSources.set(result, sources);
  return result;
};

/** @param {{ localState?: any, serverState?: any, baseState?: any }} [input] */
export const mergeCanonicalDraftStates = async (input = {}) => {
  const { localState, serverState, baseState = null } = input;
  let local;
  let server;
  let base;
  try {
    local = normalizeCanonicalDraftState(localState);
    server = normalizeCanonicalDraftState(serverState);
    base = baseState ? normalizeCanonicalDraftState(baseState) : null;
  } catch {
    return invalidResult(DRAFT_MERGE_RESULTS.INVALID, 'CANONICAL_STATE_INVALID');
  }
  const identityMatches = local.formType === server.formType
    && local.draftId && local.draftId === server.draftId
    && local.sessionId && local.sessionId === server.sessionId
    && (!base || (base.draftId === local.draftId && base.sessionId === local.sessionId));
  if (!identityMatches) {
    return invalidResult(DRAFT_MERGE_RESULTS.INCOMPATIBLE, 'DRAFT_IDENTITY_MISMATCH');
  }
  if (TERMINAL_SERVER_STATUSES.has(server.draftStatus)) {
    return finalize({
      result: DRAFT_MERGE_RESULTS.SERVER_WINS,
      mergedState: cloneCanonicalDraftState(server),
      conflicts: [],
      adoptedLocalPaths: [],
      adoptedServerPaths: collectChangedFieldPaths(local, server, base),
      unchangedPaths: [],
      warnings: ['TERMINAL_SERVER_STATE_AUTHORITATIVE'],
    }, { local, server, base });
  }

  const paths = collectChangedFieldPaths(local, server, base);
  const merged = cloneCanonicalDraftState(server);
  const conflicts = [];
  const adoptedLocalPaths = [];
  const adoptedServerPaths = [];
  const unchangedPaths = [];
  const warnings = [];
  const adoptedMetadata = { ...server.fieldChangeMetadata };

  for (const fieldPath of paths) {
    const localValue = getPath(local, fieldPath);
    const serverValue = getPath(server, fieldPath);
    const baseValue = base ? getPath(base, fieldPath) : MISSING;
    const localMetadata = metadataFor(local, fieldPath);
    const serverMetadata = metadataFor(server, fieldPath);
    const same = deepEqual(localValue, serverValue);
    const localChanged = base ? !deepEqual(localValue, baseValue) : !same;
    const serverChanged = base ? !deepEqual(serverValue, baseValue) : !same;

    if (same) {
      unchangedPaths.push(fieldPath);
      continue;
    }
    if (fieldPath.startsWith('touchedQuestions.')
      && (localValue === true || serverValue === true)) {
      setPath(merged, fieldPath, true);
      if (localValue === true) adoptedLocalPaths.push(fieldPath);
      if (serverValue === true) adoptedServerPaths.push(fieldPath);
      continue;
    }
    if (fieldPath.startsWith('expandedQuestions.')) {
      setPath(merged, fieldPath, localValue);
      adoptedLocalPaths.push(fieldPath);
      continue;
    }
    if (base && localChanged && !serverChanged) {
      setPath(merged, fieldPath, localValue);
      adoptedLocalPaths.push(fieldPath);
      if (localMetadata) adoptedMetadata[fieldPath] = localMetadata;
      continue;
    }
    if (base && !localChanged && serverChanged) {
      adoptedServerPaths.push(fieldPath);
      continue;
    }
    const metadataComparison = compareFieldMetadata(localMetadata, serverMetadata);
    if (metadataComparison.result === 'local_newer') {
      setPath(merged, fieldPath, localValue);
      adoptedLocalPaths.push(fieldPath);
      if (localMetadata) adoptedMetadata[fieldPath] = localMetadata;
      continue;
    }
    if (metadataComparison.result === 'server_newer') {
      adoptedServerPaths.push(fieldPath);
      continue;
    }
    if (SECRET_PATH.test(fieldPath)) {
      return invalidResult(DRAFT_MERGE_RESULTS.INVALID, 'SECRET_BEARING_FIELD_REJECTED');
    }
    conflicts.push({
      conflictId: `conflict_${conflicts.length + 1}`,
      fieldPath,
      conflictType: conflictTypeFor(
        fieldPath, localValue, serverValue, localMetadata, serverMetadata,
      ),
      localChanged,
      serverChanged,
      localPreview: safePreview(fieldPath, localValue),
      serverPreview: safePreview(fieldPath, serverValue),
      localMetadata: localMetadata ? { ...localMetadata } : null,
      serverMetadata: serverMetadata ? { ...serverMetadata } : null,
    });
  }

  merged.fieldChangeMetadata = adoptedMetadata;
  merged.currentQuestionId = local.currentQuestionId;
  merged.draftStatus = server.draftStatus;
  merged.submission = structuredCloneSafe(server.submission);
  merged.serverRevision = server.serverRevision;
  merged.clientRevision = Math.max(local.clientRevision, server.clientRevision);
  const latestLocalMutationAdopted = adoptedLocalPaths.length > 0;
  merged.lastMutation = latestLocalMutationAdopted ? local.lastMutation : server.lastMutation;
  merged.lastChangedQuestionId = latestLocalMutationAdopted
    ? (questionIdFromPath(adoptedLocalPaths.at(-1)) || local.lastChangedQuestionId)
    : server.lastChangedQuestionId;
  const normalizedMerged = normalizeCanonicalDraftState(merged);
  /** @type {string} */
  let result = DRAFT_MERGE_RESULTS.MERGED;
  if (conflicts.length > 0) result = DRAFT_MERGE_RESULTS.USER_CHOICE_REQUIRED;
  else if (adoptedLocalPaths.length > 0 && adoptedServerPaths.length === 0) {
    result = DRAFT_MERGE_RESULTS.LOCAL_WINS;
  } else if (adoptedServerPaths.length > 0 && adoptedLocalPaths.length === 0) {
    result = DRAFT_MERGE_RESULTS.SERVER_WINS;
  }
  if (!base) warnings.push('BASE_STATE_UNAVAILABLE_METADATA_ONLY');
  return finalize({
    result,
    mergedState: normalizedMerged,
    conflicts,
    adoptedLocalPaths,
    adoptedServerPaths,
    unchangedPaths,
    warnings,
  }, { local, server, base });
};

const KEEP_BOTH_PREFIXES = Object.freeze(['responses']);

export const validateConflictChoice = (conflict, choice) => {
  const selected = typeof choice === 'string' ? choice : choice?.choice;
  if (!conflict || typeof conflict.conflictId !== 'string') {
    return Object.freeze({ valid: false, errorCode: 'CONFLICT_INVALID' });
  }
  if (selected === 'keep_local' || selected === 'keep_server') {
    return Object.freeze({ valid: true, choice: selected, errorCode: null });
  }
  if (selected === 'keep_both'
    && KEEP_BOTH_PREFIXES.some((prefix) => conflict.fieldPath.startsWith(`${prefix}.`))) {
    return Object.freeze({ valid: true, choice: selected, errorCode: null });
  }
  return Object.freeze({ valid: false, errorCode: 'CONFLICT_CHOICE_INVALID' });
};

export const applyConflictChoices = async (mergeResult, choices = {}) => {
  const sources = mergeSources.get(mergeResult);
  if (!sources || mergeResult?.result !== DRAFT_MERGE_RESULTS.USER_CHOICE_REQUIRED) {
    return invalidResult(DRAFT_MERGE_RESULTS.INVALID, 'MERGE_RESULT_INVALID');
  }
  const merged = cloneCanonicalDraftState(mergeResult.mergedState);
  const adoptedLocalPaths = [...mergeResult.adoptedLocalPaths];
  const adoptedServerPaths = [...mergeResult.adoptedServerPaths];
  for (const conflict of mergeResult.conflicts) {
    const rawChoice = choices[conflict.conflictId] ?? choices[conflict.fieldPath];
    const validation = validateConflictChoice(conflict, rawChoice);
    if (!validation.valid) {
      return invalidResult(DRAFT_MERGE_RESULTS.INVALID, validation.errorCode);
    }
    const localValue = getPath(sources.local, conflict.fieldPath);
    const serverValue = getPath(sources.server, conflict.fieldPath);
    if (validation.choice === 'keep_local') {
      setPath(merged, conflict.fieldPath, localValue);
      adoptedLocalPaths.push(conflict.fieldPath);
    } else if (validation.choice === 'keep_server') {
      setPath(merged, conflict.fieldPath, serverValue);
      adoptedServerPaths.push(conflict.fieldPath);
    } else {
      if (!Array.isArray(localValue) || !Array.isArray(serverValue)) {
        return invalidResult(DRAFT_MERGE_RESULTS.INVALID, 'KEEP_BOTH_UNSUPPORTED');
      }
      const deduped = [...serverValue, ...localValue].filter((entry, index, all) => (
        all.findIndex((candidate) => deepEqual(candidate, entry)) === index
      ));
      setPath(merged, conflict.fieldPath, deduped);
      adoptedLocalPaths.push(conflict.fieldPath);
      adoptedServerPaths.push(conflict.fieldPath);
    }
  }
  merged.currentQuestionId = sources.local.currentQuestionId;
  merged.draftStatus = sources.server.draftStatus;
  merged.submission = structuredCloneSafe(sources.server.submission);
  merged.serverRevision = sources.server.serverRevision;
  return finalize({
    result: DRAFT_MERGE_RESULTS.MERGED,
    mergedState: normalizeCanonicalDraftState(merged),
    conflicts: [],
    adoptedLocalPaths,
    adoptedServerPaths,
    unchangedPaths: mergeResult.unchangedPaths,
    warnings: mergeResult.warnings,
  }, sources);
};

export const getSafeMergeDiagnostics = (mergeResult) => Object.freeze({
  version: PRO_DRAFT_MERGE_VERSION,
  result: Object.values(DRAFT_MERGE_RESULTS).includes(mergeResult?.result)
    ? mergeResult.result : DRAFT_MERGE_RESULTS.INVALID,
  conflictCount: Array.isArray(mergeResult?.conflicts) ? mergeResult.conflicts.length : 0,
  adoptedLocalCount: Array.isArray(mergeResult?.adoptedLocalPaths)
    ? mergeResult.adoptedLocalPaths.length : 0,
  adoptedServerCount: Array.isArray(mergeResult?.adoptedServerPaths)
    ? mergeResult.adoptedServerPaths.length : 0,
  warningCount: Array.isArray(mergeResult?.warnings) ? mergeResult.warnings.length : 0,
  exposesValues: false,
  usesClientTimestampsAuthoritatively: false,
});
