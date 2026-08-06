#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(
  repositoryRoot,
  '.durable-draft-artifacts/security/dependency-audit-summary.json',
);

const runAudit = (args) => {
  const result = spawnSync('npm', ['audit', '--json', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(result.stdout || '{}');
  } catch {
    throw new Error('DEPENDENCY_AUDIT_JSON_INVALID');
  }
  return { exitCode: result.status ?? 1, report };
};

const vulnerabilityNames = (report) => Object.keys(report?.vulnerabilities || {}).sort();
const severityCounts = (report) => {
  const source = report?.metadata?.vulnerabilities || {};
  return Object.freeze({
    info: Number(source.info || 0),
    low: Number(source.low || 0),
    moderate: Number(source.moderate || 0),
    high: Number(source.high || 0),
    critical: Number(source.critical || 0),
    total: Number(source.total || 0),
  });
};

export const classifyDependencyAudit = ({ fullReport, productionReport, packageJson }) => {
  const runtimeDirect = new Set(Object.keys(packageJson?.dependencies || {}));
  const productionNames = vulnerabilityNames(productionReport);
  const blocking = [];
  for (const name of productionNames) {
    const finding = productionReport.vulnerabilities[name] || {};
    if (finding.severity === 'critical') {
      blocking.push({ package: name, reason: 'CRITICAL_PRODUCTION_DEPENDENCY' });
    } else if (finding.severity === 'high' && finding.isDirect && runtimeDirect.has(name)) {
      blocking.push({ package: name, reason: 'HIGH_DIRECT_EXPOSED_RUNTIME_PATH' });
    }
  }
  const fullNames = vulnerabilityNames(fullReport);
  const devOnly = fullNames.filter((name) => !productionNames.includes(name));
  return Object.freeze({
    status: blocking.length === 0 ? 'PASS' : 'BLOCKED',
    full: severityCounts(fullReport),
    production: severityCounts(productionReport),
    blocking: Object.freeze(blocking.map(Object.freeze)),
    acceptedDevOnly: Object.freeze(devOnly.map((packageName) => Object.freeze({
      package: packageName,
      reason: 'DEV_ONLY_REVIEW_REQUIRED',
    }))),
    autoFixApplied: false,
    majorUpgradeApplied: false,
  });
};

const main = async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const full = runAudit([]);
  const production = runAudit(['--omit=dev']);
  const summary = classifyDependencyAudit({
    fullReport: full.report,
    productionReport: production.report,
    packageJson,
  });
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0
    ? path.resolve(process.argv[outputIndex + 1] || '')
    : DEFAULT_OUTPUT;
  if (!outputPath) throw new Error('DEPENDENCY_AUDIT_OUTPUT_REQUIRED');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    ...summary,
    auditExitCodes: { full: full.exitCode, production: production.exitCode },
  }, null, 2)}\n`, 'utf8');
  console.log(`Dependency security audit: ${summary.status}`);
  console.log(JSON.stringify({
    full: summary.full,
    production: summary.production,
    blockingCount: summary.blocking.length,
    acceptedDevOnlyCount: summary.acceptedDevOnly.length,
    output: path.relative(repositoryRoot, outputPath),
  }, null, 2));
  if (summary.status !== 'PASS') process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'DEPENDENCY_AUDIT_FAILED');
    process.exitCode = 1;
  });
}
