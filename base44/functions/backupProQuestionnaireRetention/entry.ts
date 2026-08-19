import { createClientFromRequest } from "npm:@base44/sdk";
import {
  BACKUP_POLICY_ID,
  backupRecordToS3,
  createS3Client,
  getBackupConfiguration,
  sha256Hex,
  stableStringify
} from "./retentionBackup.ts";

const CHECKPOINT_KEY = 'pro-questionnaire-retention-v1';
const DEFAULT_MAX_RECORDS = 15;
const MAX_MANUAL_RECORDS = 450;
const BACKUP_CONCURRENCY = 3;
const SCHEDULED_RECENT_RECORDS_PER_ENTITY = 15;
const EVENT_BATCH_ENTITY = 'ProFormDraftEventBatch';
const ENTITY_NAMES = [
  'ProFormDraft',
  'ProFormSubmission',
  'ProFormSubmissionIntake',
  'ProFormDraftRevision',
  'ProFormDraftEvent',
  'QuestionnairePdfVersion',
  'ProFormRecoveryLifecycleEvent',
  'ProFormIdentityResolutionAttempt',
  'ProFormIdentityResolutionRun'
];

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
});

const safeParse = (value: unknown, fallback: any) => {
  try { return typeof value === 'string' && value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isRetryableBase44Error = (error: any) => {
  const status = Number(error?.status || error?.response?.status || error?.data?.status || 0);
  const message = String(error?.message || error?.data?.message || '').toLowerCase();
  return status === 429 || status >= 500 || message.includes('rate limit') || message.includes('too many requests');
};

const withBoundedRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: any = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (!isRetryableBase44Error(error) || attempt === 3) throw error;
      await wait(500 * (2 ** attempt));
    }
  }
  throw lastError;
};

const cleanFolderValue = (value: unknown, fallback = '') => (
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : fallback
);

const directFolderContext = (record: any) => ({
  businessName: cleanFolderValue(
    record?.business_name
      || record?.metadata?.business_name
      || record?.business_name_original
      || record?.business_name_candidate,
    'Business-Unknown'
  ),
  draftStartedAt: cleanFolderValue(
    record?.created_date
      || record?.created_at_server
      || record?.metadata?.submission_datetime
      || record?.started_at
      || record?.generated_at
      || record?.occurred_at,
    'date-unknown'
  )
});

const getLinkedRecord = async (entities: any, recordType: string, recordId: string) => {
  const entityName = recordType === 'draft'
    ? 'ProFormDraft'
    : recordType === 'intake'
      ? 'ProFormSubmissionIntake'
      : recordType === 'submission'
        ? 'ProFormSubmission'
        : '';
  if (!entityName || !recordId) return null;
  try { return await entities[entityName].get(recordId); } catch { return null; }
};

const resolveFolderContext = async (
  entities: any,
  entityName: string,
  record: any,
  cache: Map<string, any>
) => {
  let linked: any = null;
  const relationKey = entityName === 'ProFormSubmission' && record?.metadata?.source_draft_id
    ? `draft:${record.metadata.source_draft_id}`
    : entityName === 'ProFormDraftRevision' && record?.draft_id
      ? `draft:${record.draft_id}`
      : entityName === 'ProFormDraftEvent' && record?.session_id
        ? `session:${record.session_id}`
        : entityName === 'QuestionnairePdfVersion'
          ? `${record?.source_type}:${record?.source_id}`
          : (entityName === 'ProFormRecoveryLifecycleEvent' || entityName === 'ProFormIdentityResolutionAttempt')
            ? `${record?.record_type}:${record?.record_id}`
            : '';
  if (relationKey && cache.has(relationKey)) return cache.get(relationKey);

  if (entityName === 'ProFormSubmission' && record?.metadata?.source_draft_id) {
    linked = await getLinkedRecord(entities, 'draft', record.metadata.source_draft_id);
  } else if (entityName === 'ProFormDraftRevision' && record?.draft_id) {
    linked = await getLinkedRecord(entities, 'draft', record.draft_id);
  } else if (entityName === 'ProFormDraftEvent' && record?.session_id) {
    const matches = await entities.ProFormDraft.filter({ session_id: record.session_id }, 'created_date', 1);
    linked = Array.isArray(matches) ? matches[0] : null;
  } else if (entityName === 'QuestionnairePdfVersion') {
    linked = await getLinkedRecord(entities, record?.source_type, record?.source_id);
  } else if (entityName === 'ProFormRecoveryLifecycleEvent' || entityName === 'ProFormIdentityResolutionAttempt') {
    linked = await getLinkedRecord(entities, record?.record_type, record?.record_id);
  }

  const direct = directFolderContext(record);
  if (!linked) {
    if (relationKey) cache.set(relationKey, direct);
    return direct;
  }
  const linkedContext = directFolderContext(linked);
  const context = {
    businessName: linkedContext.businessName !== 'Business-Unknown'
      ? linkedContext.businessName
      : direct.businessName,
    draftStartedAt: linkedContext.draftStartedAt !== 'date-unknown'
      ? linkedContext.draftStartedAt
      : direct.draftStartedAt
  };
  if (relationKey) cache.set(relationKey, context);
  return context;
};

