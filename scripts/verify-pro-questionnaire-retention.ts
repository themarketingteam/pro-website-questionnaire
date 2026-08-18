const drafts = await base44.entities.ProFormDraft.list('-created_date', 5000);
const submissions = await base44.entities.ProFormSubmission.list('-created_date', 5000);
const intakes = await base44.entities.ProFormSubmissionIntake.list('-created_date', 5000);
const submissionIds = new Set(submissions.map((record: any) => record.id));
const retained = (record: any) => record.retention_policy_version === 'three-year-active-v1'
  && Number.isFinite(Date.parse(record.retention_started_at || ''))
  && Number.isFinite(Date.parse(record.retention_until || ''));
const linkedSubmissionIds = new Set(
  drafts.map((draft: any) => draft.final_submission_id).filter((id: string) => id && submissionIds.has(id))
);

console.log(JSON.stringify({
  success: true,
  counts: {
    drafts: drafts.length,
    submissions: submissions.length,
    intakes: intakes.length,
    drafts_with_retention: drafts.filter(retained).length,
    submissions_with_retention: submissions.filter(retained).length,
    intakes_with_retention: intakes.filter(retained).length,
    linked_draft_submissions: linkedSubmissionIds.size,
    standalone_submissions: submissions.filter((submission: any) => (
      !submission?.metadata?.source_draft_id && !submission?.metadata?.source_intake_id
    )).length,
    broken_draft_submission_links: drafts.filter((draft: any) => (
      draft.final_submission_id && !submissionIds.has(draft.final_submission_id)
    )).length,
    legacy_compatible_submissions: submissions.filter((submission: any) => (
      submission.responses && submission.metadata && submission.userdata
    )).length,
    active_drafts: drafts.filter((record: any) => !record.archived_at && !record.soft_deleted_at).length,
    active_submissions: submissions.filter((record: any) => !record.archived_at && !record.soft_deleted_at).length,
    soft_deleted_records: [...drafts, ...submissions, ...intakes].filter((record: any) => record.soft_deleted_at).length
  },
  all_primary_records_have_retention: drafts.every(retained)
    && submissions.every(retained)
    && intakes.every(retained),
  source_count: drafts.length + submissions.length + intakes.length
}, null, 2));
