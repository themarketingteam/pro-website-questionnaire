#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateFeatureFreeze } from './lib/staging-release-candidate.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_REF = /^[A-Za-z0-9._/-]{1,160}$/u;
const SAFE_OUTPUT = /^\.durable-draft-artifacts\/[A-Za-z0-9._/-]+\.json$/u;

const parseArguments = (argv) => {
  const options = {
    config: 'config/durable-draft-staging-release-candidate.json',
    enforce: false,
    freezeRef: '',
    output: '.durable-draft-artifacts/staging-rc/feature-freeze.json',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--enforce') {
      options.enforce = true;
      continue;
    }
    const key = { '--config': 'config', '--freeze-ref': 'freezeRef', '--output': 'output' }[flag];
    if (!key) throw new Error('RC_FREEZE_ARGUMENT_INVALID');
    const value = argv[++index];
    if (!value) throw new Error('RC_FREEZE_ARGUMENT_VALUE_MISSING');
    options[key] = value;
  }
  if (options.freezeRef && !SAFE_REF.test(options.freezeRef)) throw new Error('RC_FREEZE_REF_INVALID');
  if (!SAFE_OUTPUT.test(options.output)) throw new Error('RC_FREEZE_OUTPUT_UNSAFE');
  return options;
};

const changedFilesFrom = (freezeRef) => {
  if (!freezeRef) return [];
  const verified = spawnSync('git', ['rev-parse', '--verify', `${freezeRef}^{commit}`], {
    cwd: repositoryRoot, encoding: 'utf8',
  });
  if (verified.status !== 0) throw new Error('RC_FREEZE_REF_UNAVAILABLE');
  const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', `${freezeRef}..HEAD`], {
    cwd: repositoryRoot, encoding: 'utf8',
  });
  if (diff.status !== 0) throw new Error('RC_FREEZE_DIFF_FAILED');
  return diff.stdout.split('\n').filter(Boolean).sort();
};

export const runReleaseCandidateFeatureFreezeValidation = async (
  options = parseArguments(process.argv.slice(2)),
) => {
  const config = JSON.parse(await readFile(path.resolve(repositoryRoot, options.config), 'utf8'));
  const enforced = options.enforce || config.featureFreezeEnforced === true;
  const freezeRef = options.freezeRef || config.featureFreezeRef;
  if (enforced && !freezeRef) throw new Error('RC_FREEZE_REF_REQUIRED');
  const report = {
    version: 1,
    checkedAt: new Date().toISOString(),
    ...evaluateFeatureFreeze({ changedFiles: changedFilesFrom(freezeRef), enforced, freezeRef }),
  };
  const outputPath = path.resolve(repositoryRoot, options.output);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const report = await runReleaseCandidateFeatureFreezeValidation();
    process.stdout.write(`rc_freeze_verdict=${report.verdict}\n`);
    if (!report.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.message || 'RC_FREEZE_VALIDATION_FAILED'}\n`);
    process.exitCode = 2;
  }
}
