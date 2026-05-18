import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const truncate = (value, max = 500) => String(value ?? '').slice(0, max);

const classifyError = (error) => {
  const status = error?.status ?? error?.response?.status ?? null;
  const message = truncate(error?.message ?? error, 500).toLowerCase();
  const name = truncate(error?.name ?? '', 200).toLowerCase();

  if (name.includes('timeout') || message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) return 'timeout';
  if (status === 401 || /unauthorized|auth|session|login|token/.test(message)) return 'auth';
  if (status === 403 || /forbidden|permission|rls|policy|access denied/.test(message)) return 'permission';
  if (status === 429) return 'rate_limit';
  if (status === 400 || status === 422) return /schema/.test(message) ? 'schema' : 'validation';
  if (/failed to fetch|network|cors|offline/.test(message)) return 'network';
  if ([500, 502, 503, 504].includes(status)) return 'server';
  return 'unknown';
};

const normalizePayload = (payload, questionnaireSessionId, primaryError) => {
  const metadata = typeof payload?.metadata === 'object' && payload.metadata ? payload.metadata : {};
  const userdata = typeof payload?.userdata === 'object' && payload.userdata ? payload.userdata : {};

  return {
    ...payload,
    metadata: {
      ...metadata,
      business_name: metadata.business_name || '',
      businessDomain: metadata.businessDomain || '',
      submission_path: 'server_fallback',
      browser_create_failed: true,
      primary_failure_kind: primaryError?.failureKind || null,
      questionnaire_session_id: questionnaireSessionId
    },
    userdata
  };
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const transformedPayload = body?.transformedPayload;
    const questionnaireSessionId = body?.questionnaireSessionId;
    const primaryError = body?.primaryError || null;

    if (!transformedPayload || typeof transformedPayload !== 'object') {
      return Response.json({ success: false, usedFallback: true, error: { message: 'Invalid submission payload', failureKind: 'validation', status: 400, code: 'INVALID_PAYLOAD' } }, { status: 400 });
    }

    if (!questionnaireSessionId) {
      return Response.json({ success: false, usedFallback: true, error: { message: 'Missing questionnaire session', failureKind: 'validation', status: 400, code: 'MISSING_SESSION' } }, { status: 400 });
    }

    const normalizedPayload = normalizePayload(transformedPayload, questionnaireSessionId, primaryError);

    if (!normalizedPayload.metadata?.business_name || !normalizedPayload.metadata?.businessDomain) {
      return Response.json({ success: false, usedFallback: true, error: { message: 'Missing required submission metadata', failureKind: 'validation', status: 400, code: 'INVALID_METADATA' } }, { status: 400 });
    }

    const submission = await base44.asServiceRole.entities.ProFormSubmission.create(normalizedPayload);

    return Response.json({
      success: true,
      submissionId: submission?.id || '',
      submission,
      usedFallback: true,
      zapierSent: false
    });
  } catch (error) {
    return Response.json({
      success: false,
      usedFallback: true,
      error: {
        message: truncate(error?.message || 'Fallback submission failed', 500),
        failureKind: classifyError(error),
        status: error?.status ?? error?.response?.status ?? null,
        code: truncate(error?.code || '', 200)
      }
    }, { status: 500 });
  }
});