import { normalizeStoredOrganizedRecord, validateOrganizedSubmission } from './pageOrganizerContract.js';
import { createSubmissionContentFingerprint, createSubmissionIdentityFingerprint, getSubmissionIdentity, hashDraftSubmissionValue } from './proDraftSubmissionAuthorization.ts';
import { withEntityLease, type EntityLease } from './entityLease.ts';
import { transformResponsesToPayload, validateSubmissionPayload } from './proQuestionnairePayload.js';
import { SERVICE_OPTIONS_GROUPED } from './proServiceCatalog.js';
import { isAutomaticRetryExcluded, nextSubmissionRetryAt } from './submissionRetryPolicy.ts';

type Row = Record<string, any>;
const plain = (value: any): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const parseRetryObject = (value: any): Row | null => {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return plain(parsed) ? parsed : null; } catch { return null; }
};
const stableValue = (value: any): any => Array.isArray(value) ? value.map(stableValue) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])])) : value;
const clone = <T>(value: T): T => structuredClone(value);
const nowIso = () => new Date().toISOString();
const text = (value: any, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const json = (value: any) => JSON.stringify(value);
export const retryFault = (code: string, message: string, status = 409) => Object.assign(new Error(message), { code, status });
const jobs = (base44: any) => base44.asServiceRole.entities.ProSubmissionRetryJob;
const hold = (row: Row) => Boolean(row?.automatic_retry_hold || row?.delivery_hold || row?.legal_hold || row?.retention_hold || row?.active_investigation || row?.soft_deleted_at || row?.archived_at);
const identityFor = (draft: Row) => ({ businessName: text(draft.business_name, 300), domain: text(draft.domain, 500) });
export const retrySourceFingerprint = async (draft: Row, responses = parseRetryObject(draft.responses_json)) => {
  if (!responses) throw retryFault('DRAFT_SNAPSHOT_INVALID', 'The saved questionnaire answer map is unreadable.');
  return hashDraftSubmissionValue(json(stableValue({ responses, identity: await createSubmissionIdentityFingerprint(identityFor(draft)) })));
};
const outbound = (payload: Row) => ({ metadata: clone(payload.metadata || {}), userdata: clone(payload.userdata || {}) });
const safeError = (error: any) => ({ code: text(error?.code || error?.response?.data?.code, 150), message: text(error?.message || error?.response?.data?.error || 'Submission retry failed.', 500), status: Number(error?.status || error?.response?.status || 0) || null });
export const retryJobSummary = (job: Row | null) => job ? Object.fromEntries(['id','job_key','source_draft_id','source_intake_id','source_session_id','submission_id','status','stage','next_retry_at','attempt_count','first_failed_at','last_attempt_at','last_error_json','delivery_http_status','delivery_accepted_at','created_from'].map(key => [key, job[key] ?? null])) : null;

/** Caller must already own this draft's entity lease. Snapshot fields never change. */
export async function ensureProRetryJobLocked({ base44, draft, lease, payload, responses, attemptId = '', intakeId = '', submissionId = '', createdFrom = 'explicit_submission', allowCompleted = false, forceRequestId = '', failedAt = '', allowMappedFallback = true, baselineDraft = null, initialReview = '' }: any): Promise<Row | null> {
  if (!draft?.id || !lease) throw retryFault('RETRY_SOURCE_REQUIRED', 'A locked questionnaire draft is required.');
  const raw = responses || parseRetryObject(draft.responses_json);
  if (!plain(raw)) throw retryFault('DRAFT_SNAPSHOT_INVALID', 'A readable saved answer map is required.');
  const mapped = plain(payload) ? outbound(payload) : allowMappedFallback ? parseRetryObject(draft.mapped_payload_json) : null;
  const identity = identityFor(draft);
  const content = await createSubmissionContentFingerprint({ payload: mapped, rawResponses: raw, draftId: draft.id, identity });
  const source = await retrySourceFingerprint(draft, raw);
  const baseKey = await hashDraftSubmissionValue(`pro:${draft.id}:${source}`);
  const key = forceRequestId ? `${baseKey}:manual:${text(forceRequestId, 120)}` : baseKey;
  const found = await jobs(base44).filter({ source_draft_id: draft.id, job_key: key }, 'created_date', 2);
  if (found?.length > 1) throw retryFault('RETRY_JOB_AMBIGUOUS', 'More than one retained retry job matches this submission.');
  if (found?.[0]) {
    const existing = found[0];
    if (mapped && !parseRetryObject(existing.mapped_payload_json) && !existing.delivery_accepted_at) {
      await lease.assertActive();
      const promoted = await jobs(base44).update(existing.id, { mapped_payload_json: json(mapped), outbound_payload_json: json(mapped), content_fingerprint: content, submission_attempt_id: attemptId || existing.submission_attempt_id, source_intake_id: intakeId || existing.source_intake_id || '' });
      if (promoted.mapped_payload_json !== json(mapped) || promoted.outbound_payload_json !== json(mapped)) throw retryFault('RETRY_JOB_STORAGE_INVALID', 'The retry service did not retain the complete outbound payload.', 502);
      return promoted;
    }
    if (mapped && parseRetryObject(existing.mapped_payload_json) && existing.content_fingerprint !== content) throw retryFault('RETRY_CONTENT_CHANGED', 'This frozen submission attempt already retained different mapped answers.');
    return existing;
  }
  // Missing delivery state on an old completed receipt is never evidence that
  // it was unsent. Only a deliberate protected force action may admit it.
  if ((draft.status === 'submitted' || draft.final_submission_id) && !allowCompleted && !forceRequestId) return null;
  const when = nowIso();
  const excluded = hold(draft) || isAutomaticRetryExcluded(draft, mapped);
  const value = {
    job_key: key, source_draft_id: draft.id, source_intake_id: intakeId, source_session_id: draft.session_id || '',
    submission_attempt_id: attemptId || `retry_${baseKey}`, submission_id: submissionId || '',
    content_fingerprint: content, source_fingerprint: source, raw_responses_json: json(raw), mapped_payload_json: json(mapped), outbound_payload_json: mapped ? json(mapped) : '',
    business_name: identity.businessName, business_domain: identity.domain, baseline_restore_allowed: Boolean(baselineDraft), baseline_source_fingerprint: baselineDraft ? await retrySourceFingerprint(baselineDraft) : '', baseline_revision: baselineDraft ? Number(baselineDraft.save_revision || 0) : 0,
    status: excluded ? 'excluded' : initialReview ? 'needs_review' : 'queued', stage: submissionId ? 'delivery' : 'submission',
    first_attempt_at: when, first_failed_at: failedAt || '', next_retry_at: excluded || initialReview ? '' : nextSubmissionRetryAt(failedAt || when), last_attempt_at: '', attempt_count: 0,
    last_error_json: initialReview ? json({ code: 'LEGACY_RETRY_REVIEW_REQUIRED', message: initialReview }) : '', delivery_key: '', delivery_accepted_at: '', delivery_started_at: '', delivery_http_status: 0,
    manual_force: Boolean(forceRequestId), automatic_retry_excluded: excluded, created_from: createdFrom
  };
  await lease.assertActive();
  const stored = await jobs(base44).create(value);
  if (!stored?.id || ['job_key','source_fingerprint','raw_responses_json','mapped_payload_json','outbound_payload_json','submission_attempt_id'].some(key => stored[key] !== (value as Row)[key])) throw retryFault('RETRY_JOB_STORAGE_INVALID', 'The database did not retain the complete submission retry checkpoint.', 502);
  return stored;
}

export async function failProRetryJobLocked(base44: any, job: Row | null, error: any, { uncertain = false, review = false, increment = false, lease, httpStatus }: any = {}): Promise<Row | null> {
  if (!job?.id) return job;
  const current = await jobs(base44).get(job.id);
  if (current.delivery_accepted_at || ['succeeded','excluded','cancelled','delivery_unknown','needs_review'].includes(current.status)) return current;
  // Duplicate browser failure reports are not new delivery attempts and must
  // not push an already scheduled retry further into the future.
  if (!review && !uncertain && !increment && current.status === 'retry_waiting' && Date.parse(current.next_retry_at || '') > Date.now()) return current;
  if (lease) await lease.assertActive();
  const when = nowIso();
  await jobs(base44).updateMany({ id: current.id, status: current.status, delivery_accepted_at: current.delivery_accepted_at ?? null, last_attempt_at: current.last_attempt_at ?? null }, { $set: {
    status: uncertain ? 'delivery_unknown' : review ? 'needs_review' : 'retry_waiting',
    first_failed_at: current.first_failed_at || when, last_attempt_at: when,
    next_retry_at: uncertain || review ? '' : nextSubmissionRetryAt(when),
    last_error_json: json(safeError(error)),
    ...(httpStatus ? { delivery_http_status: Number(httpStatus) } : {}),
    ...(increment ? { attempt_count: Number(current.attempt_count || 0) + 1 } : {})
  } });
  return jobs(base44).get(current.id);
}

export async function verifyProRetrySourceLocked({ base44, job, draft, lease }: any): Promise<void> {
  await lease.assertActive();
  if (hold(draft) || job.automatic_retry_excluded || isAutomaticRetryExcluded(draft, parseRetryObject(job.mapped_payload_json))) throw retryFault('RETRY_EXCLUDED', 'Automatic delivery is held or excluded for this questionnaire.');
  if (job.source_intake_id) {
    const intake = await base44.asServiceRole.entities.ProFormSubmissionIntake.get(job.source_intake_id);
    if (!intake?.id || (intake.source_draft_id && intake.source_draft_id !== draft.id) || hold(intake)) throw retryFault('RETRY_EXCLUDED', 'The linked intake is unavailable or held for review.');
  }
  const frozenRaw = parseRetryObject(job.raw_responses_json);
  const frozenPayload = parseRetryObject(job.mapped_payload_json);
  if (!frozenRaw || await retrySourceFingerprint({ ...draft, business_name: job.business_name, domain: job.business_domain }, frozenRaw) !== job.source_fingerprint) throw retryFault('RETRY_CHECKPOINT_INVALID', 'The frozen retry answer checkpoint changed.');
  if (frozenPayload && (await createSubmissionContentFingerprint({ payload: frozenPayload, draftId: draft.id, identity: identityFor(draft) }) !== job.content_fingerprint || await createSubmissionIdentityFingerprint(getSubmissionIdentity(frozenPayload)) !== await createSubmissionIdentityFingerprint(identityFor(draft)))) throw retryFault('RETRY_CHECKPOINT_INVALID', 'The frozen mapped payload or client identity changed.');
  if (draft.session_id !== job.source_session_id || await retrySourceFingerprint(draft) !== job.source_fingerprint) throw retryFault('RETRY_SOURCE_CHANGED', 'The questionnaire changed after this explicit submission attempt. Review the original attempt before retrying.');
  const pending = await base44.asServiceRole.entities.ProFormDraftRevision.filter({ draft_id: draft.id }, '-server_revision', 1);
  if (Number(pending?.[0]?.server_revision || 0) > Number(draft.save_revision || 0)) throw retryFault('DRAFT_SAVE_PENDING', 'A newer retained draft revision must be recovered before retrying.');
}

/** Receipt creation/reuse is shared with the public handler and scheduled worker. */
export async function createProRetryReceiptLocked({ base44, draft, lease, job, payload, responses, attemptId }: any): Promise<{ submission: Row; duplicate: boolean }> {
  const mapped = payload || parseRetryObject(job?.mapped_payload_json);
  const raw = responses || parseRetryObject(job?.raw_responses_json) || parseRetryObject(draft.responses_json);
  if (!plain(mapped?.metadata) || !plain(mapped?.userdata) || !text(mapped.metadata.business_name) || !text(mapped.metadata.businessDomain || mapped.metadata.business_domain)) throw retryFault('RETRY_PAYLOAD_UNAVAILABLE', 'A complete saved submission payload and client identity are required.', 422);
  const payloadGuard = validateSubmissionPayload(mapped);
  if (!payloadGuard.ok) throw retryFault('RETRY_PAYLOAD_INVALID', payloadGuard.errors.join(' '), 422);
  const guard = validateOrganizedSubmission({ payload: mapped, responses: raw });
  if (!guard.ok) throw retryFault(guard.code || 'INVALID_PAGE_STRUCTURE', guard.errors.join(' '), guard.status);
  const identity = identityFor(draft);
  if (await createSubmissionIdentityFingerprint(getSubmissionIdentity(mapped)) !== await createSubmissionIdentityFingerprint(identity)) throw retryFault('SUBMISSION_IDENTITY_CONFLICT', 'The saved payload belongs to a different client.');
  const content = await createSubmissionContentFingerprint({ payload: mapped, draftId: draft.id, identity });
  const identityHash = await createSubmissionIdentityFingerprint(identity);
  const selectedAttempt = attemptId || job?.submission_attempt_id;
  const entity = base44.asServiceRole.entities.ProFormSubmission;
  const confirm = async (dto: Row, duplicate: boolean) => {
    let receipt: Row;
    try { receipt = normalizeStoredOrganizedRecord(dto, mapped); } catch { throw retryFault('SUBMISSION_STORAGE_INVALID', 'The durable receipt did not retain the expected payload schema.', 502); }
    if (!receipt?.id || receipt.metadata?.source_draft_id !== draft.id
      || await createSubmissionIdentityFingerprint(getSubmissionIdentity(receipt)) !== identityHash
      || await createSubmissionContentFingerprint({ payload: receipt, draftId: draft.id, identity }) !== content) throw retryFault('SUBMISSION_STORAGE_INVALID', 'The durable receipt did not retain this exact questionnaire submission.', 502);
    await lease.assertActive();
    await lease.update({ status: 'submitted', final_submission_id: receipt.id, submitted_at: draft.submitted_at || nowIso(), submit_error: '' });
    if (job?.id) {
      const fresh = await jobs(base44).get(job.id);
      await jobs(base44).update(job.id, { submission_id: receipt.id, stage: 'delivery', delivery_key: fresh.delivery_key || `pro-submission-${receipt.id}`, status: fresh.delivery_accepted_at ? 'succeeded' : ['excluded','cancelled','needs_review','delivery_unknown','retry_waiting'].includes(fresh.status) ? fresh.status : 'queued' });
    }
    return { submission: receipt, duplicate };
  };
  const priorAttempt = await entity.filter({ 'metadata.submission_attempt_id': selectedAttempt }, '-created_date', 10);
  if (priorAttempt?.[0]) {
    const candidate = priorAttempt[0];
    if (candidate.metadata?.source_draft_id !== draft.id || candidate.metadata?.submission_content_fingerprint !== content || candidate.metadata?.client_identity_fingerprint !== identityHash) throw retryFault('SUBMISSION_ATTEMPT_CONFLICT', 'This attempt identifier already belongs to different submitted content.');
    return confirm(candidate, true);
  }
  const matching = await entity.filter({ 'metadata.source_draft_id': draft.id, 'metadata.submission_content_fingerprint': content, 'metadata.client_identity_fingerprint': identityHash }, '-created_date', 1);
  if (matching?.[0]) return confirm(matching[0], true);
  if (draft.final_submission_id) {
    const existing = await entity.get(draft.final_submission_id);
    return confirm(existing, true);
  }
  if (draft.status === 'submitted') throw retryFault('DRAFT_ALREADY_SUBMITTED', 'This completed questionnaire needs receipt recovery before another submission.');
  const sessionReceipts = await entity.filter({ 'metadata.questionnaire_session_id': draft.session_id }, '-created_date', 20);
  if (sessionReceipts?.length) throw retryFault('SUBMISSION_RECEIPT_CONFLICT', 'This questionnaire session already has a different or unverifiable retained receipt. Review the existing receipt before retrying.');
  await lease.assertActive();
  const receipt = await entity.create({ ...outbound(mapped), automatic_retry_job_key: job?.job_key || '', automatic_retry_raw_responses_json: job?.raw_responses_json || json(raw), automatic_retry_outbound_payload_json: job?.outbound_payload_json || json(outbound(mapped)), automatic_delivery_status: 'pending', automatic_delivery_accepted_at: '', metadata: { ...mapped.metadata, questionnaire_session_id: draft.session_id, source_draft_id: draft.id, submission_attempt_id: selectedAttempt, submission_content_fingerprint: content, client_identity_fingerprint: identityHash } });
  return confirm(receipt, false);
}

const WEBHOOK = 'https://hooks.zapier.com/hooks/catch/23529934/uas7p60/';
export function proRetryWebhookUrl(): string {
  let value = ''; try { value = Deno.env.get('ZAPIER_WEBHOOK_URL') || ''; } catch { /* Runtime secret can be absent. */ }
  try { const url = new URL(value); if (`${url.origin}${url.pathname.replace(/\/?$/, '/')}` === WEBHOOK && !url.username && !url.password && !url.search && !url.hash) return WEBHOOK; } catch { /* Existing fixed webhook is the default. */ }
  return WEBHOOK;
}

/** All actual delivery paths hold the same source-draft lease through HTTP+ACK. */
export async function deliverProRetryJobLocked({ base44, draft, lease, job, allowForce = false, allowImmediate = false, fetchImpl = fetch, timeoutMs = 8000 }: any): Promise<Row> {
  job = await jobs(base44).get(job.id);
  if (job.delivery_accepted_at || job.status === 'succeeded') return { success: true, zapierSent: true, alreadyDelivered: true, job: retryJobSummary(job) };
  if (job.status === 'processing' && job.delivery_started_at) {
    job = await failProRetryJobLocked(base44, job, retryFault('DELIVERY_INTERRUPTED', 'A previous HTTP delivery did not retain a final acknowledgement.'), { uncertain: true, lease });
    return { success: false, zapierSent: false, held: true, code: 'DELIVERY_UNKNOWN', job: retryJobSummary(job) };
  }
  if (['delivery_unknown','needs_review','cancelled','excluded'].includes(job.status)) return { success: false, zapierSent: false, held: true, code: job.status.toUpperCase(), job: retryJobSummary(job) };
  if (!allowImmediate && job.delivery_started_at && job.next_retry_at && Date.parse(job.next_retry_at) > Date.now()) return { success: false, zapierSent: false, scheduled: true, code: 'RETRY_NOT_DUE', nextRetryAt: job.next_retry_at, job: retryJobSummary(job) };
  await verifyProRetrySourceLocked({ base44, job, draft, lease });
  if (!job.submission_id) throw retryFault('SUBMISSION_RECEIPT_MISSING', 'Delivery requires a verified durable receipt.');
  const expected = parseRetryObject(job.mapped_payload_json);
  const receiptDto = await base44.asServiceRole.entities.ProFormSubmission.get(job.submission_id);
  if (hold(receiptDto)) throw retryFault('RETRY_EXCLUDED', 'The submitted receipt is held, archived or deleted.');
  const receipt = normalizeStoredOrganizedRecord(receiptDto, expected);
  if (receipt.automatic_delivery_accepted_at && receipt.automatic_delivery_status === 'accepted' && !allowForce) {
    job = await jobs(base44).update(job.id, { status: 'succeeded', delivery_accepted_at: receipt.automatic_delivery_accepted_at, next_retry_at: '' });
    return { success: true, zapierSent: true, alreadyDelivered: true, job: retryJobSummary(job) };
  }
  if (receipt.metadata?.source_draft_id !== draft.id || await createSubmissionContentFingerprint({ payload: receipt, draftId: draft.id, identity: identityFor(draft) }) !== job.content_fingerprint) throw retryFault('SUBMISSION_CONTENT_CONFLICT', 'The receipt differs from the frozen delivery payload.');
  const siblings = await jobs(base44).filter({ source_draft_id: draft.id, submission_id: receipt.id }, '-updated_date', 500);
  const accepted = siblings.find((row: Row) => row.delivery_accepted_at);
  if (accepted && !allowForce) {
    job = await jobs(base44).update(job.id, { status: 'succeeded', delivery_accepted_at: accepted.delivery_accepted_at, next_retry_at: '', last_error_json: '' });
    return { success: true, zapierSent: true, alreadyDelivered: true, job: retryJobSummary(job) };
  }
  const wire = parseRetryObject(job.outbound_payload_json);
  if (!wire || !expected || json(stableValue(wire)) !== json(stableValue(outbound(expected))) || await createSubmissionIdentityFingerprint(getSubmissionIdentity(wire)) !== await createSubmissionIdentityFingerprint(identityFor(draft)) || await createSubmissionContentFingerprint({ payload: wire, draftId: draft.id, identity: identityFor(draft) }) !== job.content_fingerprint) throw retryFault('RETRY_PAYLOAD_INVALID', 'The frozen outbound payload is unavailable or changed.');
  const deliveryKey = allowForce ? `${job.delivery_key || `pro-submission-${receipt.id}`}:manual:${job.id}` : job.delivery_key || `pro-submission-${receipt.id}`;
  // Retaining processing before HTTP makes a killed/ambiguous invocation a hold,
  // not a blind resend when the next worker picks it up.
  job = await jobs(base44).update(job.id, { status: 'processing', stage: 'delivery', delivery_started_at: nowIso(), last_attempt_at: nowIso(), attempt_count: Number(job.attempt_count || 0) + 1, delivery_key: deliveryKey });
  await lease.assertActive();
  await base44.asServiceRole.entities.ProFormSubmission.update(receipt.id, { automatic_delivery_status: 'sending', automatic_delivery_started_at: job.delivery_started_at, automatic_delivery_key: deliveryKey });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try { response = await fetchImpl(proRetryWebhookUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': deliveryKey, 'X-Questionnaire-Delivery-Key': deliveryKey }, body: job.outbound_payload_json, signal: controller.signal }); }
  catch (error) {
    await failProRetryJobLocked(base44, job, error, { uncertain: true, lease });
    return { success: false, zapierSent: false, held: true, code: 'DELIVERY_UNKNOWN', error: { message: 'Delivery confirmation is unknown. The saved attempt is held for review before resending.' }, job: retryJobSummary(await jobs(base44).get(job.id)) };
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const error = retryFault('ZAPIER_HTTP_FAILURE', `Zapier returned HTTP ${response.status}.`, response.status);
    job = await failProRetryJobLocked(base44, job, error, { review: response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429, lease, httpStatus: response.status });
    return { success: false, zapierSent: false, zapierStatus: response.status, error: { message: error.message }, job: retryJobSummary(job) };
  }
  const acceptedAt = nowIso();
  try {
    await lease.assertActive();
    const receiptAck = await base44.asServiceRole.entities.ProFormSubmission.update(receipt.id, { automatic_delivery_status: 'accepted', automatic_delivery_accepted_at: acceptedAt, automatic_delivery_key: deliveryKey });
    if (receiptAck.automatic_delivery_accepted_at !== acceptedAt || receiptAck.automatic_delivery_status !== 'accepted') throw new Error('Receipt delivery acceptance was not retained.');
    job = await jobs(base44).update(job.id, { status: 'succeeded', delivery_accepted_at: acceptedAt, delivery_http_status: response.status, next_retry_at: '', last_error_json: '' });
    if (!job.delivery_accepted_at || job.status !== 'succeeded') throw new Error('Delivery acceptance was not retained.');
  } catch {
    // The remote acceptance cannot be rolled back. Never automatically resend
    // if its database ACK was lost; a future sweep also holds stale processing.
    try { await jobs(base44).updateMany({ id: job.id, status: 'processing', delivery_started_at: job.delivery_started_at, delivery_accepted_at: job.delivery_accepted_at ?? null }, { $set: { status: 'delivery_unknown', next_retry_at: '', last_error_json: json({ code: 'DELIVERY_ACK_UNKNOWN', message: 'Zapier accepted the payload but the database acceptance checkpoint was not confirmed.' }) } }); } catch { /* The retained processing marker remains the conservative hold. */ }
    return { success: false, zapierSent: false, held: true, code: 'DELIVERY_ACK_UNKNOWN', error: { message: 'Zapier accepted the payload; database confirmation requires review.' } };
  }
  if (job.source_intake_id) await base44.asServiceRole.entities.ProFormSubmissionIntake.update(job.source_intake_id, { zapier_sent: true }).catch(() => null);
  return { success: true, zapierSent: true, zapierStatus: response.status, job: retryJobSummary(job) };
}

export async function processProRetryJob(base44: any, jobId: string, { fetchImpl = fetch }: any = {}): Promise<Row> {
  const observed = await jobs(base44).get(jobId);
  return withEntityLease({ entity: base44.asServiceRole.entities.ProFormDraft, entityId: observed.source_draft_id, purpose: 'pro-hourly-submission-retry' }, async lease => {
    let job = await jobs(base44).get(jobId);
    const draft = await base44.asServiceRole.entities.ProFormDraft.get(job.source_draft_id);
    if (job.delivery_accepted_at || ['succeeded','cancelled','excluded','needs_review','delivery_unknown'].includes(job.status)) return { success: true, skipped: true, job: retryJobSummary(job) };
    if (job.status === 'processing' && job.delivery_started_at) {
      await failProRetryJobLocked(base44, job, retryFault('DELIVERY_INTERRUPTED', 'A previous HTTP delivery did not retain a final acknowledgement.'), { uncertain: true, lease });
      return { success: false, held: true, code: 'DELIVERY_UNKNOWN' };
    }
    if (!job.next_retry_at || Date.parse(job.next_retry_at) > Date.now()) return { success: true, skipped: true };
    try {
      const restored = await restoreProFrozenIntentLocked({ base44, draft, lease, job });
      Object.assign(draft, restored);
      job = await jobs(base44).get(job.id);
      await verifyProRetrySourceLocked({ base44, draft, lease, job });
      const result = await createProRetryReceiptLocked({ base44, draft, lease, job });
      job = await jobs(base44).get(job.id);
      const linked = await base44.asServiceRole.entities.ProFormDraft.get(draft.id);
      return { ...(await deliverProRetryJobLocked({ base44, draft: linked, lease, job, fetchImpl })), submissionId: result.submission.id };
    } catch (error: any) {
      job = await failProRetryJobLocked(base44, job, error, { review: [400,401,403,409,422].includes(Number(error?.status)), increment: true, lease });
      return { success: false, code: error?.code || 'RETRY_FAILED', job: retryJobSummary(job) };
    }
  });
}

const collectRetryRows = async (entity: any, query: Row, sort: string) => {
  const rows: Row[] = [];
  for (let skip = 0; skip < 25_000; skip += 100) {
    const page = await entity.filter(query, sort, 100, skip);
    rows.push(...(Array.isArray(page) ? page : []));
    if (!page || page.length < 100) break;
  }
  return rows;
};

/** Discovery requires positive failed intent, receipt marker, or delivery event. */
export async function discoverProRetrySources(base44: any, { dryRun = true, limit = 30 }: any = {}): Promise<Row> {
  const result: Row = { scanned: 0, eligible: 0, admitted: 0, excluded: 0, needsReview: 0 };
  const admit = async (source: Row, raw: Row, payload: Row | null, options: Row) => {
    result.eligible++;
    if (dryRun || result.admitted >= limit) return;
    await withEntityLease({ entity: base44.asServiceRole.entities.ProFormDraft, entityId: source.id, purpose: 'pro-retry-discovery' }, async lease => {
      const current = await base44.asServiceRole.entities.ProFormDraft.get(source.id);
      if (hold(current) || isAutomaticRetryExcluded(current)) return;
      const job = await ensureProRetryJobLocked({ base44, draft: current, lease, responses: raw, payload, allowMappedFallback: false, ...options });
      if (job) result.admitted++;
    });
  };
  const drafts = await collectRetryRows(base44.asServiceRole.entities.ProFormDraft, { status: { $in: ['submit_attempted','submit_failed','received_intake'] } }, 'last_saved_at');
  for (const source of drafts) {
    result.scanned++;
    if (hold(source) || isAutomaticRetryExcluded(source)) { result.excluded++; continue; }
    const known = await jobs(base44).filter({ source_draft_id: source.id }, '-created_date', 1);
    if (known?.length) continue;
    const raw = parseRetryObject(source.responses_json), payload = parseRetryObject(source.mapped_payload_json);
    if (!raw) { result.needsReview++; continue; }
    const checkpoints = await base44.asServiceRole.entities.ProFormDraftRevision.filter({ draft_id: source.id, source: 'final_submission_barrier' }, '-server_revision', 1);
    const checkpoint = checkpoints?.[0], frozen = parseRetryObject(checkpoint?.result_snapshot_json);
    const stableAttempt = text(payload?.metadata?.submission_attempt_id, 160);
    const later = source.domain ? await base44.asServiceRole.entities.ProFormSubmission.filter({ 'metadata.businessDomain': source.domain }, '-created_date', 1) : [];
    const trustworthy = stableAttempt && checkpoint?.id && plain(frozen?.responses) && !(later?.length)
      && await retrySourceFingerprint(source, frozen.responses) === await retrySourceFingerprint(source);
    if (!trustworthy) {
      result.needsReview++;
      await admit(source, raw, payload, { createdFrom: 'legacy_ambiguous_failure', initialReview: 'This historical failure predates verifiable attempt tracking or has a later receipt. Review its saved answers and delivery history before replaying.', failedAt: source.last_saved_at || nowIso() });
      continue;
    }
    await admit(source, frozen.responses, payload, { attemptId: stableAttempt, createdFrom: 'legacy_explicit_submit_checkpoint', failedAt: checkpoint.server_received_at || source.last_saved_at || nowIso() });
  }
  const intakes = await collectRetryRows(base44.asServiceRole.entities.ProFormSubmissionIntake, { status: { $in: ['received_intake','retry_failed','retry_pending'] } }, 'created_at_server');
  for (const intake of intakes) {
    result.scanned++;
    if (hold(intake) || intake.zapier_sent || isAutomaticRetryExcluded(intake)) { result.excluded++; continue; }
    if (!intake.source_draft_id || intake.linked_submission_id) { result.needsReview++; continue; }
    const source = await base44.asServiceRole.entities.ProFormDraft.get(intake.source_draft_id);
    if (hold(source) || isAutomaticRetryExcluded(source)) { result.excluded++; continue; }
    const known = await jobs(base44).filter({ source_draft_id: source.id }, '-created_date', 1);
    if (known?.length) continue;
    const raw = parseRetryObject(intake.raw_responses_json), payload = parseRetryObject(intake.transformed_payload_json);
    if (!raw) { result.needsReview++; continue; }
    const mismatch = source.final_submission_id || !intake.submission_attempt_id || await retrySourceFingerprint(source, raw) !== await retrySourceFingerprint(source);
    if (mismatch) result.needsReview++;
    await admit(source, raw, payload, { intakeId: intake.id, attemptId: intake.submission_attempt_id || '', createdFrom: 'legacy_failed_intake', initialReview: mismatch ? 'The historical intake cannot be uniquely matched to an unchanged submitted attempt.' : '', failedAt: intake.last_retry_at || intake.created_at_server || nowIso() });
  }
  // These fields are written atomically on NEW receipt creation. An absent old
  // field never means undelivered, so historical successes are not swept.
  const marked = await collectRetryRows(base44.asServiceRole.entities.ProFormSubmission, { automatic_delivery_status: { $in: ['pending','sending'] } }, 'created_date');
  for (const receipt of marked) {
    result.scanned++;
    const id = receipt.metadata?.source_draft_id;
    if (!id || !receipt.automatic_retry_job_key || hold(receipt)) { result.needsReview++; continue; }
    const source = await base44.asServiceRole.entities.ProFormDraft.get(id);
    if (hold(source) || isAutomaticRetryExcluded(source)) { result.excluded++; continue; }
    const known = await jobs(base44).filter({ source_draft_id: id, job_key: receipt.automatic_retry_job_key }, '-created_date', 1);
    if (known?.length) continue;
    const raw = parseRetryObject(receipt.automatic_retry_raw_responses_json), payload = parseRetryObject(receipt.automatic_retry_outbound_payload_json);
    if (!raw || !payload) { result.needsReview++; continue; }
    await admit(source, raw, payload, { allowCompleted: true, submissionId: receipt.id, attemptId: receipt.metadata.submission_attempt_id, createdFrom: 'atomic_receipt_delivery_marker', initialReview: receipt.automatic_delivery_status === 'sending' ? 'A prior delivery may already have been accepted; review before resending.' : '', failedAt: receipt.created_date || nowIso() });
  }
  const events = await collectRetryRows(base44.asServiceRole.entities.ProFormDraftEvent, { event_type: 'zapier_delivery_failed_after_submit' }, 'created_at_iso');
  for (const event of events) {
    result.scanned++;
    const evidence = parseRetryObject(event.value_json), receiptId = evidence?.final_submission_id;
    if (!receiptId) { result.needsReview++; continue; }
    const receipt = await base44.asServiceRole.entities.ProFormSubmission.get(receiptId);
    const id = receipt?.metadata?.source_draft_id;
    if (!id || receipt.metadata?.questionnaire_session_id !== event.session_id) { result.needsReview++; continue; }
    const source = await base44.asServiceRole.entities.ProFormDraft.get(id);
    if (hold(source) || hold(receipt) || isAutomaticRetryExcluded(source)) { result.excluded++; continue; }
    const known = await jobs(base44).filter({ source_draft_id: id }, '-created_date', 1);
    if (known?.length) continue;
    const raw = parseRetryObject(source.responses_json), payload = parseRetryObject(source.mapped_payload_json);
    if (!raw || !payload) { result.needsReview++; continue; }
    // Old browser failure events do not distinguish a rejected HTTP request
    // from a lost response after acceptance. Retain a visible review hold.
    result.needsReview++;
    await admit(source, raw, payload, { allowCompleted: true, submissionId: receipt.id, createdFrom: 'legacy_delivery_failure_event', initialReview: 'A historical webhook failure was recorded, but acceptance is uncertain. Review downstream delivery before replaying.', failedAt: event.created_at_iso || nowIso() });
  }
  return result;
}

/** Protected team endpoint calls this after authorization; worker never forces. */
export async function runProTeamRetry(base44: any, body: Row): Promise<Row> {
  let draftId = text(body.draftId, 300), intake: Row | null = null;
  if (!draftId) {
    const values = body.intakeId
      ? await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ id: body.intakeId }, '-created_date', 1)
      : await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ questionnaire_session_id: body.questionnaireSessionId || body.session_id || '' }, '-created_at_server', 1);
    intake = values?.[0] || null;
    draftId = intake?.source_draft_id || '';
  }
  if (!draftId) throw retryFault('RETRY_SOURCE_REQUIRED', 'This legacy record has no verifiable source draft. Review or restore its saved source before retrying.');
  return withEntityLease({ entity: base44.asServiceRole.entities.ProFormDraft, entityId: draftId, purpose: 'pro-team-submission-retry' }, async lease => {
    const draft = await base44.asServiceRole.entities.ProFormDraft.get(draftId);
    if (hold(draft) || (intake && hold(intake)) || isAutomaticRetryExcluded(draft)) throw retryFault('RETRY_EXCLUDED', 'This questionnaire is held, deleted, archived, or excluded from delivery.');
    const raw = parseRetryObject(intake?.raw_responses_json || draft.responses_json);
    const payload = parseRetryObject(intake?.transformed_payload_json || draft.mapped_payload_json);
    if (!raw || !payload) throw retryFault('RETRY_PAYLOAD_UNAVAILABLE', 'The retained submission answers or mapped payload are unreadable.', 422);
    const forceRequestId = body.forceRetry === true ? text(body.forceRequestId, 120) || crypto.randomUUID() : '';
    let job = await ensureProRetryJobLocked({ base44, draft, lease, payload, responses: raw, intakeId: intake?.id || '', attemptId: intake?.submission_attempt_id || '', submissionId: draft.final_submission_id || intake?.linked_submission_id || '', forceRequestId, createdFrom: forceRequestId ? 'explicit_team_redelivery' : 'team_retry' });
    if (!job) throw retryFault('DELIVERY_LEGACY_UNTRACKED', 'This historical completed receipt has no automatic delivery ledger. Use an explicit team redelivery only after reviewing its delivery status.');
    try {
      await verifyProRetrySourceLocked({ base44, draft, lease, job });
      const { submission, duplicate } = await createProRetryReceiptLocked({ base44, draft, lease, job, payload, responses: raw, attemptId: job.submission_attempt_id });
      job = await jobs(base44).get(job.id);
      const current = await base44.asServiceRole.entities.ProFormDraft.get(draft.id);
      const delivery = await deliverProRetryJobLocked({ base44, draft: current, lease, job, allowForce: Boolean(forceRequestId), allowImmediate: true });
      if (intake?.id && delivery.success) await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, { status: 'retry_success', linked_submission_id: submission.id, zapier_sent: true, last_retry_at: nowIso(), retry_count: Number(intake.retry_count || 0) + 1 });
      return { ...delivery, linkedSubmissionId: submission.id, alreadySubmitted: duplicate, draftId, intakeId: intake?.id || '', zapierEndpoint: proRetryWebhookUrl() };
    } catch (error: any) {
      await failProRetryJobLocked(base44, job, error, { review: [400,401,403,409,422].includes(Number(error.status)), increment: true, lease });
      throw error;
    }
  });
}

