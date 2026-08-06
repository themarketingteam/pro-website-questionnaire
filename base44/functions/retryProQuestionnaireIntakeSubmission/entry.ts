import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import {
  buildZapierPersistenceDiagnostics,
  performZapierSubmission,
  stampSyntheticEnvironmentMetadata,
} from '../_shared/proExternalSideEffects/entry.ts';
import {
  ADMIN_API_OPERATION_NAMES,
  authorizeAdminRecoveryRequest,
  buildAdminErrorResponse,
  recordDeniedAdminOperation,
  recordAdminOperationEvent,
} from '../_shared/proDraftAdminRequest/entry.ts';
import { createServerRequestId } from '../_shared/proDraftPersistence/entry.ts';

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

const withNoStore = (response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const parseDiagnosticObject = (value) => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const zapierResponseFields = (result) => ({
  zapierSent: result.delivered === true,
  zapierSuppressed: result.suppressed === true,
  zapierRedirected: result.redirected === true,
  zapierStatus: result.externalStatus,
  environment: result.environment,
  externalSideEffectsMode: result.mode,
  destinationClass: result.destinationClass,
  externalErrorCode: result.errorCode,
  externalSideEffect: result
});

const persistZapierDiagnostics = async (base44, successData, result) => {
  const diagnostics = buildZapierPersistenceDiagnostics(result);
  try {
    if (successData.intakeId) {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(successData.intakeId, {
        zapier_sent: diagnostics.zapier_sent,
        diagnostics_json: JSON.stringify({
          ...parseDiagnosticObject(successData.intakeDiagnosticsJson),
          ...diagnostics
        })
      });
    } else if (successData.draftId) {
      await base44.asServiceRole.entities.ProFormDraft.update(successData.draftId, {
        draft_metadata_json: JSON.stringify({
          ...parseDiagnosticObject(successData.draftMetadataJson),
          ...diagnostics
        })
      });
    }
  } catch {
    // Delivery outcome remains truthful even if diagnostic persistence fails.
  }
};

const respondAfterZapierDelivery = async (base44, payload, successData) => {
  const {
    intakeDiagnosticsJson: _intakeDiagnosticsJson,
    draftMetadataJson: _draftMetadataJson,
    ...publicSuccessData
  } = successData;
  const zapierResult = await performZapierSubmission(payload);
  await persistZapierDiagnostics(base44, successData, zapierResult);
  const responseFields = zapierResponseFields(zapierResult);

  if (!zapierResult.success) {
    return Response.json({
      ...publicSuccessData,
      ...responseFields,
      success: false,
      error: { message: zapierResult.message, code: zapierResult.errorCode }
    });
  }

  return Response.json({
    ...publicSuccessData,
    ...responseFields,
    success: true
  });
};

async function retryProQuestionnaireIntakeSubmissionCore(req) {
  try {
    const base44 = createClientFromRequest(req);
    const rawBody = await req.json().catch(() => ({}));
    const requestId = createServerRequestId();
    let authorization;
    try {
      authorization = await authorizeAdminRecoveryRequest({ request: req, body: rawBody,
        operation: ADMIN_API_OPERATION_NAMES.RETRY_SUBMISSION, requestId,
        getEnvironmentValue: (name) => Deno.env.get(name) });
      await recordAdminOperationEvent(base44.asServiceRole.entities.ProFormRecoverySecurityEvent, {
        authorization, requestId, operation: ADMIN_API_OPERATION_NAMES.RETRY_SUBMISSION,
        environment: authorization.environment, outcome: 'authorized', testRunId: authorization.payload.testRunId,
      });
    } catch (error) {
      try { await recordDeniedAdminOperation(base44.asServiceRole.entities.ProFormRecoverySecurityEvent, {
        body: rawBody, error, requestId, operation: ADMIN_API_OPERATION_NAMES.RETRY_SUBMISSION,
        getEnvironmentValue: (name) => Deno.env.get(name),
      }); } catch { /* invalid device input cannot be safely attributed */ }
      return buildAdminErrorResponse(error, requestId);
    }
    const body = authorization.payload;

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

      const draftPayload = stampSyntheticEnvironmentMetadata(
        parsePayload(draft.mapped_payload_json)
      );
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
          return await respondAfterZapierDelivery(base44, draftPayload, {
            alreadySubmitted: true,
            linkedSubmissionId: existing.id,
            draftId,
            draftMetadataJson: draft.draft_metadata_json
          });
        }
      }

      if (draft.final_submission_id && !forceRetry) {
        return await respondAfterZapierDelivery(base44, draftPayload, {
          alreadySubmitted: true,
          linkedSubmissionId: draft.final_submission_id,
          draftId,
          draftMetadataJson: draft.draft_metadata_json
        });
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
      return await respondAfterZapierDelivery(base44, draftPayload, {
        linkedSubmissionId: submission.id,
        draftId,
        draftMetadataJson: draft.draft_metadata_json
      });
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
      const earlyPayload = stampSyntheticEnvironmentMetadata(parsePayload(intake.transformed_payload_json));
      return await respondAfterZapierDelivery(base44, earlyPayload, {
        alreadySubmitted: true,
        linkedSubmissionId: intake.linked_submission_id,
        intakeId: intake.id,
        intakeDiagnosticsJson: intake.diagnostics_json
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
        const earlyPayload = stampSyntheticEnvironmentMetadata(parsePayload(intake.transformed_payload_json));
        return await respondAfterZapierDelivery(base44, earlyPayload, {
          alreadySubmitted: true,
          linkedSubmissionId: existingSubmission.id,
          intakeId: intake.id,
          intakeDiagnosticsJson: intake.diagnostics_json
        });
      }
    }

    const transformedPayload = stampSyntheticEnvironmentMetadata(
      parsePayload(intake.transformed_payload_json)
    );

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
        return await respondAfterZapierDelivery(base44, transformedPayload, {
          alreadySubmitted: true,
          linkedSubmissionId: intake.linked_submission_id,
          intakeId: intake.id,
          intakeDiagnosticsJson: intake.diagnostics_json
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

      return await respondAfterZapierDelivery(base44, transformedPayload, {
        linkedSubmissionId: submission.id,
        intakeId: intake.id,
        intakeDiagnosticsJson: intake.diagnostics_json
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
}

export default async function retryProQuestionnaireIntakeSubmission(req) {
  return withNoStore(await retryProQuestionnaireIntakeSubmissionCore(req));
}