const getCheckpoint = async (entities: any) => {
  const matches = await entities.ProFormRetentionCheckpoint.filter({ checkpoint_key: CHECKPOINT_KEY }, '-updated_date', 1);
  return Array.isArray(matches) && matches.length > 0 ? matches[0] : null;
};

const upsertCheckpoint = async (entities: any, checkpoint: any, values: any) => checkpoint?.id
  ? entities.ProFormRetentionCheckpoint.update(checkpoint.id, values)
  : entities.ProFormRetentionCheckpoint.create({ checkpoint_key: CHECKPOINT_KEY, ...values });

const alreadyStored = async (entities: any, entityName: string, recordId: string, fingerprint: string) => {
  const matches = await entities.ProFormRetentionBackupManifest.filter({
    source_entity: entityName,
    source_record_id: recordId,
    record_fingerprint: fingerprint,
    backup_status: { $in: ['stored', 'verified'] }
  }, '-backed_up_at', 1, 0, ['id']);
  return Array.isArray(matches) && matches.length > 0;
};

const nextRows = async (entity: any, state: any, wanted: number) => {
  const offset = Number.isFinite(Number(state?.offset)) ? Math.max(0, Math.floor(Number(state.offset))) : 0;
  const fetchLimit = Math.min(501, Math.max(2, wanted + 1));
  // System updated_date cannot be filtered by Base44, and ordering by a value
  // that changes during the backup can make offset pages overlap or skip rows.
  // created_date is immutable, so it provides a stable checkpointed sweep.
  const records = await entity.list('created_date', fetchLimit, offset);
  return Array.isArray(records) ? records : [];
};

const advanceWatermark = (state: any, record: any) => {
  return {
    offset: Math.max(0, Math.floor(Number(state?.offset) || 0)) + 1,
    last_record_id: record.id,
    last_record_updated_at: record.updated_date || record.created_date || ''
  };
};