export async function restoreProFrozenIntentLocked({ base44, draft, lease, job }: any): Promise<Row> {
  const raw = parseRetryObject(job.raw_responses_json);
  if (!raw) throw retryFault('RETRY_CHECKPOINT_INVALID', 'The frozen submission answers are unreadable.');
  const attemptDraft = { ...draft, business_name: job.business_name, domain: job.business_domain };
  if (await retrySourceFingerprint(attemptDraft, raw) !== job.source_fingerprint) throw retryFault('RETRY_CHECKPOINT_INVALID', 'The retained submission intent changed.');
  const currentFingerprint = await retrySourceFingerprint(draft);
  const alreadySaved = currentFingerprint === job.source_fingerprint;
  const baselineUnchanged = job.baseline_restore_allowed === true && job.created_from === 'public_submit_intent'
    && currentFingerprint === job.baseline_source_fingerprint && Number(draft.save_revision || 0) === Number(job.baseline_revision || 0);
  if (!alreadySaved && !baselineUnchanged) throw retryFault('RETRY_SOURCE_CHANGED', 'Newer edits or client details differ from the original submission attempt.');
  let payload = parseRetryObject(job.mapped_payload_json);
  if (!payload) {
    // This is the same deterministic serializer used by the browser, never the
    // repair/AI pipeline. The frozen raw answers remain unchanged.
    payload = transformResponsesToPayload(raw, job.business_name, job.business_domain, SERVICE_OPTIONS_GROUPED);
    payload.metadata = { ...payload.metadata, submission_datetime: job.first_attempt_at, questionnaire_session_id: job.source_session_id, source_draft_id: draft.id };
    const validation = validateOrganizedSubmission({ payload, responses: raw });
    if (!validation.ok) throw retryFault(validation.code || 'RETRY_PAYLOAD_INVALID', validation.errors.join(' '), 422);
    const content = await createSubmissionContentFingerprint({ payload, draftId: draft.id, identity: identityFor(attemptDraft) });
    job = await jobs(base44).update(job.id, { mapped_payload_json: json(payload), outbound_payload_json: json(payload), content_fingerprint: content });
    if (job.mapped_payload_json !== json(payload) || job.outbound_payload_json !== json(payload)) throw retryFault('RETRY_JOB_STORAGE_INVALID', 'The reconstructed submission payload was not retained.', 502);
  }
  const genericValidation = validateSubmissionPayload(payload);
  const organizedValidation = validateOrganizedSubmission({ payload, responses: raw });
  if (!genericValidation.ok || !organizedValidation.ok) throw retryFault('RETRY_PAYLOAD_INVALID', [...genericValidation.errors, ...organizedValidation.errors].join(' '), 422);
  if (await createSubmissionIdentityFingerprint(getSubmissionIdentity(payload)) !== await createSubmissionIdentityFingerprint(identityFor(attemptDraft)) || await createSubmissionContentFingerprint({ payload, draftId: draft.id, identity: identityFor(attemptDraft) }) !== job.content_fingerprint || json(stableValue(parseRetryObject(job.outbound_payload_json))) !== json(stableValue(outbound(payload)))) throw retryFault('RETRY_CHECKPOINT_INVALID', 'The frozen mapped payload or outbound identity changed.');
  if (alreadySaved) return draft;
  if (draft.status === 'submitted' || draft.final_submission_id) throw retryFault('DRAFT_ALREADY_SUBMITTED', 'This draft already has a different completed submission.');
  const revisions = base44.asServiceRole.entities.ProFormDraftRevision;
  const latest = await revisions.filter({ draft_id: draft.id }, '-server_revision', 1);
  const pending = latest?.[0];
  const mutationId = `retry_intent_${job.id}`;
  let retained: Row | null = null;
  if (Number(pending?.server_revision || 0) > Number(draft.save_revision || 0)) {
    const snapshot = parseRetryObject(pending.result_snapshot_json);
    if (!snapshot?.responses || json(stableValue(snapshot.responses)) !== json(stableValue(raw)) || !['final_submission_barrier','automatic_frozen_submission'].includes(pending.source) || await createSubmissionIdentityFingerprint(snapshot.credentials) !== await createSubmissionIdentityFingerprint(identityFor(attemptDraft))) throw retryFault('DRAFT_SAVE_PENDING', 'A different newer draft revision needs review.');
    retained = pending;
  }
  if (!retained) {
    const keys = [...new Set([...Object.keys(parseRetryObject(draft.responses_json) || {}), ...Object.keys(raw)])];
    const snapshot = { responses: raw, credentials: { businessName: job.business_name, domain: job.business_domain, userId: draft.user_id || '', userName: draft.user_name || '', userEmail: draft.user_email || '' }, validationStatus: parseRetryObject(draft.validation_status_json) || {}, touchedQuestions: parseRetryObject(draft.touched_questions_json) || {}, expandedQuestions: parseRetryObject(draft.expanded_questions_json) || {}, currentQuestionId: draft.current_question_id || '', lastChangedQuestionId: draft.last_changed_question_id || '', progressPercent: Number(draft.progress_percent || 0) };
    const changes = { ...snapshot, responses: raw, deletedKeys: keys.filter(key => !Object.hasOwn(raw, key)) };
    await lease.assertActive();
    retained = await revisions.create({ draft_id: draft.id, session_id: draft.session_id, mutation_id: mutationId, client_instance_id: 'automatic_retry_worker', client_sequence: 1, base_revision: Number(draft.save_revision || 0), server_revision: Number(draft.save_revision || 0) + 1, changed_keys_json: json(keys), deleted_keys_json: json(changes.deletedKeys), changes_json: json(changes), result_snapshot_json: json(snapshot), source: 'automatic_frozen_submission', status: 'submit_attempted', server_received_at: nowIso(), client_changed_at: job.first_attempt_at });
    if (!retained?.id || retained.result_snapshot_json !== json(snapshot)) throw retryFault('RETRY_CHECKPOINT_INVALID', 'The restored submission checkpoint was not retained.', 502);
  }
  const restored = await lease.update({ responses_json: json(raw), mapped_payload_json: json(payload), metadata_json: json(payload.metadata), userdata_json: json(payload.userdata), business_name: job.business_name, domain: job.business_domain, save_revision: retained.server_revision, status: 'submit_attempted', last_saved_at: nowIso() });
  if (restored.responses_json !== json(raw) || Number(restored.save_revision) !== Number(retained.server_revision)) throw retryFault('RETRY_CHECKPOINT_INVALID', 'The frozen attempt could not be restored.', 502);
  return restored;
}
