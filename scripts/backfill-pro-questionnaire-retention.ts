const RETENTION_DAYS = 1095;
const RETENTION_POLICY_VERSION = 'three-year-active-v1';
const DAY_MS = 24 * 60 * 60 * 1000;

const validTimestamp = (value: unknown) => {
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const latest = (record: any, paths: string[]) => {
  const values = paths.map((path) => path.split('.').reduce((value, key) => value?.[key], record));
  return Math.max(0, ...values.map(validTimestamp));
};

const retentionFields = (activityTimestamp: number) => {
  const started = new Date(activityTimestamp || 0).toISOString();
  const until = new Date((activityTimestamp || 0) + RETENTION_DAYS * DAY_MS).toISOString();
  return {
    retention_policy_version: RETENTION_POLICY_VERSION,
    retention_started_at: started,
    retention_until: until,
    ...(Date.parse(until) <= Date.now() ? {
      archived_at: new Date().toISOString(),
      archive_reason: `retention_backfill_inactive_${RETENTION_DAYS}d`
    } : {})
  };
};

const chunks = <T>(values: T[], size = 100) => {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
};

const mergeLink = (metadata: any, field: string, value: string, metrics: any) => {
  const current = typeof metadata?.[field] === 'string' ? metadata[field].trim() : '';
  if (current && current !== value) {
    metrics.link_conflicts += 1;
    return metadata;
  }
  if (current === value) return metadata;
  return { ...(metadata || {}), [field]: value };
};

const drafts = await base44.entities.ProFormDraft.list('-created_date', 5000);
const submissions = await base44.entities.ProFormSubmission.list('-created_date', 5000);
const intakes = await base44.entities.ProFormSubmissionIntake.list('-created_date', 5000);
const submissionsById = new Map(submissions.map((record: any) => [record.id, record]));
const submissionUpdates = new Map<string, any>();
const metrics = {
  drafts_before: drafts.length,
  submissions_before: submissions.length,
  intakes_before: intakes.length,
  draft_retention_updated: 0,
  intake_retention_updated: 0,
  submission_retention_updated: 0,
  draft_submission_links_backfilled: 0,
  intake_submission_links_backfilled: 0,
  broken_draft_submission_links: 0,
  broken_intake_submission_links: 0,
  link_conflicts: 0,
  standalone_submissions_after: 0
};

const draftUpdates = drafts.map((draft: any) => {
  if (draft.final_submission_id) {
    const submission: any = submissionsById.get(draft.final_submission_id);
    if (!submission) metrics.broken_draft_submission_links += 1;
    else {
      let metadata = mergeLink(submission.metadata, 'source_draft_id', draft.id, metrics);
      if (draft.session_id) metadata = mergeLink(metadata, 'questionnaire_session_id', draft.session_id, metrics);
      if (metadata !== submission.metadata) {
        const existing = submissionUpdates.get(submission.id) || { id: submission.id };
        submissionUpdates.set(submission.id, { ...existing, metadata });
        submission.metadata = metadata;
        metrics.draft_submission_links_backfilled += 1;
      }
    }
  }
  metrics.draft_retention_updated += 1;
  return {
    id: draft.id,
    ...retentionFields(latest(draft, [
      'last_saved_at',
      'last_changed_at',
      'submit_attempted_at',
      'submitted_at',
      'last_ai_repair_at',
      'last_identity_resolution_at',
      'created_date'
    ]))
  };
});

const intakeUpdates = intakes.map((intake: any) => {
  if (intake.linked_submission_id) {
    const submission: any = submissionsById.get(intake.linked_submission_id);
    if (!submission) metrics.broken_intake_submission_links += 1;
    else {
      let metadata = mergeLink(submission.metadata, 'source_intake_id', intake.id, metrics);
      if (intake.questionnaire_session_id) {
        metadata = mergeLink(metadata, 'questionnaire_session_id', intake.questionnaire_session_id, metrics);
      }
      if (metadata !== submission.metadata) {
        const existing = submissionUpdates.get(submission.id) || { id: submission.id };
        submissionUpdates.set(submission.id, { ...existing, metadata });
        submission.metadata = metadata;
        metrics.intake_submission_links_backfilled += 1;
      }
    }
  }
  metrics.intake_retention_updated += 1;
  return {
    id: intake.id,
    ...retentionFields(latest(intake, [
      'last_retry_at',
      'last_ai_repair_at',
      'last_identity_resolution_at',
      'created_at_server',
      'created_date'
    ]))
  };
});

for (const submission of submissions) {
  const existing = submissionUpdates.get(submission.id) || { id: submission.id };
  const legacyCompatibility = {
    ...(!submission.metadata ? {
      metadata: {
        submission_datetime: submission.submitted_at || submission.created_date,
        service_type: 'pro'
      }
    } : {}),
    ...(!submission.userdata ? { userdata: {} } : {})
  };
  submissionUpdates.set(submission.id, {
    ...existing,
    ...legacyCompatibility,
    ...retentionFields(latest(submission, ['metadata.submission_datetime', 'created_date']))
  });
  metrics.submission_retention_updated += 1;
}

for (const batch of chunks(draftUpdates)) if (batch.length) await base44.entities.ProFormDraft.bulkUpdate(batch);
for (const batch of chunks(intakeUpdates)) if (batch.length) await base44.entities.ProFormSubmissionIntake.bulkUpdate(batch);
for (const batch of chunks([...submissionUpdates.values()])) {
  if (batch.length) await base44.entities.ProFormSubmission.bulkUpdate(batch);
}

metrics.standalone_submissions_after = submissions.filter((submission: any) => (
  !submission?.metadata?.source_draft_id && !submission?.metadata?.source_intake_id
)).length;

const afterCounts = {
  drafts: (await base44.entities.ProFormDraft.list('-created_date', 5000, 0, ['id'])).length,
  submissions: (await base44.entities.ProFormSubmission.list('-created_date', 5000, 0, ['id'])).length,
  intakes: (await base44.entities.ProFormSubmissionIntake.list('-created_date', 5000, 0, ['id'])).length
};

console.log(JSON.stringify({
  success: true,
  policy: RETENTION_POLICY_VERSION,
  retention_days: RETENTION_DAYS,
  metrics,
  after_counts: afterCounts,
  source_counts_unchanged: afterCounts.drafts === drafts.length
    && afterCounts.submissions === submissions.length
    && afterCounts.intakes === intakes.length
}, null, 2));
