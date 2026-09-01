import { createClientFromRequest } from "npm:@base44/sdk";

const SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';
const GRANT_SCOPE = 'draft-recovery';
const GRANT_VERSION = 1;
const GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const RETENTION_DAYS = 1095;
const RETENTION_POLICY_VERSION = 'three-year-active-v1';
const MAX_ACTIVE_SHARE_LINKS = 20;
const encoder = new TextEncoder();

const RECORD_CONFIG = {
  draft: {
    entityName: 'ProFormDraft',
    sort: '-last_saved_at',
    statuses: new Set(['draft', 'submit_attempted', 'submit_failed', 'received_intake', 'submitted']),
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
      'progress_percent',
      'session_id',
      'final_submission_id',
      'archived_at',
      'archive_reason',
      'retention_until',
      'soft_deleted_at',
      'soft_deleted_by',
      'soft_delete_reason'
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
      'archive_reason',
      'retention_until',
      'soft_deleted_at',
      'soft_deleted_by',
      'soft_delete_reason'
    ]
  },
  submission: {
    entityName: 'ProFormSubmission',
    sort: '-created_date',
    statuses: new Set(['submitted']),
    searchFields: ['metadata.business_name', 'metadata.businessDomain', 'metadata.questionnaire_session_id', 'created_by'],
    summaryFields: [
      'id',
      'metadata',
      'created_date',
      'updated_date',
      'created_by',
      'archived_at',
      'archive_reason',
      'retention_until',
      'soft_deleted_at',
      'soft_deleted_by',
      'soft_delete_reason'
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

const badRequest = (error: string, context: Record<string, unknown>) => {
  console.warn('[Draft recovery query] request rejected', { error, ...context });
  return jsonResponse({ success: false, error }, 400);
};

const cleanText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const clampInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
};

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const randomToken = (byteLength = 32) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

const hashToken = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
};

const isSessionId = (value: string) => /^[A-Za-z0-9_-]{20,120}$/.test(value);

const parseSharedAccessHashes = (value: unknown) => {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item) => typeof item === 'string' && /^[A-Za-z0-9_-]{43,64}$/.test(item)))]
      : [];
  } catch {
    return [];
  }
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

const buildArchiveCondition = (archiveState: string) => {
  const notSoftDeleted = {
    $or: [
      { soft_deleted_at: { $exists: false } },
      { soft_deleted_at: null },
      { soft_deleted_at: '' }
    ]
  };

  if (archiveState === 'active') {
    return {
      $and: [
        notSoftDeleted,
        {
          $or: [
            { archived_at: { $exists: false } },
            { archived_at: null },
            { archived_at: '' }
          ]
        }
      ]
    };
  }

  if (archiveState === 'archived') {
    return {
      $and: [
        notSoftDeleted,
        { archived_at: { $exists: true } },
        { archived_at: { $ne: null } },
        { archived_at: { $ne: '' } }
      ]
    };
  }

  if (archiveState === 'deleted') {
    return {
      $and: [
        { soft_deleted_at: { $exists: true } },
        { soft_deleted_at: { $ne: null } },
        { soft_deleted_at: { $ne: '' } }
      ]
    };
  }

  if (archiveState === 'all') return null;

  return null;
};

