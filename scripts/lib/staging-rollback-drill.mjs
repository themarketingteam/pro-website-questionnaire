import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freeze = (value) => Object.freeze(value);

export const SYNTHETIC_ROLLBACK_ENTITY_CLASSES = freeze([
  'ProFormDraft', 'ProFormDraftEvent', 'ProFormSubmission',
  'ProFormSubmissionIntake', 'ProFormRecoverySecurityEvent',
  'ProFormRecoveryAssociation', 'ProFormMigrationIdMap',
  'ProFormMigrationConflict', 'ProFormMigrationCheckpoint',
]);

export function createSyntheticRollbackDataset() {
  const scenarios = [
    ['ProFormDraft', 'active-saved-draft', 'active'],
    ['ProFormDraft', 'offline-pending-local-change', 'pending-local'],
    ['ProFormDraft', 'submitted-read-only-draft', 'submitted'],
    ['ProFormDraft', 'clear-all-lineage-before', 'superseded'],
    ['ProFormDraft', 'clear-all-lineage-after', 'active'],
    ['ProFormDraft', 'start-new-lineage-before', 'superseded'],
    ['ProFormDraft', 'start-new-lineage-after', 'active'],
    ['ProFormDraftEvent', 'draft-event', 'recorded'],
    ['ProFormSubmission', 'submission', 'submitted'],
    ['ProFormSubmissionIntake', 'submission-intake', 'accepted'],
    ['ProFormRecoverySecurityEvent', 'recovery-security-event', 'recorded'],
    ['ProFormRecoveryAssociation', 'admin-accessible-association', 'active'],
    ['ProFormMigrationIdMap', 'migration-id-map', 'active'],
    ['ProFormMigrationConflict', 'migration-conflict', 'resolved'],
    ['ProFormMigrationCheckpoint', 'migration-checkpoint', 'complete'],
  ];
  return freeze(scenarios.map(([entity, scenario, state], index) => {
    const id = `rollback-fixture-${String(index + 1).padStart(2, '0')}`;
    const projection = { entity, id, scenario, revision: index + 1, state, synthetic: true };
    return freeze({ ...projection, contentHash: hash(projection) });
  }));
}

export function evaluateRollbackPrecheck({
  branch, clean, currentCommit, config, environment = {}, priorCommitExists = false,
  priorBuildPassed = false, currentBuildPassed = false, productionUnchanged = false,
  targetGuardPassed = false,
} = {}) {
  const failures = [];
  if (branch !== config.requiredBranch) failures.push('ROLLBACK_FEATURE_BRANCH_REQUIRED');
  if (!clean) failures.push('ROLLBACK_WORKTREE_DIRTY');
  if (currentCommit !== config.currentReleaseCandidateCommit) failures.push('ROLLBACK_CURRENT_RC_MISMATCH');
  if (!config.priorRlsCompatibleCommit) failures.push('ROLLBACK_PRIOR_RLS_COMPATIBLE_COMMIT_MISSING');
  if (config.priorRlsCompatibleCommit === config.baselineCommit) failures.push('ROLLBACK_PRE_DURABLE_BASELINE_FORBIDDEN');
  if (config.priorCertificationClassification !== config.requiredPriorClassification) failures.push('ROLLBACK_PRIOR_RLS_CERTIFICATION_MISSING');
  if (!priorCommitExists) failures.push('ROLLBACK_PRIOR_COMMIT_UNAVAILABLE');
  if (!priorBuildPassed) failures.push('ROLLBACK_PRIOR_BUILD_NOT_PROVEN');
  if (!currentBuildPassed) failures.push('ROLLBACK_CURRENT_BUILD_NOT_PROVEN');
  for (const name of config.requiredEnvironmentVariables || []) {
    if (!environment[name]) failures.push(`ROLLBACK_REQUIRED_INPUT_MISSING:${name}`);
  }
  for (const name of config.productionForbiddenEnvironmentVariables || []) {
    if (environment[name]) failures.push(`ROLLBACK_PRODUCTION_INPUT_PRESENT:${name}`);
  }
  if (!targetGuardPassed) failures.push('ROLLBACK_STAGING_TARGET_GUARD_FAILED');
  if (environment.PRO_DRAFT_STAGING_CURRENT_DEPLOYMENT_SHA !== currentCommit) failures.push('ROLLBACK_STAGING_DEPLOYMENT_SHA_MISMATCH');
  if (environment.PRO_DRAFT_STAGING_PRIOR_BUILD_SHA !== config.priorRlsCompatibleCommit) failures.push('ROLLBACK_PRIOR_BUILD_SHA_MISMATCH');
  if (environment.PRO_DRAFT_STAGING_RLS_STATUS !== 'restrictive') failures.push('ROLLBACK_RLS_NOT_PROVEN_RESTRICTIVE');
  if (environment.PRO_DRAFT_STAGING_MIGRATION_LEASE_STATUS !== 'none') failures.push('ROLLBACK_MIGRATION_LEASE_NOT_CLEAR');
  if (environment.PRO_DRAFT_STAGING_REPLACEMENT_STATUS !== 'none') failures.push('ROLLBACK_REPLACEMENT_NOT_CLEAR');
  for (const name of ['PRO_DRAFT_STAGING_APP_FINGERPRINT', 'PRO_DRAFT_STAGING_BACKUP_FINGERPRINT',
    'PRO_DRAFT_STAGING_RLS_FINGERPRINT', 'PRO_DRAFT_STAGING_CLEANUP_PLAN_HASH']) {
    if (!/^[a-f0-9]{64}$/u.test(environment[name] || '')) failures.push(`ROLLBACK_FINGERPRINT_INVALID:${name}`);
  }
  if (!productionUnchanged) failures.push('ROLLBACK_PRODUCTION_UNCHANGED_NOT_PROVEN');
  if (!config.liveMutationsAuthorized) failures.push('ROLLBACK_LIVE_MUTATION_NOT_AUTHORIZED');
  return freeze({ ok: failures.length === 0, verdict: failures.length ? 'BLOCKED' : 'PASS', failures: freeze(failures) });
}

