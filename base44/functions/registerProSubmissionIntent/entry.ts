import { createClientFromRequest } from 'npm:@base44/sdk@0.8.61';
import { authorizeDraftSubmission, getSubmissionIdentity } from '../../shared/proDraftSubmissionAuthorization.ts';
import { withEntityLease } from '../../shared/entityLease.ts';
import { ensureProRetryJobLocked, failProRetryJobLocked, retryJobSummary } from '../../shared/proSubmissionRetries.ts';

export default async function(req: Request) {
  if (req.method !== 'POST') return Response.json({ success: false }, { status: 405 });
  let body: any;
  try { body = await req.json(); if (JSON.stringify(body).length > 2_250_000 || !body.responses || typeof body.responses !== 'object' || Array.isArray(body.responses)) throw new Error('invalid'); }
  catch { return Response.json({ success: false, error: 'A bounded questionnaire answer map is required.' }, { status: 400 }); }
  const base44 = createClientFromRequest(req);
  try {
    const authorization = await authorizeDraftSubmission({ base44, resumeCredential: body.resumeCredential, expectedDraftId: body.draftId || '', submitContext: body.submitContext });
    if (!authorization.authorized) return Response.json({ success: false, code: authorization.code, error: authorization.error }, { status: authorization.status });
    return await withEntityLease({ entity: base44.asServiceRole.entities.ProFormDraft, entityId: authorization.draft.id, purpose: 'pro-submission-intent' }, async lease => {
      const current = await base44.asServiceRole.entities.ProFormDraft.get(authorization.draft.id);
      const fresh = await authorizeDraftSubmission({ base44, resumeCredential: body.resumeCredential, expectedDraftId: authorization.draft.id, submitContext: body.submitContext });
      if (!fresh.authorized) return Response.json({ success: false, code: fresh.code, error: fresh.error }, { status: fresh.status });
      if (current.status === 'submitted' || current.final_submission_id) return Response.json({ success: false, code: 'DRAFT_ALREADY_SUBMITTED', error: 'Submitted answers are read-only.' }, { status: 409 });
      const attemptIdentity = getSubmissionIdentity(null, body.submitContext);
      if (!attemptIdentity.businessName || !attemptIdentity.domain) return Response.json({ success: false, code: 'SUBMISSION_IDENTITY_REQUIRED', error: 'The confirmed client name and domain are required.' }, { status: 400 });
      const attemptDraft = { ...current, business_name: attemptIdentity.businessName, domain: attemptIdentity.domain };
      const rejectedFailure = body.failure && (['identity','validation','schema','auth','permission'].includes(String(body.failure.failureKind || '')) || [400,401,403,409,422].includes(Number(body.failure.status)));
      let job = await ensureProRetryJobLocked({ base44, draft: attemptDraft, baselineDraft: current, lease, payload: null, responses: body.responses, createdFrom: 'public_submit_intent', allowMappedFallback: false, initialReview: rejectedFailure ? 'The final save or submission was explicitly rejected and requires review.' : '' });
      if (body.failure && job) job = await failProRetryJobLocked(base44, job, body.failure, { review: ['identity','validation','schema','auth','permission'].includes(String(body.failure.failureKind || '')) || [400,401,403,409,422].includes(Number(body.failure.status)), lease });
      return Response.json({ success: true, intentConfirmed: true, draftId: current.id, job: retryJobSummary(job) }, { headers: { 'Cache-Control': 'no-store' } });
    });
  } catch (error: any) { return Response.json({ success: false, code: error.code || '', error: error.message || 'The submission intent could not be retained.' }, { status: Number(error.status) || 503 }); }
}
