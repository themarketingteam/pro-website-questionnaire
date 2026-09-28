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
const VERSION_QUERY_PAGE_SIZE = 500;
const VERSION_QUERY_MAX_RECORDS = 25_000;
const VERSION_SESSION_GAP_MS = 30 * 60 * 1000;
const encoder = new TextEncoder();

const RECORD_CONFIG = {
  draft: {
    entityName: 'ProFormDraft',
    sort: '-last_saved_at',
    statuses: new Set(['draft', 'submit_attempted', 'submit_failed', 'received_intake', 'submitted']),
    searchFields: ['business_name', 'domain', 'user_email', 'user_name', 'user_id', 'session_id', 'metadata_json'],
    summaryFields: [
      'id',
      'business_name',
      'domain',
      'user_email',
      'user_name',
      'user_id',
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

const safeParse = (value: unknown, fallback: any) => {
  try {
    if (!value) return fallback;
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

const safeStringify = (value: unknown, fallback = '{}') => {
  try { return JSON.stringify(value); } catch { return fallback; }
};

const normalizeDomain = (value: unknown) => cleanText(value, 500)
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/^www\./, '')
  .split('/')[0]
  .split('?')[0]
  .split('#')[0]
  .replace(/\.+$/, '');

const isPresentValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isPresentValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(isPresentValue);
  return true;
};

const responseCount = (responses: unknown) => Object.values(
  responses && typeof responses === 'object' && !Array.isArray(responses)
    ? responses as Record<string, unknown>
    : {}
).filter(isPresentValue).length;

const hashValue = async (value: unknown) => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(safeStringify(value))));
  return toBase64Url(bytes);
};

const collectFiltered = async (
  entity: any,
  query: Record<string, unknown>,
  sort: string,
  fields: string[],
  maximum = VERSION_QUERY_MAX_RECORDS
) => {
  const records: any[] = [];
  for (let skip = 0; skip < maximum; skip += VERSION_QUERY_PAGE_SIZE) {
    const page = await entity.filter(
      query,
      sort,
      Math.min(VERSION_QUERY_PAGE_SIZE, maximum - skip),
      skip,
      fields
    );
    const safePage = Array.isArray(page) ? page : [];
    records.push(...safePage);
    if (safePage.length < VERSION_QUERY_PAGE_SIZE) return { records, truncated: false };
  }
  return { records, truncated: true };
};

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
  search: string,
  identityState: string
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

  if (config.entityName === 'ProFormDraft' && identityState === 'identified') {
    conditions.push({
      $and: [
        { business_name: { $exists: true } },
        { business_name: { $ne: null } },
        { business_name: { $ne: '' } }
      ]
    });
  }
  if (config.entityName === 'ProFormDraft' && identityState === 'unidentified') {
    conditions.push({
      $or: [
        { business_name: { $exists: false } },
        { business_name: null },
        { business_name: '' }
      ]
    });
  }

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

const draftVersionFields = [
  'id', 'session_id', 'business_name', 'domain', 'user_email', 'user_name', 'user_id',
  'status', 'responses_json', 'validation_status_json', 'touched_questions_json',
  'expanded_questions_json', 'history_baseline_json', 'history_started_at', 'mapped_payload_json',
  'current_question_id', 'last_changed_question_id', 'progress_percent', 'save_revision',
  'last_saved_at', 'last_changed_at', 'submit_attempted_at', 'submitted_at',
  'final_submission_id', 'intake_id', 'created_date', 'updated_date', 'archived_at',
  'soft_deleted_at', 'retention_until'
];

const revisionVersionFields = [
  'id', 'draft_id', 'session_id', 'mutation_id', 'client_instance_id', 'client_sequence',
  'base_revision', 'changed_keys_json', 'deleted_keys_json', 'result_snapshot_json',
  'status', 'source', 'server_received_at', 'client_changed_at', 'created_date'
];

const submissionVersionFields = [
  'id', 'metadata', 'userdata', 'created_date', 'updated_date', 'created_by',
  'archived_at', 'soft_deleted_at', 'retention_until'
];

