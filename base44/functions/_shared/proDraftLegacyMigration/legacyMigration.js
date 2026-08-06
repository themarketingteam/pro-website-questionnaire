export const PRO_DRAFT_LEGACY_MIGRATION_VERSION = 1;
export const PRO_DRAFT_CANONICAL_SCHEMA_VERSION = 4;

export const LEGACY_RECORD_CLASSIFICATIONS = Object.freeze({
  ALREADY_CURRENT: 'already_current',
  LEGACY_COMPLETE: 'legacy_complete',
  LEGACY_PARTIAL: 'legacy_partial',
  LEGACY_MALFORMED_NONCRITICAL: 'legacy_malformed_noncritical',
  LEGACY_MALFORMED_CRITICAL: 'legacy_malformed_critical',
  SUBMITTED_LEGACY: 'submitted_legacy',
  SUBMIT_FAILED_LEGACY: 'submit_failed_legacy',
  SUPERSEDED_LEGACY: 'superseded_legacy',
  DUPLICATE_CANDIDATE: 'duplicate_candidate',
  MANUAL_REVIEW_REQUIRED: 'manual_review_required',
  UNSUPPORTED_FUTURE_VERSION: 'unsupported_future_version',
});

export const LEGACY_MIGRATION_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'LEGACY_MIGRATION_INVALID_INPUT',
  MALFORMED_CRITICAL_JSON: 'LEGACY_MIGRATION_MALFORMED_CRITICAL_JSON',
  UNSUPPORTED_FUTURE_VERSION: 'LEGACY_MIGRATION_UNSUPPORTED_FUTURE_VERSION',
  AMBIGUOUS_DUPLICATE: 'LEGACY_MIGRATION_AMBIGUOUS_DUPLICATE',
  UNSAFE_REPORT: 'LEGACY_MIGRATION_UNSAFE_REPORT',
});

const CURRENT_FIELDS = Object.freeze([
  'form_type', 'draft_schema_version', 'draft_state_json',
  'text_validation_meta_json', 'ui_draft_state_json',
  'field_change_metadata_json', 'credentials_json', 'client_revision',
  'server_revision', 'state_hash',
]);
const JSON_FIELDS = Object.freeze([
  ['responses_json', 'responses', true],
  ['validation_status_json', 'validationStatus', false],
  ['touched_questions_json', 'touchedQuestions', false],
  ['expanded_questions_json', 'expandedQuestions', false],
  ['metadata_json', 'metadata', false],
  ['userdata_json', 'userdata', false],
  ['mapped_payload_json', 'mappedPayload', false],
  ['draft_metadata_json', 'draftMetadata', false],
  ['text_validation_meta_json', 'textValidationMeta', false],
  ['ui_draft_state_json', 'uiDraftState', false],
  ['field_change_metadata_json', 'fieldChangeMetadata', false],
  ['credentials_json', 'credentials', false],
]);
const HASH = /^[0-9a-f]{64}$/u;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const SUBMITTED = new Set(['submitted']);
const SUPERSEDED = new Set(['superseded', 'cleared_superseded', 'expired', 'deleted']);
const ACTIVE = new Set(['', 'draft', 'active', 'submit_attempted', 'submit_failed']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const stringOrNull = (value) => nonempty(value) ? value.trim() : null;
const unique = (values) => [...new Set(values)].sort();

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => [key, stable(value[key])]));
}

