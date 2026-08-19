const sha256Hex = async (value: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', value);
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

const signingKey = async (secretAccessKey: string, date: string, region: string) => {
  const dateKey = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), date);
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, 's3');
  return hmacSha256(serviceKey, 'aws4_request');
};

const signedGet = async ({ configuration, key, versionId = '' }: any) => {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const host = `${configuration.bucket}.s3.${configuration.region}.amazonaws.com`;
  const canonicalUri = `/${key.split('/').map(uriEncode).join('/')}`;
  const canonicalQuery = versionId ? `versionId=${uriEncode(versionId)}` : '';
  const payloadHash = await sha256Hex(new Uint8Array());
  const requestHeaders: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const signedHeaderNames = Object.keys(requestHeaders).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${requestHeaders[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${configuration.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest))
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
    { method: 'GET', headers }
  );
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    const awsCode = responseText.match(/<Code>([^<]+)<\/Code>/)?.[1] || `http_${response.status}`;
    throw new Error(`s3_${awsCode}`.slice(0, 120));
  }
  return response;
};

export const createS3Client = (configuration: any) => ({ configuration });

export const getBackupObjectBytes = async ({ client, configuration, key, versionId }: any) => {
  const response = await signedGet({
    configuration: client?.configuration || configuration,
    key,
    versionId
  });
  return new Uint8Array(await response.arrayBuffer());
};

export const getBackupObjectText = async ({ client, configuration, key, versionId }: any) => {
  const response = await signedGet({
    configuration: client?.configuration || configuration,
    key,
    versionId
  });
  return response.text();
};

