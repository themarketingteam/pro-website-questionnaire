#!/usr/bin/env node
import {
  lstat, readFile, readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TARGETS = Object.freeze([
  'test-results',
  'playwright-report',
  '.durable-draft-artifacts',
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RAW_PATH_PATTERN = /(^|\/)(?:protected-raw|raw-artifacts)(\/|$)/u;
const SAFE_FINGERPRINT_PATTERN = /^[a-f0-9]{12,64}$/u;

export const ARTIFACT_SECRET_PATTERNS = Object.freeze([
  Object.freeze({
    name: 'recovery_code',
    expression: /\b[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}\b/gu,
  }),
  Object.freeze({
    name: 'compact_signed_token',
    expression: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{32,}(?:\.[A-Za-z0-9_-]{20,})?\b/gu,
  }),
  Object.freeze({
    name: 'base64url_token_prefix',
    expression: /\b(?:pdrt|pdti|pdrs|pdar|resume|recovery_session|admin_grant)_[A-Za-z0-9_-]{20,}\b/giu,
  }),
  Object.freeze({
    name: 'email_address',
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  }),
  Object.freeze({
    name: 'aws_access_key',
    expression: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  }),
  Object.freeze({
    name: 'webhook_url',
    expression: /https:\/\/(?:hooks\.(?:slack|zapier)\.com|discord(?:app)?\.com\/api\/webhooks)\/[^\s"']+/giu,
  }),
  Object.freeze({
    name: 'canonical_response_value',
    expression: /"(?:responses|canonicalState|draft_state_json|responses_json)"\s*:\s*(?:\{|\[|"(?!<redacted>))/giu,
  }),
  Object.freeze({
    name: 'private_key_marker',
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  }),
]);

const relativePath = (value) => path.relative(repositoryRoot, value).split(path.sep).join('/');

const parseArguments = (argv) => {
  const options = { targets: [], allowSyntheticInRaw: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allow-synthetic-in-raw') options.allowSyntheticInRaw = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--path' || argument === '--directory') {
      const value = argv[index + 1];
      if (!value) throw new Error('ARTIFACT_SCAN_PATH_REQUIRED');
      options.targets.push(value);
      index += 1;
    } else throw new Error(`ARTIFACT_SCAN_ARGUMENT_INVALID:${argument}`);
  }
  if (options.targets.length === 0) options.targets.push(...DEFAULT_TARGETS);
  return options;
};

const isSyntheticAllowlisted = (match, filePath, options) => {
  if (!options.allowSyntheticInRaw || !RAW_PATH_PATTERN.test(relativePath(filePath))) return false;
  if (SAFE_FINGERPRINT_PATTERN.test(match)) return true;
  if (/@example\.test$/iu.test(match)) return true;
  return /^E2E-[A-Z0-9-]{8,80}$/u.test(match);
};

const lineAndColumn = (content, index) => {
  const prefix = content.slice(0, index);
  const lines = prefix.split('\n');
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
};

export const scanArtifactContent = (content, options = {}) => {
  const filePath = path.resolve(options.filePath || 'artifact.txt');
  const findings = [];
  for (const pattern of ARTIFACT_SECRET_PATTERNS) {
    pattern.expression.lastIndex = 0;
    for (const match of content.matchAll(pattern.expression)) {
      if (isSyntheticAllowlisted(match[0], filePath, options)) continue;
      const location = lineAndColumn(content, match.index ?? 0);
      findings.push(Object.freeze({
        pattern: pattern.name,
        path: relativePath(filePath),
        line: location.line,
        column: location.column,
        redacted: true,
      }));
    }
  }
  return Object.freeze(findings);
};

const walk = async (target) => {
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (metadata.isSymbolicLink()) return [];
  if (metadata.isFile()) return metadata.size <= MAX_FILE_BYTES ? [target] : [];
  if (!metadata.isDirectory()) return [];
  const files = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    files.push(...await walk(path.join(target, entry.name)));
  }
  return files;
};

export const scanArtifactPaths = async (targets, options = {}) => {
  const files = (await Promise.all(targets.map((target) => walk(path.resolve(target)))))
    .flat().sort();
  const findings = [];
  for (const filePath of files) {
    const buffer = await readFile(filePath);
    if (buffer.includes(0)) continue;
    findings.push(...scanArtifactContent(buffer.toString('utf8'), { ...options, filePath }));
  }
  return Object.freeze({ filesScanned: files.length, findings: Object.freeze(findings) });
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const result = await scanArtifactPaths(options.targets, options);
  const summary = {
    status: result.findings.length === 0 ? 'PASS' : 'FAILED',
    filesScanned: result.filesScanned,
    findingCount: result.findings.length,
    findings: result.findings,
  };
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Durable draft artifact scan: ${summary.status}`);
    console.log(`Files scanned: ${summary.filesScanned}; findings: ${summary.findingCount}`);
    for (const finding of result.findings) {
      console.error(
        `${finding.path}:${finding.line}:${finding.column} ${finding.pattern} [REDACTED]`,
      );
    }
  }
  if (result.findings.length > 0) process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'ARTIFACT_SCAN_FAILED');
    process.exitCode = 1;
  });
}
