import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeReleaseCandidateManifest,
  buildStagingReleaseCandidateManifest,
} from './build-staging-release-candidate-manifest.mjs';
import {
  evaluateFeatureFreeze,
  evaluateReleaseCandidateState,
} from './lib/staging-release-candidate.mjs';

const config = Object.freeze({
  releaseCandidateVersion: 1,
  requiredCertificationReports: [{ id: 'required', acceptedClassifications: ['CERTIFIED'] }],
  requiredBrowserProjects: ['chromium-desktop'],
  requiredManualEvidence: [{ id: 'real-device', status: 'PENDING' }],
  requiredSecurityVerdicts: ['SECURITY_CERTIFIED'],
  allowedPendingRequirementPrefixes: ['DR-MIG-GREEN-'],
  requiredFeatureFlags: { VITE_REQUIRED: true },
  forbiddenFeatureFlags: { VITE_FORBIDDEN: true },
  requiredCleanupStatus: 'CLEANUP_VERIFIED_ZERO',
  requiredMigrationStatus: 'MIGRATION_UTILITY_CERTIFIED_LIVE_GREEN_PENDING',
});

const state = (overrides = {}) => evaluateReleaseCandidateState({
  backupVerified: true,
  baselineVerified: true,
  branch: 'feature/durable-draft-recovery',
  browserProjects: ['chromium-desktop'],
  buildBundleSafe: true,
  cleanupVerdict: 'CLEANUP_VERIFIED_ZERO',
  config,
  coverage: { ok: true, pendingRequirementIds: [] },
  currentCommit: 'a'.repeat(40),
  directEntitySafe: true,
  featureFlags: { VITE_REQUIRED: true, VITE_FORBIDDEN: false },
  manualEvidence: [{ id: 'real-device', status: 'PENDING' }],
  migrationVerdict: 'MIGRATION_UTILITY_CERTIFIED_LIVE_GREEN_PENDING',
  noProductionDeploymentWorkflow: true,
  performanceVerdict: 'PERFORMANCE_THRESHOLDS_PASSED',
  productionDefaultsDisabled: true,
  reports: [{
    checksumVerified: true,
    classification: 'CERTIFIED',
    commitApproved: true,
    exists: true,
    id: 'required',
  }],
  securityVerdicts: ['SECURITY_CERTIFIED'],
  sourceSecretsSafe: true,
  unresolvedCriticalDefects: [],
  unresolvedCriticalRisks: [],
  workingTreeClean: true,
  ...overrides,
});

const codes = (result) => result.failures.map(({ code }) => code);

describe('staging release candidate precheck contract', () => {
  it('blocks a missing required report', () => {
    expect(codes(state({ reports: [] }))).toContain('RC_REQUIRED_REPORT_MISSING');
  });

  it('fails a report with a failed classification', () => {
    const result = state({ reports: [{ exists: true, id: 'required', classification: 'AUTOMATION_FAILED', checksumVerified: true, commitApproved: true }] });
    expect(result.verdict).toBe('FAILED');
    expect(codes(result)).toContain('RC_REPORT_NOT_CERTIFIED');
  });

  it('blocks a stale report commit', () => {
    expect(codes(state({ reports: [{ exists: true, id: 'required', classification: 'CERTIFIED', checksumVerified: true, commitApproved: false }] })))
      .toContain('RC_REPORT_COMMIT_STALE');
  });

  it('blocks a missing browser project', () => {
    expect(codes(state({ browserProjects: [] }))).toContain('RC_REQUIRED_BROWSER_MISSING');
  });

  it('blocks a pending staging requirement', () => {
    expect(codes(state({ coverage: { ok: true, pendingRequirementIds: ['DR-SAVE-001'] } })))
      .toContain('RC_STAGING_REQUIREMENT_PENDING');
  });

  it('allows only the configured green pending prefix', () => {
    expect(state({ coverage: { ok: true, pendingRequirementIds: ['DR-MIG-GREEN-001'] } }).ok).toBe(true);
  });

  it('blocks a missing security verdict', () => {
    expect(codes(state({ securityVerdicts: [] }))).toContain('RC_SECURITY_VERDICT_MISSING');
  });

  it('blocks a capacity threshold failure', () => {
    expect(codes(state({ performanceVerdict: 'FAILED' }))).toContain('RC_CAPACITY_FAILED');
  });

  it('blocks a cleanup failure', () => {
    expect(codes(state({ cleanupVerdict: 'CLEANUP_FAILED' }))).toContain('RC_CLEANUP_FAILED');
  });

  it('blocks direct entity access', () => {
    expect(codes(state({ directEntitySafe: false }))).toContain('RC_DIRECT_ENTITY_ACCESS_FAILED');
  });

  it('blocks a sensitive built bundle', () => {
    expect(codes(state({ buildBundleSafe: false }))).toContain('RC_SENSITIVE_BUILD_SCAN_FAILED');
  });
});

