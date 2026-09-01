import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';

const MAX_REQUEST_BYTES = 2_250_000;
const MAX_RESPONSE_KEYS = 160;
const MAX_STRING_LENGTH = 180_000;
const MAX_ARRAY_ITEMS = 250;
const MAX_DEPTH = 10;
const ACCESS_VERSION = 1;
const RETENTION_DAYS = 1095;
const RETENTION_POLICY_VERSION = 'three-year-active-v1';
const encoder = new TextEncoder();

type JsonRecord = Record<string, unknown>;

const jsonResponse = (body: JsonRecord, status = 200) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache'
  }
});

const cleanText = (value: unknown, maxLength = 500) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const retentionUntilFrom = (value: string) => new Date(
  Date.parse(value) + RETENTION_DAYS * 24 * 60 * 60 * 1000
).toISOString();

const safeParse = (value: unknown, fallback: unknown) => {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const safeStringify = (value: unknown, fallback = '{}') => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return fallback;
  }
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

const constantTimeEqual = (left: string, right: string) => {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const isSessionId = (value: string) => /^[A-Za-z0-9_-]{20,120}$/.test(value);
const isClientId = (value: string) => /^[A-Za-z0-9_-]{12,120}$/.test(value);
const isMutationId = (value: string) => /^[A-Za-z0-9_-]{12,160}$/.test(value);
const isAnswerKey = (value: string) => /^\d+(?:\.\d+)?(?:_(?:other|primary))?$/.test(value);
const forbiddenKey = (value: string) => /(?:password|authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret)/i.test(value);

const sanitizeJsonValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) throw new Error('Draft value nesting is too deep.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new Error('Draft array exceeds the supported size.');
    return value.map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as JsonRecord);
    if (entries.length > 300) throw new Error('Draft object has too many fields.');
    const next: JsonRecord = {};
    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey).slice(0, 160);
      if (!key || ['__proto__', 'prototype', 'constructor'].includes(key) || forbiddenKey(key)) continue;
      next[key] = sanitizeJsonValue(rawValue, depth + 1);
    }
    return next;
  }
  return null;
};

const sanitizeAnswerMap = (value: unknown) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
  const entries = Object.entries(source).filter(([key]) => isAnswerKey(key));
  if (entries.length > MAX_RESPONSE_KEYS) throw new Error('Draft has too many response fields.');
  return entries.reduce((result, [key, item]) => {
    result[key] = sanitizeJsonValue(item);
    return result;
  }, {} as JsonRecord);
};

const sanitizeStateMap = (value: unknown, kind: 'validation' | 'boolean') => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
  return Object.entries(source).reduce((result, [key, item]) => {
    if (!/^\d+(?:\.\d+)?$/.test(key)) return result;
    if (kind === 'boolean') result[key] = Boolean(item);
    else result[key] = ['complete', 'needs_work', 'incomplete', 'neutral', ''].includes(String(item)) ? String(item) : '';
    return result;
  }, {} as JsonRecord);
};

const sanitizeCredentials = (value: unknown) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
  return {
    businessName: cleanText(source.businessName, 300),
    domain: cleanText(source.domain, 500),
    userId: cleanText(source.userId, 300),
    userName: cleanText(source.userName, 300),
    userEmail: cleanText(source.userEmail, 320)
  };
};