const identityMatchesDraft = (anchor: any, candidate: any) => {
  if (!anchor?.id || !candidate?.id) return false;
  if (anchor.id === candidate.id || (anchor.session_id && anchor.session_id === candidate.session_id)) return true;
  const anchorDomain = normalizeDomain(anchor.domain);
  const candidateDomain = normalizeDomain(candidate.domain);
  const anchorEmail = cleanText(anchor.user_email, 320).toLowerCase();
  const candidateEmail = cleanText(candidate.user_email, 320).toLowerCase();
  const anchorUserId = cleanText(anchor.user_id, 300);
  const candidateUserId = cleanText(candidate.user_id, 300);
  const anchorName = cleanText(anchor.business_name, 300).toLowerCase();
  const candidateName = cleanText(candidate.business_name, 300).toLowerCase();
  if (anchorUserId && candidateUserId && anchorUserId === candidateUserId) return true;
  if (anchorEmail && candidateEmail && anchorEmail === candidateEmail) return true;
  return Boolean(
    anchorDomain
    && candidateDomain
    && anchorDomain === candidateDomain
    && anchorName
    && candidateName
    && anchorName === candidateName
  );
};

const findRelatedDrafts = async (base44: any, anchor: any) => {
  const candidates = new Map<string, any>([[anchor.id, anchor]]);
  const queries: Record<string, unknown>[] = [];
  if (anchor.session_id) queries.push({ session_id: anchor.session_id });
  if (normalizeDomain(anchor.domain)) queries.push({ domain: normalizeDomain(anchor.domain) });
  if (cleanText(anchor.user_email, 320)) queries.push({ user_email: cleanText(anchor.user_email, 320) });
  if (cleanText(anchor.user_id, 300)) queries.push({ user_id: cleanText(anchor.user_id, 300) });

  for (const query of queries) {
    const matches = await base44.asServiceRole.entities.ProFormDraft.filter(
      query,
      '-last_saved_at',
      250,
      0,
      draftVersionFields
    );
    for (const candidate of Array.isArray(matches) ? matches : []) {
      if (identityMatchesDraft(anchor, candidate)) candidates.set(candidate.id, candidate);
    }
  }
  return [...candidates.values()];
};

const versionTimestamp = (record: any) => cleanText(
  record?.server_received_at
    || record?.client_changed_at
    || record?.submitted_at
    || record?.last_saved_at
    || record?.created_date,
  100
);

const versionLabelKind = (source: string, status: string) => {
  if (source === 'durable_submission_link' || status === 'submitted') return 'submitted';
  if (source === 'final_submission_barrier') return 'submission_barrier';
  if (source === 'explicit_clear_all') return 'cleared';
  if (source === 'explicit_question_clear') return 'question_cleared';
  if (source === 'admin_payload_edit') return 'admin_edit';
  if (source === 'recovery_version_copy') return 'recovery_copy';
  return 'autosave';
};

