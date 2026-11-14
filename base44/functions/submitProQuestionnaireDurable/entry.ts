import { createClientFromRequest } from 'npm:@base44/sdk@0.8.61';
import { normalizeStoredOrganizedRecord, samePageStructure, validateOrganizedResponses, validateOrganizedSubmission } from '../../shared/pageOrganizerContract.js';
import {
  authorizeDraftSubmission,
  createSubmissionContentFingerprint,
  createSubmissionIdentityFingerprint,
  getSubmissionIdentity
} from './proDraftSubmissionAuthorization.ts';

import { withEntityLease } from '../../shared/entityLease.ts';

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

  try {
    let authorization = await authorizeDraftSubmission({
      base44,
      resumeCredential: body?.resumeCredential,
      expectedDraftId: draftId,
      payload,
      submitContext: body?.submitContext
    });
    if (!authorization.authorized) {
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
    // Authorization and the snapshot must be read again after waiting for saves
    // or a competing submitter holding this same cross-instance lease.
    authorization = await authorizeDraftSubmission({ base44, resumeCredential: body?.resumeCredential, expectedDraftId: draftId, payload, submitContext: body?.submitContext });
    if (!authorization.authorized) return json({ success: false, code: authorization.code, error: authorization.error }, authorization.status);
    const latestRevisions = await base44.asServiceRole.entities.ProFormDraftRevision.filter({ draft_id: draftId }, '-server_revision', 1);
    const latestServerRevision = Number(latestRevisions?.[0]?.server_revision) || 0;
    if (latestServerRevision > (Number(authorization.draft.save_revision) || 0)) {
      return json({ success: false, code: 'DRAFT_SAVE_PENDING', error: 'A newer draft save needs to finish before submission. Save and try again.' }, 409);
    }
    let draftResponses;
    try {
      draftResponses = JSON.parse(authorization.draft.responses_json || '{}');
      if (!draftResponses || typeof draftResponses !== 'object' || Array.isArray(draftResponses)) throw new Error('invalid');
    } catch {
      return json({ success: false, code: 'DRAFT_SNAPSHOT_INVALID', error: 'The stored draft needs recovery before it can be submitted.' }, 409);
    }
    const organizerValidation = validateOrganizedSubmission({
      payload, responses: draftResponses, allowMissingPayload: action === 'authorize' && !payload
    });
    if (!organizerValidation.ok) return json({ success: false, code: organizerValidation.code, error: organizerValidation.errors.join(' ') }, organizerValidation.status);
    if (body?.rawResponses != null) {
      const rawValidation = validateOrganizedResponses(body.rawResponses);
      if (!rawValidation.ok) return json({ success: false, code: rawValidation.code, error: rawValidation.errors.join(' ') }, 400);
      for (const id of ['3', '4']) {
        const key = `${id}_structure`;
        const saved = Object.prototype.hasOwnProperty.call(draftResponses, key);
        const supplied = Object.prototype.hasOwnProperty.call(body.rawResponses, key);
        if ((saved || supplied) && (!saved || !supplied || !samePageStructure(draftResponses[key], body.rawResponses[key]))) {
          return json({ success: false, code: 'ORGANIZER_SUBMISSION_CONFLICT', error: 'The submitted raw page organization does not match the saved draft.' }, 409);
        }
      }
    }
    if (action === 'authorize') {
      return json({ success: true, authorized: true, draftId: authorization.draft.id, responses: draftResponses });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.userdata || typeof payload.userdata !== 'object') {
      return json({ success: false, code: 'INVALID_SUBMISSION_PAYLOAD', error: 'A valid transformed questionnaire payload is required.' }, 400);
    }

    const contentFingerprint = await createSubmissionContentFingerprint({
      payload,
      draftId,
      identity: authorization.identity
    });
    const suppliedFingerprint = cleanText(body?.submissionContentFingerprint, 100);
    if (suppliedFingerprint && suppliedFingerprint !== contentFingerprint) {
      return json({ success: false, code: 'SUBMISSION_CONTENT_CONFLICT', error: 'The submission content fingerprint was not valid.' }, 409);
    }
    const identityFingerprint = await createSubmissionIdentityFingerprint(authorization.identity);
    const submissions = base44.asServiceRole.entities.ProFormSubmission;
    const confirmReceipt = async (submission: any) => {
      try { submission = normalizeStoredOrganizedRecord(submission, payload); }
      catch { throw Object.assign(new Error('The durable submission service returned an invalid stored page structure.'), { status: 502, code: 'SUBMISSION_STORAGE_INVALID' }); }
      if (!submission?.id || submission.metadata?.source_draft_id !== draftId) {
        throw new Error('The durable submission service did not retain its receipt identity.');
      }
      if (await createSubmissionIdentityFingerprint(getSubmissionIdentity(submission)) !== identityFingerprint) throw new Error('The durable submission service did not retain the client identity.');
      const retained = validateOrganizedSubmission({ payload: submission, responses: draftResponses });
      if (!retained.ok) throw new Error('The durable submission service did not retain the organized pages.');
      const storedFingerprint = await createSubmissionContentFingerprint({ payload: submission, draftId, identity: authorization.identity });
      if (storedFingerprint !== contentFingerprint) throw new Error('The durable submission service did not retain the submitted content.');
      await lease.assertActive();
      const linked = await lease.update({
        status: 'submitted', final_submission_id: submission.id,
        submitted_at: authorization.draft.submitted_at || new Date().toISOString(),
        submit_error: ''
      });
      if (linked?.status !== 'submitted' || linked?.final_submission_id !== submission.id) throw new Error('The durable submission receipt could not be linked to the draft.');
      return submission;
    };
    const attemptMatches = await submissions.filter(
      { 'metadata.submission_attempt_id': attemptId },
      '-created_date',
      10
    );
    const priorAttempt = (Array.isArray(attemptMatches) ? attemptMatches : [])[0];
    if (priorAttempt?.id) {
      const metadata = priorAttempt.metadata || {};
      if (
        metadata.source_draft_id !== draftId
        || metadata.submission_content_fingerprint !== contentFingerprint
        || metadata.client_identity_fingerprint !== identityFingerprint
      ) {
        return json({ success: false, code: 'SUBMISSION_ATTEMPT_CONFLICT', error: 'This submission attempt identifier is already connected to different content or identity.' }, 409);
      }
      return json({ success: true, duplicate: true, submission: await confirmReceipt(priorAttempt) });
    }

    const contentMatches = await submissions.filter({
      'metadata.source_draft_id': draftId,
      'metadata.submission_content_fingerprint': contentFingerprint,
      'metadata.client_identity_fingerprint': identityFingerprint
    }, '-created_date', 1);
    const priorContent = (Array.isArray(contentMatches) ? contentMatches : [])[0];
    if (priorContent?.id) {
      return json({ success: true, reused: true, submission: await confirmReceipt(priorContent) });
    }

    if (authorization.draft.final_submission_id) {
      const linkedDto = await submissions.get(authorization.draft.final_submission_id).catch(() => null);
      const linked = linkedDto ? normalizeStoredOrganizedRecord(linkedDto, payload) : null;
      if (linked?.metadata?.source_draft_id === draftId
        && await createSubmissionContentFingerprint({ payload: linked, draftId, identity: authorization.identity }) === contentFingerprint) {
        return json({ success: true, reused: true, submission: await confirmReceipt(linked) });
      }
    }
    if (authorization.draft.status === 'submitted' || authorization.draft.final_submission_id) {
      return json({ success: false, code: 'DRAFT_ALREADY_SUBMITTED', error: 'This questionnaire already has a durable submission. Restore its receipt or contact support before changing submitted content.' }, 409);
    }
    // Receipt creation is a separate entity write. Check ownership immediately;
    // the draft link is atomically fenced and a retained receipt is reused on retry.
    await lease.assertActive();
    const submission = await submissions.create({
      ...payload,
      metadata: {
        ...(payload.metadata || {}),
        questionnaire_session_id: authorization.draft.session_id,
        source_draft_id: draftId,
        submission_attempt_id: attemptId,
        submission_content_fingerprint: contentFingerprint,
        client_identity_fingerprint: identityFingerprint
      }
    });
    return json({ success: true, submission: await confirmReceipt(submission) });
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
