import { createClientFromRequest } from "npm:@base44/sdk";
import { authorizeRecoveryRequest } from "../../shared/draftRecoveryAuthorization.ts";

const RETENTION_DAYS = 1095;
const RETENTION_POLICY_VERSION = 'three-year-active-v1';
const RECORDS = {
  draft: 'ProFormDraft',
  intake: 'ProFormSubmissionIntake',
  submission: 'ProFormSubmission'
} as const;

const cleanText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
});

const publicRecord = (record: any) => ({
  id: record?.id || '',
  archived_at: record?.archived_at || '',
  archive_reason: record?.archive_reason || '',
  retention_until: record?.retention_until || '',
  soft_deleted_at: record?.soft_deleted_at || '',
  soft_deleted_by: record?.soft_deleted_by || '',
  soft_delete_reason: record?.soft_delete_reason || ''
});

export default async function (req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);

  const body = await req.json().catch(() => ({}));
  const base44 = createClientFromRequest(req);
  const authorization = await authorizeRecoveryRequest(base44, body);
  if (!authorization.authorized || authorization.actorMode === 'backend_function') {
    return jsonResponse({ success: false, error: 'Draft recovery access has expired.' }, 401);
  }

  const recordType = cleanText(body?.recordType, 20) as keyof typeof RECORDS;
  const recordId = cleanText(body?.recordId, 200);
  const action = cleanText(body?.action, 20);
  const reason = cleanText(body?.reason, 1000);
  const entityName = RECORDS[recordType];
  if (!entityName || !recordId || !['soft_delete', 'restore'].includes(action)) {
    return jsonResponse({ success: false, error: 'A valid recovery lifecycle action is required.' }, 400);
  }
  if (action === 'soft_delete' && reason.length < 3) {
    return jsonResponse({ success: false, error: 'A deletion reason is required.' }, 400);
  }

  try {
    const entity = base44.asServiceRole.entities[entityName];
    const record = await entity.get(recordId);
    if (!record) return jsonResponse({ success: false, error: 'Recovery record not found.' }, 404);

    const now = new Date().toISOString();
    const actorIdentifier = cleanText(
      authorization.user?.email || authorization.user?.id || authorization.actorMode,
      320
    );
    const update = action === 'soft_delete'
      ? {
          soft_deleted_at: record.soft_deleted_at || now,
          soft_deleted_by: record.soft_deleted_by || actorIdentifier,
          soft_delete_reason: reason
        }
      : {
          soft_deleted_at: '',
          soft_deleted_by: '',
          soft_delete_reason: '',
          archived_at: '',
          archive_reason: '',
          retention_policy_version: RETENTION_POLICY_VERSION,
          retention_started_at: now,
          retention_until: new Date(Date.parse(now) + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
        };

    const updated = await entity.update(recordId, update);
    await base44.asServiceRole.entities.ProFormRecoveryLifecycleEvent.create({
      record_type: recordType,
      record_id: recordId,
      action,
      actor_mode: authorization.actorMode,
      actor_identifier: actorIdentifier,
      reason: action === 'restore' ? (reason || 'Administrator restored the retained record.') : reason,
      occurred_at: now,
      previous_state_json: JSON.stringify(publicRecord(record))
    });

    console.info('[Recovery lifecycle] state changed', {
      recordType,
      recordId,
      action,
      actorMode: authorization.actorMode
    });
    return jsonResponse({ success: true, action, record: publicRecord(updated) });
  } catch (error) {
    console.error('[Recovery lifecycle] request failed', {
      recordType,
      recordId,
      action,
      name: error instanceof Error ? error.name : 'Error'
    });
    return jsonResponse({ success: false, error: 'Unable to change the recovery record state.' }, 500);
  }
}
