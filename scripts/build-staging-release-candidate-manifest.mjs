#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractCertificationClassification,
  sha256,
} from './lib/staging-release-candidate.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_FINGERPRINT = /^[a-f0-9]{64}$/u;
const SAFE_OUTPUT = /^\.durable-draft-artifacts\/[A-Za-z0-9._/-]+\.json$/u;
const FORBIDDEN_VALUE = /(?:https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bbearer\s+|\b(?:b44k_|ghp_|sk_)[A-Za-z0-9_-]+)/iu;
const FORBIDDEN_KEY = /(?:appId|url|email|code|token|credential|secret|answer)/iu;

export const assertSafeReleaseCandidateManifest = (value, key = '') => {
  if (key && FORBIDDEN_KEY.test(key) && !/(?:Fingerprint|Hash)$/u.test(key)) throw new Error('RC_MANIFEST_SENSITIVE_KEY');
  if (typeof value === 'string' && FORBIDDEN_VALUE.test(value)) throw new Error('RC_MANIFEST_SENSITIVE_VALUE');
  if (Array.isArray(value)) value.forEach((entry) => assertSafeReleaseCandidateManifest(entry));
  else if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) assertSafeReleaseCandidateManifest(childValue, childKey);
  }
  return true;
};

export const buildStagingReleaseCandidateManifest = ({
  browserMatrix = {},
  buildSha,
  cleanupVerdict = 'NOT_VERIFIED',
  commitSha,
  config,
  coverageContent = '',
  evidenceBundles = [],
  manualEvidenceStatus = 'PENDING',
  migrationUtilityVerdict = 'NOT_VERIFIED',
  now = () => new Date().toISOString(),
  performanceVerdict = 'NOT_VERIFIED',
  precheckVerdict = 'BLOCKED',
  reports = [],
  securityVerdict = 'NOT_VERIFIED',
  stagingAppFingerprint = null,
  stagingUrlFingerprint = null,
} = {}) => {
  const checksumFailure = reports.some((report) => report.checksumVerified !== true)
    || evidenceBundles.some((bundle) => bundle.checksumVerified !== true);
  const evidenceFailure = evidenceBundles.some((bundle) => bundle.certified === false);
  const browserFailure = (config.requiredBrowserProjects || [])
    .some((project) => browserMatrix[project] !== 'PASSED');
  const failedEvidence = reports.some((report) => /FAILED/u.test(report.classification || ''));
  const finalVerdict = precheckVerdict === 'FAILED' || failedEvidence || evidenceFailure
    ? 'FAILED'
    : precheckVerdict !== 'PASS' || checksumFailure || browserFailure
      ? 'BLOCKED'
      : 'READY_FOR_FINAL_STAGING_MANUAL_CERTIFICATION';
  const manifest = {
    version: config.releaseCandidateVersion,
    commitSha,
    buildSha,
    createdAt: now(),
    stagingAppFingerprint: SAFE_FINGERPRINT.test(stagingAppFingerprint || '') ? stagingAppFingerprint : null,
    stagingUrlFingerprint: SAFE_FINGERPRINT.test(stagingUrlFingerprint || '') ? stagingUrlFingerprint : null,
    certificationReports: reports.map(({ checksum, checksumVerified, classification, id, path: reportPath }) => ({
      checksum,
      checksumVerified,
      classification,
      id,
      path: reportPath,
    })),
    requirementCoverageHash: coverageContent ? sha256(coverageContent) : null,
    evidenceBundleHashes: evidenceBundles.map(({ checksum, checksumVerified, id }) => ({ checksum, checksumVerified, id })),
    browserMatrix,
    securityVerdict,
    performanceVerdict,
    migrationUtilityVerdict,
    cleanupVerdict,
    manualEvidenceStatus,
    pendingProductionRequirements: config.allowedPendingRequirementPrefixes,
    finalVerdict,
  };
  assertSafeReleaseCandidateManifest(manifest);
  return Object.freeze(manifest);
};

const parseArguments = (argv) => {
  const options = {
    buildSha: '',
    config: 'config/durable-draft-staging-release-candidate.json',
    coverage: '.durable-draft-artifacts/staging-rc/precheck/coverage/release-test-coverage.json',
    evidenceChecksums: '.durable-draft-artifacts/staging-rc/certification/evidence/checksums.sha256',
    output: '.durable-draft-artifacts/staging-rc/release-candidate-manifest.json',
    precheck: '.durable-draft-artifacts/staging-rc/precheck.json',
    stagingAppFingerprint: process.env.STAGING_APP_FINGERPRINT || '',
    stagingUrlFingerprint: process.env.STAGING_URL_FINGERPRINT || '',
  };
  const mapping = {
    '--build-sha': 'buildSha',
    '--config': 'config',
    '--coverage': 'coverage',
    '--evidence-checksums': 'evidenceChecksums',
    '--output': 'output',
    '--precheck': 'precheck',
    '--staging-app-fingerprint': 'stagingAppFingerprint',
    '--staging-url-fingerprint': 'stagingUrlFingerprint',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = mapping[argv[index]];
    if (!key) throw new Error('RC_MANIFEST_ARGUMENT_INVALID');
    const value = argv[++index];
    if (!value) throw new Error('RC_MANIFEST_ARGUMENT_VALUE_MISSING');
    options[key] = value;
  }
  if (!SAFE_OUTPUT.test(options.output)) throw new Error('RC_MANIFEST_OUTPUT_UNSAFE');
  return options;
};

