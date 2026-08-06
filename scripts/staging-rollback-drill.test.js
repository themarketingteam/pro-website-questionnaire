import { describe, expect, it } from 'vitest';
import config from '../config/durable-draft-staging-rollback-drill.json';
import {
  createSyntheticRollbackDataset, evaluateRollbackPrecheck,
  exerciseBrowserStateModel, exerciseSyntheticRollback,
} from './lib/staging-rollback-drill.mjs';

describe('staging rollback drill controls', () => {
  it('creates every required content-free scenario across nine hashed entity classes', () => {
    const rows = createSyntheticRollbackDataset();
    expect(rows).toHaveLength(15);
    expect(new Set(rows.map(({ entity }) => entity)).size).toBe(9);
    expect(rows.map(({ scenario }) => scenario)).toEqual(expect.arrayContaining([
      'active-saved-draft', 'offline-pending-local-change', 'submitted-read-only-draft',
      'clear-all-lineage-before', 'clear-all-lineage-after',
      'start-new-lineage-before', 'start-new-lineage-after', 'draft-event',
      'submission', 'submission-intake', 'recovery-security-event',
      'admin-accessible-association',
    ]));
    expect(rows.every(({ contentHash }) => /^[a-f0-9]{64}$/.test(contentHash))).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/email|password|recoveryCode|answer/i);
  });

  it('blocks when the certified compatible predecessor and staging inputs are absent', () => {
    const result = evaluateRollbackPrecheck({
      branch: config.requiredBranch, clean: true,
      currentCommit: config.currentReleaseCandidateCommit,
      config, environment: {}, productionUnchanged: true,
    });
    expect(result.verdict).toBe('BLOCKED');
    expect(result.failures).toContain('ROLLBACK_PRIOR_RLS_COMPATIBLE_COMMIT_MISSING');
    expect(result.failures).toContain('ROLLBACK_LIVE_MUTATION_NOT_AUTHORIZED');
  });

  it('never accepts the pre-durable baseline as an RLS-compatible rollback source', () => {
    const unsafe = { ...config, priorRlsCompatibleCommit: config.baselineCommit,
      priorCertificationClassification: config.requiredPriorClassification };
    const result = evaluateRollbackPrecheck({ branch: config.requiredBranch, clean: true,
      currentCommit: config.currentReleaseCandidateCommit, config: unsafe,
      environment: Object.fromEntries(config.requiredEnvironmentVariables.map((name) => [name, 'set'])),
      priorCommitExists: true, priorBuildPassed: true, currentBuildPassed: true,
      productionUnchanged: true, targetGuardPassed: true });
    expect(result.failures).toContain('ROLLBACK_PRE_DURABLE_BASELINE_FORBIDDEN');
  });

  it('passes only with exact staging, RLS, build, lease, backup, and authorization evidence', () => {
    const prior = '1111111111111111111111111111111111111111';
    const ready = { ...config, priorRlsCompatibleCommit: prior,
      priorCertificationClassification: config.requiredPriorClassification,
      liveMutationsAuthorized: true };
    const fingerprint = 'a'.repeat(64);
    const environment = Object.fromEntries(config.requiredEnvironmentVariables.map((name) => [name, 'configured']));
    Object.assign(environment, {
      PRO_DRAFT_STAGING_CURRENT_DEPLOYMENT_SHA: config.currentReleaseCandidateCommit,
      PRO_DRAFT_STAGING_PRIOR_BUILD_SHA: prior,
      PRO_DRAFT_STAGING_RLS_STATUS: 'restrictive',
      PRO_DRAFT_STAGING_MIGRATION_LEASE_STATUS: 'none',
      PRO_DRAFT_STAGING_REPLACEMENT_STATUS: 'none',
      PRO_DRAFT_STAGING_APP_FINGERPRINT: fingerprint,
      PRO_DRAFT_STAGING_BACKUP_FINGERPRINT: fingerprint,
      PRO_DRAFT_STAGING_RLS_FINGERPRINT: fingerprint,
      PRO_DRAFT_STAGING_CLEANUP_PLAN_HASH: fingerprint,
    });
    const result = evaluateRollbackPrecheck({ branch: config.requiredBranch, clean: true,
      currentCommit: config.currentReleaseCandidateCommit, config: ready, environment,
      priorCommitExists: true, priorBuildPassed: true, currentBuildPassed: true,
      productionUnchanged: true, targetGuardPassed: true });
    expect(result).toMatchObject({ ok: true, verdict: 'PASS', failures: [] });
  });

  it('reverses updates and green-native records, then resumes without duplicates or loss', () => {
    const result = exerciseSyntheticRollback({ interruptAfter: 4 });
    expect(result).toMatchObject({ interruptedAt: 4, resumed: true, greenNativePreserved: true,
      submittedPreserved: true, conflictCount: 1, conflictsContentFree: true,
      duplicateCount: 0, hashesMatch: true, cleanupRemaining: 0 });
  });

  it('preserves Chromium/WebKit persistent state and does not promote memory-only state', () => {
    expect(exerciseBrowserStateModel()).toMatchObject({ projects: ['chromium', 'webkit'],
      persistentPreserved: true, memoryOnlyNotPromoted: true,
      serverWritesBlocked: true, submittedReadOnly: true });
  });
});
