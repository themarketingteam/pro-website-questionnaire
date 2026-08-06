import { sha256Hex, toBase64Url, fromBase64Url, utf8Encode, utf8Decode } from '../proDraftSecurity/entry.ts';

export const MIGRATION_REPOSITORY_DEFAULT_PAGE_SIZE = 50;
export const MIGRATION_REPOSITORY_MAX_PAGE_SIZE = 200;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const MIGRATION_FIELDS = new Set([
  'environment', 'migration_batch_id', 'migration_direction', 'migrated_at',
  'source_content_hash', 'migration_version', 'replacement_draft_id',
  'superseded_at', 'superseded_reason',
]);
const PROTECTED_PATCH_FIELDS = new Set(['id', 'created_date', 'created_by', 'submitted_at', 'final_submission_id']);

export class MigrationRepositoryError extends Error {
  constructor(code) {
    super('The migration repository operation was rejected.');
    this.name = 'MigrationRepositoryError';
    this.code = code;
  }
}
const fail = (code) => { throw new MigrationRepositoryError(code); };
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};
const safeId = (value) => typeof value === 'string' && SAFE_ID.test(value);
const pageSize = (value) => value == null ? MIGRATION_REPOSITORY_DEFAULT_PAGE_SIZE
  : Math.min(MIGRATION_REPOSITORY_MAX_PAGE_SIZE, Math.max(1, Number.isInteger(value) ? value : fail('MIGRATION_PAGE_SIZE_INVALID')));
const cursorEncode = (value) => toBase64Url(utf8Encode(JSON.stringify(value)));
const cursorDecode = (value, kind) => {
  if (!value) return { offset: 0, anchorId: null, anchorCreatedDate: null };
  try {
    const decoded = JSON.parse(utf8Decode(fromBase64Url(value)));
    if (decoded.version !== 1 || decoded.kind !== kind || !Number.isInteger(decoded.offset)
      || decoded.offset < 1 || !safeId(decoded.anchorId) || typeof decoded.anchorCreatedDate !== 'string') {
      fail('MIGRATION_CURSOR_INVALID');
    }
    return { offset: decoded.offset, anchorId: decoded.anchorId, anchorCreatedDate: decoded.anchorCreatedDate };
  } catch (error) {
    if (error instanceof MigrationRepositoryError) throw error;
    return fail('MIGRATION_CURSOR_INVALID');
  }
};

export async function getMigrationRecordFingerprint(value, options = {}) {
  if (!record(value)) fail('MIGRATION_RECORD_INVALID');
  const projection = options.excludeMigrationFields === true
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !MIGRATION_FIELDS.has(key))) : value;
  return sha256Hex(JSON.stringify(stable(projection)), options.cryptoProvider);
}

async function listBatch(entity, kind, options = {}) {
  if (!entity || typeof entity.list !== 'function') fail('MIGRATION_ENTITY_UNAVAILABLE');
  const limit = pageSize(options.pageSize);
  const cursor = cursorDecode(options.cursor, kind);
  const skip = cursor.offset > 0 ? cursor.offset - 1 : 0;
  const rows = await entity.list('created_date', limit + (cursor.offset > 0 ? 2 : 1), skip);
  if (!Array.isArray(rows)) fail('MIGRATION_ENTITY_RESULT_INVALID');
  const ordered = [...rows].sort((left, right) => String(left.created_date || '').localeCompare(String(right.created_date || '')) || String(left.id || '').localeCompare(String(right.id || '')));
  let start = 0;
  if (cursor.offset > 0) {
    const anchor = ordered[0];
    if (anchor?.id !== cursor.anchorId || String(anchor?.created_date || '') !== cursor.anchorCreatedDate) {
      fail('MIGRATION_CURSOR_ANCHOR_CHANGED');
    }
    start = 1;
  }
  const items = ordered.slice(start, start + limit);
  const hasMore = ordered.length > start + limit;
  const last = items.at(-1);
  return Object.freeze({
    items: Object.freeze(items),
    pageSize: limit,
    nextCursor: hasMore && last ? cursorEncode({ version: 1, kind, offset: cursor.offset + items.length, anchorId: last.id, anchorCreatedDate: String(last.created_date || '') }) : null,
  });
}

