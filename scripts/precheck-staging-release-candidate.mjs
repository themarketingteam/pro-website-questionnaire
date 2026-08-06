#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFrontendRuntimeConfig } from '../src/lib/proDraftRuntimeConfig.js';
import {
  evaluateReleaseCandidateState,
  extractCandidateCommit,
  extractCertificationClassification,
  sha256,
} from './lib/staging-release-candidate.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_BASELINE = '27ddc347d55db00796a0e3e19ac343245519b01e';
const SAFE_OUTPUT = /^\.durable-draft-artifacts\/[A-Za-z0-9._/-]+\.json$/u;

const git = (args) => spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
const commandPassed = (executable, args) => spawnSync(executable, args, {
  cwd: repositoryRoot,
  encoding: 'utf8',
  stdio: 'pipe',
}).status === 0;

const parseArguments = (argv) => {
  const options = {
    config: 'config/durable-draft-staging-release-candidate.json',
    output: '.durable-draft-artifacts/staging-rc/precheck.json',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--config', '--output'].includes(flag)) throw new Error('RC_PRECHECK_ARGUMENT_INVALID');
    const value = argv[++index];
    if (!value) throw new Error('RC_PRECHECK_ARGUMENT_VALUE_MISSING');
    options[flag.slice(2)] = value;
  }
  if (!SAFE_OUTPUT.test(options.output)) throw new Error('RC_PRECHECK_OUTPUT_UNSAFE');
  return options;
};

const approvedCommit = (candidate, current) => {
  if (!candidate) return false;
  if (candidate === current) return true;
  return git(['merge-base', '--is-ancestor', candidate, current]).status === 0;
};

const checksumForReport = async (absolutePath, content) => {
  const sidecar = `${absolutePath}.sha256`;
  if (!existsSync(sidecar)) return false;
  const expected = (await readFile(sidecar, 'utf8')).trim().split(/\s+/u)[0];
  return /^[a-f0-9]{64}$/u.test(expected) && expected === sha256(content);
};

const reportsFrom = async (config, currentCommit) => Promise.all(
  config.requiredCertificationReports.map(async (required) => {
    const absolute = path.resolve(repositoryRoot, required.path);
    if (!existsSync(absolute)) return Object.freeze({ id: required.id, exists: false });
    const content = await readFile(absolute, 'utf8');
    const commitSha = extractCandidateCommit(content);
    return Object.freeze({
      checksum: sha256(content),
      checksumVerified: await checksumForReport(absolute, content),
      classification: extractCertificationClassification(content),
      commitApproved: approvedCommit(commitSha, currentCommit),
      commitSha,
      exists: true,
      id: required.id,
      path: required.path,
    });
  }),
);

