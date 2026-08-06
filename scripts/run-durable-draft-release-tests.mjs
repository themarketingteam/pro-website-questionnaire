#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveE2ETarget } from '../tests/e2e/helpers/targetSafety.js';
import { writeEvidenceBundle } from './build-durable-draft-evidence-bundle.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const FORBIDDEN_COMMAND = /\b(?:base44\s+(?:deploy|entities\s+push|functions\s+deploy)|deploy:base44|git\s+push)\b/i;

const createRunId = () => `release-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const boolFlag = (value, name) => {
  if (value === undefined) return false;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`INVALID_${name}`);
};

export const parseReleaseTestArguments = (argv, env = process.env) => {
  const options = {
    allowEmail: false,
    allowMigration: false,
    allowWrites: false,
    baseUrl: env.DURABLE_DRAFT_BASE_URL || '',
    browserScope: 'all',
    dryRun: false,
    environment: '',
    outputDir: '.durable-draft-artifacts/release-tests',
    phase: '',
    resume: false,
    strict: false,
    testRunId: '',
  };
  const booleans = new Set(['--allow-email', '--allow-migration', '--allow-writes', '--dry-run', '--resume', '--strict']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.split('=', 2);
    if (booleans.has(flag)) {
      options[{
        '--allow-email': 'allowEmail',
        '--allow-migration': 'allowMigration',
        '--allow-writes': 'allowWrites',
        '--dry-run': 'dryRun',
        '--resume': 'resume',
        '--strict': 'strict',
      }[flag]] = boolFlag(inlineValue ?? true, flag.slice(2).replaceAll('-', '_').toUpperCase());
      continue;
    }
    const key = {
      '--base-url': 'baseUrl',
      '--browser-scope': 'browserScope',
      '--environment': 'environment',
      '--output-dir': 'outputDir',
      '--phase': 'phase',
      '--test-run-id': 'testRunId',
    }[flag];
    if (!key) throw new Error('RELEASE_TEST_ARGUMENT_INVALID');
    const value = inlineValue || argv[++index];
    if (!value) throw new Error('RELEASE_TEST_ARGUMENT_VALUE_MISSING');
    options[key] = value;
  }
  options.testRunId ||= createRunId();
  if (!SAFE_RUN_ID.test(options.testRunId)) throw new Error('RELEASE_TEST_RUN_ID_INVALID');
  return options;
};

export const validateReleaseTestTarget = (options, phaseConfig) => {
  if (!phaseConfig) throw new Error('RELEASE_PHASE_UNKNOWN');
  if (phaseConfig.disabled || phaseConfig.requiredEnvironment === 'production') {
    throw new Error('PRODUCTION_RELEASE_TESTING_DISABLED');
  }
  if (options.environment !== phaseConfig.requiredEnvironment) throw new Error('RELEASE_TEST_ENVIRONMENT_MISMATCH');
  if (options.allowWrites && !phaseConfig.writePermission) throw new Error('RELEASE_TEST_WRITES_NOT_ALLOWED');
  if (options.allowEmail && !phaseConfig.emailPermission) throw new Error('RELEASE_TEST_EMAIL_NOT_ALLOWED');
  if (options.allowMigration && !phaseConfig.migrationPermission) throw new Error('RELEASE_TEST_MIGRATION_NOT_ALLOWED');
  if (phaseConfig.productionPermission) throw new Error('PRODUCTION_RELEASE_TESTING_DISABLED');

  if (options.environment === 'staging') {
    resolveE2ETarget({
      E2E_ALLOW_PRODUCTION: 'false',
      E2E_ALLOW_WRITES: String(options.allowWrites),
      E2E_BASE_URL: options.baseUrl,
      E2E_TARGET_ENVIRONMENT: 'staging',
    });
  } else if (options.baseUrl) {
    resolveE2ETarget({ E2E_BASE_URL: options.baseUrl, E2E_TARGET_ENVIRONMENT: options.environment });
  }
  return true;
};

const selectedProjects = (scope) => {
  if (scope === 'desktop') return ['chromium-desktop', 'firefox-desktop', 'webkit-desktop'];
  if (scope === 'chromium') return ['chromium-desktop'];
  if (scope === 'all') return ['chromium-desktop', 'firefox-desktop', 'webkit-desktop', 'mobile-chromium', 'mobile-webkit'];
  const projects = scope.split(',').map((value) => value.trim()).filter(Boolean);
  if (projects.length === 0 || projects.some((value) => !/^[a-z0-9-]+$/.test(value))) {
    throw new Error('RELEASE_BROWSER_SCOPE_INVALID');
  }
  return projects;
};

export const buildAuthoritativeGroups = (options) => {
  const groups = [
    {
      commands: [{ args: ['run', 'test:manifest'], executable: 'npm' }],
      id: 'source-safety',
      requirementIds: ['DR-SRC-001', 'DR-TEST-001'],
      security: false,
    },
    {
      commands: [{ args: ['run', 'test:ci'], executable: 'npm' }],
      id: 'unit-integration',
      requirementIds: ['DR-TEST-001'],
      security: false,
    },
  ];
  if (/security|release_candidate|green/.test(options.phase)) {
    groups.splice(1, 0, {
      commands: [
        { args: ['run', 'test:no-sensitive-frontend-entities'], executable: 'npm' },
        { args: ['run', 'test:sensitive-service-role'], executable: 'npm' },
        { args: ['run', 'test:admin-no-direct-entities'], executable: 'npm' },
      ],
      id: 'security-boundary',
      requirementIds: ['DR-SEC-001', 'DR-RLS-001', 'DR-ADMIN-001'],
      security: true,
    });
  }
  if (options.environment === 'staging') {
    const projectArguments = selectedProjects(options.browserScope).flatMap((project) => ['--project', project]);
    groups.push({
      browsers: selectedProjects(options.browserScope),
      commands: [{ args: ['run', 'test:e2e:staging', '--', ...projectArguments], executable: 'npm' }],
      id: 'browser-matrix',
      requirementIds: ['DR-BROWSER-001'],
      security: false,
    });
  }
  if (/capacity|release_candidate/.test(options.phase)) {
    groups.push({
      commands: [{ args: ['run', 'test:save-concurrency'], executable: 'npm' }],
      id: 'capacity',
      requirementIds: ['DR-PERF-001'],
      security: false,
    });
  }
  if (/release_candidate|green/.test(options.phase)) {
    groups.push({
      commands: [{ args: ['run', 'test:migration-blue-green'], executable: 'npm' }],
      id: 'migration',
      requirementIds: ['DR-MIG-001', 'DR-MIG-002', 'DR-MIG-003'],
      security: false,
    });
  }
  groups.push({
    commands: [{
      args: [
        'scripts/validate-release-test-coverage.mjs',
        '--phase', options.phase,
        '--output-dir', path.join(options.outputDir, 'coverage'),
        '--results-dir', options.outputDir,
      ],
      executable: process.execPath,
    }],
    id: 'coverage',
    requirementIds: ['DR-TEST-001'],
    security: false,
  });
  return groups;
};

const defaultRunner = async (command, options) => {
  const printable = `${command.executable} ${command.args.join(' ')}`;
  if (FORBIDDEN_COMMAND.test(printable)) throw new Error('RELEASE_TEST_FORBIDDEN_COMMAND');
  const result = spawnSync(command.executable, command.args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      E2E_ALLOW_PRODUCTION: 'false',
      E2E_ALLOW_WRITES: String(options.allowWrites),
      E2E_BASE_URL: options.baseUrl,
      E2E_TARGET_ENVIRONMENT: options.environment,
      E2E_TEST_RUN_ID: options.testRunId,
      FORCE_COLOR: '0',
    },
    stdio: 'inherit',
  });
  return { status: result.status ?? 1 };
};

const defaultCleanupRunner = async (options) => {
  const result = spawnSync(process.execPath, [
    'scripts/cleanup-durable-draft-test-data.mjs',
    '--environment', 'staging',
    '--test-run-id', options.testRunId,
    '--apply', 'DELETE_ONLY_THIS_TEST_RUN',
  ], {
    cwd: repositoryRoot,
    env: { ...process.env },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('CLEANUP_FAILED');
};

const resultFor = (group, options, status, safeErrorCode = null) => ({
  artifactPaths: [],
  browser: null,
  commitSha: options.commitSha,
  durationMs: 0,
  environment: options.environment,
  phase: options.phase,
  requirementIds: group.requirementIds,
  safeErrorCode,
  status,
  testId: group.id,
  timestamp: new Date().toISOString(),
});

export const runReleaseTests = async (options, {
  cleanupRunner = defaultCleanupRunner,
  evidenceWriter = writeEvidenceBundle,
  groups = buildAuthoritativeGroups(options),
  phaseModel,
  runner = defaultRunner,
} = {}) => {
  const phaseConfig = phaseModel.phases?.[options.phase];
  validateReleaseTestTarget(options, phaseConfig);
  const outputDir = path.resolve(repositoryRoot, options.outputDir);
  const statePath = path.join(outputDir, 'orchestrator-state.json');
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const prior = options.resume && existsSync(statePath)
    ? JSON.parse(await readFile(statePath, 'utf8'))
    : { results: [] };
  const results = [];

  for (const group of groups) {
    const previous = prior.results.find((result) => result.testId === group.id && result.status === 'passed');
    if (options.resume && previous && !group.security) {
      results.push({ ...previous, resumed: true });
      continue;
    }
    if (options.dryRun) {
      results.push(resultFor(group, options, 'planned'));
      continue;
    }
    let failed = false;
    for (const command of group.commands) {
      const printable = `${command.executable} ${command.args.join(' ')}`;
      if (FORBIDDEN_COMMAND.test(printable)) throw new Error('RELEASE_TEST_FORBIDDEN_COMMAND');
      const outcome = await runner(command, options);
      if (outcome.status !== 0) {
        failed = true;
        break;
      }
    }
    const groupResult = resultFor(group, options, failed ? 'failed' : 'passed', failed ? 'TEST_GROUP_FAILED' : null);
    results.push(groupResult);
    if (!failed && group.browsers) {
      results.push(...group.browsers.map((browser) => ({ ...groupResult, browser, testId: `${group.id}:${browser}` })));
    }
    await writeFile(statePath, `${JSON.stringify({ results }, null, 2)}\n`, { mode: 0o600 });
    if (failed && group.security) break;
  }

  if (options.allowWrites && !options.dryRun) {
    if (typeof cleanupRunner !== 'function') {
      results.push(resultFor({ id: 'cleanup', requirementIds: ['DR-TEST-001'] }, options, 'blocked', 'CLEANUP_RUNNER_MISSING'));
    } else {
      try {
        await cleanupRunner(options);
        results.push(resultFor({ id: 'cleanup', requirementIds: ['DR-TEST-001'] }, options, 'passed'));
      } catch {
        results.push(resultFor({ id: 'cleanup', requirementIds: ['DR-TEST-001'] }, options, 'failed', 'CLEANUP_FAILED'));
      }
    }
  } else {
    results.push(resultFor({ id: 'cleanup-no-writes', requirementIds: ['DR-TEST-001'] }, options, options.dryRun ? 'planned' : 'passed'));
  }

  if (!options.dryRun) {
    for (const browser of phaseConfig.requiredBrowsers) {
      const hasResult = results.some((result) => result.browser === browser
        || result.browser === `${browser}-desktop`
        || result.browser?.startsWith(`${browser}-`));
      if (!hasResult) {
        results.push(resultFor({ id: `browser-result:${browser}`, requirementIds: ['DR-BROWSER-001'] }, options, 'failed', 'REQUIRED_BROWSER_RESULT_MISSING'));
      }
    }
    if (options.strict) {
      const reportGroups = {
        'browser-matrix': 'browser-matrix',
        cleanup: options.allowWrites ? 'cleanup' : 'cleanup-no-writes',
        coverage: 'coverage',
        integration: 'unit-integration',
        unit: 'unit-integration',
        'source-safety': 'source-safety',
        'security-summary': 'security-boundary',
        'performance-summary': 'capacity',
        'migration-summary': 'migration',
      };
      for (const reportName of phaseConfig.requiredReports) {
        const groupId = reportGroups[reportName];
        if (groupId && !results.some((result) => result.testId === groupId && result.status === 'passed')) {
          results.push(resultFor({ id: `required-report:${reportName}`, requirementIds: ['DR-TEST-001'] }, options, 'failed', 'REQUIRED_REPORT_MISSING'));
        }
      }
    }
  }

  await writeFile(statePath, `${JSON.stringify({ results }, null, 2)}\n`, { mode: 0o600 });
  const blocking = results.some((result) => ['failed', 'blocked', 'skipped'].includes(result.status));
  const verdict = options.dryRun ? 'DRY_RUN_PLANNED' : blocking ? 'FAILED' : 'PASSED';
  await evidenceWriter({
    commitSha: options.commitSha,
    environment: options.environment,
    outputDir: path.join(outputDir, 'evidence'),
    phase: options.phase,
    results,
    testRunId: options.testRunId,
  });
  return { blocking, results, testRunId: options.testRunId, verdict };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseReleaseTestArguments(process.argv.slice(2));
    const [phaseModel, commitSha] = await Promise.all([
      readFile(path.join(repositoryRoot, 'config', 'durable-draft-release-phases.json'), 'utf8').then(JSON.parse),
      Promise.resolve(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).stdout.trim()),
    ]);
    const result = await runReleaseTests({ ...options, commitSha }, { phaseModel });
    process.stdout.write(`release_test_run_id=${result.testRunId}\nrelease_test_verdict=${result.verdict}\n`);
    if (result.blocking && !options.dryRun) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.message || 'RELEASE_TEST_ORCHESTRATION_FAILED'}\n`);
    process.exitCode = 2;
  }
}
