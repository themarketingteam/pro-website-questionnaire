import { createClientFromRequest } from 'npm:@base44/sdk@0.8.61';
import { validateOrganizedPayload } from './pageOrganizerContract.js';
import { authorizeDraftSubmission, createSubmissionContentFingerprint, createSubmissionIdentityFingerprint, getSubmissionIdentity } from './proDraftSubmissionAuthorization.ts';
import { withEntityLease } from './entityLease.ts';
import { deliverProRetryJobLocked, parseRetryObject, retryFault } from './proSubmissionRetries.ts';

export default async function(req: Request) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'no-store' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return Response.json({ success: false }, { status: 405, headers });
  try {
    const body = await req.json();
    if (JSON.stringify(body).length > 2_250_000) throw retryFault('PAYLOAD_TOO_LARGE', 'The submission payload is too large.', 413);
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : body;
    const validation = validateOrganizedPayload(payload);
    if (!validation.ok) return Response.json({ success: false, code: validation.code, error: validation.errors.join(' ') }, { status: 400, headers });
    const base44 = createClientFromRequest(req);
    const draftId = String(body.draftId || payload.metadata?.source_draft_id || '');
    if (!draftId) throw retryFault('DRAFT_CREDENTIAL_REQUIRED', 'A saved source draft is required.', 401);
    const credential = body.resumeCredential || '';
    const authorization = credential ? await authorizeDraftSubmission({ base44, resumeCredential: credential, expectedDraftId: draftId, payload }) : null;
    if (credential && !authorization?.authorized) throw retryFault(authorization?.code || 'DRAFT_CREDENTIAL_REJECTED', authorization?.error || 'Draft authorization failed.', authorization?.status || 401);
    return await withEntityLease({ entity: base44.asServiceRole.entities.ProFormDraft, entityId: draftId, purpose: 'pro-public-submission-delivery' }, async lease => {
      const draft = await base44.asServiceRole.entities.ProFormDraft.get(draftId);
      if (credential) {
        const fresh = await authorizeDraftSubmission({ base44, resumeCredential: credential, expectedDraftId: draftId, payload });
        if (!fresh.authorized) throw retryFault(fresh.code || 'DRAFT_CREDENTIAL_REJECTED', fresh.error || 'Draft access was denied.', fresh.status);
      }
      const identity = { businessName: draft.business_name || '', domain: draft.domain || '' };
      if (await createSubmissionIdentityFingerprint(getSubmissionIdentity(payload)) !== await createSubmissionIdentityFingerprint(identity)) throw retryFault('SUBMISSION_IDENTITY_CONFLICT', 'The payload does not match this saved client.');
      const fingerprint = await createSubmissionContentFingerprint({ payload, draftId, identity });
      const found = await base44.asServiceRole.entities.ProSubmissionRetryJob.filter({ source_draft_id: draftId, content_fingerprint: fingerprint }, '-created_date', 20);
      const job = (found || []).find((candidate: any) => candidate.source_session_id === draft.session_id && candidate.submission_id === draft.final_submission_id && !candidate.manual_force);
      if (!job) throw retryFault('DELIVERY_JOB_REQUIRED', 'No admitted frozen delivery job matches this receipt. Review its recovery record.');
      if (!credential) {
        // Cached payload-only callers can finish the first admitted delivery,
        // never create jobs, force retries, or reopen a waiting/accepted state.
        const frozen = parseRetryObject(job.mapped_payload_json);
        if (payload.metadata?.questionnaire_session_id !== draft.session_id || payload.metadata?.source_draft_id !== draftId || !frozen || job.stage !== 'delivery' || job.status !== 'queued' || job.delivery_started_at || job.delivery_accepted_at || Number(job.attempt_count || 0) !== 0) throw retryFault('DRAFT_CREDENTIAL_REQUIRED', 'A secure draft credential is required for this delivery action.', 401);
      }
      const result = await deliverProRetryJobLocked({ base44, draft, lease, job });
      return Response.json(result, { status: result.success ? 200 : result.held ? 409 : 502, headers });
    });
  } catch (error: any) { return Response.json({ success: false, code: error.code || 'DELIVERY_FAILED', error: error.message || 'Zapier delivery could not be confirmed.' }, { status: Number(error.status) || 503, headers }); }
}
