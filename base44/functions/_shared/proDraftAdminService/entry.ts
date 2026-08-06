/** Bounded, projection-only operations for authorized draft recovery administration. */

import { normalizeRecoveryEmail } from '../proDraftIdentity/entry.ts';
import {
  hmacSha256Base64Url,
  hmacSha256Hex,
  hashNormalizedRecoveryEmail,
  timingSafeEqualStrings,
  toBase64Url,
  fromBase64Url,
  utf8Decode,
  utf8Encode,
} from '../proDraftSecurity/entry.ts';
import { ADMIN_API_ERROR_CODES, adminApiError, isSafeAdminIdentifier } from '../proDraftAdminRequest/entry.ts';

type RecordValue = Record<string, unknown>;
type Entity = Readonly<{
  get?: (id: string) => Promise<RecordValue>;
  filter: (query: RecordValue, sort?: string, limit?: number, skip?: number, fields?: string[]) => Promise<RecordValue[]>;
  update?: (id: string, value: RecordValue) => Promise<RecordValue>;
  updateMany?: (query: RecordValue, value: RecordValue) => Promise<unknown>;
  create?: (value: RecordValue) => Promise<RecordValue>;
}>;
export type AdminDraftEntities = Readonly<{ ProFormDraft: Entity; ProFormDraftEvent: Entity; ProFormSubmissionIntake?: Entity }>;

const SUMMARY_FIELDS = ['id','session_id','business_name','domain','user_name','user_email','recovery_email','status','current_question_id','last_changed_question_id','last_changed_at','last_saved_at','submitted_at','submit_error','final_submission_id','client_revision','server_revision','retention_hold','retention_hold_reason','environment','test_run_id','draft_generation','previous_draft_id','replacement_draft_id','replacement_transaction_id','replacement_transaction_status','superseded_at','superseded_reason','source_app_id','source_entity','source_record_id','migration_batch_id','created_date','updated_date'];
const SAFE_SUMMARY_FIELDS = ['id','session_id','status','business_name','recovery_email','domain','created_date','updated_date','last_saved_at','client_revision','server_revision','retention_hold','environment','test_run_id','draft_generation','previous_draft_id','replacement_draft_id','replacement_transaction_id','replacement_transaction_status','superseded_at','superseded_reason'];
const DETAIL_FIELDS = [...SUMMARY_FIELDS,'form_type','draft_schema_version','responses_json','validation_status_json','touched_questions_json','expanded_questions_json','text_validation_meta_json','ui_draft_state_json','field_change_metadata_json','credentials_json','draft_state_json','metadata_json','userdata_json','mapped_payload_json','draft_metadata_json','save_error','submit_error','submit_attempted_at','last_sync_reason','recovery_email_source','recovery_email_verification_status','recovery_email_verified_at','retention_expires_at','retention_policy_version','ai_repair_status','last_ai_repair_at','ai_repair_error_json','ai_repair_report_json','ai_repaired_payload_json','ai_repair_applied'];
const EVENT_FIELDS = ['id','draft_id','session_id','event_id','event_type','question_id','question_type','value_summary','value_length','selected_option_count','business_name','domain','created_at_iso','client_revision','server_revision','source_tab_id','mutation_id','event_metadata_json','redaction_level','retention_hold','retention_hold_reason','environment','test_run_id','source_app_id','source_entity','source_record_id','migration_batch_id','created_date','updated_date'];
const SAFE_EVENT_FIELDS = ['id','draft_id','session_id','event_id','event_type','question_id','question_type','value_summary','value_length','selected_option_count','created_at_iso','client_revision','server_revision','source_tab_id','mutation_id','redaction_level','environment','test_run_id'];
const JSON_FIELDS = new Set(['responses_json','validation_status_json','touched_questions_json','expanded_questions_json','text_validation_meta_json','ui_draft_state_json','field_change_metadata_json','credentials_json','draft_state_json','metadata_json','userdata_json','mapped_payload_json','draft_metadata_json','ai_repair_error_json','ai_repair_report_json','ai_repaired_payload_json']);
const EDIT_FIELDS = new Set(['business_name','domain','user_name','user_email','recovery_email','mapped_payload_json','metadata_json','userdata_json','retention_hold','retention_hold_reason','ai_repair_status','last_ai_repair_at','ai_repair_error_json','ai_repair_report_json','ai_repaired_payload_json','ai_repair_applied']);
const AI_FIELDS = new Set(['ai_repair_status','last_ai_repair_at','ai_repair_error_json','ai_repair_report_json','ai_repaired_payload_json','ai_repair_applied']);
const AI_STATUS_VALUES = new Set(['','pending','running','completed','failed','skipped','diagnosed','needs_human_review','repair_ready','retry_failed','retry_success']);
const INTAKE_SUMMARY_FIELDS = ['id','questionnaire_session_id','status','business_name','business_domain','primary_failure_kind','fallback_failure_kind','linked_submission_id','retry_count','last_retry_at','ai_repair_status','created_at_server','environment','test_run_id','created_date','updated_date'];
const INTAKE_DETAIL_FIELDS = [...INTAKE_SUMMARY_FIELDS,'intake_reason','diagnostics_json','retry_error_json','transformed_payload_json','ai_repair_report_json','ai_repair_error_json','ai_repaired_payload_json','ai_repair_applied','ai_repair_attempt_count','ai_repair_retry_attempted','ai_repair_retry_result_json','last_ai_repair_at'];
const FORBIDDEN_VALUE_KEYS = /(?:password|secret|token|grant|recovery.?code|private.?key|authorization|cookie)/iu;
const PAGE_MAX = 100;
const SCAN_MAX = 500;

