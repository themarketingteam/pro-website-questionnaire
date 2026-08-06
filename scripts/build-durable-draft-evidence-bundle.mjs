#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeEvidenceValue } from './lib/normalize-test-results.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_ARTIFACT = /(storage.?state|trace\.zip|\.har$|recovery.?code|screenshot)/i;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(sanitizeEvidenceValue(value), null, 2)}\n`;

const safeArtifactPaths = (results) => [...new Set(results.flatMap((result) => (
  result.artifactPaths || []
)).filter((artifact) => !RAW_ARTIFACT.test(artifact)))].sort();

const byRequirement = (results) => Object.fromEntries([...new Set(
  results.flatMap((result) => result.requirementIds || []),
)].sort().map((requirementId) => [requirementId, results.filter((result) => (
  result.requirementIds?.includes(requirementId)
)).map((result) => ({ status: result.status, testId: result.testId }))]));

const byBrowser = (results) => Object.fromEntries([...new Set(
  results.map((result) => result.browser).filter(Boolean),
)].sort().map((browser) => [browser, {
  failed: results.filter((result) => result.browser === browser && result.status === 'failed').length,
  passed: results.filter((result) => result.browser === browser && result.status === 'passed').length,
  skipped: results.filter((result) => result.browser === browser && result.status === 'skipped').length,
} ]));

const summaryFor = (results, matcher) => ({
  blocked: results.filter((result) => matcher(result) && result.status === 'blocked').length,
  failed: results.filter((result) => matcher(result) && result.status === 'failed').length,
  passed: results.filter((result) => matcher(result) && result.status === 'passed').length,
  skipped: results.filter((result) => matcher(result) && result.status === 'skipped').length,
});

export const createEvidenceBundleFiles = ({ commitSha, environment, phase, results, testRunId }) => {
  const safeResults = sanitizeEvidenceValue(results).map((result) => ({
    artifactPaths: (result.artifactPaths || []).filter((artifact) => !RAW_ARTIFACT.test(artifact)),
    browser: result.browser || null,
    commitSha: String(result.commitSha || commitSha || 'unknown'),
    durationMs: Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : 0,
    environment: String(result.environment || environment || 'unknown'),
    phase: String(result.phase || phase || 'unknown'),
    requirementIds: Array.isArray(result.requirementIds) ? result.requirementIds : [],
    safeErrorCode: result.safeErrorCode || null,
    status: String(result.status || 'unknown'),
    testId: String(result.testId || 'UNNAMED_TEST'),
    timestamp: String(result.timestamp || 'unknown'),
  }));
  const status = safeResults.length === 0
    ? 'INCOMPLETE'
    : safeResults.some((result) => ['failed', 'blocked'].includes(result.status))
      ? 'FAILED'
      : safeResults.some((result) => !['passed'].includes(result.status)) ? 'INCOMPLETE' : 'PASSED';
  const generatedAt = new Date().toISOString();
  const files = {
    'requirements.json': json({ requirements: byRequirement(safeResults) }),
    'browser-matrix.json': json({ browsers: byBrowser(safeResults) }),
    'security-summary.json': json(summaryFor(safeResults, (result) => result.requirementIds?.some((id) => /^DR-(SEC|RLS|ADMIN|ABUSE|CRYPTO)-/.test(id)))),
    'performance-summary.json': json(summaryFor(safeResults, (result) => result.requirementIds?.some((id) => /^DR-(PERF|CAP)-/.test(id)))),
    'migration-summary.json': json(summaryFor(safeResults, (result) => result.requirementIds?.some((id) => /^DR-MIG/.test(id)))),
    'cleanup-summary.json': json(summaryFor(safeResults, (result) => /cleanup/i.test(result.testId))),
  };
  files['manifest.json'] = json({
    artifactPaths: safeArtifactPaths(safeResults),
    commitSha,
    environment,
    generatedAt,
    phase,
    signed: false,
    status,
    testRunId,
    totalResults: safeResults.length,
  });
  files['summary.md'] = [
    '# Durable draft release evidence',
    '',
    `- Phase: \`${phase}\``,
    `- Environment: \`${environment}\``,
    `- Commit: \`${commitSha}\``,
    `- Test run: \`${testRunId}\``,
    `- Status: **${status}**`,
    `- Normalized results: ${safeResults.length}`,
    '',
    'Raw developer artifacts remain protected locally and are not copied into this bundle.',
    'Deployment success is not a release verdict.',
    '',
  ].join('\n');
  return { files, status };
};

export const writeEvidenceBundle = async (options) => {
  const outputDir = path.resolve(options.outputDir);
  const { files, status } = createEvidenceBundleFiles(options);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  for (const [fileName, content] of Object.entries(files)) {
    await writeFile(path.join(outputDir, fileName), content, { mode: 0o600 });
  }
  const checksums = Object.entries(files).sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, content]) => `${sha256(content)}  ${fileName}`)
    .join('\n');
  await writeFile(path.join(outputDir, 'checksums.sha256'), `${checksums}\n`, { mode: 0o600 });
  return { checksums, fileNames: [...Object.keys(files), 'checksums.sha256'], status };
};

const parseArguments = (argv) => {
  const options = {
    commitSha: process.env.GITHUB_SHA || 'unknown',
    environment: 'local',
    inputDir: '.durable-draft-artifacts/results',
    outputDir: '.durable-draft-artifacts/evidence',
    phase: 'source_foundation',
    testRunId: 'release-test-run-0001',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [rawFlag, inlineValue] = argv[index].split('=', 2);
    const key = {
      '--commit-sha': 'commitSha',
      '--environment': 'environment',
      '--input-dir': 'inputDir',
      '--output-dir': 'outputDir',
      '--phase': 'phase',
      '--test-run-id': 'testRunId',
    }[rawFlag];
    if (!key) throw new Error('EVIDENCE_ARGUMENT_INVALID');
    const value = inlineValue || argv[++index];
    if (!value) throw new Error('EVIDENCE_ARGUMENT_VALUE_MISSING');
    options[key] = value;
  }
  return options;
};

const readResults = async (directory) => {
  if (!existsSync(directory)) return [];
  const results = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const parsed = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    const values = Array.isArray(parsed) ? parsed : parsed.results;
    if (Array.isArray(values)) results.push(...values);
  }
  return results;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const results = await readResults(path.resolve(repositoryRoot, options.inputDir));
    const written = await writeEvidenceBundle({
      ...options,
      outputDir: path.resolve(repositoryRoot, options.outputDir),
      results,
    });
    process.stdout.write(`evidence_status=${written.status}\nevidence_files=${written.fileNames.length}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message || 'EVIDENCE_BUILD_FAILED'}\n`);
    process.exitCode = 1;
  }
}
