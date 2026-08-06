#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_OUTPUT = /^\.durable-draft-artifacts\/[A-Za-z0-9._/-]+\.json$/u;
const PLACEHOLDER = /^(?:PENDING|NOT_RUN|UNAVAILABLE|N\/A|-)?$/iu;
const RESULT_VALUES = new Set(['PASS', 'FAIL', 'PENDING', 'NOT_RUN', 'UNAVAILABLE']);
const FORBIDDEN_QUERY_KEY = /(?:access.?token|recovery.?code|recovery.?session|admin.?grant|credential|password|secret)/iu;
const RAW_RECOVERY_CODE = /\b[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3,5}\b/u;
const PRODUCTION_HOST = /(?:^|\.)(?:forms\.mspsuccesswebsites\.com|production\.[A-Za-z0-9.-]+|prod\.[A-Za-z0-9.-]+)$/iu;

const ids = (prefix, values) => values.map((value) => `${prefix}${value}`);

export const EVIDENCE_CONTRACTS = Object.freeze({
  accessibility: Object.freeze({
    path: 'docs/durable-draft-recovery/testing/manual-accessibility-checklist.md',
    requiredIds: ids('A11Y-MAN-', Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(3, '0'))),
    requiredHeaders: ['ID', 'Check', 'Device / reader', 'Result', 'Tester', 'UTC timestamp', 'Evidence reference'],
  }),
  devices: Object.freeze({
    path: 'docs/durable-draft-recovery/testing/device-and-mail-link-certification-manifest.md',
    requiredIds: [
      'DEVICE-OUTLOOK-WIN', 'DEVICE-OUTLOOK-WEB', 'DEVICE-GMAIL-WEB', 'DEVICE-GMAIL-ANDROID',
      'DEVICE-GMAIL-IOS', 'DEVICE-TEAMS-DESKTOP', 'DEVICE-TEAMS-MOBILE', 'DEVICE-IOS-MAIL',
      'DEVICE-ANDROID-MAIL', 'DEVICE-SAFARI-IOS', 'DEVICE-CHROME-ANDROID',
    ],
    requiredHeaders: ['ID', 'Application / version', 'Device / OS', 'Link source', 'Resulting browser', 'Staging URL host', 'Opening modal shown', 'No query credential', 'Recovery flow usable', 'Copy code usable', 'PDF access', 'Result', 'Tester', 'UTC timestamp', 'Evidence reference'],
  }),
  email: Object.freeze({
    path: 'docs/durable-draft-recovery/testing/staging-email-client-rendering.md',
    requiredIds: ['EMAIL-GMAIL-WEB', 'EMAIL-OUTLOOK', 'EMAIL-IOS-MAIL', 'EMAIL-ANDROID-GMAIL'],
    requiredHeaders: ['ID', 'Client', 'Sender verified', '[STAGING] prefix', 'Code readable / no excessive wrap', 'Safe browser link / no code in URL', 'Plain text fallback', 'HTML escaping', 'No tracking or external image', 'Dark mode', 'Result', 'Tester', 'UTC timestamp', 'Evidence reference'],
  }),
  pdf: Object.freeze({
    path: 'docs/durable-draft-recovery/testing/staging-pdf-visual-qa.md',
    requiredIds: ['PDF-LONG-TEXT', 'PDF-MULTI-SELECT', 'PDF-GEOGRAPHIC', 'PDF-FILE-METADATA', 'PDF-CERTIFICATIONS', 'PDF-GUARANTEES', 'PDF-CONDITIONAL', 'PDF-UNICODE', 'PDF-LONG-IDENTITY'],
    requiredHeaders: ['ID', 'Synthetic scenario', 'Result', 'Tester', 'UTC timestamp', 'Evidence reference'],
  }),
});

const cleanCell = (value) => String(value || '').trim().replaceAll('`', '');
const parseRow = (line) => line.trim().replace(/^\||\|$/gu, '').split('|').map(cleanCell);

const parseEvidenceDocument = (content) => {
  const lines = String(content).split('\n');
  const candidateCommit = String(content).match(/^- Candidate commit:\s*`([^`]+)`/mu)?.[1] || '';
  const headerIndex = lines.findIndex((line) => /^\|\s*ID\s*\|/u.test(line));
  if (headerIndex < 0 || !/^\|(?:\s*:?-+:?\s*\|)+\s*$/u.test(lines[headerIndex + 1] || '')) {
    return { candidateCommit, headers: [], rows: [] };
  }
  const headers = parseRow(lines[headerIndex]);
  const rows = [];
  for (let index = headerIndex + 2; index < lines.length && /^\|/u.test(lines[index]); index += 1) {
    const cells = parseRow(lines[index]);
    rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ''])));
  }
  return { candidateCommit, headers, rows };
};

const unsafeUrls = (content) => {
  const failures = [];
  for (const match of String(content).matchAll(/https?:\/\/[^\s<>()|`]+/giu)) {
    try {
      const url = new URL(match[0].replace(/[.,;:]$/u, ''));
      if (url.username || url.password) failures.push('MANUAL_EVIDENCE_URL_CREDENTIALS');
      if (PRODUCTION_HOST.test(url.hostname)) failures.push('MANUAL_EVIDENCE_PRODUCTION_URL');
      if ([...url.searchParams.keys()].some((key) => FORBIDDEN_QUERY_KEY.test(key))) {
        failures.push('MANUAL_EVIDENCE_LINK_CREDENTIAL_QUERY');
      }
    } catch {
      failures.push('MANUAL_EVIDENCE_URL_INVALID');
    }
  }
  if (RAW_RECOVERY_CODE.test(String(content))) failures.push('MANUAL_EVIDENCE_RAW_RECOVERY_CODE');
  return failures;
};

