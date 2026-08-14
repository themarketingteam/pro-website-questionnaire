import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { authorizeRecoveryRequest } from '../../shared/draftRecoveryAuthorization.ts';
import {
  cleanIdentityText,
  computeIdentityFingerprint,
  isMissingIdentityValue,
  normalizeDomain
} from '../../shared/proIdentityResolution.ts';

const CONFIG: Record<string, any> = {
  draft: {
    entityName: 'ProFormDraft',
    payloadField: 'mapped_payload_json',
    nameField: 'business_name',
    domainField: 'domain'
  },
  intake: {
    entityName: 'ProFormSubmissionIntake',
    payloadField: 'transformed_payload_json',
    nameField: 'business_name',
    domainField: 'business_domain'
  }
};

const parsePayload = (value: unknown) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  const body = await req.json().catch(() => ({}));
  const base44 = createClientFromRequest(req);
  const authorization = await authorizeRecoveryRequest(base44, body);
  if (!authorization.authorized) return jsonResponse({ success: false, error: 'Unauthorized.' }, 403);

  const attemptId = cleanIdentityText(body?.attemptId, 200);
  const field = ['business_name', 'domain'].includes(body?.field) ? body.field : '';
  const decision = ['apply', 'reject'].includes(body?.decision) ? body.decision : '';
  const expectedFingerprint = cleanIdentityText(body?.expectedFingerprint, 200);
  if (!attemptId || !field || !decision || !expectedFingerprint) {
    return jsonResponse({ success: false, error: 'attemptId, field, decision, and expectedFingerprint are required.' }, 400);
  }

  const attempt = await base44.asServiceRole.entities.ProFormIdentityResolutionAttempt.get(attemptId).catch(() => null);
  if (!attempt) return jsonResponse({ success: false, error: 'Identity-resolution attempt not found.' }, 404);
  if (attempt.payload_fingerprint !== expectedFingerprint) {
    return jsonResponse({ success: false, stale: true, error: 'The candidate no longer matches the reviewed payload.' }, 409);
  }

  const config = CONFIG[attempt.record_type];
  if (!config) return jsonResponse({ success: false, error: 'Unsupported recovery record type.' }, 400);
  const record = await base44.asServiceRole.entities[config.entityName].get(attempt.record_id).catch(() => null);
  if (!record) return jsonResponse({ success: false, error: 'Recovery record not found.' }, 404);
  let payload = parsePayload(record?.[config.payloadField]);
  if (!payload && attempt.record_type === 'draft') {
    payload = {
      metadata: parsePayload(record?.metadata_json) || {},
      userdata: parsePayload(record?.userdata_json) || {}
    };
  }
  payload = payload || { metadata: {}, userdata: {} };
  const recordName = cleanIdentityText(record?.[config.nameField], 300);
  const payloadName = cleanIdentityText(payload?.metadata?.business_name, 300);
  const recordDomain = normalizeDomain(record?.[config.domainField]);
  const payloadDomain = normalizeDomain(payload?.metadata?.businessDomain || payload?.metadata?.business_domain);
  const currentFingerprint = await computeIdentityFingerprint({
    recordType: attempt.record_type,
    businessName: !isMissingIdentityValue(recordName) ? recordName : payloadName,
    domain: !isMissingIdentityValue(recordDomain) ? recordDomain : payloadDomain,
    payload
  });
  if (currentFingerprint !== expectedFingerprint) {
    await base44.asServiceRole.entities.ProFormIdentityResolutionAttempt.update(attempt.id, { status: 'stale' });
    return jsonResponse({ success: false, stale: true, error: 'The recovery record changed after this candidate was generated.' }, 409);
  }

  const reviewedAt = new Date().toISOString();
  const reviewedBy = authorization.user?.email || authorization.actorMode;
  if (decision === 'reject') {
    await base44.asServiceRole.entities.ProFormIdentityResolutionAttempt.update(attempt.id, {
      status: 'rejected',
      [`${field}_review_decision`]: 'rejected',
      reviewed_by: reviewedBy,
      reviewed_at: reviewedAt
    });
    return jsonResponse({ success: true, decision: 'rejected', field, record });
  }

  const candidate = field === 'business_name'
    ? cleanIdentityText(attempt.business_name_candidate, 300)
    : normalizeDomain(attempt.domain_candidate);
  if (isMissingIdentityValue(candidate)) {
    return jsonResponse({ success: false, error: 'This attempt does not contain a usable candidate.' }, 400);
  }
  if (!isMissingIdentityValue(record?.[config[field === 'business_name' ? 'nameField' : 'domainField']])) {
    return jsonResponse({ success: false, error: 'A valid value is already present and will not be overwritten.' }, 409);
  }
  if (field === 'domain') {
    const businessName = cleanIdentityText(record?.[config.nameField] || payload?.metadata?.business_name, 300);
    if (isMissingIdentityValue(businessName)) {
      return jsonResponse({ success: false, error: 'Accept or enter the Business Name before applying a Domain.' }, 409);
    }
  }

  const updatedPayload = JSON.parse(JSON.stringify(payload));
  if (!updatedPayload.metadata || typeof updatedPayload.metadata !== 'object') updatedPayload.metadata = {};
  const updates: Record<string, unknown> = {
    identity_resolution_status: 'manual_applied',
    identity_resolution_latest_attempt_id: attempt.id,
    last_identity_resolution_at: reviewedAt
  };
  if (field === 'business_name') {
    updates[config.nameField] = candidate;
    updatedPayload.metadata.business_name = candidate;
  } else {
    updates[config.domainField] = candidate;
    updatedPayload.metadata.businessDomain = candidate;
  }
  updates[config.payloadField] = JSON.stringify(updatedPayload);
  if (attempt.record_type === 'draft') {
    updates.metadata_json = JSON.stringify(updatedPayload.metadata || {});
    updates.userdata_json = JSON.stringify(updatedPayload.userdata || {});
  }

  const updatedRecord = await base44.asServiceRole.entities[config.entityName].update(record.id, updates);
  let priorAppliedFields: any[] = [];
  try {
    const parsedAppliedFields = JSON.parse(attempt.applied_fields_json || '[]');
    priorAppliedFields = Array.isArray(parsedAppliedFields) ? parsedAppliedFields : [];
  } catch {
    priorAppliedFields = [];
  }
  const appliedFields = Array.isArray(priorAppliedFields)
    ? [...new Set([...priorAppliedFields, field])]
    : [field];
  await base44.asServiceRole.entities.ProFormIdentityResolutionAttempt.update(attempt.id, {
    status: 'applied',
    [`${field}_review_decision`]: 'applied',
    applied_fields_json: JSON.stringify(appliedFields),
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt
  });

  return jsonResponse({ success: true, decision: 'applied', field, record: updatedRecord });
});
