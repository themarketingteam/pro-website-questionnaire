import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const truncate = (value, maxLength = 500) => String(value ?? '').slice(0, maxLength);

const classifyFailure = (error) => {
  const status = Number(error?.status ?? error?.response?.status ?? 0) || null;
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

const serializeFunctionError = (error) => ({
  message: truncate(error?.message ?? error ?? 'Unknown fallback error', 500),
  failureKind: classifyFailure(error),
  status: Number(error?.status ?? error?.response?.status ?? 0) || null,
  code: truncate(error?.code ?? '', 100) || null
});

const normalizePayload = (payload, questionnaireSessionId, primaryError) => {
  const nextPayload = payload && typeof payload === 'object' ? structuredClone(payload) : {};
  const metadata = nextPayload.metadata && typeof nextPayload.metadata === 'object' ? { ...nextPayload.metadata } : {};
  const userdata = nextPayload.userdata && typeof nextPayload.userdata === 'object' ? nextPayload.userdata : {};

  metadata.submission_path = 'server_fallback';
  metadata.browser_create_failed = true;
  metadata.questionnaire_session_id = questionnaireSessionId;
  if (primaryError?.failureKind && !metadata.primary_failure_kind) {
    metadata.primary_failure_kind = primaryError.failureKind;
  }

  nextPayload.metadata = metadata;
  nextPayload.userdata = userdata;

  return nextPayload;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const {
      transformedPayload,
      questionnaireSessionId,
      primaryError
    } = body || {};

    if (!transformedPayload || typeof transformedPayload !== 'object' || Array.isArray(transformedPayload)) {
      return Response.json({
        success: false,
        usedFallback: true,
        error: {
          message: 'Invalid submission payload',
          failureKind: 'validation',
          status: 400,
          code: 'INVALID_PAYLOAD'
        }
      }, { status: 400 });
    }

    if (!questionnaireSessionId) {
      return Response.json({
        success: false,
        usedFallback: true,
        error: {
          message: 'Missing questionnaire session id',
          failureKind: 'validation',
          status: 400,
          code: 'MISSING_SESSION_ID'
        }
      }, { status: 400 });
    }

    const normalizedPayload = normalizePayload(transformedPayload, questionnaireSessionId, primaryError);
    const metadata = normalizedPayload.metadata || {};

    if (!metadata.business_name || !metadata.businessDomain) {
      return Response.json({
        success: false,
        usedFallback: true,
        error: {
          message: 'Missing required submission metadata',
          failureKind: 'validation',
          status: 400,
          code: 'MISSING_REQUIRED_METADATA'
        }
      }, { status: 400 });
    }

    const submission = await base44.asServiceRole.entities.ProFormSubmission.create(normalizedPayload);

    return Response.json({
      success: true,
      submissionId: submission?.id || null,
      submission,
      usedFallback: true,
      zapierSent: false
    });
  } catch (error) {
    const serialized = serializeFunctionError(error);
    return Response.json({
      success: false,
      usedFallback: true,
      error: serialized
    }, { status: serialized.status || 500 });
  }
});