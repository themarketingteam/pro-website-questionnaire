#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createInMemoryLoadAdapter,
  parseLoadTestArguments,
  runLoadHarness,
  validateLoadTestOptions,
} from './lib/pro-draft-load-harness.mjs';
import { createStagingBase44LoadAdapter } from './lib/pro-draft-load-staging-adapter.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
};

const main = async () => {
  const parsed = parseLoadTestArguments(process.argv.slice(2));
  const options = validateLoadTestOptions(parsed);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const adapter = options.adapter === 'mock'
      ? createInMemoryLoadAdapter({ latencyMs: 0 })
      : await createStagingBase44LoadAdapter();
    const result = await runLoadHarness({
      options,
      adapter,
      signal: controller.signal,
      commit: commit(),
    });
    process.stdout.write(`${JSON.stringify({
      verdict: result.verdict,
      profile: options.profile,
      testRunId: options.testRunId,
      stagingAppFingerprint: adapter.stagingAppFingerprint || options.baseUrlFingerprint,
      output: path.relative(repositoryRoot, path.resolve(options.output)),
      cleanupVerified: result.cleanup.verifiedZero,
    })}\n`);
    if (result.verdict !== 'PASS') process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
};

main().catch((error) => {
  process.stderr.write(`${/^[A-Z0-9_]{1,96}$/u.test(String(error?.code || error?.message || ''))
    ? String(error.code || error.message)
    : 'LOAD_TEST_FAILED'}\n`);
  process.exitCode = 1;
});
