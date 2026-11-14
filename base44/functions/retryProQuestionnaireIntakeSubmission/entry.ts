import { normalizeStoredOrganizedRecord, samePageStructure, validateOrganizedPayload, validateOrganizedSubmission } from '../../shared/pageOrganizerContract.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.61';

import { withEntityLease } from '../../shared/entityLease.ts';
import { createSubmissionContentFingerprint, createSubmissionIdentityFingerprint, getSubmissionIdentity } from '../../shared/proDraftSubmissionAuthorization.ts';

const stampSubmissionIdentity = async (payload: any, draftId: string, attemptId: string) => {
  if (!draftId) return payload;
  const identity = getSubmissionIdentity(payload);
  return { ...payload, metadata: {
    ...(payload.metadata || {}), source_draft_id: draftId,
    submission_attempt_id: attemptId,
    submission_content_fingerprint: await createSubmissionContentFingerprint({ payload, draftId, identity }),
    client_identity_fingerprint: await createSubmissionIdentityFingerprint(identity)
  } };
};

const validateReceiptAgreement = (receipt: any, expected: any) => {
  receipt = normalizeStoredOrganizedRecord(receipt, expected);
  if (!receipt?.id) throw Object.assign(new Error('The durable submission receipt is missing.'), { status: 409, code: 'SUBMISSION_RECEIPT_MISSING' });
  if (expected?.metadata?.source_draft_id && receipt.metadata?.source_draft_id && expected.metadata.source_draft_id !== receipt.metadata.source_draft_id) throw Object.assign(new Error('The retained receipt belongs to a different source draft.'), { status: 409, code: 'SUBMISSION_IDENTITY_CONFLICT' });
  const validation = validateOrganizedPayload(receipt);
  if (!validation.ok) throw Object.assign(new Error(validation.errors.join(' ')), { status: 409, code: validation.code });
  for (const field of ['service_offerings_structure', 'target_industries_structure']) {
    const sent = Object.prototype.hasOwnProperty.call(expected?.userdata || {}, field);
    const stored = Object.prototype.hasOwnProperty.call(receipt?.userdata || {}, field);
    if (sent !== stored || (sent && !samePageStructure(expected.userdata[field], receipt.userdata[field]))) {
      throw Object.assign(new Error('The retained submission pages differ from the selected recovery payload. Review the records before retrying.'), { status: 409, code: 'ORGANIZER_SUBMISSION_CONFLICT' });
    }
  }
  return receipt;
};

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

const ZAPIER_WEBHOOK_FALLBACK_URL = 'https://hooks.zapier.com/hooks/catch/23529934/uas7p60/';

const isValidZapierWebhookUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;

  try {
    const url = new URL(value.trim());
    const normalizedUrl = `${url.origin}${url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`}`;
    return normalizedUrl === ZAPIER_WEBHOOK_FALLBACK_URL &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
};

const resolveZapierWebhookUrl = () => {
  let configuredUrl = '';
  try {
    configuredUrl = Deno.env.get('ZAPIER_WEBHOOK_URL')?.trim() || '';
  } catch {
    configuredUrl = '';
  }

  if (!isValidZapierWebhookUrl(configuredUrl)) return ZAPIER_WEBHOOK_FALLBACK_URL;
  return configuredUrl.endsWith('/') ? configuredUrl : `${configuredUrl}/`;
};

const ZAPIER_WEBHOOK_URL = resolveZapierWebhookUrl();

const DRAFT_RECOVERY_SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';
const DRAFT_RECOVERY_GRANT_SCOPE = 'draft-recovery';
const DRAFT_RECOVERY_GRANT_VERSION = 1;
const DRAFT_RECOVERY_GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;
const draftRecoveryEncoder = new TextEncoder();

const draftRecoveryFromBase64Url = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const draftRecoveryToBase64Url = (bytes) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const importDraftRecoverySigningKey = (secret) => crypto.subtle.importKey(
  'raw',
  draftRecoveryEncoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['verify']
);

const verifyDraftRecoveryGrant = async (token) => {
  if (typeof token !== 'string' || !token) return false;

  let configuredPassword = '';
  try {
    configuredPassword = Deno.env.get(DRAFT_RECOVERY_SECRET_NAME) || '';
  } catch {
    configuredPassword = '';
  }
  if (!configuredPassword) return false;

  const [encodedPayload, encodedSignature, ...extraParts] = token.split('.');
  if (!encodedPayload || !encodedSignature || extraParts.length > 0) return false;

  try {
    if (
      draftRecoveryToBase64Url(draftRecoveryFromBase64Url(encodedPayload)) !== encodedPayload ||
      draftRecoveryToBase64Url(draftRecoveryFromBase64Url(encodedSignature)) !== encodedSignature
    ) return false;
    const signingKey = await importDraftRecoverySigningKey(configuredPassword);
    const signatureIsValid = await crypto.subtle.verify(
      'HMAC',
      signingKey,
      draftRecoveryFromBase64Url(encodedSignature),
      draftRecoveryEncoder.encode(encodedPayload)
    );
    if (!signatureIsValid) return false;

    const payload = JSON.parse(new TextDecoder().decode(draftRecoveryFromBase64Url(encodedPayload)));
    const now = Math.floor(Date.now() / 1000);
    return payload?.version === DRAFT_RECOVERY_GRANT_VERSION &&
      payload?.scope === DRAFT_RECOVERY_GRANT_SCOPE &&
      Number.isFinite(payload?.issuedAt) &&
      Number.isFinite(payload?.expiresAt) &&
      payload.issuedAt <= now + 60 &&
      payload.expiresAt > now &&
      payload.expiresAt <= payload.issuedAt + DRAFT_RECOVERY_GRANT_TTL_SECONDS;
  } catch {
    return false;
  }
};

const authorizeDraftRecoveryRequest = async (base44, body) => {
  try {
    const user = await base44.auth.me();
    if (user?.role === 'admin') return 'admin';
  } catch {
    // Public callers do not have a Base44 user session.
  }

  return await verifyDraftRecoveryGrant(body?.recoveryGrant) ? 'recovery_grant' : '';
};

// Deliver the payload to the required Zapier workflow and report the result to
// the caller. The admin UI must not report a successful retry when Zapier did
// not accept the request.
const sendToZapierSafe = async (payload) => {
  const organizerValidation = validateOrganizedPayload(payload);
  if (!organizerValidation.ok) return { ok: false, error: organizerValidation.errors.join(' ') };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(ZAPIER_WEBHOOK_URL, {
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

const respondAfterZapierDelivery = async (payload, successData) => {
  if (!payload) {
    return Response.json({
      ...successData,
      success: false,
      zapierSent: false,
      zapierEndpoint: ZAPIER_WEBHOOK_URL,
      error: { message: 'Zapier delivery failed: no submission payload was available' }
    });
  }

  const zapierResult = await sendToZapierSafe(payload);
  if (!zapierResult.ok) {
    const detail = zapierResult.error || (zapierResult.status ? `HTTP ${zapierResult.status}` : 'unknown error');
    return Response.json({
      ...successData,
      success: false,
      zapierSent: false,
      zapierStatus: zapierResult.status ?? null,
      zapierEndpoint: ZAPIER_WEBHOOK_URL,
      error: { message: `Zapier delivery failed: ${detail}` }
    });
  }

  return Response.json({
    ...successData,
    success: true,
    zapierSent: true,
    zapierStatus: zapierResult.status,
    zapierEndpoint: ZAPIER_WEBHOOK_URL
  });
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const authorizationMode = await authorizeDraftRecoveryRequest(base44, body);

    if (!authorizationMode) {
      console.warn('Retry rejected: missing admin session or valid recovery grant');
      return Response.json({
        success: false,
        error: { message: 'Forbidden: Admin session or valid draft recovery access is required' }
      }, { status: 403 });
    }
    console.info('Retry authorized', { authorizationMode });

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

      return await withEntityLease({ entity: base44.asServiceRole.entities.ProFormDraft, entityId: draftId, purpose: 'pro-admin-draft-retry' }, async (lease) => {
      draft = await base44.asServiceRole.entities.ProFormDraft.get(draftId);
      const pending = await base44.asServiceRole.entities.ProFormDraftRevision.filter({ draft_id: draftId }, '-server_revision', 1);
      if ((Number(pending?.[0]?.server_revision) || 0) > (Number(draft.save_revision) || 0)) return Response.json({ success: false, code: 'DRAFT_SAVE_PENDING', error: { message: 'A newer saved revision needs recovery before retrying.' } }, { status: 409 });
      let draftPayload = parsePayload(draft.mapped_payload_json);
      if (!draftPayload) {
        return Response.json({
          success: false,
          error: { message: 'No mapped_payload_json found on draft. Edit and save the draft payload first.' }
        }, { status: 400 });
      }

      const organizerValidation = validateOrganizedSubmission({ payload: draftPayload, responses: parsePayload(draft.responses_json) || {} });
      if (!organizerValidation.ok) return Response.json({ success: false, code: organizerValidation.code, error: { message: organizerValidation.errors.join(' ') } }, { status: organizerValidation.status });

      const metadata = typeof draftPayload.metadata === 'object' && draftPayload.metadata ? draftPayload.metadata : {};
      const businessName = typeof metadata.business_name === 'string' ? metadata.business_name.trim() : '';
      const businessDomain = typeof metadata.businessDomain === 'string' ? metadata.businessDomain.trim() : '';

      if (!businessName || !businessDomain) {
        return Response.json({
          success: false,
          error: { message: 'Payload is missing required metadata.business_name or metadata.businessDomain' }
        }, { status: 400 });
      }

      if (draft.final_submission_id) {
        const linked = validateReceiptAgreement(await base44.asServiceRole.entities.ProFormSubmission.get(draft.final_submission_id), draftPayload);
        return await respondAfterZapierDelivery(linked, {
          alreadySubmitted: true,
          linkedSubmissionId: draft.final_submission_id,
          draftId
        });
      }


      // Duplicate guard by session_id
      const sessionId = draft.session_id;
      if (sessionId) {
        const existingBySession = await base44.asServiceRole.entities.ProFormSubmission.filter({
          'metadata.questionnaire_session_id': sessionId
        });
        if (Array.isArray(existingBySession) && existingBySession.length > 0) {
          const candidates = existingBySession.filter((record) => !record.metadata?.source_draft_id || record.metadata.source_draft_id === draftId);
          const existing = candidates[0] ? validateReceiptAgreement(candidates[0], draftPayload) : null;
          if (existing) {
          await lease.update({
            status: 'submitted',
            final_submission_id: existing.id,
            submitted_at: new Date().toISOString()
          });
          return await respondAfterZapierDelivery(existing, {
            alreadySubmitted: true,
            linkedSubmissionId: existing.id,
            draftId
          });
          }
        }
      }


      // Stamp session_id onto payload metadata for deduplication
      if (sessionId) {
        draftPayload.metadata = {
          ...metadata,
          questionnaire_session_id: sessionId,
          source_draft_id: draftId
        };
      }

      draftPayload = await stampSubmissionIdentity(draftPayload, draftId, `admin_draft_${crypto.randomUUID().replace(/-/g, '')}`);
      await lease.assertActive();
      const submission = validateReceiptAgreement(await base44.asServiceRole.entities.ProFormSubmission.create(draftPayload), draftPayload);
      await lease.update({
        status: 'submitted',
        final_submission_id: submission.id,
        submitted_at: new Date().toISOString()
      });
      return await respondAfterZapierDelivery(submission, {
        linkedSubmissionId: submission.id,
        draftId
      });
      });
    }

    // --- Intake-based retry path (original) ---
    if (!intakeId && !questionnaireSessionId) {
      return Response.json({ success: false, error: { message: 'draftId, intakeId, or questionnaireSessionId is required' } }, { status: 400 });
    }

    const intakeList = intakeId
      ? await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ id: intakeId })
      : await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ questionnaire_session_id: questionnaireSessionId });

    const intakeRecord = Array.isArray(intakeList) && intakeList.length > 0
      ? [...intakeList].sort((a, b) => new Date(String(b.created_at_server || b.created_date || 0)).getTime() - new Date(String(a.created_at_server || a.created_date || 0)).getTime())[0]
      : null;

    if (!intakeRecord) {
      return Response.json({ success: false, error: { message: 'Intake record not found' } }, { status: 404 });
    }

    return await withEntityLease({
      entity: intakeRecord.source_draft_id ? base44.asServiceRole.entities.ProFormDraft : base44.asServiceRole.entities.ProFormSubmissionIntake,
      entityId: intakeRecord.source_draft_id || intakeRecord.id, purpose: 'pro-admin-intake-retry'
    }, async (lease) => {
    const intake = await base44.asServiceRole.entities.ProFormSubmissionIntake.get(intakeRecord.id);
    if (!intake?.id) return Response.json({ success: false, error: { message: 'Intake record not found' } }, { status: 404 });
    // Apply the same structure guard before early duplicate-delivery paths.
    const storedIntakePayload = parsePayload(intake.transformed_payload_json);
    if (storedIntakePayload) {
      const storedValidation = validateOrganizedPayload(storedIntakePayload);
      if (!storedValidation.ok) return Response.json({ success: false, code: storedValidation.code, error: { message: storedValidation.errors.join(' ') } }, { status: 400 });
      if (intake.source_draft_id) {
        const sourceDraft = await base44.asServiceRole.entities.ProFormDraft.get(intake.source_draft_id);
        const sourceGuard = validateOrganizedSubmission({ payload: storedIntakePayload, responses: parsePayload(sourceDraft.responses_json) || {} });
        if (!sourceGuard.ok) return Response.json({ success: false, code: sourceGuard.code, error: { message: sourceGuard.errors.join(' ') } }, { status: sourceGuard.status });
      }
    }

    if (intake.linked_submission_id && !forceRetry) {
      const earlyPayload = parsePayload(intake.transformed_payload_json);
      const linked = validateReceiptAgreement(await base44.asServiceRole.entities.ProFormSubmission.get(intake.linked_submission_id), earlyPayload);
      return await respondAfterZapierDelivery(linked, {
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
        const candidates = existingSubmissions.filter((record) => !intake.source_draft_id || !record.metadata?.source_draft_id || record.metadata.source_draft_id === intake.source_draft_id);
        const existingSubmission = candidates[0] ? validateReceiptAgreement(candidates[0], storedIntakePayload) : null;
        if (existingSubmission) {
        await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
          status: 'retry_success',
          linked_submission_id: existingSubmission.id,
          retry_error_json: '',
          last_retry_at: new Date().toISOString(),
          retry_count: incrementRetryCount(intake.retry_count)
        });
        return await respondAfterZapierDelivery(existingSubmission, {
          alreadySubmitted: true,
          linkedSubmissionId: existingSubmission.id,
          intakeId: intake.id
        });
        }
      }
    }

    let transformedPayload = parsePayload(intake.transformed_payload_json);

    if (!transformedPayload) {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify({ message: 'Malformed transformed payload JSON' }),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count)
      });

      return Response.json({ success: false, error: { message: 'Malformed transformed payload JSON' }, intakeId: intake.id }, { status: 400 });
    }

    const organizerValidation = validateOrganizedPayload(transformedPayload);
    if (!organizerValidation.ok) return Response.json({ success: false, code: organizerValidation.code, error: { message: organizerValidation.errors.join(' ') } }, { status: 400 });
    if (intake.source_draft_id) {
      const sourceDraft = await base44.asServiceRole.entities.ProFormDraft.get(intake.source_draft_id);
      const submissionGuard = validateOrganizedSubmission({ payload: transformedPayload, responses: parsePayload(sourceDraft.responses_json) || {} });
      if (!submissionGuard.ok) return Response.json({ success: false, code: submissionGuard.code, error: { message: submissionGuard.errors.join(' ') } }, { status: submissionGuard.status });
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
        const linked = validateReceiptAgreement(linkedList[0], transformedPayload);
        return await respondAfterZapierDelivery(linked, {
          alreadySubmitted: true,
          linkedSubmissionId: intake.linked_submission_id,
          intakeId: intake.id
        });
      }
    }

    try {
      transformedPayload.metadata = {
        ...(transformedPayload.metadata || {}),
        questionnaire_session_id: intake.questionnaire_session_id || questionnaireSessionId || '',
        source_intake_id: intake.id
      };
      transformedPayload = await stampSubmissionIdentity(transformedPayload, intake.source_draft_id, intake.submission_attempt_id || `admin_intake_${intake.id}`);
      await lease.assertActive();
      const submission = validateReceiptAgreement(await base44.asServiceRole.entities.ProFormSubmission.create(transformedPayload), transformedPayload);
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_success',
        linked_submission_id: submission.id,
        retry_error_json: '',
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intake.retry_count)
      });

      if (intake.source_draft_id) await lease.update({ status: 'submitted', final_submission_id: submission.id, submitted_at: new Date().toISOString() });
      return await respondAfterZapierDelivery(submission, {
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

      return Response.json({ success: false, error: serialized, intakeId: intake.id }, { status: serialized.status || 500 });
    }
    });
  } catch (error) {
    return Response.json({ success: false, code: error?.code || '', error: safeError(error) }, { status: error?.status || 500 });
  }
});
