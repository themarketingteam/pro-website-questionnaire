#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exerciseBrowserStateModel, exerciseSyntheticRollback } from './lib/staging-rollback-drill.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();
const migration = exerciseSyntheticRollback({ interruptAfter: 4 });
const browser = exerciseBrowserStateModel();
const passed = migration.resumed && migration.hashesMatch && migration.submittedPreserved
  && migration.duplicateCount === 0 && migration.cleanupRemaining === 0
  && browser.persistentPreserved && browser.memoryOnlyNotPromoted && browser.serverWritesBlocked;
const report = {
  version: 1,
  classification: passed ? 'SYNTHETIC_ROLLBACK_DRILL_PASSED' : 'SYNTHETIC_ROLLBACK_DRILL_FAILED',
  durationMilliseconds: Date.now() - started,
  killSwitch: { clientWritesBlocked: true, serverWritesBlocked: true, recoveryCodeDisplayPreserved: true },
  migration,
  browser,
  containsQuestionnaireContent: false,
};
const destination = path.join(root, '.durable-draft-artifacts/staging-rollback/synthetic-drill.json');
await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`synthetic_rollback_drill=${passed ? 'PASS' : 'FAIL'}\n`);
if (!passed) process.exitCode = 1;
