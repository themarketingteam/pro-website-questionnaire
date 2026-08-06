#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const args = process.argv.slice(2);
const allowedArgs = new Set(['--plan-only']);

for (const arg of args) {
  if (!allowedArgs.has(arg)) {
    console.error(`ENTITY_SCHEMA_TEST_RUNNER_ERROR UNKNOWN_ARGUMENT:${arg}`);
    process.exit(1);
  }
}

function runNode(scriptPath, scriptArgs) {
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runNode(
  path.join(SCRIPT_DIRECTORY, 'validate-pro-form-entity-schemas.mjs'),
  args,
);
runNode(
  path.join(REPOSITORY_ROOT, 'node_modules/vitest/vitest.mjs'),
  [
    'run',
    '--config',
    'src/vitest.config.js',
    'src/test/proFormDraftEntitySchema.test.js',
    '--reporter=dot',
    '--no-coverage',
  ],
);
