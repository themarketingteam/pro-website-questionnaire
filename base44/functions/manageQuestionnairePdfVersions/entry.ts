import { createClientFromRequest } from "npm:@base44/sdk";

const SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';
const GRANT_SCOPE = 'draft-recovery';
const GRANT_VERSION = 1;
const GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;
const SOURCE_TYPES = new Set(['draft', 'intake', 'submission']);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache'
  }
});

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const importSigningKey = (secret: string) => crypto.subtle.importKey(
  'raw',
  encoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['verify']
);

const verifyGrant = async (token: string, secret: string) => {
  const [encodedPayload, encodedSignature, ...extraParts] = token.split('.');
  if (!encodedPayload || !encodedSignature || extraParts.length > 0) return false;

  try {
    const signingKey = await importSigningKey(secret);
    const signatureIsValid = await crypto.subtle.verify(
      'HMAC',
      signingKey,
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload)
    );
    if (!signatureIsValid) return false;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    const now = Math.floor(Date.now() / 1000);

    return payload?.version === GRANT_VERSION
      && payload?.scope === GRANT_SCOPE
      && Number.isFinite(payload?.issuedAt)
      && Number.isFinite(payload?.expiresAt)
      && payload.issuedAt <= now + 60
      && payload.expiresAt > now
      && payload.expiresAt <= payload.issuedAt + GRANT_TTL_SECONDS;
  } catch {
    return false;
  }
};

const cleanText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const cleanFilename = (value: unknown) => {
  const filename = cleanText(value, 180)
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_');
  return filename.toLowerCase().endsWith('.pdf') ? filename : '';
};

const cleanFileUrl = (value: unknown) => {
  const rawUrl = cleanText(value, 2048);
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
};

const publicVersion = (version: Record<string, unknown> | null) => version ? ({
  id: version.id,
  source_type: version.source_type,
  source_id: version.source_id,
  session_id: version.session_id,
  payload_hash: version.payload_hash,
  file_url: version.file_url,
  file_name: version.file_name,
  version_number: version.version_number,
  business_name: version.business_name,
  domain: version.domain,
  generated_at: version.generated_at,
  created_date: version.created_date
}) : null;

export default async function (req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const base44 = createClientFromRequest(req);
  const recoveryGrant = cleanText(body?.recoveryGrant, 4096);
  const configuredPassword = Deno.env.get(SECRET_NAME) || '';
  let isAdmin = false;

  try {
    const user = await base44.auth.me();
    isAdmin = user?.role === 'admin';
  } catch {
    isAdmin = false;
  }

  const hasRecoveryAccess = Boolean(
    recoveryGrant
    && configuredPassword
    && await verifyGrant(recoveryGrant, configuredPassword)
  );

  if (!isAdmin && !hasRecoveryAccess) {
    return jsonResponse({ success: false, error: 'Draft recovery access has expired.' }, 401);
  }

  const action = cleanText(body?.action, 20);
  const sourceType = cleanText(body?.sourceType, 20);
  const sourceId = cleanText(body?.sourceId, 200);

  if (!SOURCE_TYPES.has(sourceType) || !sourceId) {
    return jsonResponse({ success: false, error: 'A valid PDF source is required.' }, 400);
  }

  try {
    const versions = await base44.asServiceRole.entities.QuestionnairePdfVersion.filter(
      { source_type: sourceType, source_id: sourceId },
      '-version_number',
      action === 'list' ? 100 : 1
    );
    const latest = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;

    if (action === 'list') {
      return jsonResponse({
        success: true,
        versions: Array.isArray(versions) ? versions.map(publicVersion) : []
      });
    }

    if (action === 'latest') {
      return jsonResponse({ success: true, version: publicVersion(latest) });
    }

    if (action !== 'save') {
      return jsonResponse({ success: false, error: 'Unsupported PDF version action.' }, 400);
    }

    const payloadHash = cleanText(body?.payloadHash, 64).toLowerCase();
    const fileUrl = cleanFileUrl(body?.fileUrl);
    const fileName = cleanFilename(body?.fileName);

    if (!HASH_PATTERN.test(payloadHash) || !fileUrl || !fileName) {
      return jsonResponse({ success: false, error: 'The PDF version metadata is invalid.' }, 400);
    }

    if (latest?.payload_hash === payloadHash && latest?.file_url) {
      return jsonResponse({ success: true, created: false, version: publicVersion(latest) });
    }

    const versionNumber = Math.max(0, Number(latest?.version_number) || 0) + 1;
    const saved = await base44.asServiceRole.entities.QuestionnairePdfVersion.create({
      source_type: sourceType,
      source_id: sourceId,
      session_id: cleanText(body?.sessionId, 200),
      payload_hash: payloadHash,
      file_url: fileUrl,
      file_name: fileName,
      version_number: versionNumber,
      business_name: cleanText(body?.businessName, 300),
      domain: cleanText(body?.domain, 500),
      generated_at: new Date().toISOString()
    });

    return jsonResponse({ success: true, created: true, version: publicVersion(saved) });
  } catch (error) {
    console.error('[Questionnaire PDF versions] request failed:', error);
    return jsonResponse({ success: false, error: 'Unable to access saved questionnaire PDFs.' }, 500);
  }
}
