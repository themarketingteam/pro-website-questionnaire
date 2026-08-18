import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "npm:@aws-sdk/client-s3@3.1112.0";
import { secrets } from "base44:runtime";

export const BACKUP_SCHEMA_VERSION = 'pro-retention-backup-v1';
export const BACKUP_POLICY_ID = 'pro-retention-s3-v1';
export const MAX_ASSETS_PER_RECORD = 10;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const REQUIRED_SECRET_NAMES = [
  'RETENTION_S3_BUCKET',
  'RETENTION_S3_REGION',
  'RETENTION_S3_PREFIX',
  'RETENTION_AWS_ACCESS_KEY_ID',
  'RETENTION_AWS_SECRET_ACCESS_KEY',
  'RETENTION_S3_KMS_KEY_ID'
];

const secretValue = (name: string) => {
  try {
    return String(secrets.get(name) || '').trim();
  } catch {
    return '';
  }
};

export const getBackupConfiguration = () => {
  const values: Record<string, string> = Object.fromEntries(
    REQUIRED_SECRET_NAMES.map((name) => [name, secretValue(name)])
  );
  const missing = REQUIRED_SECRET_NAMES.filter((name) => !values[name]);
  return {
    configured: missing.length === 0,
    missing,
    bucket: values.RETENTION_S3_BUCKET,
    region: values.RETENTION_S3_REGION,
    prefix: values.RETENTION_S3_PREFIX.replace(/^\/+|\/+$/g, ''),
    accessKeyId: values.RETENTION_AWS_ACCESS_KEY_ID,
    secretAccessKey: values.RETENTION_AWS_SECRET_ACCESS_KEY,
    kmsKeyId: values.RETENTION_S3_KMS_KEY_ID
  };
};

export const createS3Client = (configuration: ReturnType<typeof getBackupConfiguration>) => new S3Client({
  region: configuration.region,
  credentials: {
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey
  },
  maxAttempts: 3
});

const stableValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {} as Record<string, unknown>);
};

export const stableStringify = (value: unknown) => JSON.stringify(stableValue(value));

export const sha256Hex = async (value: string | Uint8Array) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const safeKeyPart = (value: unknown) => String(value || '')
  .trim()
  .replace(/[^A-Za-z0-9._-]+/g, '_')
  .slice(0, 180);

export const recordObjectKey = ({ prefix, entityName, recordId, fingerprint }: any) => (
  `${prefix}/records/${safeKeyPart(entityName)}/${safeKeyPart(recordId)}/${fingerprint}.json`
);

const isAssetPath = (path: string) => /(?:file|image|photo|pdf).*(?:url)|(?:url).*(?:file|image|photo|pdf)/i.test(path);

const isBlockedHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  if (normalized === '::1' || normalized === '0.0.0.0' || normalized === '169.254.169.254') return true;
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};

const validateAssetUrl = (value: string) => {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || isBlockedHostname(parsed.hostname)) throw new Error('asset_url_blocked');
  return parsed.toString();
};

export const extractAssetUrls = (value: unknown) => {
  const urls = new Set<string>();
  const visit = (node: any, path: string, depth: number) => {
    if (depth > 12 || node == null) return;
    if (typeof node === 'string') {
      if (!isAssetPath(path)) return;
      try {
        const parsed = new URL(node);
        if (parsed.protocol === 'https:' && !isBlockedHostname(parsed.hostname)) urls.add(parsed.toString());
      } catch {
        // Non-URL questionnaire strings are not backup assets.
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (typeof node === 'object') {
      Object.entries(node).forEach(([key, nested]) => visit(nested, path ? `${path}.${key}` : key, depth + 1));
    }
  };
  visit(value, '', 0);
  return [...urls].slice(0, MAX_ASSETS_PER_RECORD);
};

const fetchAsset = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let target = validateAssetUrl(url);
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      response = await fetch(target, { signal: controller.signal, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) throw new Error('asset_redirect_missing');
      target = validateAssetUrl(new URL(location, target).toString());
    }
    if (!response) throw new Error('asset_fetch_failed');
    if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error('asset_redirect_limit');
    if (!response.ok) throw new Error(`asset_http_${response.status}`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_ASSET_BYTES) throw new Error('asset_too_large');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('asset_too_large');
    return {
      bytes,
      contentType: response.headers.get('content-type') || 'application/octet-stream'
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const putBackupObject = async ({ client, configuration, key, body, contentType }: any) => client.send(
  new PutObjectCommand({
    Bucket: configuration.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: configuration.kmsKeyId,
    Metadata: {
      'backup-schema': BACKUP_SCHEMA_VERSION
    }
  })
);

export const backupAssets = async ({ client, configuration, entityName, recordId, record }: any) => {
  const assets = [];
  for (const sourceUrl of extractAssetUrls(record)) {
    try {
      const sourceHash = await sha256Hex(sourceUrl);
      const fetched = await fetchAsset(sourceUrl);
      const contentHash = await sha256Hex(fetched.bytes);
      const key = `${configuration.prefix}/assets/${safeKeyPart(entityName)}/${safeKeyPart(recordId)}/${sourceHash}/${contentHash}`;
      const stored = await putBackupObject({
        client,
        configuration,
        key,
        body: fetched.bytes,
        contentType: fetched.contentType
      });
      assets.push({
        source_url: sourceUrl,
        status: 'stored',
        object_key: key,
        object_version_id: stored.VersionId || '',
        content_sha256: contentHash,
        content_type: fetched.contentType,
        bytes: fetched.bytes.byteLength
      });
    } catch (error) {
      assets.push({
        source_url: sourceUrl,
        status: 'failed',
        error_code: error instanceof Error ? error.message.slice(0, 120) : 'asset_backup_failed'
      });
    }
  }
  return assets;
};

export const backupRecordToS3 = async ({ client, configuration, entityName, record }: any) => {
  const recordFingerprint = await sha256Hex(stableStringify(record));
  const assets = await backupAssets({ client, configuration, entityName, recordId: record.id, record });
  const envelope = {
    schema_version: BACKUP_SCHEMA_VERSION,
    source_entity: entityName,
    source_record_id: record.id,
    source_updated_at: record.updated_date || record.created_date || '',
    backed_up_at: new Date().toISOString(),
    record_fingerprint: recordFingerprint,
    record,
    assets
  };
  const serialized = stableStringify(envelope);
  const objectChecksum = await sha256Hex(serialized);
  const key = recordObjectKey({
    prefix: configuration.prefix,
    entityName,
    recordId: record.id,
    fingerprint: recordFingerprint
  });
  const stored = await putBackupObject({
    client,
    configuration,
    key,
    body: serialized,
    contentType: 'application/json'
  });
  return {
    recordFingerprint,
    objectChecksum,
    key,
    versionId: stored.VersionId || '',
    etag: String(stored.ETag || '').replaceAll('"', ''),
    assets
  };
};

export const getBackupObjectText = async ({ client, configuration, key, versionId }: any) => {
  const response = await client.send(new GetObjectCommand({
    Bucket: configuration.bucket,
    Key: key,
    ...(versionId ? { VersionId: versionId } : {})
  }));
  if (!response.Body) throw new Error('backup_object_body_missing');
  return response.Body.transformToString();
};

export const getBackupObjectBytes = async ({ client, configuration, key, versionId }: any) => {
  const response = await client.send(new GetObjectCommand({
    Bucket: configuration.bucket,
    Key: key,
    ...(versionId ? { VersionId: versionId } : {})
  }));
  if (!response.Body) throw new Error('backup_object_body_missing');
  return new Uint8Array(await response.Body.transformToByteArray());
};
