import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const RESULT_VALUES = new Set([
  'cancelled',
  'failure',
  'pass',
  'skipped',
  'success',
  'unknown',
]);
const ENVIRONMENT_VALUES = new Set(['ci', 'local', 'staging']);
const BASELINE_VALUES = new Set(['mismatch', 'missing', 'unknown', 'verified']);

const safeEnum = (value, allowed) => {
  const normalized = String(value || 'unknown').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : 'unknown';
};

const safeCommit = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(normalized) ? normalized : 'unknown';
};

const safePendingCount = (value) => {
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized : 'unknown';
};

const safeArtifacts = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item));

export const buildCiSummary = (input = {}) => {
  const commitSha = safeCommit(input.commitSha);
  const environment = safeEnum(input.environment, ENVIRONMENT_VALUES);
  const unitResult = safeEnum(input.unitResult, RESULT_VALUES);
  const buildResult = safeEnum(input.buildResult, RESULT_VALUES);
  const e2eResult = safeEnum(input.e2eResult, RESULT_VALUES);
  const pendingCount = safePendingCount(input.pendingCount);
  const baselineStatus = safeEnum(input.baselineStatus, BASELINE_VALUES);
  const noDeploy = String(input.noDeploy).trim().toLowerCase() === 'true';
  const artifacts = safeArtifacts(input.artifacts);

  return [
    '# Durable Draft CI summary',
    '',
    '| Field | Result |',
    '| --- | --- |',
    `| Commit SHA | \`${commitSha}\` |`,
    `| Environment | \`${environment}\` |`,
    `| Unit quality | \`${unitResult}\` |`,
    `| Build | \`${buildResult}\` |`,
    `| E2E | \`${e2eResult}\` |`,
    `| Pending V2 tests | \`${pendingCount}\` |`,
    `| Baseline tag | \`${baselineStatus}\` |`,
    `| No deploy performed | \`${noDeploy ? 'confirmed' : 'not-confirmed'}\` |`,
    '',
    '## Artifacts',
    '',
    ...(artifacts.length > 0
      ? artifacts.map((artifact) => `- \`${artifact}\``)
      : ['- `none`']),
  ].join('\n');
};

export const runCiSummary = (env = process.env) => {
  const summary = buildCiSummary({
    artifacts: env.CI_SUMMARY_ARTIFACTS,
    baselineStatus: env.CI_SUMMARY_BASELINE_STATUS,
    buildResult: env.CI_SUMMARY_BUILD_RESULT,
    commitSha: env.CI_SUMMARY_COMMIT_SHA,
    e2eResult: env.CI_SUMMARY_E2E_RESULT,
    environment: env.CI_SUMMARY_ENVIRONMENT,
    noDeploy: env.CI_SUMMARY_NO_DEPLOY,
    pendingCount: env.CI_SUMMARY_PENDING_COUNT,
    unitResult: env.CI_SUMMARY_UNIT_RESULT,
  });
  const outputPath = String(env.GITHUB_STEP_SUMMARY || '').trim();

  if (outputPath) {
    appendFileSync(outputPath, `${summary}\n`, 'utf8');
  } else {
    process.stdout.write(`${summary}\n`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runCiSummary();
}
