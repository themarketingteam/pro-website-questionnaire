#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRollbackPrecheck } from './lib/staging-rollback-drill.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.durable-draft-artifacts/staging-rollback/precheck.json');
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const config = JSON.parse(await readFile(path.join(root, 'config/durable-draft-staging-rollback-drill.json'), 'utf8'));
const currentCommit = git(['rev-parse', 'HEAD']).stdout.trim();
const priorExists = Boolean(config.priorRlsCompatibleCommit)
  && git(['cat-file', '-e', `${config.priorRlsCompatibleCommit}^{commit}`]).status === 0;
const environment = Object.fromEntries([
  ...(config.requiredEnvironmentVariables || []),
  ...(config.productionForbiddenEnvironmentVariables || []),
].map((name) => [name, process.env[name] || '']));
const result = evaluateRollbackPrecheck({
  branch: git(['branch', '--show-current']).stdout.trim(),
  clean: git(['status', '--porcelain']).stdout.trim() === '',
  currentCommit,
  config,
  environment,
  priorCommitExists: priorExists,
  currentBuildPassed: existsSync(path.join(root, 'dist/index.html')),
  priorBuildPassed: priorExists
    && environment.PRO_DRAFT_STAGING_PRIOR_BUILD_SHA === config.priorRlsCompatibleCommit,
  targetGuardPassed: spawnSync(process.execPath, [
    'scripts/verify-base44-deployment-target.mjs', '--required-environment=staging',
  ], { cwd: root, env: process.env, encoding: 'utf8', stdio: 'pipe' }).status === 0,
  productionUnchanged: git(['rev-parse', 'main']).stdout.trim() === config.baselineCommit
    && git(['rev-parse', 'origin/main']).stdout.trim() === config.baselineCommit,
});
const report = {
  version: 1,
  checkedAt: new Date().toISOString(),
  currentCommit,
  priorCommit: config.priorRlsCompatibleCommit,
  environment: config.environment,
  failures: result.failures,
  verdict: result.verdict,
  liveMutationPerformed: false,
};
await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`staging_rollback_precheck=${result.verdict}\nfailures=${result.failures.length}\n`);
if (!result.ok) process.exitCode = 1;