const buildVersionCatalog = async (base44: any, anchor: any, mode: string) => {
  const relatedDrafts = await findRelatedDrafts(base44, anchor);
  const draftIds = relatedDrafts.map((draft) => draft.id).filter(Boolean);
  const sessionIds = [...new Set(relatedDrafts.map((draft) => draft.session_id).filter(Boolean))];
  const revisionResult = draftIds.length
    ? await collectFiltered(
        base44.asServiceRole.entities.ProFormDraftRevision,
        { draft_id: { $in: draftIds } },
        'server_received_at',
        revisionVersionFields
      )
    : { records: [], truncated: false };

  const draftById = new Map(relatedDrafts.map((draft) => [draft.id, draft]));
  const revisionVersions: any[] = [];
  for (let index = 0; index < revisionResult.records.length; index += 1) {
    const revision = revisionResult.records[index];
    const snapshot = safeParse(revision.result_snapshot_json, {});
    const responses = snapshot?.responses || {};
    const sourceDraft = draftById.get(revision.draft_id) || anchor;
    revisionVersions.push({
      versionId: `revision:${revision.id}`,
      kind: versionLabelKind(cleanText(revision.source, 80), cleanText(revision.status, 40)),
      sourceType: 'revision',
      sourceRecordId: revision.id,
      draftId: revision.draft_id,
      sessionId: revision.session_id || sourceDraft.session_id || '',
      timestamp: versionTimestamp(revision),
      source: cleanText(revision.source, 80) || 'autosave',
      status: cleanText(revision.status, 40) || 'draft',
      responseCount: responseCount(responses),
      rawResponseKeyCount: Object.keys(responses).length,
      progressPercent: Math.max(0, Math.min(100, Number(snapshot?.progressPercent) || 0)),
      changedKeyCount: safeParse(revision.changed_keys_json, []).length || 0,
      deletedKeyCount: safeParse(revision.deleted_keys_json, []).length || 0,
      businessName: cleanText(snapshot?.credentials?.businessName || sourceDraft.business_name, 300),
      domain: normalizeDomain(snapshot?.credentials?.domain || sourceDraft.domain),
      snapshotHash: await hashValue(snapshot),
      meaningful: false,
      current: false,
      submitted: revision.source === 'durable_submission_link' || revision.status === 'submitted'
    });
  }

  const revisionsByDraft = new Map<string, any[]>();
  for (const version of revisionVersions) {
    const values = revisionsByDraft.get(version.draftId) || [];
    values.push(version);
    revisionsByDraft.set(version.draftId, values);
  }
  for (const values of revisionsByDraft.values()) {
    values.sort((left, right) => Date.parse(left.timestamp || '') - Date.parse(right.timestamp || ''));
    let highWater = -1;
    for (let index = 0; index < values.length; index += 1) {
      const version = values[index];
      const previous = values[index - 1];
      const next = values[index + 1];
      const gapAfter = next
        ? Date.parse(next.timestamp || '') - Date.parse(version.timestamp || '')
        : Number.POSITIVE_INFINITY;
      const isNewHighWater = version.responseCount > highWater;
      highWater = Math.max(highWater, version.responseCount);
      const beforeLargeDrop = Boolean(next && (
        next.responseCount === 0 && version.responseCount > 0
        || next.responseCount < version.responseCount * 0.5
        || next.deletedKeyCount >= Math.max(3, Math.floor(version.responseCount * 0.5))
      ));
      version.meaningful = Boolean(
        isNewHighWater
        || beforeLargeDrop
        || gapAfter >= VERSION_SESSION_GAP_MS
        || version.kind !== 'autosave'
        || index === values.length - 1
        || !previous
      );
      version.beforeClear = beforeLargeDrop;
    }
  }

  const currentVersions = await Promise.all(relatedDrafts.map(async (draft) => {
    const responses = safeParse(draft.responses_json, {});
    const snapshot = {
      responses,
      validationStatus: safeParse(draft.validation_status_json, {}),
      touchedQuestions: safeParse(draft.touched_questions_json, {}),
      expandedQuestions: safeParse(draft.expanded_questions_json, {}),
      credentials: {
        businessName: draft.business_name || '',
        domain: draft.domain || '',
        userId: draft.user_id || '',
        userName: draft.user_name || '',
        userEmail: draft.user_email || ''
      },
      currentQuestionId: draft.current_question_id || '',
      lastChangedQuestionId: draft.last_changed_question_id || '',
      progressPercent: Number(draft.progress_percent) || 0,
      mappedPayload: safeParse(draft.mapped_payload_json, {})
    };
    return {
      versionId: `current:${draft.id}`,
      kind: 'current',
      sourceType: 'draft',
      sourceRecordId: draft.id,
      draftId: draft.id,
      sessionId: draft.session_id || '',
      timestamp: versionTimestamp(draft),
      source: 'current_materialized_draft',
      status: draft.status || 'draft',
      responseCount: responseCount(responses),
      rawResponseKeyCount: Object.keys(responses).length,
      progressPercent: Math.max(0, Math.min(100, Number(draft.progress_percent) || 0)),
      changedKeyCount: 0,
      deletedKeyCount: 0,
      businessName: cleanText(draft.business_name, 300),
      domain: normalizeDomain(draft.domain),
      snapshotHash: await hashValue(snapshot),
      meaningful: true,
      current: draft.id === anchor.id,
      submitted: draft.status === 'submitted'
    };
  }));

  const submissionIds = new Set(relatedDrafts.map((draft) => draft.final_submission_id).filter(Boolean));
  let sessionSubmissions: any[] = [];
  if (sessionIds.length > 0) {
    const result = await collectFiltered(
      base44.asServiceRole.entities.ProFormSubmission,
      { 'metadata.questionnaire_session_id': { $in: sessionIds } },
      'created_date',
      submissionVersionFields,
      5000
    );
    sessionSubmissions = result.records;
    result.records.forEach((record) => submissionIds.add(record.id));
  }
  const linkedSubmissions = submissionIds.size > 0
    ? await base44.asServiceRole.entities.ProFormSubmission.filter(
        { id: { $in: [...submissionIds] } },
        'created_date',
        Math.min(5000, submissionIds.size),
        0,
        submissionVersionFields
      )
    : [];
  const submissions = new Map<string, any>();
  [...sessionSubmissions, ...(Array.isArray(linkedSubmissions) ? linkedSubmissions : [])]
    .forEach((record) => { if (record?.id) submissions.set(record.id, record); });
  const submissionVersions = await Promise.all([...submissions.values()].map(async (submission) => {
    const payload = { metadata: submission.metadata || {}, userdata: submission.userdata || {} };
    return {
      versionId: `submission:${submission.id}`,
      kind: 'final_submission',
      sourceType: 'submission',
      sourceRecordId: submission.id,
      draftId: submission.metadata?.source_draft_id || '',
      sessionId: submission.metadata?.questionnaire_session_id || '',
      timestamp: submission.metadata?.submission_datetime || submission.created_date || '',
      source: 'final_submission',
      status: 'submitted',
      responseCount: Object.keys(submission.userdata || {}).filter((key) => isPresentValue(submission.userdata?.[key])).length,
      rawResponseKeyCount: 0,
      progressPercent: 100,
      changedKeyCount: 0,
      deletedKeyCount: 0,
      businessName: cleanText(submission.metadata?.business_name, 300),
      domain: normalizeDomain(submission.metadata?.businessDomain || submission.metadata?.business_domain),
      snapshotHash: await hashValue(payload),
      meaningful: true,
      current: false,
      submitted: true
    };
  }));

  const allVersions = [...submissionVersions, ...currentVersions, ...revisionVersions]
    .sort((left, right) => Date.parse(right.timestamp || '') - Date.parse(left.timestamp || ''));
  const defaultVersion = [...allVersions].sort((left, right) => {
    const priority = (version: any) => version.kind === 'submitted'
      ? 6
      : version.kind === 'final_submission'
        ? 5
        : version.kind === 'submission_barrier'
          ? 3
          : version.responseCount > 0
            ? 2
            : 1;
    return priority(right) - priority(left)
      || right.responseCount - left.responseCount
      || right.progressPercent - left.progressPercent
      || Date.parse(right.timestamp || '') - Date.parse(left.timestamp || '');
  })[0] || null;
  const selectedVersions = mode === 'all'
    ? allVersions
    : allVersions.filter((version) => version.meaningful || version.versionId === defaultVersion?.versionId);
  const unique = new Map<string, any>();
  for (const version of selectedVersions) {
    const key = `${version.sourceType}:${version.sourceRecordId}`;
    if (!unique.has(key)) unique.set(key, version);
  }
  return {
    versions: [...unique.values()],
    defaultVersionId: defaultVersion?.versionId || `current:${anchor.id}`,
    totalVersionCount: allVersions.length,
    meaningfulVersionCount: allVersions.filter((version) => version.meaningful).length,
    relatedDraftCount: relatedDrafts.length,
    truncated: revisionResult.truncated,
    relatedDraftIds: draftIds
  };
};

