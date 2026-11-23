import { createClientFromRequest } from 'npm:@base44/sdk@0.8.61';
import { samePageStructure, validateOrganizedResponses, validateOrganizedSubmission } from '../../shared/pageOrganizerContract.js';
import {
  authorizeDraftSubmission,
  createSubmissionContentFingerprint
} from './proDraftSubmissionAuthorization.ts';

import { withEntityLease } from '../../shared/entityLease.ts';
import { ensureProRetryJobLocked, createProRetryReceiptLocked, failProRetryJobLocked, retryJobSummary, retrySourceFingerprint } from '../../shared/proSubmissionRetries.ts';

const MAX_REQUEST_BYTES = 2_250_000;
const cleanText = (value: unknown, maxLength = 500) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);
const json = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
});
const isAttemptId = (value: string) => /^[A-Za-z0-9_-]{20,160}$/.test(value);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);
  if (Number(req.headers.get('content-length') || 0) > MAX_REQUEST_BYTES) {
    return json({ success: false, error: 'Submission request is too large.' }, 413);
  }
  let body: any;
  try {
    body = await req.json();
    if (JSON.stringify(body).length > MAX_REQUEST_BYTES) throw new Error('too_large');
  } catch {
    return json({ success: false, error: 'Invalid submission request.' }, 400);
  }

  const base44 = createClientFromRequest(req);
  const draftId = cleanText(body?.draftId, 300);
  const attemptId = cleanText(body?.submissionAttemptId, 160);
  const payload = body?.transformedPayload;
  const action = cleanText(body?.action, 20) || 'submit';
  if (!draftId || !isAttemptId(attemptId)) {
    return json({ success: false, code: 'INVALID_SUBMISSION_ATTEMPT', error: 'Valid draft and submission-attempt identifiers are required.' }, 400);
  }

  const holdRejectedIntent = async (draft: any, lease: any, rejected: any, status: number) => {
    if (action !== 'submit' || !draft?.id) return;
    let raw: any;
    try { raw = JSON.parse(draft.responses_json || '{}'); } catch { return; }
    const fingerprint = await retrySourceFingerprint(draft, raw);
    const retained = await base44.asServiceRole.entities.ProSubmissionRetryJob.filter({ source_draft_id: draft.id, source_fingerprint: fingerprint }, '-created_date', 20);
    for (const job of retained || []) await failProRetryJobLocked(base44, job, { code: rejected.code || 'SUBMISSION_REJECTED', message: rejected.error || 'The submission was rejected.', status }, { review: true, lease });
  };
  try {
    let authorization = await authorizeDraftSubmission({
      base44,
      resumeCredential: body?.resumeCredential,
      expectedDraftId: draftId,
      payload,
      submitContext: body?.submitContext
    });
    if (!authorization.authorized) {
      // Only a valid source capability can hold its own rejected intent.
      if (action === 'submit' && authorization.status === 409) {
        const secured = await authorizeDraftSubmission({ base44, resumeCredential: body?.resumeCredential, expectedDraftId: draftId });
        if (secured.authorized) await withEntityLease({ entity: base44.asServiceRole.entities.ProFormDraft, entityId: draftId, purpose: 'pro-rejected-submission' }, async lease => {
          await holdRejectedIntent(await base44.asServiceRole.entities.ProFormDraft.get(draftId), lease, authorization, 409);
        });
      }
      console.warn('[Durable questionnaire submission] authorization rejected', {
        code: authorization.code,
        conflictFieldCount: authorization.conflictFields?.length || 0
      });
      return json({
        success: false,
        code: authorization.code,
        error: authorization.error,
        conflictFields: authorization.conflictFields || []
      }, authorization.status);
    }
    return await withEntityLease({ entity: base44.asServiceRole.entities.ProFormDraft, entityId: draftId, purpose: 'pro-draft-submission' }, async (lease) => {
    const rejectSubmission = async (value: any, status = 409) => {
      await holdRejectedIntent(authorization.draft, lease, value, status);
      return json(value, status);
    };
    // Authorization and the snapshot must be read again after waiting for saves
    // or a competing submitter holding this same cross-instance lease.
    authorization = await authorizeDraftSubmission({ base44, resumeCredential: body?.resumeCredential, expectedDraftId: draftId, payload, submitContext: body?.submitContext });
    if (!authorization.authorized) return await rejectSubmission({ success: false, code: authorization.code, error: authorization.error }, authorization.status);
    const latestRevisions = await base44.asServiceRole.entities.ProFormDraftRevision.filter({ draft_id: draftId }, '-server_revision', 1);
    const latestServerRevision = Number(latestRevisions?.[0]?.server_revision) || 0;
    if (latestServerRevision > (Number(authorization.draft.save_revision) || 0)) {
      return await rejectSubmission({ success: false, code: 'DRAFT_SAVE_PENDING', error: 'A newer draft save needs to finish before submission. Save and try again.' }, 409);
    }
    let draftResponses;
    try {
      draftResponses = JSON.parse(authorization.draft.responses_json || '{}');
      if (!draftResponses || typeof draftResponses !== 'object' || Array.isArray(draftResponses)) throw new Error('invalid');
    } catch {
      return await rejectSubmission({ success: false, code: 'DRAFT_SNAPSHOT_INVALID', error: 'The stored draft needs recovery before it can be submitted.' }, 409);
    }
    const organizerValidation = validateOrganizedSubmission({
      payload, responses: draftResponses, allowMissingPayload: action === 'authorize' && !payload
    });
    if (!organizerValidation.ok) return await rejectSubmission({ success: false, code: organizerValidation.code, error: organizerValidation.errors.join(' ') }, organizerValidation.status);
    if (body?.rawResponses != null) {
      const rawValidation = validateOrganizedResponses(body.rawResponses);
      if (!rawValidation.ok) return await rejectSubmission({ success: false, code: rawValidation.code, error: rawValidation.errors.join(' ') }, 400);
      for (const id of ['3', '4']) {
        const key = `${id}_structure`;
        const saved = Object.prototype.hasOwnProperty.call(draftResponses, key);
        const supplied = Object.prototype.hasOwnProperty.call(body.rawResponses, key);
        if ((saved || supplied) && (!saved || !supplied || !samePageStructure(draftResponses[key], body.rawResponses[key]))) {
          return await rejectSubmission({ success: false, code: 'ORGANIZER_SUBMISSION_CONFLICT', error: 'The submitted raw page organization does not match the saved draft.' }, 409);
        }
      }
    }
    if (action === 'authorize') {
      return json({ success: true, authorized: true, finalized: authorization.draft.status === 'submitted' || Boolean(authorization.draft.final_submission_id), draftId: authorization.draft.id, responses: draftResponses });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.userdata || typeof payload.userdata !== 'object') {
      return await rejectSubmission({ success: false, code: 'INVALID_SUBMISSION_PAYLOAD', error: 'A valid transformed questionnaire payload is required.' }, 400);
    }

    const expectedFingerprint = await createSubmissionContentFingerprint({ payload, draftId, identity: authorization.identity });
    const suppliedFingerprint = cleanText(body?.submissionContentFingerprint, 100);
    if (suppliedFingerprint && suppliedFingerprint !== expectedFingerprint) {
      const intent = await ensureProRetryJobLocked({ base44, draft: authorization.draft, lease, payload: null, responses: draftResponses, createdFrom: 'invalid_fingerprint_intent', allowMappedFallback: false });
      await failProRetryJobLocked(base44, intent, { code: 'SUBMISSION_CONTENT_CONFLICT', message: 'The submission content fingerprint was not valid.', status: 409 }, { review: true, lease });
      return json({ success: false, code: 'SUBMISSION_CONTENT_CONFLICT', error: 'The submission content fingerprint was not valid.' }, 409);
    }
    const retryJob = await ensureProRetryJobLocked({ base44, draft: authorization.draft, lease, payload, responses: draftResponses, attemptId, createdFrom: 'public_durable_submission' });
    try {
      const result = await createProRetryReceiptLocked({ base44, draft: authorization.draft, lease, job: retryJob, payload, responses: draftResponses, attemptId });
      return json({ success: true, duplicate: result.duplicate, submission: result.submission, retryJob: retryJobSummary(retryJob) });
    } catch (error: any) {
      await failProRetryJobLocked(base44, retryJob, error, { review: [400,401,403,409,422].includes(Number(error?.status)), increment: true, lease });
      throw error;
    }
    });
  } catch (error) {
    const safeError = error instanceof Error ? error : new Error('Unknown submission failure.');
    console.error('[Durable questionnaire submission] request failed', {
      name: safeError.name,
      message: safeError.message.slice(0, 300)
    });
    return json({ success: false, error: 'Unable to durably create the questionnaire submission.' }, Number((error as any)?.status) || 500);
  }
});
