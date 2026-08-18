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
const getBackupObjectBytes = async ({ client, configuration, key, versionId }: any) => {
  const response = await client.send(new GetObjectCommand({
    Bucket: configuration.bucket,
    Key: key,
    ...(versionId ? { VersionId: versionId } : {})
  }));
  if (!response.Body) throw new Error('backup_object_body_missing');
  return new Uint8Array(await response.Body.transformToByteArray());
};
const sha256Hex = async (value: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
});

const cleanId = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 200) : '';

export default async function (req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  const base44 = createClientFromRequest(req);
  let admin = false;
  try { admin = (await base44.auth.me())?.role === 'admin'; } catch { admin = false; }
  if (!admin) return jsonResponse({ success: false, error: 'Administrator access is required.' }, 401);

  const body = await req.json().catch(() => ({}));
  const manifestId = cleanId(body?.manifestId);
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
    if (!manifest) return jsonResponse({ success: false, error: 'Backup manifest not found.' }, 404);
    const client = createS3Client(configuration);
    const bytes = await getBackupObjectBytes({
      client,
      configuration,
      key: manifest.object_key,
      versionId: manifest.object_version_id
    });
    const checksum = await sha256Hex(bytes);
    const assetManifest = (() => {
      try { return JSON.parse(manifest.asset_manifest_json || '[]'); } catch { return []; }
    })();
    let verifiedAssets = 0;
    let failedAssets = 0;
    for (const asset of Array.isArray(assetManifest) ? assetManifest : []) {
      if (asset?.status !== 'stored' || !asset?.object_key || !asset?.content_sha256) continue;
      try {
        const assetBytes = await getBackupObjectBytes({
          client,
          configuration,
          key: asset.object_key,
          versionId: asset.object_version_id
        });
        if (await sha256Hex(assetBytes) === asset.content_sha256) verifiedAssets += 1;
        else failedAssets += 1;
      } catch {
        failedAssets += 1;
      }
    }
    const verified = Boolean(manifest.object_checksum)
      && checksum === manifest.object_checksum
      && failedAssets === 0;
    const now = new Date().toISOString();
    await entities.ProFormRetentionBackupManifest.update(manifest.id, {
      backup_status: verified ? 'verified' : 'failed',
      verified_at: now,
      verification_error: verified ? '' : 'checksum_mismatch'
    });
    console.info('[Retention backup] verification complete', {
      manifestId,
      sourceEntity: manifest.source_entity,
      sourceRecordId: manifest.source_record_id,
      verified
    });
    return jsonResponse({
      success: verified,
      verified,
      manifestId,
      sourceEntity: manifest.source_entity,
      sourceRecordId: manifest.source_record_id,
      verifiedAt: now,
      verifiedAssets,
      failedAssets,
      ...(verified ? {} : { error: 'Backup integrity verification failed.' })
    }, verified ? 200 : 409);
  } catch (error) {
    console.error('[Retention backup] verification failed', {
      manifestId,
      name: error instanceof Error ? error.name : 'Error'
    });
    return jsonResponse({ success: false, error: 'Unable to verify the retention backup.' }, 500);
  }
}
