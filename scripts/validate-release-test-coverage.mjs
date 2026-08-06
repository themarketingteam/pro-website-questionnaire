#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIREMENT_ID = /\bDR-[A-Z0-9-]+\b/g;
const TEST_ID = /\b(?:UT|IT|BT)-[A-Z0-9-]+\b/g;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP = /\b(?:test|it|describe)\s*\.\s*(?:skip|fixme|todo)|\b(?:test|it)\s*\.\s*skipIf\b/;

const walk = async (directory) => {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'dist', 'node_modules', 'playwright-report', 'test-results'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
};

const parseArguments = (argv) => {
  const options = {
    acceptancePath: 'docs/durable-draft-recovery/release/production-acceptance-criteria.md',
    matrixPath: 'docs/durable-draft-recovery/release/requirements-traceability-matrix.md',
    outputDir: '.durable-draft-artifacts/coverage',
    phase: 'source_foundation',
    phaseModelPath: 'config/durable-draft-release-phases.json',
    resultsDir: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--phase' || argument === '--output-dir' || argument === '--results-dir'
      || argument === '--matrix' || argument === '--acceptance' || argument === '--phase-model') {
      const value = argv[index + 1];
      if (!value) throw new Error('COVERAGE_ARGUMENT_VALUE_MISSING');
      index += 1;
      const key = {
        '--acceptance': 'acceptancePath',
        '--matrix': 'matrixPath',
        '--output-dir': 'outputDir',
        '--phase': 'phase',
        '--phase-model': 'phaseModelPath',
        '--results-dir': 'resultsDir',
      }[argument];
      options[key] = value;
    } else if (argument.startsWith('--')) {
      const [flag, value] = argument.split('=', 2);
      if (!value) throw new Error('COVERAGE_ARGUMENT_INVALID');
      const key = {
        '--acceptance': 'acceptancePath',
        '--matrix': 'matrixPath',
        '--output-dir': 'outputDir',
        '--phase': 'phase',
        '--phase-model': 'phaseModelPath',
        '--results-dir': 'resultsDir',
      }[flag];
      if (!key) throw new Error('COVERAGE_ARGUMENT_INVALID');
      options[key] = value;
    } else throw new Error('COVERAGE_ARGUMENT_INVALID');
  }
  return options;
};

export const parseTraceabilityMatrix = (markdown) => {
  const requirements = [];
  for (const line of String(markdown).split('\n')) {
    if (!/^\|\s*`DR-[A-Z0-9-]+`\s*\|/.test(line)) continue;
    const fields = line.split('|').slice(1, -1).map((field) => field.trim());
    const id = fields[0].replaceAll('`', '');
    requirements.push({
      id,
      description: fields[1] || '',
      sourceReferences: fields[4] || '',
      testIds: [...new Set([fields[5], fields[6], fields[7]].flatMap((field) => field?.match(TEST_ID) || []))],
      stagingEvidence: fields[8] || '',
      releaseBlocking: /yes/i.test(fields[11] || ''),
      status: fields[12] || '',
      raw: line,
    });
  }
  return requirements;
};

const categoryOf = (requirement) => {
  const id = requirement.id;
  const text = `${requirement.description} ${requirement.stagingEvidence}`.toLowerCase();
  if (/^DR-(SEC|RLS|ADMIN|ABUSE|CRYPTO|AUTH)-/.test(id)) return 'security';
  if (/^DR-(PERF|CAP)-/.test(id)) return 'capacity';
  if (/^DR-MIG/.test(id)) return 'migration';
  if (/green/.test(text)) return 'green';
  if (/cutover|domain/.test(text)) return 'cutover';
  if (/post.?cutover/.test(text)) return 'post_cutover';
  if (/production.enabled/.test(text)) return 'production_enabled';
  if (/production/.test(text)) return 'production';
  return 'staging';
};

const isPending = (status) => !/(?:certified|locally passed|tested|satisfied)/i.test(status)
  || /pending|planned|blocked|failed|not ready/i.test(status);