const buildListQuery = (
  config: typeof RECORD_CONFIG[keyof typeof RECORD_CONFIG],
  status: string,
  archiveState: string,
  search: string
) => {
  const conditions: Record<string, unknown>[] = [];

  if (status !== 'all' && config.entityName !== 'ProFormSubmission') conditions.push({ status });
  if (config.entityName === 'ProFormSubmission') {
    conditions.push({
      $and: [
        {
          $or: [
            { 'metadata.source_draft_id': { $exists: false } },
            { 'metadata.source_draft_id': null },
            { 'metadata.source_draft_id': '' }
          ]
        },
        {
          $or: [
            { 'metadata.source_intake_id': { $exists: false } },
            { 'metadata.source_intake_id': null },
            { 'metadata.source_intake_id': '' }
          ]
        }
      ]
    });
  }
  const archiveCondition = buildArchiveCondition(archiveState);
  if (archiveCondition) conditions.push(archiveCondition);

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
  let adminIdentifier = '';

  try {
    const user = await base44.auth.me();
    isAdmin = user?.role === 'admin';
    if (isAdmin) adminIdentifier = cleanText(user?.email || user?.id, 320);
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
    return badRequest('Unsupported recovery record type.', {
      action: cleanText(body?.action, 20),
      recordType: recordType || '(missing)'
    });
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
        return badRequest('Unsupported status filter.', { action, recordType, status });
      }
      if (!['active', 'archived', 'deleted', 'all'].includes(archiveState)) {
        return badRequest('Unsupported archive filter.', { action, recordType, archiveState });
      }

      const query = buildListQuery(config, status, archiveState, search);
      const skip = (page - 1) * pageSize;
      const requestedLimit = pageSize + 1;
      const records = query
        ? await entity.filter(query, config.sort, requestedLimit, skip, [...config.summaryFields])
        : await entity.list(config.sort, requestedLimit, skip, [...config.summaryFields]);
      const safeRecords = Array.isArray(records) ? records : [];
      let pageRecords = safeRecords.slice(0, pageSize);
      const hasMore = safeRecords.length > pageSize;
      const anyRecords = query
        ? await entity.filter(query, config.sort, 1, 0, ['id'])
        : await entity.list(config.sort, 1, 0, ['id']);
      let duplicateSessionIds: string[] = [];

      if (recordType === 'draft') {
        const linkedIds = [...new Set(pageRecords.map((record) => record.final_submission_id).filter(Boolean))];
        if (linkedIds.length > 0) {
          const linkedSubmissions = await base44.asServiceRole.entities.ProFormSubmission.filter(
            { id: { $in: linkedIds } },
            '-created_date',
            linkedIds.length,
            0,
            ['id']
          );
          const existingIds = new Set((Array.isArray(linkedSubmissions) ? linkedSubmissions : []).map((record) => record.id));
          pageRecords = pageRecords.map((record) => ({
            ...record,
            link_integrity_status: record.final_submission_id && !existingIds.has(record.final_submission_id)
              ? 'missing_submission'
              : 'ok'
          }));
        }
        const sessionIds = [...new Set(pageRecords.map((record) => record.session_id).filter(Boolean))];
        if (sessionIds.length > 0) {
          const duplicateConditions: Record<string, unknown>[] = [
            { session_id: { $in: sessionIds } }
          ];
          const duplicateArchiveCondition = buildArchiveCondition(archiveState);
          if (duplicateArchiveCondition) duplicateConditions.push(duplicateArchiveCondition);
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
      return badRequest('A recovery record ID is required.', { action, recordType });
    }

    if (action === 'create_share_link' && recordType === 'draft') {
      const draft = await entity.get(recordId);
      if (!draft?.id) {
        return jsonResponse({ success: false, error: 'Questionnaire draft not found.' }, 404);
      }
      if (cleanText(draft.soft_deleted_at, 100)) {
        return jsonResponse({ success: false, error: 'Restore this deleted draft before creating a client link.' }, 410);
      }

      const sessionId = cleanText(draft.session_id, 120);
      if (!isSessionId(sessionId)) {
        return badRequest('This draft does not have a valid secure session ID.', { action, recordType, recordId });
      }

      const secret = randomToken();
      const tokenHash = await hashToken(secret);
      const previousHashes = parseSharedAccessHashes(draft.shared_access_token_hashes_json);
      const nextHashes = [...previousHashes, tokenHash].slice(-MAX_ACTIVE_SHARE_LINKS);
      const now = new Date().toISOString();
      const actorIdentifier = isAdmin ? (adminIdentifier || 'base44-admin') : 'password-recovery-grant';

      await entity.update(recordId, {
        shared_access_token_hashes_json: JSON.stringify(nextHashes),
        shared_access_link_created_at: now,
        shared_access_link_created_by: actorIdentifier,
        shared_access_link_generation_count: Math.max(0, Number(draft.shared_access_link_generation_count) || 0) + 1
      });

      try {
        await base44.asServiceRole.entities.ProFormDraftEvent.create({
          session_id: sessionId,
          event_type: 'admin_share_link_created',
          question_id: '',
          question_type: 'administrative_access',
          value_json: '{}',
          value_summary: 'An administrator created a secure client draft-resume link.',
          value_length: 0,
          selected_option_count: 0,
          business_name: cleanText(draft.business_name, 300),
          domain: cleanText(draft.domain, 500),
          user_id: '',
          created_at_iso: now
        });
      } catch (auditError) {
        // The draft itself retains who/when/count metadata. Do not strand the
        // newly issued client link if the secondary event record is unavailable.
        console.warn('[Draft recovery query] share-link event audit failed', {
          recordId,
          message: auditError instanceof Error ? auditError.message : 'unknown audit error'
        });
      }

      return jsonResponse({
        success: true,
        resumeCredential: `${sessionId}.${secret}`,
        issuedAt: now
      });
    }

    if (action === 'get') {
      const record = await entity.get(recordId);
      if (recordType === 'draft' && record?.final_submission_id) {
        const linked = await base44.asServiceRole.entities.ProFormSubmission.get(record.final_submission_id).catch(() => null);
        record.link_integrity_status = linked ? 'ok' : 'missing_submission';
      }
      return record
        ? jsonResponse({ success: true, record })
        : jsonResponse({ success: false, error: 'Recovery record not found.' }, 404);
    }

    if (action === 'update' && recordType === 'draft') {
      const updates = body?.updates && typeof body.updates === 'object' ? body.updates : {};
      const mappedPayload = updates.mapped_payload_json;
      if (!validateMappedPayload(mappedPayload)) {
        return badRequest('The mapped payload must be valid JSON.', { action, recordType });
      }

      const updated = await entity.update(recordId, {
        business_name: cleanText(updates.business_name, 300),
        domain: cleanText(updates.domain, 500),
        user_email: cleanText(updates.user_email, 320),
        mapped_payload_json: mappedPayload,
        archived_at: '',
        archive_reason: '',
        retention_policy_version: RETENTION_POLICY_VERSION,
        retention_started_at: new Date().toISOString(),
        retention_until: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      });
      return jsonResponse({ success: true, record: updated });
    }

    return badRequest('Unsupported recovery action.', { action: action || '(missing)', recordType });
  } catch (error) {
    console.error('[Draft recovery query] request failed:', error);
    return jsonResponse({ success: false, error: 'Unable to access recovery records.' }, 500);
  }
});
