import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createEvidenceBundleFiles,
  writeEvidenceBundle,
} from './build-durable-draft-evidence-bundle.mjs';
import {
  CLEANUP_ENTITY_NAMES,
  runCleanupCoordinator,
  validateCleanupRequest,
} from './cleanup-durable-draft-test-data.mjs';
import {
  normalizeTestResults,
  sanitizeEvidenceValue,
} from './lib/normalize-test-results.mjs';
import {
  parseReleaseTestArguments,
  runReleaseTests,
  validateReleaseTestTarget,
} from './run-durable-draft-release-tests.mjs';
import { validateReleaseTestCoverage } from './validate-release-test-coverage.mjs';
import {
  createActiveDraft,
  createQuestionnaireResponseSet,
  createSyntheticFactoryContext,
  createVerificationAttempt,
} from '../tests/factories/proDraftSyntheticDataFactory.js';

const temporaryDirectories = [];
const temporaryDirectory = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'durable-draft-release-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

const matrixRow = ({
  id = 'DR-TEST-001',
  source = '`scripts/example.mjs`',
  status = 'Implemented',
  testId = 'UT-TEST-001',
} = {}) => `| \`${id}\` | Synthetic requirement | ADR | B09 | ${source} | \`${testId}\` | \`IT-TEST-001\` | \`BT-TEST-001\` | \`EV-STG-TEST-001\` | pending | pending | Yes | ${status} |`;

const phaseModel = (overrides = {}) => ({
  phases: {
    test: {
      allowedPendingRequirementCategories: [],
      emailPermission: false,
      migrationPermission: false,
      productionPermission: false,
      requiredBrowsers: [],
      requiredEnvironment: 'local',
      requiredReports: [],
      requiredRequirementIdPatterns: ['^DR-TEST-'],
      writePermission: false,
      ...overrides,
    },
  },
});

const options = async (overrides = {}) => ({
  allowEmail: false,
  allowMigration: false,
  allowWrites: false,
  baseUrl: '',
  browserScope: 'all',
  commitSha: 'a'.repeat(40),
  dryRun: false,
  environment: 'local',
  outputDir: await temporaryDirectory(),
  phase: 'test',
  resume: false,
  strict: true,
  testRunId: 'release-test-0001',
  ...overrides,
});

