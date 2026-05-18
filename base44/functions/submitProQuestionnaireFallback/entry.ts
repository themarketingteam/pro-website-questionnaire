import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const truncate = (value, max = 500) => String(value ?? '').slice(0, max);
const safeJsonStringify = (value) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: 'serialization_failed' });
  }
};
const nowIso = () => new Date().toISOString();

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

const getIntakeBySession = async (base44, questionnaireSessionId) => {
  const matches = await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ questionnaire_session_id: questionnaireSessionId }, '-updated_date', 1);
  return Array.isArray(matches) && matches.length ? matches[0] : null;
};

const upsertIntake = async (base44, questionnaireSessionId, nextData) => {
  const existing = await getIntakeBySession(base44, questionnaireSessionId);
  const retryCount = Number(existing?.retry_count || 0) + 1;
  const payload = {
    ...nextData,
    questionnaire_session_id: questionnaireSessionId,
    created_at_server: existing?.created_at_server || nowIso(),
    last_retry_at: nowIso(),
    retry_count: retryCount
  };

  if (existing?.id) {
    const updated = await base44.asServiceRole.entities.ProFormSubmissionIntake.update(existing.id, payload);
    return updated;
  }

  return await base44.asServiceRole.entities.ProFormSubmissionIntake.create(payload);
};

const buildIntakePayload = ({
  questionnaireSessionId,
  normalizedPayload,
  rawResponses,
  primaryError,
  fallbackError,
  diagnostics,
  submitContext,
  status,
  intakeReason,
  linkedSubmissionId,
  source,
  zapierSent = false
}) => ({
  business_name: normalizedPayload?.metadata?.business_name || submitContext?.business_name || '',
  business_domain: normalizedPayload?.metadata?.businessDomain || submitContext?.domain || '',
  user_email: submitContext?.user_email || '',
  user_id: submitContext?.user_id || '',
  status,
  intake_reason: intakeReason,
  primary_failure_kind: primaryError?.failureKind || '',
  fallback_failure_kind: fallbackError?.failureKind || '',
  primary_error_json: safeJsonStringify(primaryError),
  fallback_error_json: safeJsonStringify(fallbackError),
  transformed_payload_json: safeJsonStringify(normalizedPayload),
  raw_responses_json: safeJsonStringify(rawResponses),
  diagnostics_json: safeJsonStringify(diagnostics),
  source,
  created_at_client: submitContext?.created_at_client || '',
  linked_submission_id: linkedSubmissionId || '',
  zapier_sent: Boolean(zapierSent),
  notes: ''
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const transformedPayload = body?.transformedPayload;
    const rawResponses = body?.rawResponses || body?.responseSnapshot || null;
    const questionnaireSessionId = body?.questionnaireSessionId;
    const primaryError = body?.primaryError || null;
    const submitContext = body?.submitContext || {};
    const diagnostics = body?.diagnostics || {};

    if (!questionnaireSessionId) {
      return Response.json({ success: false, received: false, usedFallback: true, error: { message: 'Missing questionnaire session', failureKind: 'validation', status: 400, code: 'MISSING_SESSION' } }, { status: 400 });
    }

    const normalizedPayload = transformedPayload && typeof transformedPayload === 'object'
      ? normalizePayload(transformedPayload, questionnaireSessionId, primaryError)
      : null;

    if (normalizedPayload?.metadata?.business_name && normalizedPayload?.metadata?.businessDomain) {
      try {
        const submission = await base44.asServiceRole.entities.ProFormSubmission.create(normalizedPayload);
        await upsertIntake(
          base44,
          questionnaireSessionId,
          buildIntakePayload({
            questionnaireSessionId,
            normalizedPayload,
            rawResponses,
            primaryError,
            fallbackError: null,
            diagnostics,
            submitContext,
            status: 'submitted',
            intakeReason: 'server_fallback_submission_created',
            linkedSubmissionId: submission?.id || '',
            source: 'server_fallback',
            zapierSent: false
          })
        );

        return Response.json({
          success: true,
          received: true,
          submissionCreated: true,
          submissionId: submission?.id || '',
          submission,
          usedFallback: true,
          zapierSent: false
        });
      } catch (submissionError) {
        const fallbackError = {
          message: truncate(submissionError?.message || 'Fallback submission failed', 500),
          failureKind: classifyError(submissionError),
          status: submissionError?.status ?? submissionError?.response?.status ?? null,
          code: truncate(submissionError?.code || '', 200)
        };

        try {
          const intake = await upsertIntake(
            base44,
            questionnaireSessionId,
            buildIntakePayload({
              questionnaireSessionId,
              normalizedPayload,
              rawResponses,
              primaryError,
              fallbackError,
              diagnostics,
              submitContext,
              status: 'received_intake',
              intakeReason: 'pro_form_submission_create_failed',
              linkedSubmissionId: '',
              source: 'server_fallback_intake',
              zapierSent: false
            })
          );

          return Response.json({
            success: true,
            received: true,
            submissionCreated: false,
            intakeId: intake?.id || '',
            usedFallback: true,
            zapierSent: false
          });
        } catch (intakeError) {
          return Response.json({
            success: false,
            received: false,
            usedFallback: true,
            error: {
              message: truncate(intakeError?.message || 'Fallback intake failed', 500),
              failureKind: classifyError(intakeError),
              status: intakeError?.status ?? intakeError?.response?.status ?? null,
              code: truncate(intakeError?.code || '', 200)
            }
          }, { status: 500 });
        }
      }
    }

    try {
      const intake = await upsertIntake(
        base44,
        questionnaireSessionId,
        buildIntakePayload({
          questionnaireSessionId,
          normalizedPayload,
          rawResponses,
          primaryError,
          fallbackError: { message: 'Submission payload unavailable for server create', failureKind: 'validation', status: 400, code: 'NO_TRANSFORMED_PAYLOAD' },
          diagnostics,
          submitContext,
          status: 'received_intake',
          intakeReason: 'pro_form_submission_create_failed',
          linkedSubmissionId: '',
          source: 'server_fallback_intake',
          zapierSent: false
        })
      );

      return Response.json({
        success: true,
        received: true,
        submissionCreated: false,
        intakeId: intake?.id || '',
        usedFallback: true,
        zapierSent: false
      });
    } catch (intakeError) {
      return Response.json({
        success: false,
        received: false,
        usedFallback: true,
        error: {
          message: truncate(intakeError?.message || 'Fallback intake failed', 500),
          failureKind: classifyError(intakeError),
          status: intakeError?.status ?? intakeError?.response?.status ?? null,
          code: truncate(intakeError?.code || '', 200)
        }
      }, { status: 500 });
    }
  } catch (error) {
    return Response.json({
      success: false,
      received: false,
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