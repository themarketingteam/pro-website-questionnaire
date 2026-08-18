import { createClientFromRequest } from "npm:@base44/sdk";
import {
  latestMeaningfulActivity,
  RETENTION_DAYS,
  RETENTION_POLICY_VERSION,
  retentionUntilFor,
  validIso
} from "./recoveryRetention.ts";

export const POLICY_ID = 'recovery-retention-v2';
const MAX_RECORDS_PER_ENTITY = 5000;
const UPDATE_BATCH_SIZE = 100;

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache'
  }
});

const unarchivedCondition = {
  $or: [
    { archived_at: { $exists: false } },
    { archived_at: null },
    { archived_at: '' }
  ]
};

const retainedCondition = {
  $or: [
    { soft_deleted_at: { $exists: false } },
    { soft_deleted_at: null },
    { soft_deleted_at: '' }
  ]
};

const chunk = <T>(values: T[], size: number) => {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) batches.push(values.slice(index, index + size));
  return batches;
};

const processEntity = async ({ entity, activityFields, now, reason }: {
  entity: any;
  activityFields: string[];
  now: Date;
  reason: string;
}) => {
  const records = await entity.filter(
    { $and: [unarchivedCondition, retainedCondition] },
    'created_date',
    MAX_RECORDS_PER_ENTITY
  );
  const safeRecords = Array.isArray(records) ? records : [];
  const updates = safeRecords.map((record) => {
    const activityAt = latestMeaningfulActivity(record, activityFields);
    const retentionUntil = retentionUntilFor(activityAt);
    const shouldArchive = Date.parse(retentionUntil) <= now.getTime();
    const update = {
      id: record.id,
      retention_policy_version: RETENTION_POLICY_VERSION,
      retention_started_at: activityAt,
      retention_until: retentionUntil,
      ...(shouldArchive ? {
        archived_at: now.toISOString(),
        archive_reason: reason
      } : {})
    };
    const unchanged = record.retention_policy_version === update.retention_policy_version
      && validIso(record.retention_started_at) === update.retention_started_at
      && validIso(record.retention_until) === update.retention_until
      && (!shouldArchive || Boolean(record.archived_at));
    return unchanged ? null : update;
  }).filter(Boolean);

  for (const batch of chunk(updates, UPDATE_BATCH_SIZE)) {
    if (batch.length > 0) await entity.bulkUpdate(batch);
  }

  const archived = updates.filter((update) => Boolean(update.archived_at)).length;
  return {
    scanned: safeRecords.length,
    updated: updates.length,
    archived,
    hasMore: safeRecords.length === MAX_RECORDS_PER_ENTITY
  };
};

// This job is intentionally archival-only. It never permanently deletes records.
// eslint-disable-next-line no-undef
Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);

  const body = await req.json().catch(() => ({}));
  const args = body?.args && typeof body.args === 'object' ? body.args : {};
  const isScheduledPolicyRun = args?.policy_id === POLICY_ID;
  const base44 = createClientFromRequest(req);
  let isAdmin = false;

  try {
    const user = await base44.auth.me();
    isAdmin = user?.role === 'admin';
  } catch {
    isAdmin = false;
  }

  if (!isAdmin && !isScheduledPolicyRun) return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);

  const now = new Date();
  const reason = `scheduled_inactive_record_${RETENTION_DAYS}d`;
  const entities = base44.asServiceRole.entities;

  try {
    const [drafts, intakes, submissions] = await Promise.all([
      processEntity({
        entity: entities.ProFormDraft,
        activityFields: [
          'last_saved_at',
          'last_changed_at',
          'submit_attempted_at',
          'submitted_at',
          'last_ai_repair_at',
          'last_identity_resolution_at',
          'created_date'
        ],
        now,
        reason
      }),
      processEntity({
        entity: entities.ProFormSubmissionIntake,
        activityFields: [
          'last_retry_at',
          'last_ai_repair_at',
          'last_identity_resolution_at',
          'created_at_server',
          'created_date'
        ],
        now,
        reason
      }),
      processEntity({
        entity: entities.ProFormSubmission,
        activityFields: ['metadata.submission_datetime', 'created_date'],
        now,
        reason
      })
    ]);

    console.log('[Recovery retention] archival run complete', {
      policyId: POLICY_ID,
      drafts: { scanned: drafts.scanned, archived: drafts.archived },
      intakes: { scanned: intakes.scanned, archived: intakes.archived },
      submissions: { scanned: submissions.scanned, archived: submissions.archived },
      hasMore: drafts.hasMore || intakes.hasMore || submissions.hasMore
    });

    return jsonResponse({
      success: true,
      policyId: POLICY_ID,
      retentionPolicyVersion: RETENTION_POLICY_VERSION,
      archiveAfterDays: RETENTION_DAYS,
      archivedAt: now.toISOString(),
      drafts,
      intakes,
      submissions,
      permanentDeletionEnabled: false
    });
  } catch (error) {
    console.error('[Recovery retention] archival run failed', {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error'
    });
    return jsonResponse({ success: false, error: 'Recovery archival failed.' }, 500);
  }
});
