#!/usr/bin/env node

import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_MIGRATION_ERROR_CODES,
  assertSafeLegacyMigrationReport,
  buildLegacyMigrationAnalysisReport,
  stableLegacySerialize,
} from '../base44/functions/_shared/proDraftLegacyMigration/legacyMigration.js';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const fixturePath = path.join(
  repositoryRoot,
  'src/test/fixtures/pro-draft-legacy-migration/corpus.json',
);

export function parseLegacyAnalysisArguments(args) {
  const options = { fixture: false, input: '', output: '', strict: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--fixture') options.fixture = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--input' || argument === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('LEGACY_ANALYSIS_ARGUMENT_REQUIRED');
      options[argument.slice(2)] = value;
      index += 1;
    } else throw new Error('LEGACY_ANALYSIS_ARGUMENT_INVALID');
  }
  if (options.fixture === Boolean(options.input)) {
    throw new Error('LEGACY_ANALYSIS_SOURCE_REQUIRED');
  }
  return Object.freeze(options);
}

function normalizeCorpus(value) {
  if (Array.isArray(value)) return { drafts: value, events: [] };
  if (!value || typeof value !== 'object' || !Array.isArray(value.drafts)
    || !Array.isArray(value.events || [])) {
    throw new Error(LEGACY_MIGRATION_ERROR_CODES.INVALID_INPUT);
  }
  return {
    drafts: value.drafts,
    events: value.events || [],
    batchId: typeof value.batchId === 'string' ? value.batchId : undefined,
    environment: typeof value.environment === 'string' ? value.environment : undefined,
    analyzedAt: typeof value.analyzedAt === 'string' ? value.analyzedAt : undefined,
  };
}

function buildSessionDraftMap(drafts) {
  const output = {};
  for (const draft of drafts) {
    if (typeof draft?.session_id !== 'string' || typeof draft?.id !== 'string') continue;
    if (!output[draft.session_id]) output[draft.session_id] = [];
    output[draft.session_id].push(draft.id);
  }
  return output;
}

function strictFailure(report) {
  return report.counts.criticalMalformed > 0
    || report.counts.unsupportedFuture > 0
    || report.duplicateGroups.some((group) => group.manualReview);
}

export async function runLegacyAnalysisCli(args = process.argv.slice(2), io = {}) {
  const stderr = io.stderr || process.stderr;
  const stdout = io.stdout || process.stdout;
  try {
    const options = parseLegacyAnalysisArguments(args);
    const sourcePath = options.fixture ? fixturePath : path.resolve(options.input);
    if (!options.fixture) {
      const sourceStat = await stat(sourcePath);
      if ((sourceStat.mode & 0o077) !== 0) stderr.write('INPUT_FILE_PERMISSIONS_TOO_OPEN\n');
    }
    const corpus = normalizeCorpus(JSON.parse(await readFile(sourcePath, 'utf8')));
    const report = await buildLegacyMigrationAnalysisReport({
      ...corpus,
      batchId: corpus.batchId || 'legacy-analysis',
      environment: corpus.environment || 'offline-input',
      analyzedAt: corpus.analyzedAt || new Date().toISOString(),
      sessionDraftMap: buildSessionDraftMap(corpus.drafts),
    });
    assertSafeLegacyMigrationReport(report, corpus.drafts);
    const serialized = `${stableLegacySerialize(report)}\n`;
    if (options.output) {
      const outputPath = path.resolve(options.output);
      await writeFile(outputPath, serialized, { encoding: 'utf8', mode: 0o600 });
      await chmod(outputPath, 0o600);
      stdout.write('LEGACY_ANALYSIS_REPORT_WRITTEN\n');
    } else stdout.write(serialized);
    if (options.strict && strictFailure(report)) {
      stderr.write('LEGACY_ANALYSIS_STRICT_FAILURE\n');
      return 2;
    }
    return 0;
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message : 'LEGACY_ANALYSIS_FAILED';
    stderr.write(`${code}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runLegacyAnalysisCli();
}