export function stableLegacySerialize(value) {
  return JSON.stringify(stable(value));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function byteSize(value) {
  return new TextEncoder().encode(stableLegacySerialize(value)).byteLength;
}

function parseObjectField(record, field, label, critical, warnings, errors) {
  const source = record[field];
  if (source === undefined || source === null || source === '') return {};
  try {
    const parsed = typeof source === 'string' ? JSON.parse(source) : source;
    if (isObject(parsed)) return parsed;
  } catch {
    // Only a code is retained. Raw content never enters diagnostics.
  }
  const code = `MALFORMED_${label.replace(/([a-z])([A-Z])/gu, '$1_$2').toUpperCase()}`;
  warnings.push(code);
  if (critical) errors.push(LEGACY_MIGRATION_ERROR_CODES.MALFORMED_CRITICAL_JSON);
  return {};
}

function normalizeEmail(value) {
  if (!nonempty(value)) return null;
  const normalized = value.trim().normalize('NFKC').toLowerCase();
  return normalized.length <= 254 && EMAIL.test(normalized) ? normalized : null;
}

function normalizeStatus(value, warnings) {
  const status = nonempty(value) ? value.trim().toLowerCase() : '';
  if (status === '' || status === 'draft') {
    warnings.push('LEGACY_STATUS_NORMALIZED_ACTIVE');
    return 'active';
  }
  if (status === 'superseded') return 'cleared_superseded';
  return status;
}

function isFuture(record) {
  return (Number.isFinite(record.draft_schema_version)
      && record.draft_schema_version > PRO_DRAFT_CANONICAL_SCHEMA_VERSION)
    || (Number.isFinite(record.migration_version)
      && record.migration_version > PRO_DRAFT_LEGACY_MIGRATION_VERSION);
}

function currentCanonical(record) {
  if (!nonempty(record.draft_state_json)) return null;
  try {
    const parsed = JSON.parse(record.draft_state_json);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validCurrent(record) {
  const canonical = currentCanonical(record);
  return canonical
    && canonical.schemaVersion === PRO_DRAFT_CANONICAL_SCHEMA_VERSION
    && record.draft_schema_version === PRO_DRAFT_CANONICAL_SCHEMA_VERSION
    && CURRENT_FIELDS.every((field) => record[field] !== undefined && record[field] !== null
      && record[field] !== '')
    && HASH.test(String(record.state_hash || ''));
}

function allowlistedCredentials(record, recoveryEmail) {
  const output = {};
  for (const [target, source] of [
    ['businessName', 'business_name'], ['domain', 'domain'],
    ['userId', 'user_id'], ['userName', 'user_name'],
  ]) {
    if (nonempty(record[source])) output[target] = record[source].trim();
  }
  if (recoveryEmail) output.recoveryEmail = recoveryEmail;
  return output;
}

function allowlistedLegacyCredentialObject(value) {
  if (!isObject(value)) return {};
  const output = {};
  for (const key of ['businessName', 'domain', 'userId', 'userName']) {
    if (nonempty(value[key])) output[key] = value[key].trim();
  }
  return output;
}

function submissionErrorCode(record) {
  return nonempty(record.submit_error) ? 'LEGACY_SUBMISSION_ERROR' : null;
}

export async function reconstructCanonicalStateFromLegacyRecord(record, options = {}) {
  if (!isObject(record)) throw new TypeError(LEGACY_MIGRATION_ERROR_CODES.INVALID_INPUT);
  const inputSnapshot = stableLegacySerialize(record);
  const warnings = [];
  const errors = [];
  const parsed = {};
  for (const [field, label, critical] of JSON_FIELDS) {
    parsed[label] = parseObjectField(record, field, label, critical, warnings, errors);
  }
  if (stableLegacySerialize(record) !== inputSnapshot) {
    throw new TypeError(LEGACY_MIGRATION_ERROR_CODES.INVALID_INPUT);
  }
  if (nonempty(record.responses_json) && Object.keys(parsed.responses).length === 0
    && warnings.includes('MALFORMED_RESPONSES')) {
    errors.push(LEGACY_MIGRATION_ERROR_CODES.MALFORMED_CRITICAL_JSON);
  }
  const hasExistingRecoveryEmail = nonempty(record.recovery_email);
  const existingRecoveryEmail = normalizeEmail(record.recovery_email);
  const legacyEmail = normalizeEmail(record.user_email);
  const migrateLegacyEmail = !hasExistingRecoveryEmail && Boolean(legacyEmail)
    && options.migrateLegacyEmail !== false;
  if (hasExistingRecoveryEmail && !existingRecoveryEmail) {
    warnings.push('EXISTING_RECOVERY_EMAIL_INVALID');
  }
  if (nonempty(record.user_email) && !legacyEmail) warnings.push('LEGACY_EMAIL_INVALID');
  if (migrateLegacyEmail) warnings.push('LEGACY_EMAIL_MIGRATION_UNVERIFIED');
  if (migrateLegacyEmail) warnings.push('RECOVERY_EMAIL_LOOKUP_HASH_EXECUTION_REQUIRED');
  if (!nonempty(record.recovery_code_hash)) warnings.push('LEGACY_RECOVERY_CODE_UNAVAILABLE');

  const status = normalizeStatus(record.status, warnings);
  const recoveryEmail = existingRecoveryEmail || (migrateLegacyEmail ? legacyEmail : null);
  const state = {
    schemaVersion: PRO_DRAFT_CANONICAL_SCHEMA_VERSION,
    formType: 'pro-questionnaire',
    draftId: stringOrNull(record.id),
    sessionId: stringOrNull(record.session_id),
    draftStatus: status,
    clientRevision: integer(record.client_revision),
    serverRevision: integer(record.server_revision),
    savedAtClient: null,
    savedAtServer: stringOrNull(record.last_saved_at),
    sourceTabId: stringOrNull(record.source_tab_id),
    responses: parsed.responses,
    validationStatus: parsed.validationStatus,
    touchedQuestions: parsed.touchedQuestions,
    expandedQuestions: parsed.expandedQuestions,
    textValidationMeta: parsed.textValidationMeta,
    credentials: {
      ...allowlistedLegacyCredentialObject(parsed.credentials),
      ...allowlistedCredentials(record, recoveryEmail),
    },
    identityContext: {
      recoveryEmailSource: existingRecoveryEmail
        ? (record.recovery_email_source || 'existing')
        : (migrateLegacyEmail ? 'migrated_legacy' : 'anonymous'),
      recoveryEmailVerificationStatus: record.recovery_email_verification_status || 'unverified',
    },
    uiDraftState: parsed.uiDraftState,
    fieldChangeMetadata: parsed.fieldChangeMetadata,
    currentQuestionId: stringOrNull(record.current_question_id),
    lastChangedQuestionId: stringOrNull(record.last_changed_question_id),
    lastMutation: null,
    submission: {
      finalSubmissionId: stringOrNull(record.final_submission_id),
      submittedAt: stringOrNull(record.submitted_at),
      submittedStateHash: HASH.test(String(record.submitted_state_hash || ''))
        ? record.submitted_state_hash : null,
      pdfSourceStateHash: HASH.test(String(record.pdf_source_state_hash || ''))
        ? record.pdf_source_state_hash : null,
      lastSubmissionErrorCode: record.last_submission_error_code || submissionErrorCode(record),
    },
    compatibility: {
      sourceType: 'legacy-base44-draft',
      sourceVersion: Number.isSafeInteger(record.draft_schema_version)
        ? record.draft_schema_version : 0,
      migratedAtClient: null,
      migrationWarnings: unique(warnings),
    },
  };
  const mappedUserdata = isObject(parsed.mappedPayload.userdata)
    ? parsed.mappedPayload.userdata : {};
  if (Object.keys(parsed.responses).length === 0
    && (Object.keys(parsed.userdata).length > 0 || Object.keys(mappedUserdata).length > 0)) {
    warnings.push('LEGACY_RESPONSE_MAPPING_REQUIRED');
    state.compatibility.migrationWarnings = unique(warnings);
  }
  const hashProjection = clone(state);
  hashProjection.savedAtClient = null;
  hashProjection.savedAtServer = null;
  hashProjection.submission.submittedStateHash = null;
  hashProjection.submission.pdfSourceStateHash = null;
  const stateHash = await sha256(stableLegacySerialize(hashProjection));
  return Object.freeze({
    state: Object.freeze(state),
    stateHash,
    warnings: Object.freeze(unique(warnings)),
    errors: Object.freeze(unique(errors)),
    parsed: Object.freeze(parsed),
    recoveryEmail,
    migrateLegacyEmail,
  });
}

function classificationFor(record, reconstruction, options) {
  if (isFuture(record)) return LEGACY_RECORD_CLASSIFICATIONS.UNSUPPORTED_FUTURE_VERSION;
  if (options.manualReview === true || !nonempty(record.id) || !nonempty(record.session_id)
    || reconstruction.warnings.includes('EXISTING_RECOVERY_EMAIL_INVALID')
    || reconstruction.warnings.includes('LEGACY_RESPONSE_MAPPING_REQUIRED')
    || (!ACTIVE.has(String(record.status || '').toLowerCase())
      && !SUBMITTED.has(String(record.status || '').toLowerCase())
      && !SUPERSEDED.has(String(record.status || '').toLowerCase()))) {
    return LEGACY_RECORD_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED;
  }
  if (options.duplicateCandidate === true) return LEGACY_RECORD_CLASSIFICATIONS.DUPLICATE_CANDIDATE;
  if (validCurrent(record)) return LEGACY_RECORD_CLASSIFICATIONS.ALREADY_CURRENT;
  if (reconstruction.errors.length > 0 || (nonempty(record.draft_state_json)
    && !currentCanonical(record))) {
    return LEGACY_RECORD_CLASSIFICATIONS.LEGACY_MALFORMED_CRITICAL;
  }
  const status = String(record.status || '').toLowerCase();
  if (SUBMITTED.has(status)) return LEGACY_RECORD_CLASSIFICATIONS.SUBMITTED_LEGACY;
  if (status === 'submit_failed') return LEGACY_RECORD_CLASSIFICATIONS.SUBMIT_FAILED_LEGACY;
  if (SUPERSEDED.has(status)) return LEGACY_RECORD_CLASSIFICATIONS.SUPERSEDED_LEGACY;
  if (reconstruction.warnings.some((warning) => warning.startsWith('MALFORMED_'))) {
    return LEGACY_RECORD_CLASSIFICATIONS.LEGACY_MALFORMED_NONCRITICAL;
  }
  return Object.keys(reconstruction.state.responses).length > 0
    && nonempty(record.status)
    ? LEGACY_RECORD_CLASSIFICATIONS.LEGACY_COMPLETE
    : LEGACY_RECORD_CLASSIFICATIONS.LEGACY_PARTIAL;
}

function setMissing(record, patch, reasons, field, value, reason, outdated = false) {
  const missing = record[field] === undefined || record[field] === null || record[field] === '';
  if (missing || outdated) {
    patch[field] = value;
    reasons.push(`${field}:${reason}`);
  }
}

export async function buildLegacyDraftUpgradePatch(record, options = {}) {
  if (!isObject(record)) throw new TypeError(LEGACY_MIGRATION_ERROR_CODES.INVALID_INPUT);
  const reconstruction = await reconstructCanonicalStateFromLegacyRecord(record, options);
  const classification = classificationFor(record, reconstruction, options);
  const beforeFingerprint = await sha256(stableLegacySerialize(record));
  const warnings = [...reconstruction.warnings];
  const reasons = [];
  const patch = {};
  const blocked = [
    LEGACY_RECORD_CLASSIFICATIONS.UNSUPPORTED_FUTURE_VERSION,
    LEGACY_RECORD_CLASSIFICATIONS.LEGACY_MALFORMED_CRITICAL,
    LEGACY_RECORD_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
    LEGACY_RECORD_CLASSIFICATIONS.ALREADY_CURRENT,
  ].includes(classification);

  if (!blocked) {
    setMissing(record, patch, reasons, 'form_type', 'pro-questionnaire', 'canonical_form_type');
    setMissing(record, patch, reasons, 'draft_schema_version', PRO_DRAFT_CANONICAL_SCHEMA_VERSION,
      'canonical_schema_version', Number.isFinite(record.draft_schema_version)
        && record.draft_schema_version < PRO_DRAFT_CANONICAL_SCHEMA_VERSION);
    setMissing(record, patch, reasons, 'draft_state_json', stableLegacySerialize(reconstruction.state),
      'canonical_reconstruction');
    for (const [field, stateKey] of [
      ['text_validation_meta_json', 'textValidationMeta'],
      ['ui_draft_state_json', 'uiDraftState'],
      ['field_change_metadata_json', 'fieldChangeMetadata'],
      ['credentials_json', 'credentials'],
    ]) {
      setMissing(record, patch, reasons, field,
        stableLegacySerialize(reconstruction.state[stateKey]), 'missing_compatibility_projection');
    }
    setMissing(record, patch, reasons, 'client_revision', reconstruction.state.clientRevision,
      'unknown_revision');
    setMissing(record, patch, reasons, 'server_revision', reconstruction.state.serverRevision,
      'unknown_revision');
    setMissing(record, patch, reasons, 'state_hash', reconstruction.stateHash, 'canonical_state_hash');
    if (reconstruction.migrateLegacyEmail) {
      setMissing(record, patch, reasons, 'recovery_email', reconstruction.recoveryEmail,
        'approved_valid_legacy_email');
      setMissing(record, patch, reasons, 'recovery_email_source', 'migrated_legacy',
        'approved_legacy_provenance');
      setMissing(record, patch, reasons, 'recovery_email_verification_status', 'unverified',
        'migration_does_not_verify_email');
    }
    if (record.status === 'draft') {
      patch.status = 'active';
      reasons.push('status:recognized_legacy_normalization');
    }
    setMissing(record, patch, reasons, 'environment', options.environment || 'analysis',
      'migration_environment');
    setMissing(record, patch, reasons, 'migration_batch_id', options.batchId || 'legacy-analysis',
      'migration_batch');
    setMissing(record, patch, reasons, 'migrated_at', options.analyzedAt || new Date(0).toISOString(),
      'migration_timestamp');
    setMissing(record, patch, reasons, 'migration_version', PRO_DRAFT_LEGACY_MIGRATION_VERSION,
      'migration_contract_version', Number.isFinite(record.migration_version)
        && record.migration_version < PRO_DRAFT_LEGACY_MIGRATION_VERSION);
    setMissing(record, patch, reasons, 'source_content_hash', beforeFingerprint,
      'source_integrity_fingerprint');
  }
  const afterFingerprint = await sha256(stableLegacySerialize({ ...record, ...patch }));
  const reportedCanonicalState = classification === LEGACY_RECORD_CLASSIFICATIONS.ALREADY_CURRENT
    ? currentCanonical(record) : reconstruction.state;
  const reportedStateHash = classification === LEGACY_RECORD_CLASSIFICATIONS.ALREADY_CURRENT
    ? record.state_hash : reconstruction.stateHash;
  return Object.freeze({
    classification,
    patch: Object.freeze(patch),
    proposedFields: Object.freeze(Object.keys(patch).sort()),
    reasons: Object.freeze(reasons.sort()),
    warnings: Object.freeze(unique(warnings)),
    errors: reconstruction.errors,
    beforeFingerprint,
    afterFingerprint,
    stateHash: reportedStateHash,
    responseCount: isObject(reportedCanonicalState?.responses)
      ? Object.keys(reportedCanonicalState.responses).length : 0,
    byteSize: byteSize(record),
    manualReview: blocked && classification !== LEGACY_RECORD_CLASSIFICATIONS.ALREADY_CURRENT,
    canonicalState: reportedCanonicalState,
  });
}

export async function analyzeLegacyDraftRecord(record, options = {}) {
  const result = await buildLegacyDraftUpgradePatch(record, options);
  return Object.freeze({ recordId: stringOrNull(record.id), status: stringOrNull(record.status), ...result });
}

function sharedKeys(record) {
  const keys = [];
  if (nonempty(record.session_id)) keys.push(`session:${record.session_id}`);
  if (nonempty(record.final_submission_id)) keys.push(`submission:${record.final_submission_id}`);
  if (nonempty(record.source_app_id) && nonempty(record.source_entity)
    && nonempty(record.source_record_id)) {
    keys.push(`source:${record.source_app_id}:${record.source_entity}:${record.source_record_id}`);
  }
  if (nonempty(record.recovery_code_hash)) keys.push(`recovery:${record.recovery_code_hash}`);
  if (nonempty(record.bootstrap_idempotency_key_hash)) {
    keys.push(`bootstrap:${record.bootstrap_idempotency_key_hash}`);
  }
  return keys;
}

export function groupPotentialDuplicateDrafts(records) {
  const list = Array.isArray(records) ? records : [];
  const parent = list.map((_, index) => index);
  const find = (value) => parent[value] === value ? value : (parent[value] = find(parent[value]));
  const union = (left, right) => {
    const a = find(left); const b = find(right);
    if (a !== b) parent[b] = a;
  };
  const byKey = new Map();
  list.forEach((record, index) => {
    for (const key of sharedKeys(record)) {
      if (byKey.has(key)) union(index, byKey.get(key));
      else byKey.set(key, index);
    }
  });
  const groups = new Map();
  list.forEach((record, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  });
  return [...groups.values()].filter((group) => group.length > 1)
    .sort((left, right) => String(left[0]?.id).localeCompare(String(right[0]?.id)));
}

function submittedLike(record) {
  return SUBMITTED.has(String(record.status || '').toLowerCase())
    || nonempty(record.final_submission_id) || nonempty(record.submitted_at);
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rank(record) {
  return [
    submittedLike(record) ? 1 : 0,
    integer(record.server_revision),
    integer(record.client_revision),
    HASH.test(String(record.state_hash || '')) ? 1 : 0,
    timestamp(record.last_saved_at), timestamp(record.updated_date),
    timestamp(record.created_date),
  ];
}

export function selectRecommendedCanonicalRecord(records) {
  const list = [...(Array.isArray(records) ? records : [])];
  list.sort((left, right) => {
    const a = rank(left); const b = rank(right);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return b[index] - a[index];
    }
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
  return list[0] || null;
}

export function classifyDuplicateDraftGroup(records) {
  const list = Array.isArray(records) ? records : [];
  const submittedPartition = list.filter(submittedLike);
  const activePartition = list.filter((record) => !submittedLike(record));
  const hashConflict = list.filter((record) => HASH.test(String(record.state_hash || '')))
    .map((record) => record.state_hash).filter((hash, index, hashes) => hashes.indexOf(hash) === index)
    .length > 1 && list.every((record) => rank(record).slice(0, 4).join(':')
      === rank(list[0]).slice(0, 4).join(':'));
  const crossPartition = submittedPartition.length > 0 && activePartition.length > 0;
  const submittedConflict = submittedPartition.length > 1
    && new Set(submittedPartition.map((record) => record.final_submission_id).filter(Boolean)).size > 1;
  const manualReview = crossPartition || hashConflict || submittedConflict;
  return Object.freeze({
    classification: manualReview
      ? LEGACY_RECORD_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
      : LEGACY_RECORD_CLASSIFICATIONS.DUPLICATE_CANDIDATE,
    manualReview,
    warningCodes: Object.freeze(unique([
      ...(crossPartition ? ['DUPLICATE_STATUS_PARTITION_CONFLICT'] : []),
      ...(hashConflict ? ['DUPLICATE_STATE_HASH_CONFLICT'] : []),
      ...(submittedConflict ? ['DUPLICATE_SUBMISSION_ID_CONFLICT'] : []),
    ])),
    submittedRecordIds: Object.freeze(submittedPartition.map((record) => record.id).sort()),
    activeRecordIds: Object.freeze(activePartition.map((record) => record.id).sort()),
  });
}

export function buildDuplicateResolutionPlan(records) {
  const classification = classifyDuplicateDraftGroup(records);
  const canonical = classification.manualReview ? null : selectRecommendedCanonicalRecord(records);
  const actions = canonical && !submittedLike(canonical)
    ? records.filter((record) => record.id !== canonical.id && !submittedLike(record)).map((record) => ({
      recordId: record.id,
      recommendation: 'mark_superseded_and_link',
      canonicalRecordId: canonical.id,
      delete: false,
    })) : [];
  return Object.freeze({
    ...classification,
    canonicalRecordId: canonical?.id || null,
    actions: Object.freeze(actions),
    preservesAllRecords: true,
    automaticMergeAllowed: false,
  });
}

function eventTimestamp(event) {
  return stringOrNull(event.created_at_iso) || stringOrNull(event.created_date);
}

function resolveDraftRelation(event, options, warnings) {
  if (nonempty(event.draft_id)) return { draftId: event.draft_id, manualReview: false };
  const mapping = options.sessionDraftMap instanceof Map
    ? options.sessionDraftMap.get(event.session_id)
    : options.sessionDraftMap?.[event.session_id];
  const candidates = Array.isArray(mapping) ? mapping : (mapping ? [mapping] : []);
  if (candidates.length === 1) {
    return { draftId: typeof candidates[0] === 'string' ? candidates[0] : candidates[0]?.id, manualReview: false };
  }
  if (candidates.length > 1) warnings.push('EVENT_DRAFT_RELATION_AMBIGUOUS');
  else warnings.push('EVENT_DRAFT_RELATION_MISSING');
  return { draftId: null, manualReview: candidates.length > 1 };
}

export async function buildLegacyEventUpgradePatch(event, options = {}) {
  if (!isObject(event)) throw new TypeError(LEGACY_MIGRATION_ERROR_CODES.INVALID_INPUT);
  const warnings = [];
  const beforeFingerprint = await sha256(stableLegacySerialize(event));
  const patch = {};
  const reasons = [];
  const relation = resolveDraftRelation(event, options, warnings);
  if (!nonempty(event.draft_id) && nonempty(relation.draftId)) {
    patch.draft_id = relation.draftId;
    reasons.push('draft_id:unambiguous_exact_session_relation');
  }
  if (!nonempty(event.event_id) && nonempty(event.id)) {
    patch.event_id = `mig_${(await sha256(`legacy-event:${PRO_DRAFT_LEGACY_MIGRATION_VERSION}:${event.id}`)).slice(0, 48)}`;
    reasons.push('event_id:deterministic_source_identity');
  }
  if (!nonempty(event.created_at_iso) && eventTimestamp(event)) {
    patch.created_at_iso = eventTimestamp(event);
    reasons.push('created_at_iso:preserve_source_timestamp');
  }
  if (nonempty(event.value_json)) {
    try {
      const parsed = JSON.parse(event.value_json);
      if (!nonempty(event.value_hash)) {
        patch.value_hash = await sha256(stableLegacySerialize(parsed));
        reasons.push('value_hash:valid_legacy_value');
      }
    } catch {
      warnings.push('EVENT_VALUE_JSON_MALFORMED');
    }
  }
  setMissing(event, patch, reasons, 'environment', options.environment || 'analysis', 'migration_environment');
  setMissing(event, patch, reasons, 'migration_batch_id', options.batchId || 'legacy-analysis', 'migration_batch');
  setMissing(event, patch, reasons, 'migrated_at', options.analyzedAt || new Date(0).toISOString(), 'migration_timestamp');
  setMissing(event, patch, reasons, 'migration_version', PRO_DRAFT_LEGACY_MIGRATION_VERSION, 'migration_contract_version');
  setMissing(event, patch, reasons, 'source_content_hash', beforeFingerprint, 'source_integrity_fingerprint');
  setMissing(event, patch, reasons, 'redaction_level', 'omitted', 'safe_migration_default');
  const afterFingerprint = await sha256(stableLegacySerialize({ ...event, ...patch }));
  return Object.freeze({
    patch: Object.freeze(patch), proposedFields: Object.freeze(Object.keys(patch).sort()),
    reasons: Object.freeze(reasons.sort()), warnings: Object.freeze(unique(warnings)),
    beforeFingerprint, afterFingerprint,
    manualReview: relation.manualReview,
    classification: relation.manualReview
      ? LEGACY_RECORD_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED
      : (warnings.includes('EVENT_VALUE_JSON_MALFORMED')
        ? LEGACY_RECORD_CLASSIFICATIONS.LEGACY_MALFORMED_NONCRITICAL
        : LEGACY_RECORD_CLASSIFICATIONS.LEGACY_COMPLETE),
    byteSize: byteSize(event),
  });
}

export async function analyzeLegacyDraftEvent(event, options = {}) {
  const result = await buildLegacyEventUpgradePatch(event, options);
  return Object.freeze({ recordId: stringOrNull(event.id), status: null, ...result });
}

function safeEntry(analysis) {
  return Object.freeze({
    recordId: analysis.recordId,
    classification: analysis.classification,
    status: analysis.status,
    schemaVersion: analysis.canonicalState?.schemaVersion ?? null,
    responseCount: analysis.responseCount ?? null,
    byteSize: analysis.byteSize,
    stateHashPrefix: nonempty(analysis.stateHash) ? analysis.stateHash.slice(0, 12) : null,
    proposedFields: Object.freeze([...(analysis.proposedFields || [])]),
    warningCodes: Object.freeze([...(analysis.warnings || [])]),
    manualReview: analysis.manualReview === true,
    beforeFingerprint: analysis.beforeFingerprint,
    afterFingerprint: analysis.afterFingerprint,
  });
}

export function getSafeLegacyMigrationDiagnostics(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(safeEntry));
  return safeEntry(value);
}

export async function buildLegacyMigrationAnalysisReport({
  drafts = [], events = [], batchId = 'legacy-analysis', environment = 'analysis',
  analyzedAt = new Date(0).toISOString(), sessionDraftMap = undefined,
} = {}) {
  const options = { batchId, environment, analyzedAt, sessionDraftMap };
  const draftAnalyses = await Promise.all(drafts.map((record) => analyzeLegacyDraftRecord(record, options)));
  const eventAnalyses = await Promise.all(events.map((record) => analyzeLegacyDraftEvent(record, options)));
  const duplicateGroups = groupPotentialDuplicateDrafts(drafts).map((records, index) => {
    const plan = buildDuplicateResolutionPlan(records);
    return Object.freeze({
      groupId: `duplicate-${String(index + 1).padStart(4, '0')}`,
      recordIds: Object.freeze(records.map((record) => record.id).sort()),
      ...plan,
    });
  });
  const manualReview = [
    ...draftAnalyses.filter((analysis) => analysis.manualReview).map((analysis) => ({ type: 'draft', recordId: analysis.recordId })),
    ...eventAnalyses.filter((analysis) => analysis.manualReview).map((analysis) => ({ type: 'event', recordId: analysis.recordId })),
    ...duplicateGroups.filter((group) => group.manualReview).map((group) => ({ type: 'duplicate_group', recordId: group.groupId })),
  ];
  const warnings = unique([
    ...draftAnalyses.flatMap((analysis) => analysis.warnings),
    ...eventAnalyses.flatMap((analysis) => analysis.warnings),
    ...duplicateGroups.flatMap((group) => group.warningCodes),
  ]);
  return Object.freeze({
    migrationVersion: PRO_DRAFT_LEGACY_MIGRATION_VERSION,
    batchId, environment, analyzedAt,
    counts: Object.freeze({
      drafts: draftAnalyses.length, events: eventAnalyses.length,
      duplicateGroups: duplicateGroups.length, manualReview: manualReview.length,
      criticalMalformed: draftAnalyses.filter((analysis) => analysis.classification
        === LEGACY_RECORD_CLASSIFICATIONS.LEGACY_MALFORMED_CRITICAL).length,
      unsupportedFuture: draftAnalyses.filter((analysis) => analysis.classification
        === LEGACY_RECORD_CLASSIFICATIONS.UNSUPPORTED_FUTURE_VERSION).length,
    }),
    drafts: getSafeLegacyMigrationDiagnostics(draftAnalyses),
    events: getSafeLegacyMigrationDiagnostics(eventAnalyses),
    duplicateGroups: Object.freeze(duplicateGroups),
    manualReview: Object.freeze(manualReview),
    warnings: Object.freeze(warnings),
  });
}

function collectSensitiveStrings(records) {
  const values = new Set();
  const visit = (value) => {
    if (typeof value === 'string' && value.length >= 3) values.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (isObject(value)) Object.values(value).forEach(visit);
  };
  for (const record of records) {
    for (const field of ['user_email', 'recovery_email']) if (nonempty(record[field])) values.add(record[field]);
    if (nonempty(record.responses_json)) {
      try { visit(JSON.parse(record.responses_json)); } catch { /* malformed content is never copied */ }
    }
  }
  return values;
}

export function assertSafeLegacyMigrationReport(report, sourceDrafts = []) {
  const serialized = stableLegacySerialize(report);
  const forbiddenKeys = new Set([
    'responses_json', 'recovery_email', 'user_email', 'canonicalState', 'patch',
  ]);
  const inspectKeys = (value) => {
    if (Array.isArray(value)) return value.forEach(inspectKeys);
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error(LEGACY_MIGRATION_ERROR_CODES.UNSAFE_REPORT);
      inspectKeys(child);
    }
  };
  inspectKeys(report);
  for (const sensitive of collectSensitiveStrings(sourceDrafts)) {
    if (serialized.includes(sensitive)) throw new Error(LEGACY_MIGRATION_ERROR_CODES.UNSAFE_REPORT);
  }
  return true;
}