const normalizeDomain = (value: string) => value
  .replace(/^https?:\/\//i, '')
  .replace(/^www\./i, '')
  .split('/')[0]
  .trim()
  .toLowerCase()
  .slice(0, 500);

const parseCredential = (value: unknown) => {
  const text = cleanText(value, 400);
  const separator = text.indexOf('.');
  if (separator < 1) return null;
  const sessionId = text.slice(0, separator);
  const secret = text.slice(separator + 1);
  if (!isSessionId(sessionId) || !/^[A-Za-z0-9_-]{32,160}$/.test(secret)) return null;
  return { sessionId, secret, raw: text };
};

const findDraftCandidates = async (entity: any, sessionId: string) => {
  const records = await entity.filter({ session_id: sessionId }, '-last_saved_at', 10);
  const safeRecords = Array.isArray(records) ? records : [];
  return safeRecords.sort((left, right) => {
    const leftTime = Date.parse(left.last_saved_at || left.updated_date || left.created_date || '') || 0;
    const rightTime = Date.parse(right.last_saved_at || right.updated_date || right.created_date || '') || 0;
    return rightTime - leftTime;
  });
};

const findLatestDraft = async (entity: any, sessionId: string) => (
  (await findDraftCandidates(entity, sessionId))[0] || null
);

const parseSharedAccessHashes = (value: unknown) => {
  const parsed = safeParse(value, []);
  return Array.isArray(parsed)
    ? parsed.filter((item) => typeof item === 'string' && /^[A-Za-z0-9_-]{43,64}$/.test(item))
    : [];
};

const draftAcceptsAccessHash = (draft: any, suppliedHash: string) => {
  const primaryMatches = constantTimeEqual(String(draft?.access_token_hash || ''), suppliedHash);
  const sharedMatches = parseSharedAccessHashes(draft?.shared_access_token_hashes_json)
    .some((storedHash) => constantTimeEqual(storedHash, suppliedHash));
  return primaryMatches || sharedMatches;
};

const authorizeDraft = async (entity: any, credentialValue: unknown) => {
  const credential = parseCredential(credentialValue);
  if (!credential) return { error: 'A valid draft recovery credential is required.', status: 401 };
  const suppliedHash = await hashToken(credential.secret);
  const candidates = await findDraftCandidates(entity, credential.sessionId);
  const draft = candidates.find((candidate) => candidate?.id && draftAcceptsAccessHash(candidate, suppliedHash));
  if (!draft?.id) return { error: 'Draft recovery credential was not recognized.', status: 401 };
  if (cleanText(draft.soft_deleted_at, 100)) {
    return { error: 'This questionnaire draft was removed by an administrator.', status: 410 };
  }
  return { draft, credential };
};

const baselineFromDraft = (draft: any) => ({
  responses: sanitizeAnswerMap(safeParse(draft?.responses_json, {})),
  validationStatus: sanitizeStateMap(safeParse(draft?.validation_status_json, {}), 'validation'),
  touchedQuestions: sanitizeStateMap(safeParse(draft?.touched_questions_json, {}), 'boolean'),
  expandedQuestions: sanitizeStateMap(safeParse(draft?.expanded_questions_json, {}), 'boolean'),
  credentials: {
    businessName: cleanText(draft?.business_name, 300),
    domain: cleanText(draft?.domain, 500),
    userId: cleanText(draft?.user_id, 300),
    userName: cleanText(draft?.user_name, 300),
    userEmail: cleanText(draft?.user_email, 320)
  },
  currentQuestionId: cleanText(draft?.current_question_id, 40),
  lastChangedQuestionId: cleanText(draft?.last_changed_question_id, 40),
  progressPercent: Math.max(0, Math.min(100, Number(draft?.progress_percent) || 0))
});

const getBaseline = (draft: any) => {
  const stored = safeParse(draft?.history_baseline_json, null);
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const source = stored as JsonRecord;
    return {
      responses: sanitizeAnswerMap(source.responses),
      validationStatus: sanitizeStateMap(source.validationStatus, 'validation'),
      touchedQuestions: sanitizeStateMap(source.touchedQuestions, 'boolean'),
      expandedQuestions: sanitizeStateMap(source.expandedQuestions, 'boolean'),
      credentials: sanitizeCredentials(source.credentials),
      currentQuestionId: cleanText(source.currentQuestionId, 40),
      lastChangedQuestionId: cleanText(source.lastChangedQuestionId, 40),
      progressPercent: Math.max(0, Math.min(100, Number(source.progressPercent) || 0))
    };
  }
  return baselineFromDraft(draft);
};

const applyChanges = (snapshot: any, changeRecord: any) => {
  const changes = changeRecord && typeof changeRecord === 'object' ? changeRecord : {};
  const answerChanges = sanitizeAnswerMap(changes.responses);
  Object.entries(answerChanges).forEach(([key, value]) => { snapshot.responses[key] = value; });
  const deletedKeys = Array.isArray(changes.deletedKeys) ? changes.deletedKeys : [];
  deletedKeys.filter((key: unknown) => typeof key === 'string' && isAnswerKey(key)).forEach((key: string) => {
    delete snapshot.responses[key];
    delete snapshot.validationStatus[key];
    delete snapshot.touchedQuestions[key];
    delete snapshot.expandedQuestions[key];
  });
  Object.assign(snapshot.validationStatus, sanitizeStateMap(changes.validationStatus, 'validation'));
  Object.assign(snapshot.touchedQuestions, sanitizeStateMap(changes.touchedQuestions, 'boolean'));
  Object.assign(snapshot.expandedQuestions, sanitizeStateMap(changes.expandedQuestions, 'boolean'));
  const credentials = sanitizeCredentials(changes.credentials);
  Object.entries(credentials).forEach(([key, value]) => {
    if (value) snapshot.credentials[key] = value;
  });
  if (cleanText(changes.currentQuestionId, 40)) snapshot.currentQuestionId = cleanText(changes.currentQuestionId, 40);
  if (cleanText(changes.lastChangedQuestionId, 40)) snapshot.lastChangedQuestionId = cleanText(changes.lastChangedQuestionId, 40);
  if (Number.isFinite(Number(changes.progressPercent))) {
    snapshot.progressPercent = Math.max(0, Math.min(100, Number(changes.progressPercent)));
  }
  return snapshot;
};

