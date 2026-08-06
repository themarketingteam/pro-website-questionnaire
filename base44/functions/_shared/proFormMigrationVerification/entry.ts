export const PRO_FORM_MIGRATION_VERIFICATION_DIMENSIONS = Object.freeze([
  'source_count_by_entity',
  'destination_mapped_count',
  'status_distribution',
  'logical_creation_range',
  'logical_update_range',
  'critical_field_null_distribution',
  'content_hash_equality',
  'relationship_completeness',
  'submitted_final_ids',
  'draft_session_ids',
  'event_to_draft_mapping',
  'draft_to_submission_mapping',
  'file_reference_status',
  'conflict_count',
  'unresolved_relationship_count',
  'test_staging_contamination',
  'duplicate_migration_mappings',
  'orphan_destination_records',
]);

export const PRO_FORM_MIGRATION_VERDICTS = Object.freeze([
  'PASS', 'PASS_WITH_WARNINGS', 'FAIL', 'BLOCKED',
]);

export function buildProFormMigrationVerificationReport(input: {
  dimensions: Record<string, { status: string; observed?: number; expected?: number; code?: string }>;
  blocked?: boolean;
  generatedAt?: string;
}) {
  const checks = PRO_FORM_MIGRATION_VERIFICATION_DIMENSIONS.map((dimension) => {
    const value = input.dimensions[dimension] ?? { status: 'BLOCKED', code: 'EVIDENCE_MISSING' };
    return Object.freeze({ dimension, ...value });
  });
  const statuses = new Set(checks.map((check) => check.status));
  const verdict = input.blocked === true || statuses.has('BLOCKED') ? 'BLOCKED'
    : statuses.has('FAIL') ? 'FAIL'
      : statuses.has('WARN') ? 'PASS_WITH_WARNINGS' : 'PASS';
  return Object.freeze({
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    verdict,
    cutoverReady: verdict === 'PASS',
    checks: Object.freeze(checks),
    containsRecordData: false,
  });
}

export function compareProFormMigrationInventories(input: {
  sourceCount: number;
  destinationCount: number;
  mappedCount: number;
  hashMismatchCount: number;
  relationshipErrorCount: number;
  openConflictCount: number;
  unresolvedCount: number;
  contaminationCount: number;
  duplicateMapCount: number;
  orphanCount: number;
  fileBlockerCount: number;
  statusDistributionMatch?: boolean;
  logicalCreationRangeMatch?: boolean;
  logicalUpdateRangeMatch?: boolean;
  criticalNullDistributionMatch?: boolean;
  submittedFinalIdErrorCount?: number;
  draftSessionIdErrorCount?: number;
  eventDraftErrorCount?: number;
  draftSubmissionErrorCount?: number;
}) {
  const pass = (condition: boolean, observed: number, expected = 0) => ({
    status: condition ? 'PASS' : 'FAIL', observed, expected,
  });
  const evidence = (value: boolean | undefined) => value === undefined
    ? { status: 'BLOCKED', code: 'EVIDENCE_MISSING' }
    : { status: value ? 'PASS' : 'FAIL', observed: value ? 0 : 1, expected: 0 };
  const errorCount = (value: number | undefined) => value === undefined
    ? { status: 'BLOCKED', code: 'EVIDENCE_MISSING' }
    : pass(value === 0, value);
  return buildProFormMigrationVerificationReport({ dimensions: {
    source_count_by_entity: pass(input.sourceCount >= 0, input.sourceCount, input.sourceCount),
    destination_mapped_count: pass(input.mappedCount === input.sourceCount
      && input.destinationCount >= input.mappedCount,
      input.mappedCount, input.sourceCount),
    content_hash_equality: pass(input.hashMismatchCount === 0, input.hashMismatchCount),
    relationship_completeness: pass(input.relationshipErrorCount === 0, input.relationshipErrorCount),
    file_reference_status: pass(input.fileBlockerCount === 0, input.fileBlockerCount),
    conflict_count: pass(input.openConflictCount === 0, input.openConflictCount),
    unresolved_relationship_count: pass(input.unresolvedCount === 0, input.unresolvedCount),
    test_staging_contamination: pass(input.contaminationCount === 0, input.contaminationCount),
    duplicate_migration_mappings: pass(input.duplicateMapCount === 0, input.duplicateMapCount),
    orphan_destination_records: pass(input.orphanCount === 0, input.orphanCount),
    status_distribution: evidence(input.statusDistributionMatch),
    logical_creation_range: evidence(input.logicalCreationRangeMatch),
    logical_update_range: evidence(input.logicalUpdateRangeMatch),
    critical_field_null_distribution: evidence(input.criticalNullDistributionMatch),
    submitted_final_ids: errorCount(input.submittedFinalIdErrorCount),
    draft_session_ids: errorCount(input.draftSessionIdErrorCount),
    event_to_draft_mapping: errorCount(input.eventDraftErrorCount),
    draft_to_submission_mapping: errorCount(input.draftSubmissionErrorCount),
  } });
}