describe('RC manifest and feature freeze', () => {
  const manifestInput = (checksumVerified = true) => ({
    browserMatrix: { 'chromium-desktop': 'PASSED' },
    buildSha: 'b'.repeat(40),
    cleanupVerdict: 'CLEANUP_VERIFIED_ZERO',
    commitSha: 'a'.repeat(40),
    config,
    coverageContent: '{"ok":true}',
    evidenceBundles: [{ id: 'bundle', checksum: 'd'.repeat(64), checksumVerified }],
    manualEvidenceStatus: 'PENDING',
    migrationUtilityVerdict: 'MIGRATION_UTILITY_CERTIFIED_LIVE_GREEN_PENDING',
    now: () => '2026-08-06T00:00:00.000Z',
    performanceVerdict: 'PERFORMANCE_THRESHOLDS_PASSED',
    precheckVerdict: 'PASS',
    reports: [{ id: 'required', path: 'safe.md', classification: 'CERTIFIED', checksum: 'c'.repeat(64), checksumVerified }],
    securityVerdict: 'SECURITY_CERTIFIED_IN_STAGING',
    stagingAppFingerprint: 'e'.repeat(64),
    stagingUrlFingerprint: 'f'.repeat(64),
  });

  it('verifies all referenced checksums before a ready manifest', () => {
    expect(buildStagingReleaseCandidateManifest(manifestInput()).finalVerdict)
      .toBe('READY_FOR_FINAL_STAGING_MANUAL_CERTIFICATION');
    expect(buildStagingReleaseCandidateManifest(manifestInput(false)).finalVerdict).toBe('BLOCKED');
  });

  it('rejects sensitive manifest values', () => {
    expect(() => assertSafeReleaseCandidateManifest({ note: 'https://staging.example.test' }))
      .toThrow('RC_MANIFEST_SENSITIVE_VALUE');
  });

  it('invalidates runtime changes after an enforced freeze', () => {
    const result = evaluateFeatureFreeze({ changedFiles: ['src/App.jsx'], enforced: true, freezeRef: 'rc-freeze' });
    expect(result).toMatchObject({ valid: false, verdict: 'RELEASE_CANDIDATE_INVALIDATED' });
  });

  it('preserves an RC for documentation-only changes', () => {
    const result = evaluateFeatureFreeze({ changedFiles: ['docs/release.md'], enforced: true, freezeRef: 'rc-freeze' });
    expect(result).toMatchObject({ valid: true, verdict: 'RELEASE_CANDIDATE_PRESERVED' });
  });

  it('classifies certification documents as evidence', () => {
    const result = evaluateFeatureFreeze({
      changedFiles: ['docs/durable-draft-recovery/testing/staging-certification.md'],
      enforced: true,
      freezeRef: 'rc-freeze',
    });
    expect(result.classified[0].category).toBe('evidence');
    expect(result.valid).toBe(true);
  });

  it('contains no production deploy, tag, or push operation', async () => {
    const files = [
      'scripts/run-staging-release-candidate-certification.mjs',
      '.github/workflows/durable-draft-staging-release-candidate.yml',
    ];
    const source = (await Promise.all(files.map((file) => readFile(path.resolve(file), 'utf8')))).join('\n');
    expect(source).not.toMatch(/\bnpx base44 deploy\b|\bgit (?:tag|push)\b|deploy:base44:production/u);
  });
});