const sourcePathsOf = (value) => [...String(value).matchAll(/`((?:src|scripts|tests|base44|config)\/[^`]+)`/g)]
  .map((match) => match[1].replace(/[;,]$/, ''));

const loadResults = async (resultsDir) => {
  if (!resultsDir || !existsSync(resultsDir)) return [];
  const files = (await walk(resultsDir)).filter((file) => file.endsWith('.json'));
  const output = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      const values = Array.isArray(parsed) ? parsed : parsed.results;
      if (Array.isArray(values)) output.push(...values);
    } catch {
      output.push({ status: 'failed', safeErrorCode: 'RESULT_JSON_INVALID' });
    }
  }
  return output;
};

export const validateReleaseTestCoverage = async ({
  acceptanceText,
  matrixText,
  phase,
  phaseModel,
  repository = repositoryRoot,
  results = [],
  testSources,
  certificationText = '',
}) => {
  const phaseConfig = phaseModel.phases?.[phase];
  if (!phaseConfig) throw new Error('RELEASE_PHASE_UNKNOWN');
  const requirements = parseTraceabilityMatrix(matrixText);
  const acceptanceIds = new Set(String(acceptanceText).match(REQUIREMENT_ID) || []);
  const patterns = phaseConfig.requiredRequirementIdPatterns.map((pattern) => new RegExp(pattern));
  const required = requirements.filter((requirement) => (
    requirement.releaseBlocking && patterns.some((pattern) => pattern.test(requirement.id))
  ));
  const files = testSources || (await Promise.all(
    (await walk(repository)).filter((file) => TEST_FILE.test(file)).map(async (file) => ({
      path: path.relative(repository, file).split(path.sep).join('/'),
      text: await readFile(file, 'utf8'),
    })),
  ));
  const failures = [];
  const warnings = [];
  const coverage = [];

  for (const requirement of required) {
    const category = categoryOf(requirement);
    const pending = isPending(requirement.status);
    const pendingAllowed = phaseConfig.allowedPendingRequirementCategories.includes(category);
    const identifiers = new Set([requirement.id, ...requirement.testIds]);
    const matchingFiles = files.filter((file) => [...identifiers].some((id) => file.text.includes(id)));
    const skippedFiles = matchingFiles.filter((file) => file.text.split('\n').some((line) => (
      SKIP.test(line) && [...identifiers].some((id) => line.includes(id))
    )));
    const stalePaths = sourcePathsOf(requirement.sourceReferences).filter((file) => !existsSync(path.join(repository, file)));
    const certified = /certified/i.test(requirement.status);
    const hasEvidence = requirement.stagingEvidence.match(/EV-[A-Z0-9-]+/g)?.some((id) => certificationText.includes(id));

    if (matchingFiles.length === 0 && !(pending && pendingAllowed)) failures.push(`MISSING_REQUIRED_TEST:${requirement.id}`);
    if (skippedFiles.length > 0 && !(pending && pendingAllowed)) failures.push(`SKIPPED_REQUIRED_TEST:${requirement.id}`);
    if (stalePaths.length > 0 && !(pending && pendingAllowed)) failures.push(`STALE_SOURCE_REFERENCE:${requirement.id}`);
    if (certified && !hasEvidence) failures.push(`CERTIFIED_WITHOUT_EVIDENCE:${requirement.id}`);
    if (phase === 'staging_security' && category === 'security' && pending) failures.push(`SECURITY_REQUIREMENT_PENDING:${requirement.id}`);
    if (pending && !pendingAllowed) failures.push(`REQUIRED_REQUIREMENT_PENDING:${requirement.id}`);
    if (pending && pendingAllowed) warnings.push(`PHASE_PENDING_ALLOWED:${requirement.id}:${category}`);

    coverage.push({
      category,
      id: requirement.id,
      matchingTestFiles: matchingFiles.map((file) => file.path).sort(),
      pending,
      pendingAllowed,
      skippedTestFiles: skippedFiles.map((file) => file.path).sort(),
      stalePaths,
      status: requirement.status,
      testIds: requirement.testIds,
    });
  }

  for (const id of acceptanceIds) {
    if (!requirements.some((requirement) => requirement.id === id)) failures.push(`ACCEPTANCE_REQUIREMENT_MISSING_FROM_MATRIX:${id}`);
  }

  const passedResults = results.filter((result) => result.status === 'passed');
  for (const browser of phaseConfig.requiredBrowsers) {
    if (!passedResults.some((result) => result.browser === browser
      || result.browser === `${browser}-desktop`
      || result.browser?.startsWith(`${browser}-`))) failures.push(`REQUIRED_BROWSER_RESULT_MISSING:${browser}`);
  }
  for (const result of results) {
    if (result.status === 'skipped' && result.requirementIds?.some((id) => required.some((item) => item.id === id))) {
      failures.push(`REQUIRED_RESULT_SKIPPED:${result.testId || 'UNKNOWN'}`);
    }
    if (result.status === 'failed' && result.requirementIds?.some((id) => /^DR-(SEC|RLS|ADMIN|ABUSE|CRYPTO)-/.test(id))) {
      failures.push(`SECURITY_BOUNDARY_FAILED:${result.testId || 'UNKNOWN'}`);
    }
  }

  return {
    coverage,
    failures: [...new Set(failures)].sort(),
    generatedAt: new Date().toISOString(),
    ok: failures.length === 0,
    phase,
    requiredBrowsers: phaseConfig.requiredBrowsers,
    requiredRequirementCount: required.length,
    warnings: [...new Set(warnings)].sort(),
  };
};

const formatText = (report) => [
  `release_phase=${report.phase}`,
  `required_requirements=${report.requiredRequirementCount}`,
  `failures=${report.failures.length}`,
  `warnings=${report.warnings.length}`,
  `status=${report.ok ? 'PASS' : 'FAIL'}`,
  ...report.failures.map((failure) => `FAIL ${failure}`),
  ...report.warnings.map((warning) => `WARN ${warning}`),
  '',
].join('\n');

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const absolute = (value) => path.resolve(repositoryRoot, value);
    const [matrixText, acceptanceText, phaseModel, resultValues, certificationFiles] = await Promise.all([
      readFile(absolute(options.matrixPath), 'utf8'),
      readFile(absolute(options.acceptancePath), 'utf8'),
      readFile(absolute(options.phaseModelPath), 'utf8').then(JSON.parse),
      loadResults(options.resultsDir ? absolute(options.resultsDir) : ''),
      walk(path.join(repositoryRoot, 'docs', 'durable-draft-recovery')),
    ]);
    const certificationText = (await Promise.all(
      certificationFiles.filter((file) => file.endsWith('.md')).map((file) => readFile(file, 'utf8')),
    )).join('\n');
    const report = await validateReleaseTestCoverage({
      acceptanceText,
      certificationText,
      matrixText,
      phase: options.phase,
      phaseModel,
      results: resultValues,
    });
    const outputDir = absolute(options.outputDir);
    await mkdir(outputDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(outputDir, 'release-test-coverage.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
      writeFile(path.join(outputDir, 'release-test-coverage.txt'), formatText(report), { mode: 0o600 }),
    ]);
    process.stdout.write(formatText(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.message || 'COVERAGE_VALIDATION_FAILED'}\n`);
    process.exitCode = 2;
  }
}