const rebuildSnapshot = async (base44: any, draft: any) => {
  const snapshot = getBaseline(draft);
  const revisions = await base44.asServiceRole.entities.ProFormDraftRevision.filter(
    { draft_id: draft.id },
    'server_received_at',
    5000
  );
  const ordered = (Array.isArray(revisions) ? revisions : []).sort((left, right) => {
    const timeDifference = (Date.parse(left.client_changed_at || left.server_received_at || left.created_date || '') || 0)
      - (Date.parse(right.client_changed_at || right.server_received_at || right.created_date || '') || 0);
    if (timeDifference !== 0) return timeDifference;
    return String(left.mutation_id || '').localeCompare(String(right.mutation_id || ''));
  });
  const sequences: Record<string, number> = {};
  let applied = 0;
  for (const revision of ordered) {
    const clientId = cleanText(revision.client_instance_id, 120);
    const sequence = Math.max(0, Math.floor(Number(revision.client_sequence) || 0));
    if (!clientId || sequence <= (sequences[clientId] || 0)) continue;
    sequences[clientId] = sequence;
    applyChanges(snapshot, safeParse(revision.changes_json, {}));
    applied += 1;
  }
  return { snapshot, sequences, revision: applied, latestRevision: ordered[ordered.length - 1] || null };
};

const materializeDraft = async (base44: any, draft: any, rebuilt: any, lifecycle: any = {}) => {
  const now = new Date().toISOString();
  const latestDraft = await base44.asServiceRole.entities.ProFormDraft.get(draft.id).catch(() => draft);
  draft = latestDraft || draft;
  const snapshot = rebuilt.snapshot;
  const credentials = sanitizeCredentials(snapshot.credentials);
  const mappedPayload = lifecycle.mappedPayload && typeof lifecycle.mappedPayload === 'object'
    ? sanitizeJsonValue(lifecycle.mappedPayload)
    : safeParse(draft.mapped_payload_json, {});
  const metadata = mappedPayload && typeof mappedPayload === 'object' && !Array.isArray(mappedPayload)
    ? (mappedPayload as JsonRecord).metadata || {}
    : {};
  const userdata = mappedPayload && typeof mappedPayload === 'object' && !Array.isArray(mappedPayload)
    ? (mappedPayload as JsonRecord).userdata || {}
    : {};
  const currentStatus = cleanText(draft.status, 40) || 'draft';
  const requestedStatus = cleanText(lifecycle.status, 40);
  let status = currentStatus;
  if (currentStatus !== 'submitted') {
    if (['draft', 'submit_attempted', 'submit_failed', 'received_intake', 'submitted'].includes(requestedStatus)) {
      status = requestedStatus;
    }
  }
  const finalSubmissionId = status === 'submitted'
    ? cleanText(lifecycle.finalSubmissionId || draft.final_submission_id, 300)
    : cleanText(draft.final_submission_id, 300);
  if (status === 'submitted' && !finalSubmissionId) {
    throw new Error('A durable final submission ID is required before marking a draft submitted.');
  }
  const intakeId = status === 'received_intake'
    ? cleanText(lifecycle.intakeId || draft.intake_id, 300)
    : cleanText(draft.intake_id, 300);
  if (status === 'received_intake' && !intakeId) {
    throw new Error('A durable intake ID is required before marking a draft received.');
  }
  const update = {
    business_name: credentials.businessName,
    domain: normalizeDomain(credentials.domain),
    user_id: credentials.userId,
    user_name: credentials.userName,
    user_email: credentials.userEmail,
    status,
    current_question_id: snapshot.currentQuestionId || '',
    last_changed_question_id: snapshot.lastChangedQuestionId || '',
    responses_json: safeStringify(snapshot.responses),
    validation_status_json: safeStringify(snapshot.validationStatus),
    touched_questions_json: safeStringify(snapshot.touchedQuestions),
    expanded_questions_json: safeStringify(snapshot.expandedQuestions),
    metadata_json: safeStringify(metadata),
    userdata_json: safeStringify(userdata),
    mapped_payload_json: safeStringify(mappedPayload),
    draft_metadata_json: safeStringify({ app: 'pro_questionnaire', source: 'secure_server_draft_v1' }),
    save_error: '',
    submit_error: cleanText(lifecycle.submitError, 10_000) || (requestedStatus ? '' : cleanText(draft.submit_error, 10_000)),
    final_submission_id: finalSubmissionId,
    intake_id: intakeId,
    submit_attempted_at: ['submit_attempted', 'submit_failed', 'received_intake'].includes(status)
      ? (draft.submit_attempted_at || now)
      : cleanText(draft.submit_attempted_at, 100),
    submitted_at: status === 'submitted' ? (draft.submitted_at || now) : cleanText(draft.submitted_at, 100),
    last_changed_at: lifecycle.changed ? now : (draft.last_changed_at || now),
    last_saved_at: now,
    save_revision: rebuilt.revision,
    latest_client_sequences_json: safeStringify(rebuilt.sequences),
    progress_percent: snapshot.progressPercent || 0,
    retention_policy_version: RETENTION_POLICY_VERSION,
    retention_started_at: now,
    retention_until: retentionUntilFrom(now),
    archived_at: '',
    archive_reason: ''
  };
  const updated = await base44.asServiceRole.entities.ProFormDraft.update(draft.id, update);
  if (cleanText(draft.archived_at, 100)) {
    await base44.asServiceRole.entities.ProFormRecoveryLifecycleEvent.create({
      record_type: 'draft',
      record_id: draft.id,
      action: 'reactivate',
      actor_mode: 'draft_resume_credential',
      actor_identifier: '',
      reason: 'Authorized client activity resumed the archived draft.',
      occurred_at: now,
      previous_state_json: safeStringify({
        archived_at: draft.archived_at,
        archive_reason: draft.archive_reason
      })
    }).catch(() => null);
  }
  return updated;
};

