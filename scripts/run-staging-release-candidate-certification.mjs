#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveE2ETarget } from '../tests/e2e/helpers/targetSafety.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const SAFE_OUTPUT = /^\.durable-draft-artifacts\/[A-Za-z0-9._/-]+$/u;
const FORBIDDEN_COMMAND = /\b(?:base44\s+(?:deploy|entities\s+push|functions\s+deploy)|deploy:base44|git\s+(?:tag|push))\b/iu;

const createRunId = () => `staging-rc-${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;

export const parseStagingReleaseCandidateArguments = (argv, env = process.env) => {
  const options = {
    baseUrl: env.PRO_DRAFT_STAGING_URL || '',
    environment: 'staging',
    outputDir: '.durable-draft-artifacts/staging-rc',
    resume: false,
    testRunId: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--resume') {
      options.resume = true;
      continue;
    }
    const key = {
      '--base-url': 'baseUrl',
      '--environment': 'environment',
      '--output-dir': 'outputDir',
      '--test-run-id': 'testRunId',
    }[flag];
    if (!key) throw new Error('RC_ORCHESTRATOR_ARGUMENT_INVALID');
    const value = argv[++index];
    if (!value) throw new Error('RC_ORCHESTRATOR_ARGUMENT_VALUE_MISSING');
    options[key] = value;
  }
  options.testRunId ||= createRunId();
  if (!SAFE_RUN_ID.test(options.testRunId)) throw new Error('RC_ORCHESTRATOR_RUN_ID_INVALID');
  if (!SAFE_OUTPUT.test(options.outputDir)) throw new Error('RC_ORCHESTRATOR_OUTPUT_UNSAFE');
  if (options.environment !== 'staging') throw new Error('RC_ORCHESTRATOR_STAGING_ONLY');
  resolveE2ETarget({
    E2E_ALLOW_PRODUCTION: 'false',
    E2E_ALLOW_WRITES: 'true',
    E2E_BASE_URL: options.baseUrl,
    E2E_TARGET_ENVIRONMENT: 'staging',
  });
  return Object.freeze(options);
};

const run = (executable, args, options) => {
  const printable = `${executable} ${args.join(' ')}`;
  if (FORBIDDEN_COMMAND.test(printable)) throw new Error('RC_ORCHESTRATOR_FORBIDDEN_COMMAND');
  return spawnSync(executable, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DURABLE_DRAFT_BASE_URL: options.baseUrl,
      E2E_ALLOW_PRODUCTION: 'false',
      E2E_ALLOW_WRITES: 'true',
      E2E_BASE_URL: options.baseUrl,
      E2E_TARGET_ENVIRONMENT: 'staging',
      E2E_TEST_RUN_ID: options.testRunId,
      FORCE_COLOR: '0',
    },
    stdio: 'inherit',
  });
};

export const releaseCandidateSuiteArguments = (options) => [
  'scripts/run-durable-draft-release-tests.mjs',
  '--phase', 'staging_release_candidate',
  '--environment', 'staging',
  '--browser-scope', 'all',
  '--test-run-id', options.testRunId,
  '--output-dir', path.join(options.outputDir, 'certification'),
  '--allow-writes',
  '--allow-email',
  '--allow-migration',
  '--strict',
  ...(options.resume ? ['--resume'] : []),
];

export const runStagingReleaseCandidateCertification = async (
  options,
  { runner = run } = {},
) => {
  const outputDir = path.resolve(repositoryRoot, options.outputDir);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const state = {
    version: 1,
    testRunId: options.testRunId,
    environment: 'staging',
    resumePolicy: 'NONSECURITY_ONLY_SECURITY_ALWAYS_RERUNS',
    deploymentPerformed: false,
    tagCreated: false,
    groups: [],
  };
  const precheck = runner(process.execPath, [
    'scripts/precheck-staging-release-candidate.mjs',
    '--output', path.join(options.outputDir, 'precheck.json'),
  ], options);
  state.groups.push({ id: 'precheck', status: precheck.status === 0 ? 'passed' : 'blocked' });

  if (precheck.status === 0) {
    const coverage = runner(process.execPath, [
      'scripts/validate-release-test-coverage.mjs',
      '--phase', 'staging_release_candidate',
      '--output-dir', path.join(options.outputDir, 'strict-coverage'),
    ], options);
    state.groups.push({ id: 'strict-coverage', status: coverage.status === 0 ? 'passed' : 'failed' });
    if (coverage.status === 0) {
      const certification = runner(process.execPath, releaseCandidateSuiteArguments(options), options);
      state.groups.push({ id: 'comprehensive-automated-staging', status: certification.status === 0 ? 'passed' : 'failed' });
    }
  }

  const config = JSON.parse(await readFile(path.join(repositoryRoot, 'config/durable-draft-staging-release-candidate.json'), 'utf8'));
  state.manualEvidence = config.requiredManualEvidence;
  state.rollbackDrillStatus = config.requiredManualEvidence.find(({ id }) => id === 'rollback-drill')?.status || 'MISSING';
  const manifest = runner(process.execPath, [
    'scripts/build-staging-release-candidate-manifest.mjs',
    '--precheck', path.join(options.outputDir, 'precheck.json'),
    '--coverage', path.join(options.outputDir, 'strict-coverage/release-test-coverage.json'),
    '--evidence-checksums', path.join(options.outputDir, 'certification/evidence/checksums.sha256'),
    '--output', path.join(options.outputDir, 'release-candidate-manifest.json'),
  ], options);
  state.groups.push({ id: 'manifest', status: manifest.status === 0 ? 'written' : 'failed' });
  const blocking = state.groups.some(({ status }) => ['blocked', 'failed'].includes(status));
  state.verdict = blocking ? 'BLOCKED' : 'READY_FOR_FINAL_STAGING_MANUAL_CERTIFICATION';
  await writeFile(path.join(outputDir, 'orchestrator-state.json'), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze(state);
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseStagingReleaseCandidateArguments(process.argv.slice(2));
    const result = await runStagingReleaseCandidateCertification(options);
    process.stdout.write(`staging_rc_run_id=${result.testRunId}\nstaging_rc_verdict=${result.verdict}\n`);
    if (result.verdict !== 'READY_FOR_FINAL_STAGING_MANUAL_CERTIFICATION') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.message || 'RC_ORCHESTRATION_FAILED'}\n`);
    process.exitCode = 2;
  }
}