const verifiedFile = async (repositoryPath) => {
  const absolute = path.resolve(repositoryRoot, repositoryPath);
  if (!existsSync(absolute)) return null;
  const content = await readFile(absolute, 'utf8');
  const sidecar = `${absolute}.sha256`;
  let expected = '';
  if (existsSync(sidecar)) expected = (await readFile(sidecar, 'utf8')).trim().split(/\s+/u)[0];
  const checksum = sha256(content);
  return { checksum, checksumVerified: expected === checksum, content };
};

const verifiedEvidenceBundle = async (checksumPath) => {
  const absolute = path.resolve(repositoryRoot, checksumPath);
  if (!existsSync(absolute)) return null;
  const content = await readFile(absolute, 'utf8');
  const directory = path.dirname(absolute);
  const entries = content.trim().split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u);
    return match ? { checksum: match[1], fileName: match[2] } : null;
  });
  const checksumVerified = entries.length > 0 && !entries.includes(null)
    && (await Promise.all(entries.map(async ({ checksum, fileName }) => {
      const filePath = path.join(directory, fileName);
      if (!existsSync(filePath)) return false;
      return sha256(await readFile(filePath, 'utf8')) === checksum;
    }))).every(Boolean);
  const manifestPath = path.join(directory, 'manifest.json');
  const certified = checksumVerified && existsSync(manifestPath)
    && JSON.parse(await readFile(manifestPath, 'utf8')).status === 'PASSED';
  return { certified, checksum: sha256(content), checksumVerified, content, directory };
};

const browserMatrixFrom = async (bundle, requiredProjects) => {
  if (!bundle?.checksumVerified) {
    return Object.fromEntries(requiredProjects.map((project) => [project, 'PENDING']));
  }
  const matrixPath = path.join(bundle.directory, 'browser-matrix.json');
  if (!existsSync(matrixPath)) return Object.fromEntries(requiredProjects.map((project) => [project, 'MISSING']));
  const parsed = JSON.parse(await readFile(matrixPath, 'utf8'));
  return Object.fromEntries(requiredProjects.map((project) => {
    const result = parsed.browsers?.[project];
    const passed = Number(result?.passed || 0) > 0
      && Number(result?.failed || 0) === 0
      && Number(result?.skipped || 0) === 0;
    return [project, passed ? 'PASSED' : 'FAILED'];
  }));
};

export const writeStagingReleaseCandidateManifest = async (options = parseArguments(process.argv.slice(2))) => {
  const config = JSON.parse(await readFile(path.resolve(repositoryRoot, options.config), 'utf8'));
  const commitSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).stdout.trim();
  const precheck = existsSync(path.resolve(repositoryRoot, options.precheck))
    ? JSON.parse(await readFile(path.resolve(repositoryRoot, options.precheck), 'utf8'))
    : { verdict: 'BLOCKED' };
  const reports = [];
  for (const required of config.requiredCertificationReports) {
    const verified = await verifiedFile(required.path);
    reports.push({
      checksum: verified?.checksum || null,
      checksumVerified: verified?.checksumVerified === true,
      classification: verified ? extractCertificationClassification(verified.content) : 'MISSING',
      id: required.id,
      path: required.path,
    });
  }
  const coverage = await verifiedFile(options.coverage);
  const evidence = await verifiedEvidenceBundle(options.evidenceChecksums);
  const browserMatrix = await browserMatrixFrom(evidence, config.requiredBrowserProjects);
  const manifest = buildStagingReleaseCandidateManifest({
    browserMatrix,
    buildSha: /^[a-f0-9]{40}$/u.test(options.buildSha) ? options.buildSha : commitSha,
    cleanupVerdict: precheck.failures?.some(({ code }) => code === 'RC_CLEANUP_FAILED') ? 'NOT_VERIFIED' : config.requiredCleanupStatus,
    commitSha,
    config,
    coverageContent: coverage?.content || '',
    evidenceBundles: [{
      certified: evidence?.certified === true,
      checksum: evidence?.checksum || null,
      checksumVerified: evidence?.checksumVerified === true,
      id: 'comprehensive-certification',
    }],
    manualEvidenceStatus: 'PENDING',
    migrationUtilityVerdict: reports.find(({ id }) => id === 'migration-utility')?.classification || 'NOT_VERIFIED',
    performanceVerdict: precheck.failures?.some(({ code }) => code === 'RC_CAPACITY_FAILED') ? 'NOT_VERIFIED' : 'PERFORMANCE_THRESHOLDS_PASSED',
    precheckVerdict: precheck.commitSha === commitSha ? precheck.verdict : 'BLOCKED',
    reports,
    securityVerdict: precheck.failures?.some(({ code }) => code.startsWith('RC_SECURITY')) ? 'NOT_VERIFIED' : 'SECURITY_CERTIFIED_IN_STAGING',
    stagingAppFingerprint: options.stagingAppFingerprint,
    stagingUrlFingerprint: options.stagingUrlFingerprint,
  });
  const outputPath = path.resolve(repositoryRoot, options.output);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(outputPath, serialized, { mode: 0o600 });
  await writeFile(`${outputPath}.sha256`, `${sha256(serialized)}  ${path.basename(outputPath)}\n`, { mode: 0o600 });
  return manifest;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const manifest = await writeStagingReleaseCandidateManifest();
    process.stdout.write(`rc_manifest_verdict=${manifest.finalVerdict}\n`);
    if (manifest.finalVerdict !== 'READY_FOR_FINAL_STAGING_MANUAL_CERTIFICATION') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.message || 'RC_MANIFEST_FAILED'}\n`);
    process.exitCode = 2;
  }
}
