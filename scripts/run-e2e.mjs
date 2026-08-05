import { spawnSync } from 'node:child_process';

const mode = process.argv[2];
const forwardedArguments = process.argv.slice(3);
const npmExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const env = { ...process.env };
const playwrightArguments = ['playwright', 'test'];

if (mode === 'staging') {
  if (!String(env.E2E_BASE_URL || '').trim()) {
    console.error('MISSING_E2E_BASE_URL');
    process.exit(2);
  }
  if (env.E2E_TARGET_ENVIRONMENT && env.E2E_TARGET_ENVIRONMENT !== 'staging') {
    console.error('STAGING_E2E_ENVIRONMENT_MISMATCH');
    process.exit(2);
  }
  env.E2E_TARGET_ENVIRONMENT = 'staging';
  playwrightArguments.push('tests/e2e/smoke/staging-shell.spec.js');
} else if (mode === 'edge') {
  env.E2E_EDGE_ENABLED = 'true';
  playwrightArguments.push(
    'tests/e2e/smoke/staging-shell.spec.js',
    '--project=msedge',
  );
} else {
  console.error('INVALID_E2E_RUN_MODE');
  process.exit(2);
}

playwrightArguments.push(...forwardedArguments);
const result = spawnSync(npmExecutable, playwrightArguments, {
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
