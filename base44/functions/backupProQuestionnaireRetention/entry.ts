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
const MAX_MANUAL_RECORDS = 100;
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
  const timestamp = typeof state?.timestamp === 'string' && state.timestamp
    ? state.timestamp
    : '1970-01-01T00:00:00.000Z';
  const knownIds = new Set(Array.isArray(state?.ids) ? state.ids : []);
  const fetchLimit = Math.min(5000, Math.max(100, wanted + knownIds.size + 50));
  const records = await entity.filter({ updated_date: { $gte: timestamp } }, 'updated_date', fetchLimit);
  return (Array.isArray(records) ? records : []).filter((record) => (
    record.updated_date !== timestamp || !knownIds.has(record.id)
  ));
};

const advanceWatermark = (state: any, record: any) => {
  const timestamp = record.updated_date || record.created_date || new Date().toISOString();
  if (timestamp === state.timestamp) {
    return { timestamp, ids: [...new Set([...(state.ids || []), record.id])].slice(-5000) };
  }
  return { timestamp, ids: [record.id] };
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

    for (const entityName of ENTITY_NAMES) {
      if (remaining <= 0) { metrics.remaining_backlog += 1; break; }
      const entity = entities[entityName];
      let state = watermarks[entityName] || { timestamp: '1970-01-01T00:00:00.000Z', ids: [] };
      const rows = await nextRows(entity, state, remaining);
      if (rows.length > remaining) metrics.remaining_backlog += 1;

      for (const record of rows.slice(0, remaining)) {
        metrics.records_scanned += 1;
        const fingerprint = await sha256Hex(stableStringify(record));
        if (await alreadyStored(entities, entityName, record.id, fingerprint)) {
          metrics.records_skipped += 1;
          state = advanceWatermark(state, record);
          watermarks[entityName] = state;
          remaining -= 1;
          continue;
        }

        try {
          const stored = await backupRecordToS3({ client, configuration, entityName, record });
          await entities.ProFormRetentionBackupManifest.create({
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
          });
          metrics.records_stored += 1;
          metrics.assets_stored += stored.assets.filter((asset: any) => asset.status === 'stored').length;
          metrics.provider_failures += stored.assets.filter((asset: any) => asset.status === 'failed').length;
          state = advanceWatermark(state, record);
          watermarks[entityName] = state;
        } catch (error) {
          metrics.provider_failures += 1;
          console.error('[Retention backup] record failed', {
            entityName,
            recordId: record.id,
            name: error instanceof Error ? error.name : 'Error'
          });
          metrics.remaining_backlog += 1;
          break;
        } finally {
          remaining -= 1;
        }
      }
    }

    const completedAt = new Date();
    const status = metrics.provider_failures > 0 ? 'partial' : 'completed';
    await upsertCheckpoint(entities, checkpoint, {
      watermarks_json: JSON.stringify(watermarks),
      last_started_at: startedAt.toISOString(),
      last_completed_at: completedAt.toISOString(),
      last_status: status,
      remaining_backlog: metrics.remaining_backlog,
      last_error: ''
    });
    await entities.ProFormRetentionRun.update(run.id, {
      status,
      completed_at: completedAt.toISOString(),
      ...metrics,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      error_code: ''
    });
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
