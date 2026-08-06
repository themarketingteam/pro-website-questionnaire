import { getMigrationRecordFingerprint } from '../proDraftMigrationRepository/repository.js';

export const RETENTION_REPOSITORY_DEFAULT_PAGE_SIZE = 50;
export const RETENTION_REPOSITORY_MAX_PAGE_SIZE = 200;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const safeId = (value) => typeof value === 'string' && SAFE_ID.test(value);
const bounded = (value, fallback = RETENTION_REPOSITORY_DEFAULT_PAGE_SIZE) => value == null ? fallback
  : Math.min(RETENTION_REPOSITORY_MAX_PAGE_SIZE, Math.max(1, Number.isInteger(value) ? value : fail('RETENTION_PAGE_SIZE_INVALID')));
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

export class RetentionRepositoryError extends Error {
  constructor(code) {
    super('The retention repository operation was rejected.');
    this.name = 'RetentionRepositoryError';
    this.code = code;
  }
}
const fail = (code) => { throw new RetentionRepositoryError(code); };

export function createRetentionRepository(entities, options = {}) {
  const drafts = entities?.ProFormDraft;
  const events = entities?.ProFormDraftEvent;
  const checkpoints = entities?.ProFormMigrationCheckpoint;
  const securityEvents = entities?.ProFormRecoverySecurityEvent;
  for (const entity of [drafts, events, checkpoints, securityEvents]) {
    if (!entity) fail('RETENTION_ENTITY_UNAVAILABLE');
  }
  return Object.freeze({
    getOrCreateCheckpoint: async (identity, initial = {}) => {
      const query = { migration_name: identity.migrationName, environment: identity.environment,
        migration_version: identity.policyVersion, batch_id: identity.batchId };
      if (!safeId(identity.migrationName) || !safeId(identity.environment) || !safeId(identity.batchId)
        || !Number.isInteger(identity.policyVersion)) fail('RETENTION_CHECKPOINT_IDENTITY_INVALID');
      const matches = await checkpoints.filter(query, 'created_date', 2, 0);
      if (matches.length > 1) fail('RETENTION_CHECKPOINT_DUPLICATE');
      if (matches[0]) return matches[0];
      return checkpoints.create({ ...query, mode: 'dry_run', status: 'pending', phase: 'active', cursor: '0',
        records_scanned: 0, records_planned: 0, records_updated: 0, records_skipped: 0,
        records_failed: 0, manual_review_count: 0, retention_apply_index: 0, ...initial });
    },
    updateCheckpoint: async (id, patch) => {
      if (!safeId(id) || !record(patch) || Object.hasOwn(patch, 'id')) fail('RETENTION_CHECKPOINT_UPDATE_INVALID');
      return checkpoints.update(id, patch);
    },
    listDraftsByStatus: async (status, pageSize, skip = 0) => {
      if (!['active', 'submit_failed', 'cleared_superseded'].includes(status)
        || !Number.isInteger(skip) || skip < 0) fail('RETENTION_LIST_INPUT_INVALID');
      const limit = bounded(pageSize);
      const rows = await drafts.filter({ status }, 'created_date', limit + 1, skip);
      if (!Array.isArray(rows)) fail('RETENTION_ENTITY_RESULT_INVALID');
      return Object.freeze({ items: Object.freeze(rows.slice(0, limit)), hasMore: rows.length > limit,
        nextSkip: skip + Math.min(rows.length, limit) });
    },
    listEventsForDraft: async (draftId, limit = 200) => {
      if (!safeId(draftId)) fail('RETENTION_DRAFT_ID_INVALID');
      const pageLimit = bounded(limit);
      const rows = await events.filter({ draft_id: draftId }, 'created_date', pageLimit + 1, 0);
      if (!Array.isArray(rows)) fail('RETENTION_ENTITY_RESULT_INVALID');
      return Object.freeze({ items: Object.freeze(rows.slice(0, pageLimit)), hasMore: rows.length > pageLimit });
    },
    getDraft: (id) => safeId(id) ? drafts.get(id) : fail('RETENTION_DRAFT_ID_INVALID'),
    getEvent: (id) => safeId(id) ? events.get(id) : fail('RETENTION_EVENT_ID_INVALID'),
    deleteDraft: (id) => safeId(id) ? drafts.delete(id) : fail('RETENTION_DRAFT_ID_INVALID'),
    deleteEvent: (id) => safeId(id) ? events.delete(id) : fail('RETENTION_EVENT_ID_INVALID'),
    fingerprint: (value) => getMigrationRecordFingerprint(value, options),
    estimateBytes: (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength,
    createAuditEvent: async (input) => securityEvents.create({
      request_id: input.requestId, environment: input.environment, attempt_type: input.attemptType,
      outcome: input.outcome, draft_id: safeId(input.draftId) ? input.draftId : undefined,
      created_at_server: input.createdAt, policy_version: input.policyVersion,
      test_run_id: input.testRunId,
    }),
  });
}

export function getSafeRetentionRepositoryDiagnostics() {
  return Object.freeze({ version: 1, defaultPageSize: 50, maxPageSize: 200,
    exactStatusFilters: true, deleteMany: false, eventBeforeDraft: true,
    checkpointEntity: 'ProFormMigrationCheckpoint' });
}
