import { secrets } from "base44:runtime";

export const BACKUP_SCHEMA_VERSION = 'pro-retention-backup-v2';
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

// Base44's Deno bundler is not compatible with every release of the modular
// AWS SDK. Keep S3 access dependency-free and use AWS Signature Version 4 over
// HTTPS so the same code runs predictably in deployed backend functions.
export const createS3Client = (configuration: ReturnType<typeof getBackupConfiguration>) => ({
  configuration
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

const hmacSha256 = async (key: Uint8Array, value: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)));
};

const uriEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
  `%${character.charCodeAt(0).toString(16).toUpperCase()}`
));

const canonicalObjectPath = (key: string) => `/${key.split('/').map(uriEncode).join('/')}`;

const signingKey = async (secretAccessKey: string, date: string, region: string) => {
  const dateKey = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), date);
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, 's3');
  return hmacSha256(serviceKey, 'aws4_request');
};

const signedS3Request = async ({
  configuration,
  method,
  key,
  body,
  contentType = '',
  versionId = '',
  kms = false
}: any) => {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const host = `${configuration.bucket}.s3.${configuration.region}.amazonaws.com`;
  const canonicalUri = canonicalObjectPath(key);
  const canonicalQuery = versionId ? `versionId=${uriEncode(versionId)}` : '';
  const bodyBytes = typeof body === 'string'
    ? new TextEncoder().encode(body)
    : body instanceof Uint8Array
      ? body
      : new Uint8Array();
  const payloadHash = await sha256Hex(bodyBytes);
  const requestHeaders: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  if (contentType) requestHeaders['content-type'] = contentType;
  if (kms) {
    requestHeaders['x-amz-meta-backup-schema'] = BACKUP_SCHEMA_VERSION;
    requestHeaders['x-amz-server-side-encryption'] = 'aws:kms';
    requestHeaders['x-amz-server-side-encryption-aws-kms-key-id'] = configuration.kmsKeyId;
  }
  const signedHeaderNames = Object.keys(requestHeaders).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${requestHeaders[name].trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${date}/${configuration.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');
  const signatureBytes = await hmacSha256(
    await signingKey(configuration.secretAccessKey, date, configuration.region),
    stringToSign
  );
  const signature = [...signatureBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const headers = new Headers(requestHeaders);
  headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${configuration.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
  const response = await fetch(
    `https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
    {
      method,
      headers,
      ...(method === 'PUT' ? { body: bodyBytes } : {})
    }
  );
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    const awsCode = responseText.match(/<Code>([^<]+)<\/Code>/)?.[1] || `http_${response.status}`;
    throw new Error(`s3_${awsCode}`.slice(0, 120));
  }
  return response;
};

const safeKeyPart = (value: unknown) => String(value || '')
  .trim()
  .replace(/[^A-Za-z0-9._-]+/g, '_')
  .slice(0, 180);

const safeDatePart = (value: unknown) => {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 'date-unknown' : parsed.toISOString().slice(0, 10);
};

export const backupFolder = ({ prefix, businessName, draftStartedAt }: any) => (
  `${String(prefix || '').replace(/^\/+|\/+$/g, '')}/${safeKeyPart(businessName) || 'Business-Unknown'}/${safeDatePart(draftStartedAt)}`
);

export const recordObjectKey = ({
  prefix,
  businessName,
  draftStartedAt,
  entityName,
  recordId,
  fingerprint
}: any) => (
  `${backupFolder({ prefix, businessName, draftStartedAt })}/records/${safeKeyPart(entityName)}/${safeKeyPart(recordId)}/${fingerprint}.json`
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

export const putBackupObject = async ({ client, configuration, key, body, contentType }: any) => {
  const response = await signedS3Request({
    configuration: client?.configuration || configuration,
    method: 'PUT',
    key,
    body,
    contentType,
    kms: true
  });
  return {
    VersionId: response.headers.get('x-amz-version-id') || '',
    ETag: response.headers.get('etag') || ''
  };
};

export const backupAssets = async ({
  client,
  configuration,
  entityName,
  recordId,
  record,
  folderContext
}: any) => {
  const assets = [];
  const folder = backupFolder({ prefix: configuration.prefix, ...folderContext });
  for (const sourceUrl of extractAssetUrls(record)) {
    try {
      const sourceHash = await sha256Hex(sourceUrl);
      const fetched = await fetchAsset(sourceUrl);
      const contentHash = await sha256Hex(fetched.bytes);
      const key = `${folder}/assets/${safeKeyPart(entityName)}/${safeKeyPart(recordId)}/${sourceHash}/${contentHash}`;
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

export const backupRecordToS3 = async ({
  client,
  configuration,
  entityName,
  record,
  folderContext
}: any) => {
  const recordFingerprint = await sha256Hex(stableStringify(record));
  const assets = await backupAssets({
    client,
    configuration,
    entityName,
    recordId: record.id,
    record,
    folderContext
  });
  const envelope = {
    schema_version: BACKUP_SCHEMA_VERSION,
    source_entity: entityName,
    source_record_id: record.id,
    source_updated_at: record.updated_date || record.created_date || '',
    backed_up_at: new Date().toISOString(),
    record_fingerprint: recordFingerprint,
    folder_context: folderContext,
    record,
    assets
  };
  const serialized = stableStringify(envelope);
  const objectChecksum = await sha256Hex(serialized);
  const key = recordObjectKey({
    prefix: configuration.prefix,
    businessName: folderContext.businessName,
    draftStartedAt: folderContext.draftStartedAt,
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
  const response = await signedS3Request({
    configuration: client?.configuration || configuration,
    method: 'GET',
    key,
    versionId
  });
  return response.text();
};

export const getBackupObjectBytes = async ({ client, configuration, key, versionId }: any) => {
  const response = await signedS3Request({
    configuration: client?.configuration || configuration,
    method: 'GET',
    key,
    versionId
  });
  return new Uint8Array(await response.arrayBuffer());
};