const coverageFrom = async (config, outputDirectory) => {
  const directory = path.join(outputDirectory, 'coverage');
  const result = spawnSync(process.execPath, [
    'scripts/validate-release-test-coverage.mjs',
    '--phase', config.requiredPhase,
    '--output-dir', path.relative(repositoryRoot, directory),
  ], { cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe' });
  const reportPath = path.join(directory, 'release-test-coverage.json');
  if (!existsSync(reportPath)) return { ok: false, pendingRequirementIds: [] };
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  return {
    ok: result.status === 0 && report.ok === true,
    pendingRequirementIds: (report.coverage || []).filter((entry) => entry.pending).map((entry) => entry.id),
  };
};

const browserProjectsFrom = (reports) => {
  const projectPatterns = {
    'chromium-desktop': /chromium(?:-desktop| desktop)[^\n|]*(?:PASS|PASSED)/iu,
    'firefox-desktop': /firefox(?:-desktop| desktop)[^\n|]*(?:PASS|PASSED)/iu,
    'webkit-desktop': /webkit(?:-desktop| desktop)[^\n|]*(?:PASS|PASSED)/iu,
    'mobile-chromium': /mobile chromium[^\n|]*(?:PASS|PASSED)/iu,
    'mobile-webkit': /mobile webkit[^\n|]*(?:PASS|PASSED)/iu,
  };
  const text = reports.map((report) => report.content || '').join('\n');
  return Object.entries(projectPatterns).filter(([, pattern]) => pattern.test(text)).map(([project]) => project);
};

const reportContents = async (reports) => Promise.all(reports.filter((report) => report.exists).map(async (report) => ({
  ...report,
  content: await readFile(path.resolve(repositoryRoot, report.path), 'utf8'),
})));

const securityVerdictsFrom = (reports) => {
  const classifications = new Set(reports.map(({ classification }) => classification));
  return [
    classifications.has('SECURITY_PRIMITIVES_CERTIFIED_IN_STAGING') && 'SECURITY_CERTIFIED_IN_STAGING',
    classifications.has('DRAFT_RLS_CERTIFIED_IN_STAGING') && 'RLS_CERTIFIED_IN_STAGING',
    classifications.has('PASSWORD_ONLY_ADMIN_RECOVERY_CERTIFIED_IN_STAGING') && 'ADMIN_RECOVERY_CERTIFIED_IN_STAGING',
    classifications.has('PUBLIC_RECOVERY_SERVICES_CERTIFIED_IN_STAGING') && 'PUBLIC_RECOVERY_CERTIFIED_IN_STAGING',
  ].filter(Boolean);
};

const criticalDefectsFrom = (text) => String(text).split(/^## /mu).filter((section) => (
  /\*\*Severity:\*\* (?:High|Critical)/u.test(section)
  && !/\*\*Remediation status:\*\*[^\n]*(?:certified|resolved)/iu.test(section)
)).map((section) => section.match(/DRAFT-\d+/u)?.[0] || 'UNNAMED_DEFECT');

const criticalRisksFrom = (text) => String(text).split('\n').filter((line) => (
  /^\| `RISK-\d+`/u.test(line) && /\| Critical \|/u.test(line) && !/\| Accepted(?: \||$)/iu.test(line)
)).map((line) => line.match(/RISK-\d+/u)?.[0] || 'UNNAMED_RISK');

export const runStagingReleaseCandidatePrecheck = async (options = parseArguments(process.argv.slice(2))) => {
  const config = JSON.parse(await readFile(path.resolve(repositoryRoot, options.config), 'utf8'));
  const currentCommit = git(['rev-parse', 'HEAD']).stdout.trim();
  const branch = git(['branch', '--show-current']).stdout.trim();
  const reports = await reportsFrom(config, currentCommit);
  const reportsWithContent = await reportContents(reports);
  const outputPath = path.resolve(repositoryRoot, options.output);
  const outputDirectory = path.dirname(outputPath);
  const [coverage, defectText, riskText, workflows] = await Promise.all([
    coverageFrom(config, outputDirectory),
    readFile(path.join(repositoryRoot, 'docs/durable-draft-recovery/audit/current-defect-register.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs/durable-draft-recovery/release/risk-register.md'), 'utf8'),
    readdir(path.join(repositoryRoot, '.github/workflows')),
  ]);
  const workflowContents = (await Promise.all(workflows.map((name) => readFile(path.join(repositoryRoot, '.github/workflows', name), 'utf8')))).join('\n');
  const featureFlags = Object.fromEntries([
    ...Object.keys(config.requiredFeatureFlags || {}),
    ...Object.keys(config.forbiddenFeatureFlags || {}),
  ].map((name) => [name, process.env[name] === 'true']));
  const defaultRuntime = getFrontendRuntimeConfig({});
  const result = evaluateReleaseCandidateState({
    backupVerified: git(['rev-parse', 'backup/pre-durable-draft-recovery-2026-08-05']).stdout.trim() === EXPECTED_BASELINE,
    baselineVerified: git(['rev-parse', 'pre-durable-draft-recovery-2026-08-05^{commit}']).stdout.trim() === EXPECTED_BASELINE,
    branch,
    browserProjects: browserProjectsFrom(reportsWithContent),
    buildBundleSafe: existsSync(path.join(repositoryRoot, 'dist'))
      && commandPassed(process.execPath, ['scripts/validate-sensitive-entity-access.mjs', '--built-only']),
    cleanupVerdict: reportsWithContent.some(({ content }) => /CLEANUP_VERIFIED_ZERO/u.test(content)) ? 'CLEANUP_VERIFIED_ZERO' : 'CLEANUP_NOT_VERIFIED',
    config,
    coverage,
    currentCommit,
    directEntitySafe: commandPassed(process.execPath, ['scripts/validate-sensitive-entity-access.mjs', '--source-only'])
      && commandPassed(process.execPath, ['scripts/validate-sensitive-function-service-role.mjs'])
      && commandPassed(process.execPath, ['scripts/validate-admin-recovery-no-direct-entity-access.mjs']),
    featureFlags,
    manualEvidence: config.requiredManualEvidence,
    migrationVerdict: reports.find(({ id }) => id === 'migration-utility')?.classification || 'MIGRATION_NOT_VERIFIED',
    noProductionDeploymentWorkflow: !/\b(?:npx base44 deploy|deploy:base44:production)\b/iu.test(workflowContents),
    performanceVerdict: reportsWithContent.some(({ content }) => /PERFORMANCE_THRESHOLDS_PASSED/u.test(content))
      ? 'PERFORMANCE_THRESHOLDS_PASSED' : 'PERFORMANCE_NOT_VERIFIED',
    productionDefaultsDisabled: defaultRuntime.durableDraftV2Enabled === false
      && defaultRuntime.publicEmailRecoveryEnabled === false
      && defaultRuntime.emailOtpEnabled === false
      && defaultRuntime.magicLinkEnabled === false,
    reports,
    securityVerdicts: securityVerdictsFrom(reports),
    sourceSecretsSafe: commandPassed(process.execPath, [
      'scripts/scan-ci-source-safety.mjs', '--base', 'pre-durable-draft-recovery-2026-08-05', '--head', 'HEAD',
    ]),
    unresolvedCriticalDefects: criticalDefectsFrom(defectText),
    unresolvedCriticalRisks: criticalRisksFrom(riskText),
    workingTreeClean: git(['status', '--porcelain']).stdout.trim() === '',
  });
  const report = {
    version: 1,
    checkedAt: new Date().toISOString(),
    commitSha: currentCommit,
    environment: config.requiredEnvironment,
    failures: result.failures,
    reportChecksums: reports.filter(({ exists }) => exists).map(({ checksum, checksumVerified, id }) => ({ checksum, checksumVerified, id })),
    verdict: result.verdict,
  };
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const report = await runStagingReleaseCandidatePrecheck();
    process.stdout.write(`rc_precheck_verdict=${report.verdict}\nrc_precheck_failures=${report.failures.length}\n`);
    if (report.verdict !== 'PASS') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.message || 'RC_PRECHECK_FAILED'}\n`);
    process.exitCode = 2;
  }
}
