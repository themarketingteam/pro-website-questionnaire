#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSecurityTarget, assertIsolatedRateLimitSubject } from '../tests/security/helpers/targetSafety.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'local';

const run = (args, env = process.env) => {
  const result = spawnSync('npx', ['vitest', 'run', ...args], {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
};

if (mode === 'staging') {
  const target = assertSecurityTarget({
    environment: process.env.SECURITY_TARGET_ENVIRONMENT,
    baseURL: process.env.SECURITY_BASE_URL,
  });
  assertIsolatedRateLimitSubject({
    testRunId: process.env.SECURITY_TEST_RUN_ID,
    subject: process.env.SECURITY_RATE_LIMIT_SUBJECT,
    attempts: Number(process.env.SECURITY_RATE_LIMIT_ATTEMPTS || 12),
  });
  if (process.env.SECURITY_ALLOW_PRODUCTION === 'true') throw new Error('SECURITY_PRODUCTION_AUTHORIZATION_FORBIDDEN');
  if (process.env.SECURITY_ALLOW_EMAIL_SENDS === 'true') throw new Error('SECURITY_EMAIL_SEND_AUTHORIZATION_FORBIDDEN');
  run(['--config', 'tests/security/vitest.staging.config.js'], {
    ...process.env,
    SECURITY_TARGET_ENVIRONMENT: target.environment,
  });
} else if (mode === 'local') {
  run(['--config', 'tests/security/vitest.config.js']);
  run([
    '--config', 'src/vitest.config.js',
    'src/test/proDraftAuthorization.test.js',
    'src/test/proDraftRecoverySecurity.test.js',
    'src/test/proDraftRlsAttackContract.test.js',
    'src/test/proDraftRlsFailureIntegration.test.js',
    'src/test/proDraftFunctionAuthorizationOrderContract.test.js',
    'src/test/proDraftEmailTemplates.test.js',
    'src/test/proDraftEmailTransport.test.js',
    'src/test/proDraftPersistence.test.js',
    'src/test/proDraftConflictMerge.test.js',
    'src/test/questionnaireDraftState.test.js',
    'src/test/proFormMigrationBundle.test.js',
    'src/test/proFormMigrationIncrementalReverse.test.js',
  ]);
} else {
  throw new Error('SECURITY_TEST_MODE_INVALID');
}
