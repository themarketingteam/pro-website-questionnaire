export {
  PRO_DRAFT_LEGACY_MIGRATION_VERSION,
  PRO_DRAFT_CANONICAL_SCHEMA_VERSION,
  LEGACY_RECORD_CLASSIFICATIONS,
  LEGACY_MIGRATION_ERROR_CODES,
  stableLegacySerialize,
  analyzeLegacyDraftRecord,
  reconstructCanonicalStateFromLegacyRecord,
  buildLegacyDraftUpgradePatch,
  analyzeLegacyDraftEvent,
  buildLegacyEventUpgradePatch,
  groupPotentialDuplicateDrafts,
  classifyDuplicateDraftGroup,
  selectRecommendedCanonicalRecord,
  buildDuplicateResolutionPlan,
  getSafeLegacyMigrationDiagnostics,
  buildLegacyMigrationAnalysisReport,
  assertSafeLegacyMigrationReport,
} from './legacyMigration.js';

export type LegacyRecordClassification =
  | 'already_current' | 'legacy_complete' | 'legacy_partial'
  | 'legacy_malformed_noncritical' | 'legacy_malformed_critical'
  | 'submitted_legacy' | 'submit_failed_legacy' | 'superseded_legacy'
  | 'duplicate_candidate' | 'manual_review_required'
  | 'unsupported_future_version';

export type LegacyDraftRecord = Readonly<Record<string, unknown> & { id?: string }>;
export type LegacyDraftEventRecord = Readonly<Record<string, unknown> & { id?: string }>;
export type LegacyUpgradePatch = Readonly<{
  patch: Readonly<Record<string, unknown>>;
  proposedFields: readonly string[];
  reasons: readonly string[];
  warnings: readonly string[];
  beforeFingerprint: string;
  afterFingerprint: string;
  manualReview: boolean;
}>;

export type SafeLegacyMigrationRecordDiagnostic = Readonly<{
  recordId: string | null;
  classification: LegacyRecordClassification;
  status: string | null;
  schemaVersion: number | null;
  responseCount: number | null;
  byteSize: number;
  stateHashPrefix: string | null;
  proposedFields: readonly string[];
  warningCodes: readonly string[];
  manualReview: boolean;
  beforeFingerprint: string;
  afterFingerprint: string;
}>;
