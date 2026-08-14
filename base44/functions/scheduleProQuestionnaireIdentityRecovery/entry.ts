import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import {
  centralDateKey,
  isCentralFourAmWeekday,
  isMissingIdentityValue,
  createIdentityResolverInternalGrant
} from './scheduleUtils.ts';

const POLICY_ID = 'pro-identity-recovery-v1';
const MAX_RECORDS = 15;
const QUERY_PAGE_SIZE = 100;
const MAX_QUERY_PAGES_PER_TYPE = 5;
const CONCURRENCY = 3;
const WORK_DEADLINE_MS = 150_000;

const activeArchiveCondition = {
  $or: [
    { archived_at: { $exists: false } },
    { archived_at: null },
    { archived_at: '' }
  ]
};

const noLinkedRecordCondition = (field: string) => ({
  $or: [
    { [field]: { $exists: false } },
    { [field]: null },
    { [field]: '' }
  ]
});

const attemptedToday = (value: unknown, centralDate: string) => {
  if (typeof value !== 'string' || !value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && centralDateKey(date) === centralDate;
};

const loadSelectedPages = async (
  entity: any,
  query: any,
  fields: string[]
) => {
  const records: any[] = [];
  for (let page = 0; page < MAX_QUERY_PAGES_PER_TYPE; page += 1) {
    const batch = await entity.filter(
      query,
      'last_identity_resolution_at',
      QUERY_PAGE_SIZE,
      page * QUERY_PAGE_SIZE,
      fields
    );
    const items = Array.isArray(batch) ? batch : [];
    records.push(...items);
    if (items.length < QUERY_PAGE_SIZE) break;
  }
  return records;
};

const loadEligibleRecords = async (base44: any, centralDate: string) => {
  const draftQuery = {
    $and: [
      activeArchiveCondition,
      { status: { $in: ['submit_attempted', 'submit_failed'] } },
      noLinkedRecordCondition('final_submission_id')
    ]
  };
  const intakeQuery = {
    $and: [
      activeArchiveCondition,
      { status: { $in: ['received_intake', 'retry_pending', 'retry_failed'] } },
      noLinkedRecordCondition('linked_submission_id')
    ]
  };
  const [drafts, intakes] = await Promise.all([
    loadSelectedPages(
      base44.asServiceRole.entities.ProFormDraft,
      draftQuery,
      ['id', 'business_name', 'domain', 'session_id', 'status', 'last_identity_resolution_at', 'identity_resolution_attempt_count']
    ),
    loadSelectedPages(
      base44.asServiceRole.entities.ProFormSubmissionIntake,
      intakeQuery,
      ['id', 'business_name', 'business_domain', 'questionnaire_session_id', 'status', 'last_identity_resolution_at', 'identity_resolution_attempt_count']
    )
  ]);

  const draftCandidates = (Array.isArray(drafts) ? drafts : [])
    .filter((record) => isMissingIdentityValue(record.business_name) || isMissingIdentityValue(record.domain))
    .filter((record) => !attemptedToday(record.last_identity_resolution_at, centralDate))
    .map((record) => ({ recordType: 'draft', record }));
  const intakeCandidates = (Array.isArray(intakes) ? intakes : [])
    .filter((record) => isMissingIdentityValue(record.business_name) || isMissingIdentityValue(record.business_domain))
    .filter((record) => !attemptedToday(record.last_identity_resolution_at, centralDate))
    .map((record) => ({ recordType: 'intake', record }));

  return [...draftCandidates, ...intakeCandidates].sort((left, right) => {
    const leftAt = new Date(left.record.last_identity_resolution_at || 0).getTime();
    const rightAt = new Date(right.record.last_identity_resolution_at || 0).getTime();
    return leftAt - rightAt;
  });
};

const runPool = async (items: any[], worker: (item: any) => Promise<any>, deadline: number) => {
  const results: any[] = [];
  let nextIndex = 0;
  const runner = async () => {
    while (nextIndex < items.length && Date.now() < deadline) {
      const index = nextIndex++;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        const caught = error as any;
        results[index] = { success: false, error: caught?.message || 'scheduled_resolution_failed' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => runner()));
  return results.filter(Boolean);
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ success: false, error: 'Method not allowed.' }, { status: 405 });
  const body = await req.json().catch(() => ({}));
  const args = body?.args && typeof body.args === 'object' ? body.args : {};
  if (args?.policy_id !== POLICY_ID) {
    return Response.json({ success: false, error: 'Unauthorized scheduled policy.' }, { status: 401 });
  }

  const base44 = createClientFromRequest(req);
  const started = new Date();
  const startedAt = started.toISOString();
  const centralDate = centralDateKey(started);
  const activeWindow = isCentralFourAmWeekday(started);
  const shadowMode = Deno.env.get('IDENTITY_RESOLUTION_AUTO_APPLY') !== 'true';
  const run = await base44.asServiceRole.entities.ProFormIdentityResolutionRun.create({
    started_at: startedAt,
    central_date: centralDate,
    active_window: activeWindow,
    shadow_mode: shadowMode,
    errors_json: '[]'
  });

  if (!activeWindow) {
    await base44.asServiceRole.entities.ProFormIdentityResolutionRun.update(run.id, {
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started.getTime()
    });
    return Response.json({ success: true, skipped: true, reason: 'not_4am_America_Chicago', centralDate });
  }

  const deadline = started.getTime() + WORK_DEADLINE_MS;
  const eligible = await loadEligibleRecords(base44, centralDate);
  const selected = eligible.slice(0, MAX_RECORDS);
  const results = await runPool(selected, async ({ recordType, record }) => {
    const invocation = {
      recordType,
      recordId: record.id,
      trigger: 'scheduled',
      apply: true
    };
    const internalGrant = await createIdentityResolverInternalGrant(invocation);
    const response = await base44.asServiceRole.functions.invoke('resolveProQuestionnaireIdentity', {
      ...invocation,
      internalGrant
    });
    return response?.data ?? response;
  }, deadline);

  const resolutions = results.map((result) => result?.identityResolution).filter(Boolean);
  const counts = {
    eligible_count: eligible.length,
    attempted_count: results.length,
    auto_eligible_count: resolutions.filter((resolution) => (
      resolution.business_name?.auto_eligible || resolution.domain?.auto_eligible
    )).length,
    applied_count: resolutions.filter((resolution) => resolution.applied).length,
    needs_review_count: resolutions.filter((resolution) => resolution.status === 'needs_review').length,
    provider_failure_count: resolutions.filter((resolution) => resolution.status === 'provider_error').length
      + results.filter((result) => !result?.success).length,
    stale_abort_count: resolutions.filter((resolution) => resolution.stale_write_aborted).length,
    backlog_count: Math.max(0, eligible.length - results.length)
  };
  const errors = results.filter((result) => !result?.success).map((result) => result?.error || 'unknown_error').slice(0, 20);
  const completedAt = new Date().toISOString();
  await base44.asServiceRole.entities.ProFormIdentityResolutionRun.update(run.id, {
    ...counts,
    completed_at: completedAt,
    duration_ms: Date.now() - started.getTime(),
    errors_json: JSON.stringify(errors)
  });

  console.info('[Scheduled identity recovery] completed', {
    centralDate,
    shadowMode,
    ...counts,
    durationMs: Date.now() - started.getTime()
  });
  return Response.json({
    success: true,
    policyId: POLICY_ID,
    centralDate,
    shadowMode,
    runId: run.id,
    ...counts
  });
});
