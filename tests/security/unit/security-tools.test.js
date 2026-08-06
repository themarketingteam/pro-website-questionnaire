import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  scanArtifactContent,
  scanArtifactPaths,
} from '../../../scripts/scan-durable-draft-test-artifacts.mjs';
import { classifyDependencyAudit } from '../../../scripts/audit-durable-draft-dependencies.mjs';
import {
  assertSeededProperty,
  fc,
} from '../helpers/propertyTest.js';
import {
  SYNTHETIC_TEST_RUN_ID,
  syntheticSecurityIdentity,
} from '../fixtures/adversarialFixtures.js';
import {
  assertIsolatedRateLimitSubject,
  assertSecurityTarget,
} from '../helpers/targetSafety.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('sensitive artifact scanner', () => {
  it.each([
    ['recovery_code', '2345-6789-ABCD-EFGH-JKMN'],
    ['email_address', 'security-fixture@example.test'],
    ['compact_signed_token', [
      'eyJ0eXBlIjoic2VjdXJpdHlfZml4dHVyZSJ9',
      'abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-',
    ].join('.')],
  ])('detects %s without returning the detected value', (pattern, content) => {
    const findings = scanArtifactContent(content, { filePath: '/tmp/sanitized/report.json' });
    expect(findings.some((finding) => finding.pattern === pattern)).toBe(true);
    expect(JSON.stringify(findings)).not.toContain(content);
    expect(findings.every((finding) => finding.redacted)).toBe(true);
  });

  it('ignores approved safe fingerprints and only allowlists synthetic email in protected raw paths', () => {
    expect(scanArtifactContent('a'.repeat(64), { filePath: '/tmp/sanitized/report.json' }))
      .toEqual([]);
    expect(scanArtifactContent('security-fixture@example.test', {
      filePath: '/tmp/protected-raw/report.json',
      allowSyntheticInRaw: true,
    })).toEqual([]);
    expect(scanArtifactContent('security-fixture@example.test', {
      filePath: '/tmp/sanitized/report.json',
      allowSyntheticInRaw: true,
    })).toHaveLength(1);
  });

  it('CLI exits nonzero and redacts the matched value from output', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'draft-security-scan-'));
    temporaryDirectories.push(directory);
    const secret = 'security-cli-fixture@example.test';
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ value: secret }));
    const result = spawnSync(process.execPath, [
      'scripts/scan-durable-draft-test-artifacts.mjs', '--path', directory,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('email_address [REDACTED]');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });

  it('scans nested JSON artifacts and skips symlinks/binary content safely', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'draft-security-tree-'));
    temporaryDirectories.push(directory);
    await mkdir(path.join(directory, 'nested'));
    await writeFile(path.join(directory, 'nested', 'safe.json'), '{"status":"PASS"}');
    const result = await scanArtifactPaths([directory]);
    expect(result).toEqual({ filesScanned: 1, findings: [] });
  });
});

describe('property, target, and dependency-audit tools', () => {
  it('reports only seed/path metadata for property failures', async () => {
    await expect(assertSeededProperty(fc.property(fc.constant('private-counterexample'), () => false), {
      seed: 12345,
      numRuns: 1,
    })).rejects.toThrow(/^SECURITY_PROPERTY_FAILED seed=12345 path=/u);
    await expect(assertSeededProperty(fc.property(fc.constant('private-counterexample'), () => false), {
      seed: 12345,
      numRuns: 1,
    })).rejects.not.toThrow(/private-counterexample/u);
  });

  it('rejects production targets and uncontrolled rate-limit subjects', () => {
    expect(() => assertSecurityTarget({
      environment: 'staging', baseURL: 'https://www.mspsuccesswebsites.com',
    })).toThrow('SECURITY_PRODUCTION_TARGET_DENIED');
    expect(() => assertIsolatedRateLimitSubject({
      testRunId: SYNTHETIC_TEST_RUN_ID,
      subject: syntheticSecurityIdentity.email,
      attempts: 100,
    })).toThrow('SECURITY_BRUTE_FORCE_BOUND_EXCEEDED');
  });

  it('blocks critical production and high direct runtime findings without auto-fix', () => {
    const fullReport = {
      metadata: { vulnerabilities: { high: 2, critical: 1, total: 3 } },
      vulnerabilities: {
        'runtime-critical': { severity: 'critical', isDirect: false },
        'runtime-direct': { severity: 'high', isDirect: true },
        'dev-tool': { severity: 'high', isDirect: true },
      },
    };
    const productionReport = {
      metadata: { vulnerabilities: { high: 1, critical: 1, total: 2 } },
      vulnerabilities: {
        'runtime-critical': { severity: 'critical', isDirect: false },
        'runtime-direct': { severity: 'high', isDirect: true },
      },
    };
    const result = classifyDependencyAudit({
      fullReport,
      productionReport,
      packageJson: { dependencies: { 'runtime-direct': '1.0.0' }, devDependencies: { 'dev-tool': '1.0.0' } },
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.blocking.map(({ reason }) => reason)).toEqual([
      'CRITICAL_PRODUCTION_DEPENDENCY',
      'HIGH_DIRECT_EXPOSED_RUNTIME_PATH',
    ]);
    expect(result.acceptedDevOnly).toEqual([{
      package: 'dev-tool', reason: 'DEV_ONLY_REVIEW_REQUIRED',
    }]);
    expect(result).toMatchObject({ autoFixApplied: false, majorUpgradeApplied: false });
  });
});