const failure = (code, detail = '') => ({ code, ...(detail ? { detail } : {}) });

export const validateManualStagingEvidenceDocuments = ({ currentCommit, documents }) => {
  const failures = [];
  let pendingRows = 0;
  let passedRows = 0;
  for (const [name, contract] of Object.entries(EVIDENCE_CONTRACTS)) {
    const content = documents[name] || '';
    const parsed = parseEvidenceDocument(content);
    if (parsed.candidateCommit !== currentCommit) failures.push(failure('MANUAL_EVIDENCE_STALE_COMMIT', name));
    for (const header of contract.requiredHeaders) {
      if (!parsed.headers.includes(header)) failures.push(failure('MANUAL_EVIDENCE_HEADER_MISSING', `${name}:${header}`));
    }
    const byId = new Map(parsed.rows.map((row) => [cleanCell(row.ID), row]));
    for (const id of contract.requiredIds) {
      const row = byId.get(id);
      if (!row) {
        failures.push(failure('MANUAL_EVIDENCE_REQUIRED_ROW_MISSING', `${name}:${id}`));
        continue;
      }
      const result = cleanCell(row.Result).toUpperCase();
      if (!RESULT_VALUES.has(result)) failures.push(failure('MANUAL_EVIDENCE_RESULT_INVALID', `${name}:${id}`));
      if (!cleanCell(row.Tester)) failures.push(failure('MANUAL_EVIDENCE_TESTER_MISSING', `${name}:${id}`));
      if (!cleanCell(row['UTC timestamp'])) failures.push(failure('MANUAL_EVIDENCE_TIMESTAMP_MISSING', `${name}:${id}`));
      if (result === 'PASS') {
        if (PLACEHOLDER.test(cleanCell(row.Tester))) failures.push(failure('MANUAL_EVIDENCE_TESTER_MISSING', `${name}:${id}`));
        if (Number.isNaN(Date.parse(cleanCell(row['UTC timestamp'])))) failures.push(failure('MANUAL_EVIDENCE_TIMESTAMP_INVALID', `${name}:${id}`));
        if (PLACEHOLDER.test(cleanCell(row['Evidence reference']))) failures.push(failure('MANUAL_EVIDENCE_REFERENCE_MISSING', `${name}:${id}`));
        passedRows += 1;
      } else if (result === 'FAIL') {
        failures.push(failure('MANUAL_EVIDENCE_ROW_FAILED', `${name}:${id}`));
      } else {
        pendingRows += 1;
      }
    }
    for (const code of unsafeUrls(content)) failures.push(failure(code, name));
  }
  const hardFailure = failures.some(({ code }) => /(?:PRODUCTION_URL|CREDENTIAL|RAW_RECOVERY_CODE|ROW_FAILED|URL_INVALID)/u.test(code));
  const verdict = failures.length === 0 && pendingRows === 0
    ? 'PASS'
    : hardFailure ? 'FAILED' : 'BLOCKED';
  return Object.freeze({
    currentCommit,
    failureCodes: failures.map(({ code }) => code),
    failures,
    passedRows,
    pendingRows,
    verdict,
  });
};

const parseArguments = (argv) => {
  const options = { output: '.durable-draft-artifacts/manual-staging/evidence-summary.json' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--output') throw new Error('MANUAL_EVIDENCE_ARGUMENT_INVALID');
    options.output = argv[++index];
  }
  if (!SAFE_OUTPUT.test(options.output) || options.output.split('/').includes('..')) {
    throw new Error('MANUAL_EVIDENCE_OUTPUT_UNSAFE');
  }
  return options;
};

export const runManualStagingEvidenceValidation = async (options = parseArguments(process.argv.slice(2))) => {
  const currentCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).stdout.trim();
  const documents = Object.fromEntries(await Promise.all(Object.entries(EVIDENCE_CONTRACTS).map(async ([name, contract]) => (
    [name, await readFile(path.join(repositoryRoot, contract.path), 'utf8')]
  ))));
  const result = validateManualStagingEvidenceDocuments({ currentCommit, documents });
  const outputPath = path.resolve(repositoryRoot, options.output);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify({
    version: 1,
    checkedAt: new Date().toISOString(),
    commitSha: result.currentCommit,
    verdict: result.verdict,
    passedRows: result.passedRows,
    pendingRows: result.pendingRows,
    failureCodes: [...new Set(result.failureCodes)].sort(),
  }, null, 2)}\n`, { mode: 0o600 });
  return result;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await runManualStagingEvidenceValidation();
    process.stdout.write(`manual_evidence_verdict=${result.verdict}\nmanual_evidence_passed=${result.passedRows}\nmanual_evidence_pending=${result.pendingRows}\n`);
    if (result.verdict !== 'PASS') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.message || 'MANUAL_EVIDENCE_VALIDATION_FAILED'}\n`);
    process.exitCode = 2;
  }
}