describe('durable draft release control plane', () => {
  it('[DR-TEST-016] generates deterministic isolated staging-only synthetic records', () => {
    const contextA = createSyntheticFactoryContext({ seed: 'fixed', testRunId: 'release-test-0001', workerId: 'worker-0001' });
    const contextB = createSyntheticFactoryContext({ seed: 'fixed', testRunId: 'release-test-0001', workerId: 'worker-0001' });
    expect(createActiveDraft(contextA)).toEqual(createActiveDraft(contextB));
    const responses = createQuestionnaireResponseSet(contextA);
    expect(responses).toMatchObject({ environment: 'staging', test_run_id: 'release-test-0001' });
    expect(JSON.stringify(responses)).toContain('example.test');
  });

  it('[DR-SEC-003] labels fake verification codes as test-only', () => {
    const context = createSyntheticFactoryContext({ seed: 'fixed', testRunId: 'release-test-0001', workerId: 'worker-0001' });
    expect(createVerificationAttempt(context).test_only_fake_code_label).toMatch(/^TEST-ONLY-FAKE-CODE-/);
  });

  it('[DR-TEST-001] parses the authoritative release phase options', () => {
    expect(parseReleaseTestArguments([
      '--phase', 'staging_functional', '--environment=staging', '--base-url', 'https://staging.example.test',
      '--browser-scope=desktop', '--dry-run', '--strict', '--test-run-id', 'release-test-0001',
    ])).toMatchObject({
      browserScope: 'desktop',
      dryRun: true,
      environment: 'staging',
      phase: 'staging_functional',
      strict: true,
    });
  });

  it('[DR-TEST-002] rejects a production URL for a staging phase', () => {
    expect(() => validateReleaseTestTarget({
      allowEmail: false,
      allowMigration: false,
      allowWrites: false,
      baseUrl: 'https://questionnaire.mspsuccesswebsites.com',
      environment: 'staging',
    }, phaseModel({ requiredEnvironment: 'staging' }).phases.test)).toThrowError('PRODUCTION_E2E_NOT_ALLOWED');
  });

  it('[DR-TEST-003] detects an acceptance requirement missing from the matrix', async () => {
    const report = await validateReleaseTestCoverage({
      acceptanceText: 'Requirement IDs: DR-TEST-001, DR-TEST-999',
      certificationText: '',
      matrixText: matrixRow({ source: '' }),
      phase: 'test',
      phaseModel: phaseModel(),
      repository: process.cwd(),
      results: [],
      testSources: [{ path: 'scripts/test.js', text: "it('[DR-TEST-001] [UT-TEST-001] works', () => {})" }],
    });
    expect(report.failures).toContain('ACCEPTANCE_REQUIREMENT_MISSING_FROM_MATRIX:DR-TEST-999');
  });

  it('[DR-TEST-004] rejects a skipped required test', async () => {
    const report = await validateReleaseTestCoverage({
      acceptanceText: 'DR-TEST-001',
      certificationText: '',
      matrixText: matrixRow({ source: '' }),
      phase: 'test',
      phaseModel: phaseModel(),
      repository: process.cwd(),
      results: [],
      testSources: [{ path: 'scripts/test.js', text: "it.skip('[DR-TEST-001] [UT-TEST-001] skipped', () => {})" }],
    });
    expect(report.failures).toContain('SKIPPED_REQUIRED_TEST:DR-TEST-001');
  });

  it('[DR-TEST-005] permits an explicitly phase-appropriate future pending requirement', async () => {
    const model = phaseModel({
      allowedPendingRequirementCategories: ['migration'],
      requiredRequirementIdPatterns: ['^DR-MIG-'],
    });
    const report = await validateReleaseTestCoverage({
      acceptanceText: 'DR-MIG-001',
      certificationText: '',
      matrixText: matrixRow({ id: 'DR-MIG-001', source: '', status: 'Planned', testId: 'UT-MIG-001' }),
      phase: 'test',
      phaseModel: model,
      repository: process.cwd(),
      results: [],
      testSources: [],
    });
    expect(report.failures).toEqual([]);
    expect(report.warnings).toContain('PHASE_PENDING_ALLOWED:DR-MIG-001:migration');
  });

  it('[DR-TEST-006] detects a missing required browser result', async () => {
    const report = await validateReleaseTestCoverage({
      acceptanceText: '',
      certificationText: '',
      matrixText: '',
      phase: 'test',
      phaseModel: phaseModel({ requiredBrowsers: ['webkit'] }),
      repository: process.cwd(),
      results: [{ browser: 'chromium', status: 'passed' }],
      testSources: [],
    });
    expect(report.failures).toContain('REQUIRED_BROWSER_RESULT_MISSING:webkit');
  });

  it('[DR-SEC-001] stops after a security-boundary failure', async () => {
    const runOptions = await options({ strict: false });
    const calls = [];
    const result = await runReleaseTests(runOptions, {
      evidenceWriter: async () => ({}),
      groups: [
        { commands: [{ executable: 'node', args: ['security'] }], id: 'security', requirementIds: ['DR-SEC-001'], security: true },
        { commands: [{ executable: 'node', args: ['later'] }], id: 'later', requirementIds: ['DR-TEST-001'], security: false },
      ],
      phaseModel: phaseModel(),
      runner: async (command) => { calls.push(command.args[0]); return { status: 1 }; },
    });
    expect(calls).toEqual(['security']);
    expect(result.blocking).toBe(true);
  });

  it('[DR-TEST-007] resumes passed nonsecurity groups but reruns security groups', async () => {
    const outputDir = await temporaryDirectory();
    const firstOptions = await options({ outputDir, strict: false });
    const groups = [
      { commands: [{ executable: 'node', args: ['ordinary'] }], id: 'ordinary', requirementIds: ['DR-TEST-001'], security: false },
      { commands: [{ executable: 'node', args: ['security'] }], id: 'security', requirementIds: ['DR-SEC-001'], security: true },
    ];
    await runReleaseTests(firstOptions, { evidenceWriter: async () => ({}), groups, phaseModel: phaseModel(), runner: async () => ({ status: 0 }) });
    const calls = [];
    await runReleaseTests({ ...firstOptions, resume: true }, {
      evidenceWriter: async () => ({}),
      groups,
      phaseModel: phaseModel(),
      runner: async (command) => { calls.push(command.args[0]); return { status: 0 }; },
    });
    expect(calls).toEqual(['security']);
  });

  it('[DR-TEST-008] normalizes Vitest and Playwright results', () => {
    const vitest = normalizeTestResults({ testResults: [{ assertionResults: [{ duration: 5, fullName: '[DR-TEST-008] unit', status: 'passed' }] }] }, { format: 'vitest' });
    const playwright = normalizeTestResults({ suites: [{ specs: [{ title: '[DR-BROWSER-001] browser', tests: [{ projectName: 'webkit', results: [{ duration: 8, status: 'passed' }] }] }] }] }, { format: 'playwright' });
    expect(vitest[0]).toMatchObject({ requirementIds: ['DR-TEST-008'], status: 'passed' });
    expect(playwright[0]).toMatchObject({ browser: 'webkit', requirementIds: ['DR-BROWSER-001'], status: 'passed' });
    for (const format of ['migration', 'load', 'security', 'manual']) {
      expect(normalizeTestResults({ results: [{ id: `[DR-TEST-008] ${format}`, status: 'pass' }] }, { format })[0].status).toBe('passed');
    }
  });

  it('[DR-SEC-002] redacts emails, tokens, query parameters, answers, and stack traces', () => {
    const safe = sanitizeEvidenceValue({
      answer: 'private response',
      error: ['Bearer', ['TOKENVALUE123456', '789012345678901234'].join('')].join(' '),
      stack: 'not retained by normalized schema',
      user: 'person@example.test',
      url: 'https://staging.example.test/path?token=secret#fragment',
    });
    expect(JSON.stringify(safe)).not.toContain('private response');
    expect(JSON.stringify(safe)).not.toContain('person@example.test');
    expect(safe.url).toBe('https://staging.example.test/path');
    expect(normalizeTestResults({ results: [{ error: { code: 'SAFE_FAILURE', stack: 'private stack' }, status: 'failed', testId: 'x' }] })[0]).not.toHaveProperty('stack');
  });

  it('[DR-TEST-009] builds the required sanitized evidence files and checksums', async () => {
    const outputDir = await temporaryDirectory();
    const result = await writeEvidenceBundle({
      commitSha: 'a'.repeat(40),
      environment: 'staging',
      outputDir,
      phase: 'staging_functional',
      results: [{ artifactPaths: ['protected/result.json', 'trace.zip'], answer: 'must-not-escape', browser: 'chromium', requirementIds: ['DR-TEST-009'], status: 'passed', testId: 'safe' }],
      testRunId: 'release-test-0001',
    });
    expect(result.fileNames).toContain('checksums.sha256');
    expect(result.fileNames).toContain('manifest.json');
    expect(await readFile(path.join(outputDir, 'checksums.sha256'), 'utf8')).toMatch(/^[a-f0-9]{64}  /m);
    expect(await readFile(path.join(outputDir, 'manifest.json'), 'utf8')).not.toContain('trace.zip');
    expect(await readFile(path.join(outputDir, 'requirements.json'), 'utf8')).not.toContain('must-not-escape');
  });

  it('[DR-TEST-010] marks a dry evidence bundle incomplete rather than passed', () => {
    expect(createEvidenceBundleFiles({
      commitSha: 'a'.repeat(40), environment: 'staging', phase: 'staging_functional',
      results: [{ status: 'planned', testId: 'dry' }], testRunId: 'release-test-0001',
    }).status).toBe('INCOMPLETE');
    expect(createEvidenceBundleFiles({
      commitSha: 'a'.repeat(40), environment: 'local', phase: 'source_foundation',
      results: [], testRunId: 'release-test-0001',
    }).status).toBe('INCOMPLETE');
  });

  it('[DR-TEST-011] refuses blank and wildcard cleanup run IDs', () => {
    expect(() => validateCleanupRequest({ environment: 'staging', testRunId: '' })).toThrowError('CLEANUP_TEST_RUN_ID_INVALID');
    expect(() => validateCleanupRequest({ environment: 'staging', testRunId: 'release-*' })).toThrowError('CLEANUP_TEST_RUN_ID_INVALID');
  });

  it('[DR-TEST-012] permits cleanup only in staging with explicit apply confirmation', () => {
    expect(() => validateCleanupRequest({ environment: 'production', testRunId: 'release-test-0001' })).toThrowError('CLEANUP_STAGING_ONLY');
    expect(() => validateCleanupRequest({ apply: true, environment: 'staging', testRunId: 'release-test-0001' })).toThrowError('CLEANUP_CONFIRMATION_REQUIRED');
  });

  it('[DR-TEST-013] previews, applies, and verifies only the requested test run', async () => {
    const actions = [];
    const counts = Object.fromEntries(CLEANUP_ENTITY_NAMES.map((entityName) => [entityName, entityName === 'ProFormDraft' ? 2 : 0]));
    const zeroCounts = Object.fromEntries(CLEANUP_ENTITY_NAMES.map((entityName) => [entityName, 0]));
    const result = await runCleanupCoordinator({
      apply: true,
      confirmation: 'DELETE_ONLY_THIS_TEST_RUN',
      environment: 'staging',
      testRunId: 'release-test-0001',
    }, {
      invokeApprovedFunction: async (_name, payload) => {
        actions.push(payload);
        if (payload.action === 'preview') return { counts };
        if (payload.action === 'delete') return { deletedCounts: { ProFormDraft: 2 } };
        return { counts: zeroCounts };
      },
    });
    expect(actions.every((action) => action.testRunId === 'release-test-0001')).toBe(true);
    expect(result.verifiedZero).toBe(true);
  });

  it('[DR-TEST-014] fails stable test-ID coverage when a blocking test has no ID', async () => {
    const report = await validateReleaseTestCoverage({
      acceptanceText: 'DR-TEST-001', certificationText: '', matrixText: matrixRow({ source: '' }), phase: 'test',
      phaseModel: phaseModel(), repository: process.cwd(), results: [],
      testSources: [{ path: 'scripts/no-id.test.js', text: "it('has no stable identifier', () => {})" }],
    });
    expect(report.failures).toContain('MISSING_REQUIRED_TEST:DR-TEST-001');
  });

  it('[DR-TEST-015] never executes a forbidden release command', async () => {
    const runOptions = await options({ strict: false });
    let invoked = false;
    await expect(runReleaseTests(runOptions, {
      evidenceWriter: async () => ({}),
      groups: [{ commands: [{ executable: 'npx', args: ['base44', 'deploy'] }], id: 'unsafe', requirementIds: ['DR-TEST-015'], security: false }],
      phaseModel: phaseModel(),
      runner: async () => { invoked = true; return { status: 0 }; },
    })).rejects.toThrowError('RELEASE_TEST_FORBIDDEN_COMMAND');
    expect(invoked).toBe(false);
  });
});
