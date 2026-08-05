import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const defaultDraftV2Directory = path.join(repositoryRoot, 'tests/e2e/draft-v2');
const pendingPattern = /test\.(skip|fixme)\(\s*true\s*,\s*(['"`])\[(DR-[A-Z0-9-]+)\]\s+([^'"`\r\n]+)\2\s*\)/g;
const anyPendingCallPattern = /test\.(?:skip|fixme)\(/g;

const lineNumberAt = (source, index) => source.slice(0, index).split('\n').length;

export const scanPendingDraftV2Tests = (
  draftV2Directory = defaultDraftV2Directory,
) => {
  if (!existsSync(draftV2Directory)) {
    throw new Error('MISSING_DRAFT_V2_TEST_DIRECTORY');
  }

  const files = readdirSync(draftV2Directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.js'))
    .map((entry) => path.join(draftV2Directory, entry.name))
    .sort();
  const pendingTests = [];
  const malformed = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const relativeFile = path.relative(repositoryRoot, file).split(path.sep).join('/');
    const matches = [...source.matchAll(pendingPattern)];
    const allCalls = [...source.matchAll(anyPendingCallPattern)];

    if (matches.length !== allCalls.length) {
      malformed.push({
        file: relativeFile,
        matchedCalls: matches.length,
        pendingCalls: allCalls.length,
      });
    }

    for (const match of matches) {
      pendingTests.push({
        file: relativeFile,
        line: lineNumberAt(source, match.index),
        mechanism: match[1],
        reason: match[4].trim(),
        requirementId: match[3],
      });
    }
  }

  if (malformed.length > 0) {
    throw new Error(`MALFORMED_PENDING_DRAFT_V2_TESTS:${JSON.stringify(malformed)}`);
  }

  const requirementIds = [...new Set(
    pendingTests.map((test) => test.requirementId),
  )].sort();

  return {
    files: files.map((file) => path.relative(repositoryRoot, file).split(path.sep).join('/')),
    pendingCount: pendingTests.length,
    pendingTests,
    requirementIds,
    status: pendingTests.length > 0 ? 'FOUNDATION_PENDING_ALLOWED' : 'NO_PENDING_TESTS',
  };
};

export const formatPendingDraftV2Text = (report) => {
  const lines = [
    `status=${report.status}`,
    `pending_draft_v2_tests=${report.pendingCount}`,
    `requirement_ids=${report.requirementIds.join(',') || 'none'}`,
  ];

  for (const pendingTest of report.pendingTests) {
    lines.push(
      `${pendingTest.requirementId} ${pendingTest.mechanism} ${pendingTest.file}:${pendingTest.line} ${pendingTest.reason}`,
    );
  }
  return lines.join('\n');
};

const parseArguments = (argumentsList) => {
  let failOnPending = false;
  let format = 'both';

  for (const argument of argumentsList) {
    if (argument === '--fail-on-pending') {
      failOnPending = true;
    } else if (argument.startsWith('--format=')) {
      format = argument.slice('--format='.length);
    } else {
      throw new Error(`UNKNOWN_PENDING_REPORT_ARGUMENT:${argument}`);
    }
  }
  if (!['both', 'json', 'text'].includes(format)) {
    throw new Error(`INVALID_PENDING_REPORT_FORMAT:${format}`);
  }
  return { failOnPending, format };
};

export const runPendingDraftV2Report = (argumentsList = []) => {
  const { failOnPending, format } = parseArguments(argumentsList);
  const scannedReport = scanPendingDraftV2Tests();
  const report = failOnPending && scannedReport.pendingCount > 0
    ? { ...scannedReport, status: 'PENDING_TESTS_BLOCK_RELEASE' }
    : scannedReport;

  if (format === 'text' || format === 'both') {
    console.log(formatPendingDraftV2Text(report));
  }
  if (format === 'json' || format === 'both') {
    console.log(JSON.stringify(report, null, 2));
  }

  return failOnPending && scannedReport.pendingCount > 0 ? 1 : 0;
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = runPendingDraftV2Report(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PENDING_REPORT_FAILED');
    process.exitCode = 2;
  }
}
