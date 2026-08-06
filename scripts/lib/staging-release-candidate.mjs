import { createHash } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const extractCertificationClassification = (markdown) => {
  const matches = [...String(markdown).matchAll(/(?:Final\s+)?Classification:\s*\*\*([A-Z][A-Z0-9_]+)\*\*/giu)];
  return matches.at(-1)?.[1]?.toUpperCase() || 'CLASSIFICATION_MISSING';
};

export const extractCandidateCommit = (markdown) => {
  const match = String(markdown).match(/(?:Candidate|Tested|Source|Deployed)?\s*commit(?:\s+SHA)?:?\s*`?([a-f0-9]{40})`?/iu);
  return match?.[1]?.toLowerCase() || null;
};

const failure = (code, detail = null) => Object.freeze({ code, ...(detail ? { detail } : {}) });

export const evaluateReleaseCandidateState = ({
  backupVerified = false,
  baselineVerified = false,
  branch = '',
  browserProjects = [],
  buildBundleSafe = false,
  cleanupVerdict = '',
  config,
  coverage = { ok: false, pendingRequirementIds: [] },
  currentCommit = '',
  directEntitySafe = false,
  featureFlags = {},
  manualEvidence = [],
  migrationVerdict = '',
  noProductionDeploymentWorkflow = false,
  performanceVerdict = '',
  productionDefaultsDisabled = false,
  reports = [],
  securityVerdicts = [],
  sourceSecretsSafe = false,
  unresolvedCriticalDefects = [],
  unresolvedCriticalRisks = [],
  workingTreeClean = false,
} = {}) => {
  const failures = [];
  if (!workingTreeClean) failures.push(failure('RC_WORKTREE_DIRTY'));
  if (branch !== 'feature/durable-draft-recovery') failures.push(failure('RC_FEATURE_BRANCH_REQUIRED'));
  if (!baselineVerified) failures.push(failure('RC_BASELINE_REFERENCE_INVALID'));
  if (!backupVerified) failures.push(failure('RC_BACKUP_REFERENCE_INVALID'));

  for (const required of config.requiredCertificationReports || []) {
    const report = reports.find((entry) => entry.id === required.id);
    if (!report?.exists) {
      failures.push(failure('RC_REQUIRED_REPORT_MISSING', required.id));
      continue;
    }
    if (!required.acceptedClassifications.includes(report.classification)) {
      failures.push(failure('RC_REPORT_NOT_CERTIFIED', required.id));
    }
    if (!report.checksumVerified) failures.push(failure('RC_REPORT_CHECKSUM_INVALID', required.id));
    if (!report.commitApproved) failures.push(failure('RC_REPORT_COMMIT_STALE', required.id));
  }

  if (!coverage.ok) failures.push(failure('RC_REQUIREMENT_COVERAGE_FAILED'));
  for (const requirementId of coverage.pendingRequirementIds || []) {
    if (!(config.allowedPendingRequirementPrefixes || []).some((prefix) => requirementId.startsWith(prefix))) {
      failures.push(failure('RC_STAGING_REQUIREMENT_PENDING', requirementId));
    }
  }
  for (const project of config.requiredBrowserProjects || []) {
    if (!browserProjects.includes(project)) failures.push(failure('RC_REQUIRED_BROWSER_MISSING', project));
  }
  for (const verdict of config.requiredSecurityVerdicts || []) {
    if (!securityVerdicts.includes(verdict)) failures.push(failure('RC_SECURITY_VERDICT_MISSING', verdict));
  }
  if (performanceVerdict !== 'PERFORMANCE_THRESHOLDS_PASSED') failures.push(failure('RC_CAPACITY_FAILED'));
  if (cleanupVerdict !== config.requiredCleanupStatus) failures.push(failure('RC_CLEANUP_FAILED'));
  if (migrationVerdict !== config.requiredMigrationStatus) failures.push(failure('RC_MIGRATION_UTILITY_NOT_CERTIFIED'));
  if (!directEntitySafe) failures.push(failure('RC_DIRECT_ENTITY_ACCESS_FAILED'));
  if (!buildBundleSafe) failures.push(failure('RC_SENSITIVE_BUILD_SCAN_FAILED'));
  if (!sourceSecretsSafe) failures.push(failure('RC_SOURCE_SECRET_SCAN_FAILED'));
  if (!noProductionDeploymentWorkflow) failures.push(failure('RC_PRODUCTION_DEPLOY_WORKFLOW_PRESENT'));
  if (!productionDefaultsDisabled) failures.push(failure('RC_PRODUCTION_DEFAULTS_NOT_DISABLED'));

  for (const [name, expected] of Object.entries(config.requiredFeatureFlags || {})) {
    if (featureFlags[name] !== expected) failures.push(failure('RC_REQUIRED_FEATURE_FLAG_MISMATCH', name));
  }
  for (const [name, forbiddenValue] of Object.entries(config.forbiddenFeatureFlags || {})) {
    if (featureFlags[name] === forbiddenValue) failures.push(failure('RC_FORBIDDEN_FEATURE_FLAG_ENABLED', name));
  }
  for (const item of config.requiredManualEvidence || []) {
    if (!manualEvidence.some((entry) => entry.id === item.id && entry.status === item.status)) {
      failures.push(failure('RC_MANUAL_EVIDENCE_PLACEHOLDER_MISSING', item.id));
    }
  }
  if (unresolvedCriticalDefects.length > 0) failures.push(failure('RC_UNRESOLVED_HIGH_CRITICAL_DEFECT', String(unresolvedCriticalDefects.length)));
  if (unresolvedCriticalRisks.length > 0) failures.push(failure('RC_UNACCEPTED_CRITICAL_RISK', String(unresolvedCriticalRisks.length)));

  const failedClassification = reports.some((report) => /FAILED/u.test(report.classification || ''));
  return Object.freeze({
    currentCommit,
    failures: Object.freeze(failures),
    ok: failures.length === 0,
    verdict: failures.length === 0 ? 'PASS' : failedClassification ? 'FAILED' : 'BLOCKED',
  });
};

export const classifyReleaseCandidatePath = (file) => {
  const value = String(file).replaceAll('\\', '/');
  if (/^(?:\.durable-draft-artifacts\/|evidence\/)|(?:manifest|checksum|certification)/iu.test(value)) return 'evidence';
  if (/^(?:docs\/|README|CHANGELOG)/u.test(value)) return 'documentation';
  if (/^(?:tests\/|src\/test\/|scripts\/.*\.test\.)|\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(value)) return 'test';
  if (/^base44\/entities\//u.test(value)) return 'schema';
  if (/^base44\/functions\//u.test(value)) return 'function';
  return 'runtime-source';
};

export const evaluateFeatureFreeze = ({ changedFiles = [], enforced = false, freezeRef = null } = {}) => {
  const classified = changedFiles.map((file) => Object.freeze({ file, category: classifyReleaseCandidatePath(file) }));
  if (!enforced || !freezeRef) {
    return Object.freeze({ classified, enforced: false, freezeRef: freezeRef || null, valid: true, verdict: 'NOT_ENFORCED' });
  }
  const categories = new Set(classified.map(({ category }) => category));
  const invalidated = ['runtime-source', 'schema', 'function'].some((category) => categories.has(category));
  return Object.freeze({
    classified,
    enforced: true,
    freezeRef,
    requiresAffectedSuiteRerun: categories.has('test'),
    requiresFullStagingRecertification: categories.has('schema') || categories.has('function'),
    valid: !invalidated,
    verdict: invalidated ? 'RELEASE_CANDIDATE_INVALIDATED' : 'RELEASE_CANDIDATE_PRESERVED',
  });
};
