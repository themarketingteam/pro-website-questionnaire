import { createClientFromRequest } from "npm:@base44/sdk";
import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.1112.0";
import { secrets } from "base44:runtime";

const SECRET_NAMES = [
  'RETENTION_S3_BUCKET',
  'RETENTION_S3_REGION',
  'RETENTION_S3_PREFIX',
  'RETENTION_AWS_ACCESS_KEY_ID',
  'RETENTION_AWS_SECRET_ACCESS_KEY',
  'RETENTION_S3_KMS_KEY_ID'
];
const secretValue = (name: string) => {
  try { return String(secrets.get(name) || '').trim(); } catch { return ''; }
};
const getBackupConfiguration = () => {
  const values: Record<string, string> = Object.fromEntries(SECRET_NAMES.map((name) => [name, secretValue(name)]));
  const missing = SECRET_NAMES.filter((name) => !values[name]);
  return {
    configured: missing.length === 0,
    missing,
    bucket: values.RETENTION_S3_BUCKET,
    region: values.RETENTION_S3_REGION,
    accessKeyId: values.RETENTION_AWS_ACCESS_KEY_ID,
    secretAccessKey: values.RETENTION_AWS_SECRET_ACCESS_KEY
  };
};
const createS3Client = (configuration: ReturnType<typeof getBackupConfiguration>) => new S3Client({
  region: configuration.region,
  credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey },
  maxAttempts: 3
});
const getBackupObjectText = async ({ client, configuration, key, versionId }: any) => {
  const response = await client.send(new GetObjectCommand({
    Bucket: configuration.bucket,
    Key: key,
    ...(versionId ? { VersionId: versionId } : {})
  }));
  if (!response.Body) throw new Error('backup_object_body_missing');
  return response.Body.transformToString();
};
const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const RESTORABLE_ENTITIES = new Set([
  'ProFormDraft',
  'ProFormSubmission',
  'ProFormSubmissionIntake',
  'ProFormDraftRevision',
  'ProFormDraftEvent',
  'QuestionnairePdfVersion',
  'ProFormRecoveryLifecycleEvent',
  'ProFormIdentityResolutionAttempt',
  'ProFormIdentityResolutionRun'
]);
const PRIMARY_ENTITIES = new Set(['ProFormDraft', 'ProFormSubmission', 'ProFormSubmissionIntake']);
const SYSTEM_FIELDS = new Set(['id', 'created_date', 'updated_date', 'created_by', 'is_sample']);

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
});
const cleanId = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 200) : '';
const safeTimestamp = (value: unknown) => {
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};
const restorePayload = (record: Record<string, unknown>, sourceId: string, primary: boolean) => {
  const payload = Object.fromEntries(Object.entries(record || {}).filter(([key]) => !SYSTEM_FIELDS.has(key)));
  if (primary) payload.retention_restore_source_id = sourceId;
  return payload;
};

export default async function (req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  const base44 = createClientFromRequest(req);
  let admin = false;
  try { admin = (await base44.auth.me())?.role === 'admin'; } catch { admin = false; }
  if (!admin) return jsonResponse({ success: false, error: 'Administrator access is required.' }, 401);

  const body = await req.json().catch(() => ({}));
  const manifestId = cleanId(body?.manifestId);
  const apply = body?.apply === true;
  if (!manifestId) return jsonResponse({ success: false, error: 'A backup manifest ID is required.' }, 400);
  const configuration = getBackupConfiguration();
  if (!configuration.configured) {
    return jsonResponse({
      success: false,
      configured: false,
      error: 'Independent retention backup is not configured.',
      missingSecretNames: configuration.missing
    }, 503);
  }

  const entities = base44.asServiceRole.entities;
  try {
    const manifest = await entities.ProFormRetentionBackupManifest.get(manifestId);
    if (!manifest || !RESTORABLE_ENTITIES.has(manifest.source_entity)) {
      return jsonResponse({ success: false, error: 'Restorable backup manifest not found.' }, 404);
    }
    const serialized = await getBackupObjectText({
      client: createS3Client(configuration),
      configuration,
      key: manifest.object_key,
      versionId: manifest.object_version_id
    });
    const checksum = await sha256Hex(serialized);
    if (!manifest.object_checksum || checksum !== manifest.object_checksum) {
      return jsonResponse({ success: false, error: 'Backup integrity verification failed.' }, 409);
    }
    const envelope = JSON.parse(serialized);
    if (envelope?.source_entity !== manifest.source_entity
      || envelope?.source_record_id !== manifest.source_record_id
      || !envelope?.record
      || typeof envelope.record !== 'object') {
      return jsonResponse({ success: false, error: 'Backup envelope does not match its manifest.' }, 409);
    }

    const entity = entities[manifest.source_entity];
    let existing = null;
    try { existing = await entity.get(manifest.source_record_id); } catch { existing = null; }
    const sourceUpdatedAt = envelope.source_updated_at || manifest.source_updated_at || '';
    const existingIsNewer = existing
      ? safeTimestamp(existing.updated_date || existing.created_date) > safeTimestamp(sourceUpdatedAt)
      : false;
    const decision = existing
      ? (existingIsNewer ? 'blocked_newer_record' : 'record_already_exists')
      : 'create_recovery_copy';
    if (!apply) {
      return jsonResponse({
        success: true,
        dryRun: true,
        manifestId,
        sourceEntity: manifest.source_entity,
        sourceRecordId: manifest.source_record_id,
        sourceUpdatedAt,
        decision,
        willOverwrite: false
      });
    }
    if (existing) {
      return jsonResponse({
        success: false,
        applied: false,
        decision,
        error: existingIsNewer
          ? 'A newer database record exists; restore was refused.'
          : 'The source record still exists; restore never overwrites it.'
      }, 409);
    }

    const restored = await entity.create(restorePayload(
      envelope.record,
      manifest.source_record_id,
      PRIMARY_ENTITIES.has(manifest.source_entity)
    ));
    console.info('[Retention backup] recovery copy created', {
      manifestId,
      sourceEntity: manifest.source_entity,
      sourceRecordId: manifest.source_record_id,
      restoredRecordId: restored.id
    });
    return jsonResponse({
      success: true,
      applied: true,
      decision,
      manifestId,
      sourceEntity: manifest.source_entity,
      sourceRecordId: manifest.source_record_id,
      restoredRecordId: restored.id,
      willOverwrite: false
    });
  } catch (error) {
    console.error('[Retention backup] restore failed', {
      manifestId,
      apply,
      name: error instanceof Error ? error.name : 'Error'
    });
    return jsonResponse({ success: false, error: 'Unable to restore the retained backup.' }, 500);
  }
}
