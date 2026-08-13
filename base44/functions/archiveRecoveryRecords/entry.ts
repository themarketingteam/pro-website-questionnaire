import { createClientFromRequest } from "npm:@base44/sdk";

const POLICY_ID = 'recovery-retention-v1';
const ARCHIVE_AFTER_DAYS = 365;
const MAX_UPDATE_PASSES = 20;

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache'
  }
});

const archiveUntilComplete = async (
  entity: any,
  query: Record<string, unknown>,
  archivedAt: string,
  reason: string
) => {
  let archived = 0;
  let hasMore = true;
  let pass = 0;

  while (hasMore && pass < MAX_UPDATE_PASSES) {
    const result = await entity.updateMany(query, {
      $set: {
        archived_at: archivedAt,
        archive_reason: reason
      }
    });
    archived += Number(result?.updated) || 0;
    hasMore = Boolean(result?.has_more);
    pass += 1;
  }

  return { archived, hasMore, passes: pass };
};

// This job is intentionally archival-only. It never permanently deletes records.
// eslint-disable-next-line no-undef
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  }

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

  if (!isAdmin && !isScheduledPolicyRun) {
    return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const archivedAt = now.toISOString();
  const reason = `scheduled_terminal_record_${ARCHIVE_AFTER_DAYS}d`;
  const serviceEntities = base44.asServiceRole.entities;

  try {
    const draftQuery = {
      $and: [
        { archived_at: { $exists: false } },
        { status: 'submitted' },
        { last_saved_at: { $lt: cutoff, $ne: '' } }
      ]
    };
    const intakeQuery = {
      $and: [
        { archived_at: { $exists: false } },
        { status: { $in: ['submitted', 'retry_success', 'abandoned'] } },
        {
          $or: [
            { created_at_server: { $lt: cutoff, $ne: '' } },
            {
              $and: [
                { created_at_server: { $in: ['', null] } },
                { created_date: { $lt: cutoff } }
              ]
            }
          ]
        }
      ]
    };

    const [drafts, intakes] = await Promise.all([
      archiveUntilComplete(serviceEntities.ProFormDraft, draftQuery, archivedAt, reason),
      archiveUntilComplete(serviceEntities.ProFormSubmissionIntake, intakeQuery, archivedAt, reason)
    ]);

    console.log('[Recovery retention] archive run complete', {
      cutoff,
      drafts: drafts.archived,
      intakes: intakes.archived,
      draftHasMore: drafts.hasMore,
      intakeHasMore: intakes.hasMore
    });

    return jsonResponse({
      success: true,
      policyId: POLICY_ID,
      archiveAfterDays: ARCHIVE_AFTER_DAYS,
      cutoff,
      archivedAt,
      drafts,
      intakes,
      permanentDeletionEnabled: false
    });
  } catch (error) {
    console.error('[Recovery retention] archive run failed:', error);
    return jsonResponse({ success: false, error: 'Recovery archival failed.' }, 500);
  }
});