const publicDraft = (draft: any, rebuilt: any) => ({
  draftId: draft.id,
  sessionId: draft.session_id,
  revision: rebuilt.revision,
  responses: rebuilt.snapshot.responses,
  validationStatus: rebuilt.snapshot.validationStatus,
  touchedQuestions: rebuilt.snapshot.touchedQuestions,
  expandedQuestions: rebuilt.snapshot.expandedQuestions,
  credentials: rebuilt.snapshot.credentials,
  currentQuestionId: rebuilt.snapshot.currentQuestionId || '',
  lastChangedQuestionId: rebuilt.snapshot.lastChangedQuestionId || '',
  progressPercent: rebuilt.snapshot.progressPercent || 0,
  status: draft.status || 'draft',
  finalSubmissionId: draft.final_submission_id || '',
  intakeId: draft.intake_id || '',
  lastSavedAt: draft.last_saved_at || draft.updated_date || draft.created_date || ''
});

const createDraft = async (base44: any, sessionId: string, accessHash: string, credentialsValue: unknown) => {
  const now = new Date().toISOString();
  const credentials = sanitizeCredentials(credentialsValue);
  const baseline = {
    responses: {},
    validationStatus: {},
    touchedQuestions: {},
    expandedQuestions: {},
    credentials,
    currentQuestionId: '',
    lastChangedQuestionId: '',
    progressPercent: 0
  };
  return base44.asServiceRole.entities.ProFormDraft.create({
    session_id: sessionId,
    access_token_hash: accessHash,
    access_version: ACCESS_VERSION,
    history_baseline_json: safeStringify(baseline),
    history_started_at: now,
    save_revision: 0,
    latest_client_sequences_json: '{}',
    progress_percent: 0,
    business_name: credentials.businessName,
    domain: normalizeDomain(credentials.domain),
    user_id: credentials.userId,
    user_name: credentials.userName,
    user_email: credentials.userEmail,
    status: 'draft',
    responses_json: '{}',
    validation_status_json: '{}',
    touched_questions_json: '{}',
    expanded_questions_json: '{}',
    metadata_json: '{}',
    userdata_json: '{}',
    mapped_payload_json: '{}',
    draft_metadata_json: safeStringify({ app: 'pro_questionnaire', source: 'secure_server_draft_v1' }),
    last_changed_at: now,
    last_saved_at: now,
    retention_policy_version: RETENTION_POLICY_VERSION,
    retention_started_at: now,
    retention_until: retentionUntilFrom(now),
    archived_at: '',
    archive_reason: '',
    soft_deleted_at: '',
    soft_deleted_by: '',
    soft_delete_reason: ''
  });
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return jsonResponse({ success: false, error: 'Draft request is too large.' }, 413);

  let body: any = {};
  try {
    body = await req.json();
    if (safeStringify(body).length > MAX_REQUEST_BYTES) {
      return jsonResponse({ success: false, error: 'Draft request is too large.' }, 413);
    }
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON request.' }, 400);
  }

  const action = cleanText(body?.action, 30);
  const base44 = createClientFromRequest(req);
  const draftEntity = base44.asServiceRole.entities.ProFormDraft;

  try {
    if (action === 'bootstrap') {
      const suppliedCredential = parseCredential(body?.resumeCredential);
      let draft: any = null;
      let resumeCredential = suppliedCredential?.raw || '';

      if (suppliedCredential) {
        const authorized = await authorizeDraft(draftEntity, suppliedCredential.raw);
        if ('error' in authorized) return jsonResponse({ success: false, error: authorized.error }, authorized.status);
        draft = authorized.draft;
      } else {
        const legacySessionId = cleanText(body?.legacySessionId, 120);
        if (isSessionId(legacySessionId)) {
          const legacyDraft = await findLatestDraft(draftEntity, legacySessionId);
          if (legacyDraft?.id && !legacyDraft.access_token_hash && !cleanText(legacyDraft.soft_deleted_at, 100)) draft = legacyDraft;
        }

        const sessionId = draft?.session_id || crypto.randomUUID();
        const secret = randomToken();
        resumeCredential = `${sessionId}.${secret}`;
        const accessHash = await hashToken(secret);
        if (draft?.id) {
          const baseline = baselineFromDraft(draft);
          draft = await draftEntity.update(draft.id, {
            access_token_hash: accessHash,
            access_version: ACCESS_VERSION,
            history_baseline_json: safeStringify(baseline),
            history_started_at: new Date().toISOString(),
            save_revision: 0,
            latest_client_sequences_json: '{}'
          });
        } else {
          draft = await createDraft(base44, sessionId, accessHash, body?.credentials);
        }
      }

      const rebuilt = await rebuildSnapshot(base44, draft);
      const materialized = await materializeDraft(base44, draft, rebuilt, { changed: false });
      return jsonResponse({
        success: true,
        resumeCredential,
        draft: publicDraft(materialized, rebuilt)
      });
    }

    const authorized = await authorizeDraft(draftEntity, body?.resumeCredential);
    if ('error' in authorized) return jsonResponse({ success: false, error: authorized.error }, authorized.status);
    let draft = authorized.draft;

    if (action === 'event') {
      const event = body?.event && typeof body.event === 'object' ? body.event : {};
      const created = await base44.asServiceRole.entities.ProFormDraftEvent.create({
        session_id: draft.session_id,
        event_type: cleanText(event.event_type, 80),
        question_id: cleanText(event.question_id, 40),
        question_type: cleanText(event.question_type, 80),
        value_json: cleanText(event.value_json, 180_000),
        value_summary: cleanText(event.value_summary, 500),
        value_length: Math.max(0, Math.min(2_000_000, Number(event.value_length) || 0)),
        selected_option_count: Math.max(0, Math.min(500, Number(event.selected_option_count) || 0)),
        business_name: cleanText(draft.business_name, 300),
        domain: cleanText(draft.domain, 500),
        user_id: cleanText(draft.user_id, 300),
        created_at_iso: new Date().toISOString()
      });
      return jsonResponse({ success: true, eventId: created?.id || '' });
    }

    if (action !== 'save') return jsonResponse({ success: false, error: 'Unsupported draft action.' }, 400);

    const clientInstanceId = cleanText(body?.clientInstanceId, 120);
    const mutationId = cleanText(body?.mutationId, 160);
    const clientSequence = Math.floor(Number(body?.clientSequence) || 0);
    if (!isClientId(clientInstanceId) || !isMutationId(mutationId) || clientSequence < 1) {
      return jsonResponse({ success: false, error: 'Invalid draft save ordering metadata.' }, 400);
    }

    const duplicates = await base44.asServiceRole.entities.ProFormDraftRevision.filter({
      draft_id: draft.id,
      mutation_id: mutationId
    }, '-created_date', 1);
    if (Array.isArray(duplicates) && duplicates.length > 0) {
      const rebuilt = await rebuildSnapshot(base44, draft);
      draft = await materializeDraft(base44, draft, rebuilt, { changed: false });
      return jsonResponse({ success: true, duplicate: true, draft: publicDraft(draft, rebuilt) });
    }

    const rebuiltBefore = await rebuildSnapshot(base44, draft);
    if (clientSequence <= (rebuiltBefore.sequences[clientInstanceId] || 0)) {
      draft = await materializeDraft(base44, draft, rebuiltBefore, { changed: false });
      return jsonResponse({ success: true, stale: true, draft: publicDraft(draft, rebuiltBefore) });
    }

    const changedKeys = Array.isArray(body?.changedKeys)
      ? [...new Set(body.changedKeys.filter((key: unknown) => typeof key === 'string' && isAnswerKey(key)))].slice(0, MAX_RESPONSE_KEYS)
      : [];
    const deletedKeys = Array.isArray(body?.deletedKeys)
      ? [...new Set(body.deletedKeys.filter((key: unknown) => typeof key === 'string' && isAnswerKey(key)))].slice(0, MAX_RESPONSE_KEYS)
      : [];
    const incomingResponses = sanitizeAnswerMap(body?.responses);
    const responseChanges = changedKeys.reduce((result, key) => {
      if (Object.prototype.hasOwnProperty.call(incomingResponses, key)) result[key] = incomingResponses[key];
      return result;
    }, {} as JsonRecord);
    const changes = {
      responses: responseChanges,
      deletedKeys,
      validationStatus: sanitizeStateMap(body?.validationStatus, 'validation'),
      touchedQuestions: sanitizeStateMap(body?.touchedQuestions, 'boolean'),
      expandedQuestions: sanitizeStateMap(body?.expandedQuestions, 'boolean'),
      credentials: sanitizeCredentials(body?.credentials),
      currentQuestionId: cleanText(body?.currentQuestionId, 40),
      lastChangedQuestionId: cleanText(body?.lastChangedQuestionId, 40),
      progressPercent: Math.max(0, Math.min(100, Number(body?.progressPercent) || 0))
    };
    const resultSnapshot = applyChanges(structuredClone(rebuiltBefore.snapshot), changes);
    const now = new Date().toISOString();
    const revision = await base44.asServiceRole.entities.ProFormDraftRevision.create({
      draft_id: draft.id,
      session_id: draft.session_id,
      mutation_id: mutationId,
      client_instance_id: clientInstanceId,
      client_sequence: clientSequence,
      base_revision: Math.max(0, Math.floor(Number(body?.baseRevision) || rebuiltBefore.revision)),
      changed_keys_json: safeStringify(changedKeys, '[]'),
      deleted_keys_json: safeStringify(deletedKeys, '[]'),
      changes_json: safeStringify(changes),
      result_snapshot_json: safeStringify(resultSnapshot),
      status: cleanText(body?.status, 40) || 'draft',
      server_received_at: now,
      client_changed_at: (() => {
        const parsed = Date.parse(cleanText(body?.clientChangedAt, 100));
        const current = Date.now();
        return Number.isFinite(parsed) && Math.abs(parsed - current) <= 24 * 60 * 60 * 1000
          ? new Date(parsed).toISOString()
          : now;
      })(),
      source: cleanText(body?.source, 80) || 'autosave'
    });

    const rebuiltAfter = await rebuildSnapshot(base44, draft);
    draft = await materializeDraft(base44, draft, rebuiltAfter, {
      changed: changedKeys.length > 0 || deletedKeys.length > 0,
      status: body?.status,
      submitError: body?.submitError,
      finalSubmissionId: body?.finalSubmissionId,
      intakeId: body?.intakeId,
      mappedPayload: body?.mappedPayload
    });
    return jsonResponse({
      success: true,
      revisionId: revision?.id || '',
      draft: publicDraft(draft, rebuiltAfter)
    });
  } catch (error) {
    const safeError = error instanceof Error ? error : new Error('Unknown draft persistence error.');
    console.error('[Secure draft persistence] request failed', {
      action,
      name: safeError.name,
      message: safeError.message.slice(0, 500)
    });
    const isValidation = /invalid|too many|too large|too deep|required|exceeds|durable/i.test(safeError.message);
    return jsonResponse({
      success: false,
      error: isValidation ? safeError.message.slice(0, 500) : 'Unable to persist the questionnaire draft.'
    }, isValidation ? 400 : 500);
  }
});