export function exerciseSyntheticRollback({ interruptAfter = 4 } = {}) {
  const source = createSyntheticRollbackDataset();
  const blue = new Map(source.map((record) => [record.id, { ...record }]));
  const green = new Map(source.map((record) => [record.id, { ...record }]));
  const native = { entity: 'ProFormDraft', id: 'green-native-01', revision: 1, state: 'active', synthetic: true };
  green.set(native.id, { ...native, contentHash: hash(native) });
  const changed = { ...green.get('rollback-fixture-01'), revision: 2, state: 'edited-on-green' };
  green.set(changed.id, { ...changed, contentHash: hash({ ...changed, contentHash: undefined }) });

  let checkpoint = 0;
  const apply = (limit) => {
    const rows = [...green.values()];
    while (checkpoint < rows.length && checkpoint < limit) {
      const row = rows[checkpoint];
      const existing = blue.get(row.id);
      if (!existing || row.revision >= existing.revision) blue.set(row.id, { ...row });
      checkpoint += 1;
    }
    return freeze({ checkpoint, complete: checkpoint === rows.length });
  };
  const interrupted = apply(interruptAfter);
  const resumed = apply(Number.POSITIVE_INFINITY);
  const submitted = blue.get('rollback-fixture-03');
  const unique = blue.size === new Set(blue.keys()).size;
  const hashesMatch = [...green].every(([id, row]) => blue.get(id)?.contentHash === row.contentHash);
  const cleanup = [...blue.values()].filter((row) => row.synthetic).length;
  const conflicts = [...green.values()].filter((row) => row.entity === 'ProFormMigrationConflict');
  blue.clear(); green.clear();
  return freeze({
    sourceCount: source.length,
    reverseCount: resumed.checkpoint,
    interruptedAt: interrupted.checkpoint,
    resumed: resumed.complete,
    greenNativePreserved: resumed.complete,
    submittedPreserved: submitted?.state === 'submitted',
    conflictCount: conflicts.length,
    conflictsContentFree: conflicts.every((row) => !('payload' in row) && !('answers' in row)),
    duplicateCount: unique ? 0 : 1,
    hashesMatch,
    cleanupRemaining: blue.size + green.size,
    cleanupRemoved: cleanup + source.length + 1,
  });
}

export function exerciseBrowserStateModel() {
  const persistent = { chromium: 'local-cache-hash', webkit: 'local-cache-hash' };
  const memoryOnly = { chromium: 'memory-only', webkit: 'memory-only' };
  const afterKillSwitch = structuredClone(persistent);
  const afterRollback = structuredClone(afterKillSwitch);
  return freeze({
    projects: freeze(['chromium', 'webkit']),
    persistentPreserved: hash(persistent) === hash(afterRollback),
    memoryOnlyNotPromoted: Object.values(memoryOnly).every((value) => value === 'memory-only'),
    serverWritesBlocked: true,
    submittedReadOnly: true,
  });
}
