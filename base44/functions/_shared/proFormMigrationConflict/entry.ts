export const PRO_FORM_MIGRATION_CONFLICT_TYPES = Object.freeze([
  'source_and_destination_modified',
  'destination_native_record_collision',
  'relationship_target_missing',
  'source_fingerprint_changed_after_export',
  'destination_fingerprint_changed_before_apply',
  'submitted_state_mismatch',
  'status_regression_attempt',
  'origin_identity_collision',
  'file_reference_inaccessible',
  'unsupported_schema_version',
] as const);

const STATUS_RANK: Record<string, number> = Object.freeze({
  draft: 0, active: 1, submitted: 2, finalized: 2, completed: 2,
});

export function resolveProFormMigrationConflict(input: {
  conflictType?: string;
  sourceHash?: string | null;
  destinationHash?: string | null;
  baseHash?: string | null;
  sourceUpdatedAt?: string | null;
  destinationUpdatedAt?: string | null;
  sourceStatus?: string | null;
  destinationStatus?: string | null;
  relationshipResolved?: boolean;
  destinationNative?: boolean;
}) {
  if (input.sourceHash && input.sourceHash === input.destinationHash) {
    return Object.freeze({ policy: 'noop', applySource: false, manual: false });
  }
  const sourceRank = STATUS_RANK[String(input.sourceStatus ?? '')] ?? 0;
  const destinationRank = STATUS_RANK[String(input.destinationStatus ?? '')] ?? 0;
  if (sourceRank < destinationRank) {
    return Object.freeze({ policy: 'reject_status_regression', applySource: false, manual: true,
      conflictType: 'status_regression_attempt' });
  }
  if (input.sourceStatus === 'submitted' !== (input.destinationStatus === 'submitted')) {
    return Object.freeze({ policy: 'manual_submitted_state', applySource: false, manual: true,
      conflictType: 'submitted_state_mismatch' });
  }
  if (input.relationshipResolved === false) {
    return Object.freeze({ policy: 'defer_relationship', applySource: false, manual: false,
      conflictType: 'relationship_target_missing' });
  }
  if (input.destinationNative === true) {
    return Object.freeze({ policy: 'manual_destination_native', applySource: false, manual: true,
      conflictType: 'destination_native_record_collision' });
  }
  const destinationUnchanged = Boolean(input.baseHash && input.destinationHash === input.baseHash);
  const sourceNewer = Date.parse(String(input.sourceUpdatedAt ?? ''))
    > Date.parse(String(input.destinationUpdatedAt ?? ''));
  if (destinationUnchanged && sourceNewer) {
    return Object.freeze({ policy: 'apply_newer_source', applySource: true, manual: false });
  }
  return Object.freeze({ policy: 'manual_no_merge', applySource: false, manual: true,
    conflictType: input.conflictType ?? 'source_and_destination_modified' });
}

export function safeProFormMigrationConflict(input: Record<string, unknown>) {
  const allowed = ['conflictType', 'entityName', 'sourceRecordId', 'destinationRecordId',
    'sourceRevision', 'destinationRevision', 'detectedAt', 'policy'];
  return Object.freeze(Object.fromEntries(allowed
    .filter((key) => input[key] !== undefined)
    .map((key) => [key, input[key]])));
}