function checkpointQuery(identity) {
  if (!safeId(identity.migrationName) || !safeId(identity.environment) || !safeId(identity.batchId)
    || !Number.isInteger(identity.migrationVersion) || identity.migrationVersion < 1) fail('MIGRATION_IDENTITY_INVALID');
  return { migration_name: identity.migrationName, environment: identity.environment, migration_version: identity.migrationVersion, batch_id: identity.batchId };
}

export function createMigrationRepository(entities, options = {}) {
  const drafts = entities?.ProFormDraft;
  const events = entities?.ProFormDraftEvent;
  const checkpoints = entities?.ProFormMigrationCheckpoint;
  const getOrCreateCheckpoint = async (identity, initial = {}) => {
    const query = checkpointQuery(identity);
    const matches = await checkpoints.filter(query, 'created_date', 2, 0);
    if (matches.length > 1) fail('MIGRATION_CHECKPOINT_DUPLICATE');
    if (matches[0]) return matches[0];
    return checkpoints.create({ ...query, status: 'pending', phase: 'drafts', analyzed_count: 0, applied_count: 0, skipped_count: 0, manual_review_count: 0, ...initial });
  };
  const updateCheckpoint = async (checkpointId, patch) => {
    if (!safeId(checkpointId) || !record(patch) || Object.hasOwn(patch, 'id')) fail('MIGRATION_CHECKPOINT_UPDATE_INVALID');
    return checkpoints.update(checkpointId, patch);
  };
  const applyPatch = async (entity, id, expectedFingerprint, patch, context) => {
    if (!safeId(id) || !/^[a-f0-9]{64}$/u.test(expectedFingerprint || '') || !record(patch)) fail('MIGRATION_PATCH_INVALID');
    if ([...PROTECTED_PATCH_FIELDS].some((field) => Object.hasOwn(patch, field))) fail('MIGRATION_PATCH_PROTECTED_FIELD');
    const current = await entity.get(id);
    const isSubmitted = Boolean(current.submitted_at || current.final_submission_id || ['submitted', 'completed'].includes(String(current.status || '').toLowerCase()));
    if (isSubmitted && Object.hasOwn(patch, 'status') && patch.status !== current.status) fail('MIGRATION_SUBMITTED_STATUS_IMMUTABLE');
    for (const [field, nextValue] of Object.entries(patch)) {
      const currentValue = current[field];
      if (currentValue === undefined || currentValue === null || currentValue === '' || currentValue === nextValue) continue;
      const allowedLegacyStatus = field === 'status' && currentValue === 'draft' && nextValue === 'active';
      const allowedVersionAdvance = field === 'migration_version' && Number.isFinite(currentValue)
        && Number.isFinite(nextValue) && nextValue > currentValue;
      if (!allowedLegacyStatus && !allowedVersionAdvance) fail('MIGRATION_CURRENT_FIELD_OVERWRITE_FORBIDDEN');
    }
    if (current.migration_batch_id === context.batchId && Number(current.migration_version) === context.migrationVersion) {
      return Object.freeze({ outcome: 'already_applied', record: current });
    }
    if (await getMigrationRecordFingerprint(current, options) !== expectedFingerprint) {
      return Object.freeze({ outcome: 'fingerprint_mismatch', recordId: id });
    }
    const next = await entity.update(id, { ...patch, migration_batch_id: context.batchId, migration_version: context.migrationVersion, migrated_at: context.migratedAt });
    return Object.freeze({ outcome: 'applied', record: next });
  };
  return Object.freeze({
    getOrCreateCheckpoint,
    updateCheckpoint,
    listLegacyDraftBatch: (input) => listBatch(drafts, 'draft', input),
    listLegacyEventBatch: (input) => listBatch(events, 'event', input),
    applyDraftUpgradePatch: (id, fingerprint, patch, context) => applyPatch(drafts, id, fingerprint, patch, context),
    applyEventUpgradePatch: (id, fingerprint, patch, context) => applyPatch(events, id, fingerprint, patch, context),
    markDuplicateCandidate: async (input) => {
      const target = await drafts.get(input.recordId);
      const canonical = await drafts.get(input.canonicalRecordId);
      const submitted = (value) => Boolean(value?.submitted_at || value?.final_submission_id || ['submitted', 'completed'].includes(String(value?.status || '').toLowerCase()));
      const compatible = ['session_id', 'final_submission_id', 'recovery_code_hash', 'bootstrap_idempotency_key_hash']
        .some((field) => target[field] && target[field] === canonical[field])
        || (target.source_app_id && target.source_app_id === canonical.source_app_id
          && target.source_entity === canonical.source_entity && target.source_record_id === canonical.source_record_id);
      if (!compatible) fail('MIGRATION_DUPLICATE_PARTITION_INCOMPATIBLE');
      if (submitted(target) && !submitted(canonical)) fail('MIGRATION_SUBMITTED_SUPERSESSION_FORBIDDEN');
      if (target.replacement_draft_id === canonical.id && target.superseded_reason === 'legacy_duplicate_resolution') return { outcome: 'already_applied', record: target };
      if (submitted(target)) fail('MIGRATION_SUBMITTED_RECORD_IMMUTABLE');
      return { outcome: 'applied', record: await drafts.update(target.id, { status: 'cleared_superseded', replacement_draft_id: canonical.id, superseded_at: input.migratedAt, superseded_reason: 'legacy_duplicate_resolution', migration_batch_id: input.batchId, migration_version: input.migrationVersion, migrated_at: input.migratedAt }) };
    },
    getMigrationRecordFingerprint: (value, input) => getMigrationRecordFingerprint(value, { ...options, ...input }),
    getDraft: (id) => drafts.get(id),
    getEvent: (id) => events.get(id),
    createAuditEvent: (data) => events.create(data),
    createAuditEventIdempotent: async (data) => {
      const matches = await events.filter({ event_id: data.event_id }, 'created_date', 2, 0);
      if (matches.length > 0) return { outcome: 'already_applied', record: matches[0] };
      return { outcome: 'applied', record: await events.create(data) };
    },
    listDraftsByMigrationBatch: (batchId, limit, skip = 0) => drafts.filter({ migration_batch_id: batchId }, 'created_date', pageSize(limit), skip),
    listEventsByMigrationBatch: (batchId, limit, skip = 0) => events.filter({ migration_batch_id: batchId }, 'created_date', pageSize(limit), skip),
    clearDraftMigrationFields: async (id, batchId, fields) => {
      const current = await drafts.get(id);
      if (current.migration_batch_id !== batchId) return { outcome: 'batch_mismatch', recordId: id };
      const patch = Object.fromEntries(fields.filter((field) => MIGRATION_FIELDS.has(field) || field.startsWith('recovery_email_')).map((field) => [field, null]));
      return { outcome: 'rolled_back', record: await drafts.update(id, patch) };
    },
    clearEventMigrationFields: async (id, batchId, fields) => {
      const current = await events.get(id);
      if (current.migration_batch_id !== batchId) return { outcome: 'batch_mismatch', recordId: id };
      const patch = Object.fromEntries(fields.filter((field) => MIGRATION_FIELDS.has(field) || ['event_id', 'draft_id', 'value_hash', 'redaction_level'].includes(field)).map((field) => [field, null]));
      return { outcome: 'rolled_back', record: await events.update(id, patch) };
    },
  });
}

export function getSafeMigrationRepositoryDiagnostics() {
  return Object.freeze({ version: 1, defaultPageSize: MIGRATION_REPOSITORY_DEFAULT_PAGE_SIZE, maxPageSize: MIGRATION_REPOSITORY_MAX_PAGE_SIZE, stableSort: ['created_date', 'id'], cursorAnchorChecked: true, fingerprintBeforeWrite: true, supportsDelete: false, preservesCreatedDate: true });
}

export const getOrCreateCheckpoint = (repository, ...args) => repository.getOrCreateCheckpoint(...args);
export const updateCheckpoint = (repository, ...args) => repository.updateCheckpoint(...args);
export const listLegacyDraftBatch = (repository, ...args) => repository.listLegacyDraftBatch(...args);
export const listLegacyEventBatch = (repository, ...args) => repository.listLegacyEventBatch(...args);
export const applyDraftUpgradePatch = (repository, ...args) => repository.applyDraftUpgradePatch(...args);
export const applyEventUpgradePatch = (repository, ...args) => repository.applyEventUpgradePatch(...args);
export const markDuplicateCandidate = (repository, ...args) => repository.markDuplicateCandidate(...args);
