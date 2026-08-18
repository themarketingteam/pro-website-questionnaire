const response = await base44.functions.invoke('archiveRecoveryRecords', {
  args: { policy_id: 'recovery-retention-v2' }
});
const result = response?.data ?? response;
console.log(JSON.stringify({
  success: result?.success === true,
  policy_id: result?.policyId || '',
  archive_after_days: result?.archiveAfterDays,
  permanent_deletion_enabled: result?.permanentDeletionEnabled,
  drafts: result?.drafts,
  intakes: result?.intakes,
  submissions: result?.submissions
}, null, 2));
