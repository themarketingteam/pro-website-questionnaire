/* global Deno */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const parsePayload = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  return JSON.parse(value);
};

const safeError = (error) => ({
  name: error?.name || '',
  message: error?.message || 'Unknown error',
  status: error?.status || error?.response?.status || null,
  code: error?.code || error?.response?.data?.code || '',
});

const incrementRetryCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) ? count + 1 : 1;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ success: false, error: { message: 'Forbidden: Admin access required' } }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const intakeId = body?.intakeId || '';
    const questionnaireSessionId = body?.questionnaireSessionId || '';
    const forceRetry = Boolean(body?.forceRetry);

    if (!intakeId && !questionnaireSessionId) {
      return Response.json({ success: false, error: { message: 'intakeId or questionnaireSessionId is required' } }, { status: 400 });
    }

    const intakeList = intakeId
      ? await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ id: intakeId })
      : await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ questionnaire_session_id: questionnaireSessionId });

    const intake = Array.isArray(intakeList) && intakeList.length > 0
      ? intakeList.sort((a, b) => new Date(b.created_at_server || b.created_date || 0).getTime() - new Date(a.created_at_server || a.created_date || 0).getTime())[0]
      : null;

    if (!intake) {
      return Response.json({ success: false, error: { message: 'Intake record not found' } }, { status: 404 });
    }

    if (intake.linked_submission_id && !forceRetry) {
      return Response.json({
        success: true,
        alreadySubmitted: true,
        linkedSubmissionId: intake.linked_submission_id,
        intakeId: intake.id,
      });
    }

    let transformedPayload;
    try {
      transformedPayload = parsePayload(intake.transformed_payload_json);
    } catch {
      const error = { message: 'Malformed transformed payload JSON' };
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(error),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count),
      });
      return Response.json({ success: false, error, intakeId: intake.id }, { status: 400 });
    }

    const businessName = transformedPayload?.metadata?.business_name?.trim?.() || '';
    const businessDomain = transformedPayload?.metadata?.businessDomain?.trim?.() || '';

    if (!businessName || !businessDomain) {
      const error = { message: 'Missing required metadata fields' };
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(error),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count),
      });
      return Response.json({ success: false, error, intakeId: intake.id }, { status: 400 });
    }

    if (intake.linked_submission_id && forceRetry) {
      const linkedList = await base44.asServiceRole.entities.ProFormSubmission.filter({ id: intake.linked_submission_id });
      if (Array.isArray(linkedList) && linkedList.length > 0) {
        return Response.json({
          success: true,
          alreadySubmitted: true,
          linkedSubmissionId: intake.linked_submission_id,
          intakeId: intake.id,
        });
      }
    }

    try {
      const submission = await base44.asServiceRole.entities.ProFormSubmission.create(transformedPayload);
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_success',
        linked_submission_id: submission.id,
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count),
      });

      return Response.json({
        success: true,
        linkedSubmissionId: submission.id,
        intakeId: intake.id,
      });
    } catch (error) {
      const serialized = safeError(error);
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(serialized),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count),
      });

      return Response.json({ success: false, error: serialized, intakeId: intake.id }, { status: 500 });
    }
  } catch (error) {
    return Response.json({ success: false, error: safeError(error) }, { status: 500 });
  }
});