export default async function (req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  const body = await req.json().catch(() => ({}));
  const args = body?.args && typeof body.args === 'object' ? body.args : {};
  const scheduled = args?.policy_id === BACKUP_POLICY_ID;
  const base44 = createClientFromRequest(req);
  let isAdmin = false;
  try { isAdmin = (await base44.auth.me())?.role === 'admin'; } catch { isAdmin = false; }
  if (!scheduled && !isAdmin) return jsonResponse({ success: false, error: 'Administrator access is required.' }, 401);

  const configuration = getBackupConfiguration();
  if (!configuration.configured) {
    console.warn('[Retention backup] configuration incomplete', { missingSecretNames: configuration.missing });
    return jsonResponse({
      success: false,
      configured: false,
      error: 'Independent retention backup is not configured.',
      missingSecretNames: configuration.missing
    }, 503);
  }

  const startedAt = new Date();
  const entities = base44.asServiceRole.entities;
  const trigger = scheduled ? 'scheduled' : 'admin_manual';
  const maxRecords = scheduled
    ? DEFAULT_MAX_RECORDS
    : Math.min(MAX_MANUAL_RECORDS, Math.max(1, Math.floor(Number(body?.maxRecords) || DEFAULT_MAX_RECORDS)));
  const run = await entities.ProFormRetentionRun.create({ trigger, status: 'running', started_at: startedAt.toISOString() });
  const checkpoint = await getCheckpoint(entities);
  const watermarks = safeParse(checkpoint?.watermarks_json, {});
  const metrics = {
    records_scanned: 0,
    records_stored: 0,
    records_skipped: 0,
    assets_stored: 0,
    provider_failures: 0,
    remaining_backlog: 0
  };

  try {
    const client = createS3Client(configuration);
    let remaining = maxRecords;
    const folderContextCache = new Map<string, any>();

    const storeManifest = async (entityName: string, record: any, stored: any) => (
      withBoundedRetry(() => entities.ProFormRetentionBackupManifest.create({
        source_entity: entityName,
        source_record_id: record.id,
        source_updated_at: record.updated_date || record.created_date || '',
        record_fingerprint: stored.recordFingerprint,
        object_checksum: stored.objectChecksum,
        object_key: stored.key,
        object_version_id: stored.versionId,
        object_etag: stored.etag,
        kms_key_id: configuration.kmsKeyId,
        asset_manifest_json: JSON.stringify(stored.assets),
        backup_status: 'stored',
        backed_up_at: new Date().toISOString(),
        verified_at: '',
        verification_error: ''
      }))
    );

    const processEventRows = async (selectedRows: any[]) => {
      const grouped = new Map<string, any[]>();
      selectedRows.forEach((record) => {
        const groupKey = cleanFolderValue(record?.session_id)
          || `${cleanFolderValue(record?.business_name, 'Business-Unknown')}:${String(record?.created_date || '').slice(0, 10)}`;
        grouped.set(groupKey, [...(grouped.get(groupKey) || []), record]);
      });
      const outcomes: any[] = [];
      for (const [groupKey, records] of grouped.entries()) {
        const firstRecord = records[0];
        const lastRecord = records[records.length - 1];
        const batchRecord = {
          id: `events-${firstRecord.id}-${lastRecord.id}`,
          created_date: firstRecord.created_date || firstRecord.created_at_iso || '',
          updated_date: lastRecord.updated_date || lastRecord.created_date || lastRecord.created_at_iso || '',
          session_id: cleanFolderValue(firstRecord.session_id),
          batch_group: groupKey,
          record_count: records.length,
          source_record_ids: records.map((record) => record.id),
          records
        };
        try {
          const fingerprint = await sha256Hex(stableStringify(batchRecord));
          const exists = await withBoundedRetry(() => alreadyStored(
            entities,
            EVENT_BATCH_ENTITY,
            batchRecord.id,
            fingerprint
          ));
          if (exists) {
            outcomes.push(...records.map((record) => ({ status: 'skipped', record })));
            continue;
          }
          const folderContext = await resolveFolderContext(
            entities,
            'ProFormDraftEvent',
            firstRecord,
            folderContextCache
          );
          const stored = await backupRecordToS3({
            client,
            configuration,
            entityName: EVENT_BATCH_ENTITY,
            record: batchRecord,
            folderContext
          });
          await storeManifest(EVENT_BATCH_ENTITY, batchRecord, stored);
          outcomes.push(...records.map((record, index) => ({
            status: 'stored',
            record,
            stored: index === 0 ? stored : null
          })));
        } catch (error) {
          console.error('[Retention backup] event batch failed', {
            firstRecordId: firstRecord.id,
            lastRecordId: lastRecord.id,
            recordCount: records.length,
            name: error instanceof Error ? error.name : 'Error'
          });
          outcomes.push(...records.map((record) => ({ status: 'failed', record })));
        }
      }
      return outcomes;
    };

    const processRows = async (entityName: string, selectedRows: any[]) => {
      if (entityName === 'ProFormDraftEvent') return processEventRows(selectedRows);
      const outcomes: any[] = [];
      for (let index = 0; index < selectedRows.length; index += BACKUP_CONCURRENCY) {
        const batch = selectedRows.slice(index, index + BACKUP_CONCURRENCY);
        const batchOutcomes = await Promise.all(batch.map(async (record) => {
          try {
            const fingerprint = await sha256Hex(stableStringify(record));
            if (await withBoundedRetry(() => alreadyStored(entities, entityName, record.id, fingerprint))) {
              return { status: 'skipped', record };
            }
            const folderContext = await resolveFolderContext(
              entities,
              entityName,
              record,
              folderContextCache
            );
            const stored = await backupRecordToS3({
              client,
              configuration,
              entityName,
              record,
              folderContext
            });
            await storeManifest(entityName, record, stored);
            return { status: 'stored', record, stored };
          } catch (error) {
            console.error('[Retention backup] record failed', {
              entityName,
              recordId: record.id,
              name: error instanceof Error ? error.name : 'Error'
            });
            return { status: 'failed', record };
          }
        }));
        outcomes.push(...batchOutcomes);
      }
      return outcomes;
    };

    const collectOutcomeMetrics = (outcomes: any[]) => {
      metrics.records_scanned += outcomes.length;
      metrics.records_skipped += outcomes.filter((outcome) => outcome.status === 'skipped').length;
      metrics.records_stored += outcomes.filter((outcome) => outcome.status === 'stored').length;
      metrics.assets_stored += outcomes.reduce((count, outcome) => (
        count + (outcome.stored?.assets || []).filter((asset: any) => asset.status === 'stored').length
      ), 0);
      const failedRecords = outcomes.filter((outcome) => outcome.status === 'failed').length;
      metrics.provider_failures += failedRecords + outcomes.reduce((count, outcome) => (
        count + (outcome.stored?.assets || []).filter((asset: any) => asset.status === 'failed').length
      ), 0);
      if (failedRecords > 0) metrics.remaining_backlog += failedRecords;
      return failedRecords;
    };

    // The checkpoint sweep captures every newly appended record. A small
    // newest-first scan also captures changed fingerprints for older drafts,
    // submissions, PDFs, and audit rows without restarting the full history.
    if (scheduled) {
      for (const entityName of ENTITY_NAMES) {
        // Draft events are immutable and are captured by the append-only
        // checkpoint sweep in compact per-session batches.
        if (entityName === 'ProFormDraftEvent') continue;
        const recentRows = await withBoundedRetry(() => entities[entityName].list(
          '-updated_date',
          SCHEDULED_RECENT_RECORDS_PER_ENTITY,
          0
        ));
        const outcomes = await processRows(entityName, Array.isArray(recentRows) ? recentRows : []);
        collectOutcomeMetrics(outcomes);
      }
    }

    for (const entityName of ENTITY_NAMES) {
      if (remaining <= 0) { metrics.remaining_backlog += 1; break; }
      const entity = entities[entityName];
      let state = watermarks[entityName] || { offset: 0 };
      const rows = await withBoundedRetry(() => nextRows(entity, state, remaining));
      if (rows.length > remaining) metrics.remaining_backlog += 1;

      const selectedRows = rows.slice(0, remaining);
      const outcomes = await processRows(entityName, selectedRows);
      const failedRecords = collectOutcomeMetrics(outcomes);

      const firstFailure = outcomes.findIndex((outcome) => outcome.status === 'failed');
      const safeAdvanceCount = firstFailure === -1 ? outcomes.length : firstFailure;
      for (const outcome of outcomes.slice(0, safeAdvanceCount)) {
        state = advanceWatermark(state, outcome.record);
      }
      watermarks[entityName] = state;
      remaining -= outcomes.length;
    }

    // Keep end-of-list offsets in place. Newly created records are appended to
    // the immutable created_date ordering, while the scheduled newest-first
    // scan above independently captures changes to older retained records.

    const completedAt = new Date();
    const status = metrics.provider_failures > 0 ? 'partial' : 'completed';
    await withBoundedRetry(() => upsertCheckpoint(entities, checkpoint, {
      watermarks_json: JSON.stringify(watermarks),
      last_started_at: startedAt.toISOString(),
      last_completed_at: completedAt.toISOString(),
      last_status: status,
      remaining_backlog: metrics.remaining_backlog,
      last_error: ''
    }));
    await withBoundedRetry(() => entities.ProFormRetentionRun.update(run.id, {
      status,
      completed_at: completedAt.toISOString(),
      ...metrics,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      error_code: ''
    }));
    console.info('[Retention backup] run complete', { trigger, status, ...metrics });
    return jsonResponse({ success: true, configured: true, trigger, status, ...metrics });
  } catch (error) {
    const completedAt = new Date();
    await entities.ProFormRetentionRun.update(run.id, {
      status: 'failed',
      completed_at: completedAt.toISOString(),
      ...metrics,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      error_code: error instanceof Error ? error.name.slice(0, 120) : 'backup_failed'
    }).catch(() => null);
    console.error('[Retention backup] run failed', {
      trigger,
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message.slice(0, 240) : 'Unknown error'
    });
    return jsonResponse({ success: false, configured: true, error: 'Retention backup failed.' }, 500);
  }
}
