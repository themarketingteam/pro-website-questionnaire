const query = async (payload: any) => {
  const response = await base44.functions.invoke('queryDraftRecoveryRecords', payload);
  return response?.data ?? response;
};
const collect = async (recordType: string, archiveState: string) => {
  const records: any[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 100) {
    const result = await query({
      action: 'list',
      recordType,
      page,
      pageSize: 50,
      status: recordType === 'submission' ? 'submitted' : 'all',
      archiveState,
      search: ''
    });
    if (!result?.success) throw new Error(`Unable to list ${recordType} ${archiveState}.`);
    records.push(...(result.records || []));
    hasMore = result.hasMore === true;
    page += 1;
  }
  return records;
};

const activeDrafts = await collect('draft', 'active');
const activeSubmissions = await collect('submission', 'active');
const archivedDrafts = await collect('draft', 'archived');
const deletedDrafts = await collect('draft', 'deleted');
const allRetainedDrafts = await collect('draft', 'all');
const standalone = activeSubmissions[0];
let detailLoaded = false;
let pdfListAvailable = false;
if (standalone?.id) {
  const detail = await query({ action: 'get', recordType: 'submission', recordId: standalone.id });
  detailLoaded = detail?.success === true && detail?.record?.id === standalone.id;
  const pdfResponse = await base44.functions.invoke('manageQuestionnairePdfVersions', {
    action: 'list',
    sourceType: 'submission',
    sourceId: standalone.id
  });
  const pdfResult = pdfResponse?.data ?? pdfResponse;
  pdfListAvailable = pdfResult?.success === true && Array.isArray(pdfResult?.versions);
}

console.log(JSON.stringify({
  success: true,
  active_draft_rows: activeDrafts.length,
  active_standalone_submission_rows: activeSubmissions.length,
  archived_draft_rows: archivedDrafts.length,
  deleted_draft_rows: deletedDrafts.length,
  all_retained_draft_rows: allRetainedDrafts.length,
  broken_links_flagged: activeDrafts.filter((record) => record.link_integrity_status === 'missing_submission').length,
  submission_detail_loaded: detailLoaded,
  submission_pdf_version_api_available: pdfListAvailable,
  selected_field_summary_enforced: activeDrafts.every((record) => !Object.hasOwn(record, 'responses_json'))
    && activeSubmissions.every((record) => !Object.hasOwn(record, 'userdata'))
}, null, 2));