const plain = (v: unknown): v is RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 256) => typeof v === 'string' ? v.slice(0, max) : '';
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max ? Number(v) : null;
const iso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '';

function project(record: RecordValue, fields: readonly string[]): RecordValue {
  return Object.fromEntries(fields.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

export function maskRecoveryEmail(value: unknown): string {
  if (typeof value !== 'string') return '';
  const [local, domain] = value.split('@');
  if (!local || !domain) return '';
  return `${local[0]}***@${domain}`;
}

export function parseAdminJsonField(value: unknown): RecordValue {
  if (typeof value !== 'string') return { valid: false, raw: value, errorCode: 'NOT_A_STRING' };
  if (utf8Encode(value).byteLength > 768 * 1024) return { valid: false, raw: value, errorCode: 'JSON_TOO_LARGE' };
  try { return { valid: true, raw: value, parsed: JSON.parse(value) }; }
  catch { return { valid: false, raw: value, errorCode: 'MALFORMED_JSON' }; }
}

export function safeDraftSummary(record: RecordValue): RecordValue {
  const out = project(record, SAFE_SUMMARY_FIELDS);
  if ('recovery_email' in out) out.recovery_email = maskRecoveryEmail(out.recovery_email);
  out.hasSubmission = Boolean(record.final_submission_id || record.submitted_at);
  out.hasSubmitError = Boolean(record.submit_error);
  out.superseded = record.status === 'cleared_superseded' || Boolean(record.replacement_draft_id);
  out.generation = integer(record.draft_generation, 0) ?? integer(record.generation, 0) ?? 0;
  return out;
}

export function safeDraftDetail(record: RecordValue): RecordValue {
  const out = project(record, DETAIL_FIELDS);
  const jsonDiagnostics: RecordValue = {};
  for (const field of JSON_FIELDS) if (field in out) jsonDiagnostics[field] = parseAdminJsonField(out[field]);
  return { ...out, jsonDiagnostics };
}

function pageSize(value: unknown): number { return integer(value, 1, PAGE_MAX) ?? 25; }
function stableSpec(value: RecordValue): string { return JSON.stringify(Object.keys(value).sort().reduce((o,k) => ({...o,[k]:value[k]}), {})); }

async function encodeCursor(secret: string, operation: string, offset: number, spec: RecordValue): Promise<string> {
  const payload = toBase64Url(utf8Encode(JSON.stringify({ v: 1, operation, offset, spec: stableSpec(spec) })));
  return `${payload}.${await hmacSha256Base64Url(secret, `pro-draft:admin-cursor:v1:${payload}`)}`;
}

async function decodeCursor(value: unknown, secret: string, operation: string, spec: RecordValue): Promise<number> {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value !== 'string' || value.length > 2048) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const expected = await hmacSha256Base64Url(secret, `pro-draft:admin-cursor:v1:${payload}`);
  if (!timingSafeEqualStrings(signature, expected)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  try {
    const parsed = JSON.parse(utf8Decode(fromBase64Url(payload)));
    if (parsed.v !== 1 || parsed.operation !== operation || parsed.spec !== stableSpec(spec)) throw new Error();
    return integer(parsed.offset, 0, 100000) ?? 0;
  } catch { return adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST); }
}

function entity(entities: AdminDraftEntities, name: keyof AdminDraftEntities): Entity {
  const value = entities[name];
  if (!value || typeof value.filter !== 'function') adminApiError(ADMIN_API_ERROR_CODES.INTERNAL_ERROR, 503);
  return value;
}

function intakeEntity(entities: AdminDraftEntities): Entity {
  const value = entities.ProFormSubmissionIntake;
  if (!value || typeof value.filter !== 'function') adminApiError(ADMIN_API_ERROR_CODES.INTERNAL_ERROR, 503);
  return value;
}

export function safeIntakeSummary(record: RecordValue): RecordValue {
  return project(record, INTAKE_SUMMARY_FIELDS);
}

export function safeIntakeDetail(record: RecordValue): RecordValue {
  const out = project(record, INTAKE_DETAIL_FIELDS);
  const jsonDiagnostics: RecordValue = {};
  for (const field of INTAKE_DETAIL_FIELDS.filter((name) => name.endsWith('_json'))) {
    if (field in out) jsonDiagnostics[field] = parseAdminJsonField(out[field]);
  }
  return { ...out, jsonDiagnostics };
}

export async function listIntakesForRecovery(entities: AdminDraftEntities, payload: RecordValue, cursorSecret: string): Promise<RecordValue> {
  const size = pageSize(payload.pageSize);
  const filters = plain(payload.filters) ? payload.filters : {};
  if (Object.keys(filters).some((key) => !['status','environment','testRunId'].includes(key))) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const query: RecordValue = {};
  if (typeof filters.status === 'string') query.status = filters.status;
  if (typeof filters.environment === 'string') query.environment = filters.environment;
  if (typeof filters.testRunId === 'string') query.test_run_id = filters.testRunId;
  const spec = { filters, sort: 'created_desc' };
  const offset = await decodeCursor(payload.cursor, cursorSecret, 'list_intakes', spec);
  const rows = await intakeEntity(entities).filter(query, '-created_at_server', size + 1, offset, INTAKE_SUMMARY_FIELDS);
  return {
    items: rows.slice(0, size).map(safeIntakeSummary), pageSize: size,
    nextCursor: rows.length > size ? await encodeCursor(cursorSecret, 'list_intakes', offset + size, spec) : null,
  };
}

export async function getIntakeForRecovery(entities: AdminDraftEntities, payload: RecordValue): Promise<RecordValue> {
  if (!isSafeAdminIdentifier(payload.intakeId)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const intakes = intakeEntity(entities);
  const found = typeof intakes.get === 'function' ? await intakes.get(payload.intakeId)
    : (await intakes.filter({ id: payload.intakeId }, undefined, 1, 0, INTAKE_DETAIL_FIELDS))[0];
  if (!found) adminApiError(ADMIN_API_ERROR_CODES.NOT_FOUND, 404);
  return { intake: safeIntakeDetail(found) };
}

async function getDraft(drafts: Entity, id: unknown): Promise<RecordValue> {
  if (!isSafeAdminIdentifier(id)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const found = typeof drafts.get === 'function' ? await drafts.get(id) : (await drafts.filter({ id }, undefined, 1, 0, DETAIL_FIELDS))[0];
  if (!found) adminApiError(ADMIN_API_ERROR_CODES.NOT_FOUND, 404);
  return found;
}

export async function listDraftsForRecovery(entities: AdminDraftEntities, payload: RecordValue, secrets: Readonly<{ cursor: string; email: string }>): Promise<RecordValue> {
  const size = pageSize(payload.pageSize);
  const search = plain(payload.search) ? payload.search : {};
  const mode = text(search.mode, 32);
  const value = text(search.value, 256).trim();
  const allowedModes = new Set(['','draft_id','session_id','final_submission_id','recovery_email','business_domain','recent_text']);
  if (!allowedModes.has(mode)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const sort = payload.sort === 'updated_date_desc' ? '-updated_date' : '-last_saved_at';
  const filters = plain(payload.filters) ? payload.filters : {};
  const allowedFilters = new Set(['status','environment','hasRecoveryEmail','hasSubmission','hasSubmitError','retentionHold','superseded','testRunId','createdFrom','createdTo','savedFrom','savedTo']);
  if (Object.keys(filters).some((key) => !allowedFilters.has(key))) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const spec = { search, filters, testRunId: payload.testRunId ?? '', sort };
  const offset = await decodeCursor(payload.cursor, secrets.cursor, 'list_drafts', spec);
  const query: RecordValue = {};
  if (typeof filters.status === 'string') query.status = filters.status;
  if (typeof filters.environment === 'string') query.environment = filters.environment;
  const requestedTestRunId = typeof payload.testRunId === 'string' ? payload.testRunId : filters.testRunId;
  if (typeof requestedTestRunId === 'string') query.test_run_id = requestedTestRunId;
  if (mode === 'draft_id') query.id = value;
  if (mode === 'session_id') query.session_id = value;
  if (mode === 'final_submission_id') query.final_submission_id = value;
  if (mode === 'business_domain') query.domain = normalizeAdminDomain(value);
  if (mode === 'recovery_email') {
    const normalized = normalizeRecoveryEmail(value);
    if (!normalized.valid) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
    query.recovery_email_lookup_hash = await hashNormalizedRecoveryEmail(normalized.normalizedEmail, { name: 'PRO_FORM_EMAIL_LOOKUP_SECRET', value: secrets.email });
  }
  const hasPostFilters = mode === 'recent_text' || [...allowedFilters].some((key) => !['status','environment','testRunId'].includes(key) && filters[key] !== undefined);
  const scanLimit = hasPostFilters ? SCAN_MAX : size + 1;
  const raw = await entity(entities, 'ProFormDraft').filter(query, sort, scanLimit, offset, SUMMARY_FIELDS);
  const dateField = sort === '-updated_date' ? 'updated_date' : 'last_saved_at';
  raw.sort((a, b) => text(b[dateField] ?? b.updated_date).localeCompare(text(a[dateField] ?? a.updated_date)) || text(b.id).localeCompare(text(a.id)));
  const needle = value.toLocaleLowerCase();
  const eligible = (d: RecordValue): boolean => {
    if (mode === 'recent_text' && !['business_name','domain','user_name','user_email'].some((k) => text(d[k]).toLocaleLowerCase().includes(needle))) return false;
    if (typeof filters.hasRecoveryEmail === 'boolean' && Boolean(d.recovery_email) !== filters.hasRecoveryEmail) return false;
    if (typeof filters.hasSubmission === 'boolean' && Boolean(d.final_submission_id || d.submitted_at) !== filters.hasSubmission) return false;
    if (typeof filters.hasSubmitError === 'boolean' && Boolean(d.submit_error) !== filters.hasSubmitError) return false;
    if (typeof filters.retentionHold === 'boolean' && Boolean(d.retention_hold) !== filters.retentionHold) return false;
    const superseded = d.status === 'cleared_superseded' || Boolean(d.replacement_draft_id);
    if (typeof filters.superseded === 'boolean' && superseded !== filters.superseded) return false;
    if (iso(filters.createdFrom) && Date.parse(String(d.created_date)) < Date.parse(String(filters.createdFrom))) return false;
    if (iso(filters.createdTo) && Date.parse(String(d.created_date)) > Date.parse(String(filters.createdTo))) return false;
    if (iso(filters.savedFrom) && Date.parse(String(d.last_saved_at)) < Date.parse(String(filters.savedFrom))) return false;
    if (iso(filters.savedTo) && Date.parse(String(d.last_saved_at)) > Date.parse(String(filters.savedTo))) return false;
    return true;
  };
  const selected: RecordValue[] = [];
  let consumed = 0;
  for (const draft of raw) { consumed += 1; if (eligible(draft)) selected.push(draft); if (selected.length === size) break; }
  const hasMore = consumed < raw.length || raw.length === scanLimit;
  const items = selected.map(safeDraftSummary);
  return { items, pageSize: size, nextCursor: hasMore ? await encodeCursor(secrets.cursor, 'list_drafts', offset + consumed, spec) : null };
}

export async function getDraftForRecovery(entities: AdminDraftEntities, payload: RecordValue): Promise<RecordValue> {
  const projected = safeDraftDetail(await getDraft(entity(entities, 'ProFormDraft'), payload.draftId));
  if (payload.includeCanonicalState !== true) { delete projected.draft_state_json; delete (projected.jsonDiagnostics as RecordValue).draft_state_json; }
  if (payload.includeCompatibilityJson !== true) for (const field of JSON_FIELDS) if (field !== 'draft_state_json' && !field.startsWith('ai_')) { delete projected[field]; delete (projected.jsonDiagnostics as RecordValue)[field]; }
  if (payload.includeMigrationMetadata !== true) for (const field of ['source_app_id','source_entity','source_record_id','migration_batch_id']) delete projected[field];
  return { draft: projected };
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return plain(value) && Object.entries(value).some(([key, child]) => FORBIDDEN_VALUE_KEYS.test(key) || containsForbiddenKey(child));
}

export async function listDraftEventsForRecovery(entities: AdminDraftEntities, payload: RecordValue, cursorSecret: string): Promise<RecordValue> {
  if (!isSafeAdminIdentifier(payload.draftId)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const draft = await getDraft(entity(entities, 'ProFormDraft'), payload.draftId);
  if (payload.sessionId !== undefined && payload.sessionId !== draft.session_id) adminApiError(ADMIN_API_ERROR_CODES.NOT_FOUND, 404);
  const size = pageSize(payload.pageSize);
  const types = Array.isArray(payload.eventTypes) ? payload.eventTypes.filter((v): v is string => typeof v === 'string' && v.length <= 64).slice(0, 20) : [];
  const spec = { draftId: payload.draftId, eventTypes: types, includeValueJson: payload.includeValueJson === true };
  const offset = await decodeCursor(payload.cursor, cursorSecret, 'list_events', spec);
  const fields = payload.includeValueJson === true ? [...EVENT_FIELDS, 'value_json'] : EVENT_FIELDS;
  const scanLimit = types.length ? SCAN_MAX : size + 1;
  const raw = await entity(entities, 'ProFormDraftEvent').filter({ draft_id: payload.draftId }, '-created_at_iso', scanLimit, offset, fields);
  const selected: RecordValue[] = [];
  let consumed = 0;
  for (const event of raw) { consumed += 1; if (!types.length || types.includes(String(event.event_type))) selected.push(event); if (selected.length === size) break; }
  const items = selected.map((event) => {
    const out = project(event, payload.includeValueJson === true ? [...SAFE_EVENT_FIELDS, 'value_json'] : SAFE_EVENT_FIELDS);
    if ('value_json' in out) {
      const parsed: RecordValue = utf8Encode(String(out.value_json)).byteLength <= 32 * 1024
        ? parseAdminJsonField(out.value_json) : { valid: false, errorCode: 'JSON_TOO_LARGE' };
      if (!parsed.valid || containsForbiddenKey(parsed.parsed)) delete out.value_json;
      out.valueJsonDiagnostic = parsed.valid ? (containsForbiddenKey(parsed.parsed) ? 'REDACTED_SENSITIVE_KEYS' : 'INCLUDED') : parsed.errorCode;
    }
    return out;
  });
  const hasMore = consumed < raw.length || raw.length === scanLimit;
  return { items, pageSize: size, nextCursor: hasMore ? await encodeCursor(cursorSecret, 'list_events', offset + consumed, spec) : null };
}

export function normalizeAdminDomain(value: unknown): string {
  if (typeof value !== 'string' || value.length > 253 || /[/?#@\s]/u.test(value)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const domain = value.trim().toLowerCase().replace(/^www\./u, '').replace(/\.$/u, '');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(domain)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  return domain;
}

function serializeEditJson(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const parsed = parseAdminJsonField(serialized);
  if (!parsed.valid || containsForbiddenKey(parsed.parsed)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  return serialized;
}

export async function updateDraftForRecovery(entities: AdminDraftEntities, payload: RecordValue, context: Readonly<{ actorHash: string; environment: string; adminSecret?: string; emailSecret: string }>): Promise<RecordValue> {
  const drafts = entity(entities, 'ProFormDraft');
  const events = entity(entities, 'ProFormDraftEvent');
  const current = await getDraft(drafts, payload.draftId);
  const expected = integer(payload.expectedServerRevision);
  const key = text(payload.idempotencyKey, 128);
  if (expected === null || key.length < 16 || !/^[A-Za-z0-9_.:-]+$/u.test(key) || !plain(payload.changes)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const unknown = Object.keys(payload.changes).filter((name) => !EDIT_FIELDS.has(name));
  if (unknown.length) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const mutationId = await hmacSha256Hex(context.adminSecret ?? context.emailSecret, `pro-draft:admin-edit:v1:${key}`);
  const prior = await events.filter({ draft_id: current.id, mutation_id: mutationId }, '-created_at_iso', 1, 0, EVENT_FIELDS);
  if (prior[0]) return { draft: safeDraftDetail(current), idempotent: true };
  const changes: RecordValue = {};
  for (const [name, value] of Object.entries(payload.changes)) {
    if (JSON_FIELDS.has(name)) changes[name] = serializeEditJson(value);
    else if (name === 'domain') changes.domain = normalizeAdminDomain(value);
    else if (name === 'user_email') {
      if (value === '') changes.user_email = '';
      else { const normalized = normalizeRecoveryEmail(value); if (!normalized.valid) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST); changes.user_email = normalized.normalizedEmail; }
    }
    else if (name === 'recovery_email') {
      const normalized = normalizeRecoveryEmail(value);
      if (!normalized.valid) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
      changes.recovery_email = normalized.normalizedEmail;
      changes.recovery_email_lookup_hash = await hashNormalizedRecoveryEmail(normalized.normalizedEmail, { name: 'PRO_FORM_EMAIL_LOOKUP_SECRET', value: context.emailSecret });
      changes.recovery_email_source = 'admin_corrected'; changes.recovery_email_verification_status = 'unverified'; changes.recovery_email_verified_at = '';
    } else if (name === 'retention_hold') changes[name] = value === true;
    else if (name === 'ai_repair_applied') changes[name] = value === true;
    else if (name === 'ai_repair_status') { const status = text(value, 64); if (!AI_STATUS_VALUES.has(status)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST); changes[name] = status; }
    else if (name === 'last_ai_repair_at') { if (value !== '' && !iso(value)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST); changes[name] = value; }
    else changes[name] = text(value, name.includes('json') ? 524288 : 512).trim();
  }
  if ('business_name' in changes || 'domain' in changes) {
    const mapped = parseAdminJsonField(changes.mapped_payload_json ?? current.mapped_payload_json);
    if ((changes.mapped_payload_json ?? current.mapped_payload_json) && !mapped.valid) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
    if (mapped.valid && plain(mapped.parsed)) {
      const metadata = plain(mapped.parsed.metadata) ? { ...mapped.parsed.metadata } : {};
      if ('business_name' in changes) metadata.business_name = changes.business_name;
      if ('domain' in changes) metadata.businessDomain = changes.domain;
      changes.mapped_payload_json = JSON.stringify({ ...mapped.parsed, metadata });
    }
    const metadataField = parseAdminJsonField(changes.metadata_json ?? current.metadata_json);
    if (metadataField.valid && plain(metadataField.parsed)) {
      changes.metadata_json = JSON.stringify({ ...metadataField.parsed,
        ...('business_name' in changes ? { business_name: changes.business_name } : {}),
        ...('domain' in changes ? { businessDomain: changes.domain } : {}),
      });
    }
  }
  const nonRetention = Object.keys(changes).filter((k) => !['retention_hold','retention_hold_reason'].includes(k));
  if (current.status === 'submitted' && nonRetention.length) adminApiError(ADMIN_API_ERROR_CODES.CONFLICT, 409);
  const stateBearing = nonRetention.some((k) => !AI_FIELDS.has(k));
  const nextRevision = stateBearing ? expected + 1 : expected;
  const update = { ...changes, ...(stateBearing ? { server_revision: nextRevision } : {}), last_sync_reason: 'admin_recovery_edit' };
  let updated: unknown;
  if (typeof drafts.updateMany === 'function') updated = await drafts.updateMany({ id: current.id, server_revision: expected }, { $set: update });
  else if (Number(current.server_revision) === expected && typeof drafts.update === 'function') updated = await drafts.update(String(current.id), update);
  const count = typeof updated === 'number' ? updated : plain(updated) && typeof updated.updated === 'number' ? updated.updated : updated ? 1 : 0;
  if (count !== 1) adminApiError(ADMIN_API_ERROR_CODES.CONFLICT, 409);
  if (typeof events.create !== 'function') adminApiError(ADMIN_API_ERROR_CODES.EVENT_WRITE_FAILED, 503);
  await events.create({ draft_id: current.id, session_id: current.session_id, event_id: `admin_${mutationId.slice(0,48)}`, event_type: 'admin_edit', mutation_id: mutationId, server_revision: nextRevision, admin_actor_hash: context.actorHash, redaction_level: 'omitted', environment: context.environment, created_at_iso: new Date().toISOString(), event_metadata_json: JSON.stringify({ fields: Object.keys(payload.changes).sort(), reason: text(payload.reason, 128) || 'admin_recovery_edit' }) });
  const latest = await getDraft(drafts, current.id);
  return { draft: safeDraftDetail(latest), idempotent: false };
}

export async function getDraftLineageForRecovery(entities: AdminDraftEntities, payload: RecordValue): Promise<RecordValue> {
  const drafts = entity(entities, 'ProFormDraft');
  const current = await getDraft(drafts, payload.draftId);
  const linked: RecordValue[] = [];
  for (const id of [current.previous_draft_id, current.replacement_draft_id]) if (isSafeAdminIdentifier(id)) { try { linked.push(await getDraft(drafts, id)); } catch { /* broken link is diagnostic */ } }
  const siblings = current.session_id ? await drafts.filter({ session_id: current.session_id }, '-last_saved_at', 100, 0, SUMMARY_FIELDS) : [];
  const sourceMatches = current.source_app_id && current.source_record_id ? await drafts.filter({ source_app_id: current.source_app_id, source_record_id: current.source_record_id }, '-updated_date', 100, 0, SUMMARY_FIELDS) : [];
  const unique = [...linked, ...siblings, ...sourceMatches].filter((record, index, all) => record.id !== current.id && all.findIndex((other) => other.id === record.id) === index);
  const summaries = unique.map(safeDraftSummary);
  return {
    current: safeDraftSummary(current),
    previous: summaries.find((v) => v.id === current.previous_draft_id) ?? null,
    replacement: summaries.find((v) => v.id === current.replacement_draft_id) ?? null,
    related: summaries,
    supersededCandidates: summaries.filter((v) => v.superseded === true || v.status === 'cleared_superseded'),
    transactionStatus: text(current.replacement_transaction_status) || (current.replacement_draft_id ? 'replacement_linked' : current.previous_draft_id ? 'replacement_candidate' : 'standalone'),
    diagnostic: { duplicateCount: unique.length, brokenPreviousLink: Boolean(current.previous_draft_id) && !linked.some((v) => v.id === current.previous_draft_id), brokenReplacementLink: Boolean(current.replacement_draft_id) && !linked.some((v) => v.id === current.replacement_draft_id), recommendation: unique.length ? 'review_records_individually_no_automatic_merge' : 'no_related_records_found' },
  };
}
