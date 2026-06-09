/**
 * retryProQuestionnaireIntakeSubmission
 *
 * CANONICAL retry function. Accepts:
 *   - intakeId          — direct record ID lookup
 *   - questionnaireSessionId — canonical session ID
 *   - session_id        — backward-compat alias for questionnaireSessionId
 *   - forceRetry        — bypass duplicate guard
 *   - useAiRepair       — not yet implemented; returns a clear message directing
 *                         caller to repairProQuestionnaireIntakeSubmission instead
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const parsePayload = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const safeError = (error) => {
  const safe = (error ?? {});
  return {
    message: typeof safe.message === 'string' ? safe.message : 'Unknown error',
    status: typeof safe.status === 'number' ? safe.status : (safe.response?.status ?? null),
    code: typeof safe.code === 'string' ? safe.code : ''
  };
};

const incrementRetryCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) ? count + 1 : 1;
};

// eslint-disable-next-line no-undef
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ success: false, error: { message: 'Forbidden: Admin access required' } }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const intakeId = typeof body?.intakeId === 'string' ? body.intakeId : '';
    // FIX 5: Accept both questionnaireSessionId and session_id alias
    const questionnaireSessionId =
      typeof body?.questionnaireSessionId === 'string' ? body.questionnaireSessionId :
      typeof body?.session_id === 'string' ? body.session_id : '';
    const forceRetry = Boolean(body?.forceRetry);

    // FIX 6: useAiRepair is not yet implemented — return clear message
    if (body?.useAiRepair === true) {
      return Response.json({
        success: false,
        error: {
          message: 'useAiRepair is not supported in retryProQuestionnaireIntakeSubmission. Use repairProQuestionnaireIntakeSubmission with mode="repair_and_retry" instead.'
        }
      }, { status: 400 });
    }

    if (!intakeId && !questionnaireSessionId) {
      return Response.json({ success: false, error: { message: 'intakeId or questionnaireSessionId (or session_id) is required' } }, { status: 400 });
    }

    const intakeList = intakeId
      ? await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ id: intakeId })
      : await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ questionnaire_session_id: questionnaireSessionId });

    const intake = Array.isArray(intakeList) && intakeList.length > 0
      ? [...intakeList].sort((a, b) => new Date(String(b.created_at_server || b.created_date || 0)).getTime() - new Date(String(a.created_at_server || a.created_date || 0)).getTime())[0]
      : null;

    if (!intake) {
      return Response.json({ success: false, error: { message: 'Intake record not found' } }, { status: 404 });
    }

    // Guard: linked_submission_id already set
    if (intake.linked_submission_id && !forceRetry) {
      return Response.json({
        success: true,
        alreadySubmitted: true,
        linkedSubmissionId: intake.linked_submission_id,
        intakeId: intake.id
      });
    }

    // Guard: existing submission by session ID
    if (intake.questionnaire_session_id) {
      const existingSubmissions = await base44.asServiceRole.entities.ProFormSubmission.filter({
        'metadata.questionnaire_session_id': intake.questionnaire_session_id
      });
      if (Array.isArray(existingSubmissions) && existingSubmissions.length > 0 && !forceRetry) {
        const existingSubmission = existingSubmissions[0];
        await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
          status: 'retry_success',
          linked_submission_id: existingSubmission.id,
          retry_error_json: '',
          last_retry_at: new Date().toISOString(),
          retry_count: incrementRetryCount(intake.retry_count)
        });
        return Response.json({
          success: true,
          alreadySubmitted: true,
          linkedSubmissionId: existingSubmission.id,
          intakeId: intake.id
        });
      }
    }

    // Guard: forceRetry — verify the existing linked submission actually exists
    if (intake.linked_submission_id && forceRetry) {
      const linkedList = await base44.asServiceRole.entities.ProFormSubmission.filter({ id: intake.linked_submission_id });
      if (Array.isArray(linkedList) && linkedList.length > 0) {
        return Response.json({
          success: true,
          alreadySubmitted: true,
          linkedSubmissionId: intake.linked_submission_id,
          intakeId: intake.id
        });
      }
      // Linked submission no longer exists — allow retry to proceed
    }

    const transformedPayload = parsePayload(intake.transformed_payload_json);

    if (!transformedPayload) {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify({
          message: 'Malformed transformed payload JSON — use repairProQuestionnaireIntakeSubmission with mode="repair_and_retry" to recover this record.'
        }),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count)
      });

      return Response.json({
        success: false,
        error: {
          message: 'Malformed transformed payload JSON. Use repairProQuestionnaireIntakeSubmission with mode="repair_and_retry" to recover.'
        },
        intakeId: intake.id
      }, { status: 400 });
    }

    const metadata = typeof transformedPayload.metadata === 'object' && transformedPayload.metadata ? transformedPayload.metadata : {};
    const businessName = typeof metadata.business_name === 'string' ? metadata.business_name.trim() : '';
    const businessDomain = typeof metadata.businessDomain === 'string' ? metadata.businessDomain.trim() : '';

    if (!businessName || !businessDomain) {
      const error = { message: 'Missing required metadata fields (business_name or businessDomain)' };
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(error),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count)
      });
      return Response.json({ success: false, error, intakeId: intake.id }, { status: 400 });
    }

    // Ensure questionnaire_session_id is stamped on payload metadata
    if (intake.questionnaire_session_id && transformedPayload.metadata) {
      transformedPayload.metadata.questionnaire_session_id = intake.questionnaire_session_id;
    }

    try {
      const submission = await base44.asServiceRole.entities.ProFormSubmission.create(transformedPayload);
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_success',
        linked_submission_id: submission.id,
        retry_error_json: '',
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count)
      });

      return Response.json({
        success: true,
        linkedSubmissionId: submission.id,
        intakeId: intake.id
      });
    } catch (error) {
      const serialized = safeError(error);
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(serialized),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count)
      });

      return Response.json({ success: false, error: serialized, intakeId: intake.id }, { status: 500 });
    }
  } catch (error) {
    return Response.json({ success: false, error: safeError(error) }, { status: 500 });
  }
});