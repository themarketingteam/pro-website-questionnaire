import { createClientFromRequest } from "npm:@base44/sdk";

const SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';
const GRANT_SCOPE = 'draft-recovery';
const GRANT_VERSION = 1;
const GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const encoder = new TextEncoder();

const RECORD_CONFIG = {
  draft: {
    entityName: 'ProFormDraft',
    sort: '-last_saved_at',
    statuses: new Set(['draft', 'submit_attempted', 'submit_failed', 'submitted']),
    searchFields: ['business_name', 'domain', 'user_email', 'session_id'],
    summaryFields: [
      'id',
      'business_name',
      'domain',
      'user_email',
      'status',
      'last_saved_at',
      'created_date',
      'last_changed_question_id',
      'session_id',
      'archived_at',
      'archive_reason'
    ]
  },
  intake: {
    entityName: 'ProFormSubmissionIntake',
    sort: '-created_at_server',
    statuses: new Set(['submitted', 'received_intake', 'retry_pending', 'retry_success', 'retry_failed', 'abandoned']),
    searchFields: ['business_name', 'business_domain', 'user_email', 'questionnaire_session_id'],
    summaryFields: [
      'id',
      'business_name',
      'business_domain',
      'user_email',
      'questionnaire_session_id',
      'created_at_server',
      'created_date',
      'status',
      'primary_failure_kind',
      'linked_submission_id',
      'ai_repair_status',
      'archived_at',
      'archive_reason'
    ]
  }
} as const;

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache'
  }
});

const cleanText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const clampInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
};

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

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildListQuery = (
  config: typeof RECORD_CONFIG[keyof typeof RECORD_CONFIG],
  status: string,
  archiveState: string,
  search: string
) => {
  const conditions: Record<string, unknown>[] = [];

  if (status !== 'all') conditions.push({ status });
  if (archiveState === 'active') conditions.push({ archived_at: { $exists: false } });
  if (archiveState === 'archived') conditions.push({ archived_at: { $exists: true } });

  if (search) {
    const regex = `(?i)${escapeRegex(search)}`;
    conditions.push({
      $or: config.searchFields.map((field) => ({ [field]: { $regex: regex } }))
    });
  }

  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
};

const validateMappedPayload = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2_000_000) return false;
  try {
    const parsed = JSON.parse(value);
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  } catch {
    return false;
  }
};

// eslint-disable-next-line no-undef
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const base44 = createClientFromRequest(req);
  const configuredPassword = Deno.env.get(SECRET_NAME) || '';
  const recoveryGrant = cleanText(body?.recoveryGrant, 4096);
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

  const recordType = cleanText(body?.recordType, 20) as keyof typeof RECORD_CONFIG;
  const config = RECORD_CONFIG[recordType];
  if (!config) {
    return jsonResponse({ success: false, error: 'Unsupported recovery record type.' }, 400);
  }

  const entity = base44.asServiceRole.entities[config.entityName];
  const action = cleanText(body?.action, 20);

  try {
    if (action === 'list') {
      const page = clampInteger(body?.page, 1, 1, 100_000);
      const pageSize = clampInteger(body?.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
      const status = cleanText(body?.status, 40) || 'all';
      const archiveState = cleanText(body?.archiveState, 20) || 'active';
      const search = cleanText(body?.search, 200);

      if (status !== 'all' && !config.statuses.has(status)) {
        return jsonResponse({ success: false, error: 'Unsupported status filter.' }, 400);
      }
      if (!['active', 'archived', 'all'].includes(archiveState)) {
        return jsonResponse({ success: false, error: 'Unsupported archive filter.' }, 400);
      }

      const query = buildListQuery(config, status, archiveState, search);
      const skip = (page - 1) * pageSize;
      const requestedLimit = pageSize + 1;
      const records = query
        ? await entity.filter(query, config.sort, requestedLimit, skip, [...config.summaryFields])
        : await entity.list(config.sort, requestedLimit, skip, [...config.summaryFields]);
      const safeRecords = Array.isArray(records) ? records : [];
      const pageRecords = safeRecords.slice(0, pageSize);
      const hasMore = safeRecords.length > pageSize;
      const anyRecords = await entity.list(config.sort, 1, 0, ['id']);
      let duplicateSessionIds: string[] = [];

      if (recordType === 'draft') {
        const sessionIds = [...new Set(pageRecords.map((record) => record.session_id).filter(Boolean))];
        if (sessionIds.length > 0) {
          const duplicateConditions: Record<string, unknown>[] = [
            { session_id: { $in: sessionIds } }
          ];
          if (archiveState === 'active') duplicateConditions.push({ archived_at: { $exists: false } });
          if (archiveState === 'archived') duplicateConditions.push({ archived_at: { $exists: true } });
          const duplicateQuery = duplicateConditions.length === 1
            ? duplicateConditions[0]
            : { $and: duplicateConditions };
          const sessionMatches = await entity.filter(
            duplicateQuery,
            config.sort,
            Math.min(5000, Math.max(100, sessionIds.length * 10)),
            0,
            ['id', 'session_id']
          );
          const counts = (Array.isArray(sessionMatches) ? sessionMatches : []).reduce((acc, record) => {
            if (record.session_id) acc[record.session_id] = (acc[record.session_id] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          duplicateSessionIds = Object.entries(counts)
            .filter(([, count]) => Number(count) > 1)
            .map(([sessionId]) => sessionId);
        }
      }

      return jsonResponse({
        success: true,
        records: pageRecords,
        page,
        pageSize,
        hasMore,
        hasAnyRecords: Array.isArray(anyRecords) && anyRecords.length > 0,
        duplicateSessionIds
      });
    }

    const recordId = cleanText(body?.recordId, 200);
    if (!recordId) {
      return jsonResponse({ success: false, error: 'A recovery record ID is required.' }, 400);
    }

    if (action === 'get') {
      const record = await entity.get(recordId);
      return record
        ? jsonResponse({ success: true, record })
        : jsonResponse({ success: false, error: 'Recovery record not found.' }, 404);
    }

    if (action === 'update' && recordType === 'draft') {
      const updates = body?.updates && typeof body.updates === 'object' ? body.updates : {};
      const mappedPayload = updates.mapped_payload_json;
      if (!validateMappedPayload(mappedPayload)) {
        return jsonResponse({ success: false, error: 'The mapped payload must be valid JSON.' }, 400);
      }

      const updated = await entity.update(recordId, {
        business_name: cleanText(updates.business_name, 300),
        domain: cleanText(updates.domain, 500),
        user_email: cleanText(updates.user_email, 320),
        mapped_payload_json: mappedPayload
      });
      return jsonResponse({ success: true, record: updated });
    }

    return jsonResponse({ success: false, error: 'Unsupported recovery action.' }, 400);
  } catch (error) {
    console.error('[Draft recovery query] request failed:', error);
    return jsonResponse({ success: false, error: 'Unable to access recovery records.' }, 500);
  }
});
