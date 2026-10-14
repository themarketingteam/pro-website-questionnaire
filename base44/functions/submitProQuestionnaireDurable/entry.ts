import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import {
  authorizeDraftSubmission,
  createSubmissionContentFingerprint,
  createSubmissionIdentityFingerprint
} from '../_shared/proDraftSubmissionAuthorization.ts';

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
    const authorization = await authorizeDraftSubmission({
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
    if (action === 'authorize') {
      return json({ success: true, authorized: true, draftId: authorization.draft.id });
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
      return json({ success: true, duplicate: true, submission: priorAttempt });
    }

    const contentMatches = await submissions.filter({
      'metadata.source_draft_id': draftId,
      'metadata.submission_content_fingerprint': contentFingerprint,
      'metadata.client_identity_fingerprint': identityFingerprint
    }, '-created_date', 1);
    const priorContent = (Array.isArray(contentMatches) ? contentMatches : [])[0];
    if (priorContent?.id) {
      return json({ success: true, reused: true, submission: priorContent });
    }

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
    return json({ success: true, submission });
  } catch (error) {
    const safeError = error instanceof Error ? error : new Error('Unknown submission failure.');
    console.error('[Durable questionnaire submission] request failed', {
      name: safeError.name,
      message: safeError.message.slice(0, 300)
    });
    return json({ success: false, error: 'Unable to durably create the questionnaire submission.' }, 500);
  }
});