const snapshotFromDraft = (draft: any) => ({
  responses: safeParse(draft.responses_json, {}),
  validationStatus: safeParse(draft.validation_status_json, {}),
  touchedQuestions: safeParse(draft.touched_questions_json, {}),
  expandedQuestions: safeParse(draft.expanded_questions_json, {}),
  credentials: {
    businessName: draft.business_name || '',
    domain: draft.domain || '',
    userId: draft.user_id || '',
    userName: draft.user_name || '',
    userEmail: draft.user_email || ''
  },
  currentQuestionId: draft.current_question_id || '',
  lastChangedQuestionId: draft.last_changed_question_id || '',
  progressPercent: Number(draft.progress_percent) || 0,
  mappedPayload: safeParse(draft.mapped_payload_json, {})
});

const publicVersionDetail = async (base44: any, anchor: any, versionId: string) => {
  const relatedDrafts = await findRelatedDrafts(base44, anchor);
  const relatedDraftIds = new Set(relatedDrafts.map((draft) => draft.id));
  const relatedSessionIds = new Set(relatedDrafts.map((draft) => draft.session_id).filter(Boolean));
  const [kind, sourceId] = versionId.split(':', 2);
  if (!kind || !sourceId) return null;

  if (kind === 'current') {
    const draft = relatedDrafts.find((record) => record.id === sourceId);
    if (!draft) return null;
    const snapshot = snapshotFromDraft(draft);
    return {
      versionId,
      sourceType: 'draft',
      sourceRecordId: draft.id,
      draftId: draft.id,
      sessionId: draft.session_id || '',
      timestamp: versionTimestamp(draft),
      source: 'current_materialized_draft',
      status: draft.status || 'draft',
      snapshot,
      payload: snapshot.mappedPayload,
      responseCount: responseCount(snapshot.responses),
      progressPercent: snapshot.progressPercent,
      current: draft.id === anchor.id,
      submitted: draft.status === 'submitted'
    };
  }

  if (kind === 'revision') {
    const revision = await base44.asServiceRole.entities.ProFormDraftRevision.get(sourceId).catch(() => null);
    if (!revision?.id || !relatedDraftIds.has(revision.draft_id)) return null;
    const snapshot = safeParse(revision.result_snapshot_json, {});
    const sourceDraft = relatedDrafts.find((draft) => draft.id === revision.draft_id) || anchor;
    const mappedPayload = snapshot?.mappedPayload && typeof snapshot.mappedPayload === 'object'
      ? snapshot.mappedPayload
      : {};
    return {
      versionId,
      sourceType: 'revision',
      sourceRecordId: revision.id,
      draftId: revision.draft_id,
      sessionId: revision.session_id || sourceDraft.session_id || '',
      timestamp: versionTimestamp(revision),
      source: revision.source || 'autosave',
      status: revision.status || 'draft',
      snapshot,
      payload: mappedPayload,
      responseCount: responseCount(snapshot.responses),
      progressPercent: Number(snapshot.progressPercent) || 0,
      current: false,
      submitted: revision.source === 'durable_submission_link' || revision.status === 'submitted'
    };
  }

  if (kind === 'submission') {
    const submission = await base44.asServiceRole.entities.ProFormSubmission.get(sourceId).catch(() => null);
    const submissionSessionId = submission?.metadata?.questionnaire_session_id || '';
    const submissionDraftId = submission?.metadata?.source_draft_id || '';
    if (!submission?.id || (!relatedSessionIds.has(submissionSessionId) && !relatedDraftIds.has(submissionDraftId))) return null;
    const payload = { metadata: submission.metadata || {}, userdata: submission.userdata || {} };
    return {
      versionId,
      sourceType: 'submission',
      sourceRecordId: submission.id,
      draftId: submissionDraftId,
      sessionId: submissionSessionId,
      timestamp: submission.metadata?.submission_datetime || submission.created_date || '',
      source: 'final_submission',
      status: 'submitted',
      snapshot: { responses: {}, credentials: {
        businessName: submission.metadata?.business_name || '',
        domain: submission.metadata?.businessDomain || submission.metadata?.business_domain || ''
      }, progressPercent: 100 },
      payload,
      responseCount: Object.values(submission.userdata || {}).filter(isPresentValue).length,
      progressPercent: 100,
      current: false,
      submitted: true
    };
  }
  return null;
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
      const identityState = cleanText(body?.identityState, 20) || 'all';
      const search = cleanText(body?.search, 200);

      if (status !== 'all' && !config.statuses.has(status)) {
        return badRequest('Unsupported status filter.', { action, recordType, status });
      }
      if (!['active', 'archived', 'deleted', 'all'].includes(archiveState)) {
        return badRequest('Unsupported archive filter.', { action, recordType, archiveState });
      }
      if (!['all', 'identified', 'unidentified'].includes(identityState)) {
        return badRequest('Unsupported identity filter.', { action, recordType, identityState });
      }

      const query = buildListQuery(config, status, archiveState, search, identityState);
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

    if (recordType === 'draft' && action === 'list_versions') {
      const anchor = await entity.get(recordId).catch(() => null);
      if (!anchor?.id) return jsonResponse({ success: false, error: 'Questionnaire draft not found.' }, 404);
      const mode = cleanText(body?.mode, 20) === 'all' ? 'all' : 'meaningful';
      const catalog = await buildVersionCatalog(base44, anchor, mode);
      return jsonResponse({ success: true, mode, ...catalog });
    }

    if (recordType === 'draft' && action === 'get_version') {
      const anchor = await entity.get(recordId).catch(() => null);
      if (!anchor?.id) return jsonResponse({ success: false, error: 'Questionnaire draft not found.' }, 404);
      const versionId = cleanText(body?.versionId, 300);
      const version = await publicVersionDetail(base44, anchor, versionId);
      return version
        ? jsonResponse({ success: true, version })
        : jsonResponse({ success: false, error: 'Questionnaire version not found.' }, 404);
    }

    if (recordType === 'draft' && action === 'create_version_copy') {
      const anchor = await entity.get(recordId).catch(() => null);
      if (!anchor?.id) return jsonResponse({ success: false, error: 'Questionnaire draft not found.' }, 404);
      const versionId = cleanText(body?.versionId, 300);
      const version = await publicVersionDetail(base44, anchor, versionId);
      if (!version) return jsonResponse({ success: false, error: 'Questionnaire version not found.' }, 404);
      const snapshot = version.snapshot && typeof version.snapshot === 'object' ? version.snapshot : {};
      const responses = snapshot.responses && typeof snapshot.responses === 'object' && !Array.isArray(snapshot.responses)
        ? snapshot.responses
        : {};
      if (Object.keys(responses).length === 0 && version.sourceType === 'submission') {
        return badRequest('Final submissions do not contain the raw answer map required to create an editable draft copy.', {
          action,
          recordType,
          recordId,
          versionId
        });
      }
      const credentials = snapshot.credentials && typeof snapshot.credentials === 'object'
        ? snapshot.credentials
        : {};
      const now = new Date().toISOString();
      const sessionId = crypto.randomUUID();
      const secret = randomToken();
      const baseline = {
        responses,
        validationStatus: snapshot.validationStatus || {},
        touchedQuestions: snapshot.touchedQuestions || {},
        expandedQuestions: snapshot.expandedQuestions || {},
        credentials: {
          businessName: cleanText(credentials.businessName || anchor.business_name, 300),
          domain: normalizeDomain(credentials.domain || anchor.domain),
          userId: cleanText(credentials.userId || anchor.user_id, 300),
          userName: cleanText(credentials.userName || anchor.user_name, 300),
          userEmail: cleanText(credentials.userEmail || anchor.user_email, 320)
        },
        currentQuestionId: cleanText(snapshot.currentQuestionId, 40),
        lastChangedQuestionId: cleanText(snapshot.lastChangedQuestionId, 40),
        progressPercent: Math.max(0, Math.min(100, Number(snapshot.progressPercent) || 0))
      };
      const payload = version.payload && typeof version.payload === 'object'
        ? version.payload
        : {};
      const created = await entity.create({
        session_id: sessionId,
        access_token_hash: await hashToken(secret),
        access_version: 1,
        shared_access_token_hashes_json: '[]',
        history_baseline_json: safeStringify(baseline),
        history_started_at: now,
        save_revision: 0,
        latest_client_sequences_json: '{}',
        progress_percent: baseline.progressPercent,
        business_name: baseline.credentials.businessName,
        domain: baseline.credentials.domain,
        user_id: baseline.credentials.userId,
        user_name: baseline.credentials.userName,
        user_email: baseline.credentials.userEmail,
        status: 'draft',
        current_question_id: baseline.currentQuestionId,
        last_changed_question_id: baseline.lastChangedQuestionId,
        responses_json: safeStringify(baseline.responses),
        validation_status_json: safeStringify(baseline.validationStatus),
        touched_questions_json: safeStringify(baseline.touchedQuestions),
        expanded_questions_json: safeStringify(baseline.expandedQuestions),
        metadata_json: safeStringify(payload?.metadata || {}),
        userdata_json: safeStringify(payload?.userdata || {}),
        mapped_payload_json: safeStringify(payload),
        draft_metadata_json: safeStringify({
          app: 'pro_questionnaire',
          source: 'recovery_version_copy',
          source_draft_id: anchor.id,
          source_version_id: versionId
        }),
        last_changed_at: now,
        last_saved_at: now,
        retention_policy_version: RETENTION_POLICY_VERSION,
        retention_started_at: now,
        retention_until: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        archived_at: '',
        archive_reason: '',
        soft_deleted_at: '',
        soft_deleted_by: '',
        soft_delete_reason: ''
      });
      await base44.asServiceRole.entities.ProFormDraftEvent.create({
        session_id: sessionId,
        event_type: 'recovery_version_copy_created',
        question_id: '',
        question_type: 'administrative_recovery',
        value_json: safeStringify({ source_draft_id: anchor.id, source_version_id: versionId }),
        value_summary: 'An administrator created an editable recovery copy from a retained questionnaire version.',
        value_length: 0,
        selected_option_count: 0,
        business_name: baseline.credentials.businessName,
        domain: baseline.credentials.domain,
        user_id: baseline.credentials.userId,
        created_at_iso: now
      }).catch(() => null);
      return jsonResponse({
        success: true,
        recordId: created?.id || '',
        sessionId,
        resumeCredential: `${sessionId}.${secret}`,
        sourceVersionId: versionId
      });
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

      const beforeUpdate = await entity.get(recordId);
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
      const now = new Date().toISOString();
      const adminInstanceId = `admin-${crypto.randomUUID()}`;
      const snapshot = {
        ...snapshotFromDraft(updated),
        mappedPayload: safeParse(mappedPayload, {})
      };
      const revision = await base44.asServiceRole.entities.ProFormDraftRevision.create({
        draft_id: updated.id,
        session_id: updated.session_id,
        mutation_id: `admin-payload-${crypto.randomUUID()}`,
        client_instance_id: adminInstanceId,
        client_sequence: 1,
        base_revision: Math.max(0, Number(beforeUpdate?.save_revision) || 0),
        changed_keys_json: '[]',
        deleted_keys_json: '[]',
        changes_json: safeStringify({
          responses: {},
          deletedKeys: [],
          validationStatus: {},
          touchedQuestions: {},
          expandedQuestions: {},
          credentials: snapshot.credentials,
          currentQuestionId: snapshot.currentQuestionId,
          lastChangedQuestionId: snapshot.lastChangedQuestionId,
          progressPercent: snapshot.progressPercent
        }),
        result_snapshot_json: safeStringify(snapshot),
        status: updated.status || 'draft',
        server_received_at: now,
        client_changed_at: now,
        source: 'admin_payload_edit'
      });
      const materialized = await entity.update(recordId, {
        save_revision: Math.max(0, Number(beforeUpdate?.save_revision) || 0) + 1
      });
      return jsonResponse({ success: true, record: materialized, revisionId: revision?.id || '' });
    }

    return badRequest('Unsupported recovery action.', { action: action || '(missing)', recordType });
  } catch (error) {
    console.error('[Draft recovery query] request failed:', error);
    return jsonResponse({ success: false, error: 'Unable to access recovery records.' }, 500);
  }
});
