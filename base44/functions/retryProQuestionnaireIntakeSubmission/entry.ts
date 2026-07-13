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
    status: typeof safe.status === 'number' ? safe.status : safe.response?.status ?? null,
    code: typeof safe.code === 'string' ? safe.code : ''
  };
};

const incrementRetryCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) ? count + 1 : 1;
};

// Fire the payload to the Zapier webhook so retries reach the same downstream
// workflow as normal client submissions. Non-fatal: never breaks the retry.
const sendToZapierSafe = async (payload) => {
  try {
    const webhookUrl = 'https://hooks.zapier.com/hooks/catch/25964219/uas7p60/';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      return { ok: res.ok, status: res.status };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    return { ok: false, error: error?.message || 'zapier_send_failed' };
  }
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ success: false, error: { message: 'Forbidden: Admin access required' } }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    // Guard: useAiRepair must go through repairProQuestionnaireIntakeSubmission
    if (body?.useAiRepair === true) {
      return Response.json({
        success: false,
        error: { message: 'useAiRepair is not supported in retryProQuestionnaireIntakeSubmission. Use repairProQuestionnaireIntakeSubmission with mode="repair_and_retry" instead.' }
      }, { status: 400 });
    }

    const draftId = typeof body?.draftId === 'string' ? body.draftId : '';
    const intakeId = typeof body?.intakeId === 'string' ? body.intakeId : '';
    // Support both param names for backward compat
    const questionnaireSessionId = typeof body?.questionnaireSessionId === 'string'
      ? body.questionnaireSessionId
      : (typeof body?.session_id === 'string' ? body.session_id : '');
    const forceRetry = Boolean(body?.forceRetry);

    // --- Draft-based retry path ---
    // When draftId is provided, use the draft's mapped_payload_json directly
    if (draftId) {
      let draft = null;
      try {
        const draftList = await base44.asServiceRole.entities.ProFormDraft.filter({ id: draftId });
        draft = Array.isArray(draftList) && draftList.length > 0 ? draftList[0] : null;
      } catch {
        // filter may throw if id is invalid format
        draft = null;
      }

      if (!draft) {
        return Response.json({ success: false, error: { message: 'Draft not found' } }, { status: 404 });
      }

      const draftPayload = parsePayload(draft.mapped_payload_json);
      if (!draftPayload) {
        return Response.json({
          success: false,
          error: { message: 'No mapped_payload_json found on draft. Edit and save the draft payload first.' }
        }, { status: 400 });
      }

      const metadata = typeof draftPayload.metadata === 'object' && draftPayload.metadata ? draftPayload.metadata : {};
      const businessName = typeof metadata.business_name === 'string' ? metadata.business_name.trim() : '';
      const businessDomain = typeof metadata.businessDomain === 'string' ? metadata.businessDomain.trim() : '';

      if (!businessName || !businessDomain) {
        return Response.json({
          success: false,
          error: { message: 'Payload is missing required metadata.business_name or metadata.businessDomain' }
        }, { status: 400 });
      }

      // Duplicate guard by session_id
      const sessionId = draft.session_id;
      if (sessionId && !forceRetry) {
        const existingBySession = await base44.asServiceRole.entities.ProFormSubmission.filter({
          'metadata.questionnaire_session_id': sessionId
        });
        if (Array.isArray(existingBySession) && existingBySession.length > 0) {
          const existing = existingBySession[0];
          await base44.asServiceRole.entities.ProFormDraft.update(draftId, {
            status: 'submitted',
            final_submission_id: existing.id,
            submitted_at: new Date().toISOString()
          });
          await sendToZapierSafe(draftPayload);
          return Response.json({ success: true, alreadySubmitted: true, linkedSubmissionId: existing.id, draftId });
        }
      }

      if (draft.final_submission_id && !forceRetry) {
        await sendToZapierSafe(draftPayload);
        return Response.json({ success: true, alreadySubmitted: true, linkedSubmissionId: draft.final_submission_id, draftId });
      }

      // Stamp session_id onto payload metadata for deduplication
      if (sessionId) {
        draftPayload.metadata = { ...metadata, questionnaire_session_id: sessionId };
      }

      const submission = await base44.asServiceRole.entities.ProFormSubmission.create(draftPayload);
      await base44.asServiceRole.entities.ProFormDraft.update(draftId, {
        status: 'submitted',
        final_submission_id: submission.id,
        submitted_at: new Date().toISOString()
      });
      await sendToZapierSafe(draftPayload);
      return Response.json({ success: true, linkedSubmissionId: submission.id, draftId });
    }

    // --- Intake-based retry path (original) ---
    if (!intakeId && !questionnaireSessionId) {
      return Response.json({ success: false, error: { message: 'draftId, intakeId, or questionnaireSessionId is required' } }, { status: 400 });
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

    if (intake.linked_submission_id && !forceRetry) {
      const earlyPayload = parsePayload(intake.transformed_payload_json);
      if (earlyPayload) await sendToZapierSafe(earlyPayload);
      return Response.json({
        success: true,
        alreadySubmitted: true,
        linkedSubmissionId: intake.linked_submission_id,
        intakeId: intake.id
      });
    }

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
        const earlyPayload = parsePayload(intake.transformed_payload_json);
        if (earlyPayload) await sendToZapierSafe(earlyPayload);
        return Response.json({
          success: true,
          alreadySubmitted: true,
          linkedSubmissionId: existingSubmission.id,
          intakeId: intake.id
        });
      }
    }

    const transformedPayload = parsePayload(intake.transformed_payload_json);

    if (!transformedPayload) {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify({ message: 'Malformed transformed payload JSON' }),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count)
      });

      return Response.json({ success: false, error: { message: 'Malformed transformed payload JSON' }, intakeId: intake.id }, { status: 400 });
    }

    const metadata = typeof transformedPayload.metadata === 'object' && transformedPayload.metadata ? transformedPayload.metadata : {};
    const businessName = typeof metadata.business_name === 'string' ? metadata.business_name.trim() : '';
    const businessDomain = typeof metadata.businessDomain === 'string' ? metadata.businessDomain.trim() : '';

    if (!businessName || !businessDomain) {
      const error = { message: 'Missing required metadata fields' };
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(error),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count)
      });
      return Response.json({ success: false, error, intakeId: intake.id }, { status: 400 });
    }

    if (intake.linked_submission_id && forceRetry) {
      const linkedList = await base44.asServiceRole.entities.ProFormSubmission.filter({ id: intake.linked_submission_id });
      if (Array.isArray(linkedList) && linkedList.length > 0) {
        await sendToZapierSafe(transformedPayload);
        return Response.json({
          success: true,
          alreadySubmitted: true,
          linkedSubmissionId: intake.linked_submission_id,
          intakeId: intake.id
        });
      }
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

      await sendToZapierSafe(transformedPayload);
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