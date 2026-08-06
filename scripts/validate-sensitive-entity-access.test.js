import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  scanBuiltText,
  scanSourceText,
  validateSensitiveEntityAccess,
} from './validate-sensitive-entity-access.mjs';

const ENTITIES = [
  'ProFormDraft',
  'ProFormDraftEvent',
  'ProFormRecoverySecurityEvent',
  'ProFormEmailVerificationAttempt',
  'ProFormSubmissionIntake',
];

const basePolicy = (overrides = {}) => ({
  version: 1,
  sensitiveEntities: ENTITIES,
  sourceRoots: ['src', 'base44/functions', 'tests/e2e'],
  allowedLocations: [
    { pattern: 'base44/functions/**', operations: ['*'], rule: 'backend-only' },
    { pattern: 'tests/e2e/attack/**', operations: ['*'], rule: 'attack-only' },
  ],
  forbiddenLocations: [
    { pattern: 'src/**', operations: ['*'], rule: 'frontend-forbidden' },
    { pattern: 'tests/e2e/**', operations: ['*'], rule: 'e2e-forbidden' },
  ],
  builtOutput: { directory: 'dist', extensions: ['.js'], excludeSourceMaps: true },
  exemptions: [],
  ...overrides,
});

const createFixture = async (files, policy = basePolicy()) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sensitive-entity-policy-'));
  await writeFile(path.join(root, 'policy.json'), JSON.stringify(policy));
  for (const [file, source] of Object.entries(files)) {
    const absolute = path.join(root, file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, source);
  }
  return root;
};

describe('sensitive entity static validator', () => {
  it.each([
    ['property access', 'base44.entities.ProFormDraft.create({});', 'create'],
    ['bracket access', 'base44.entities["ProFormDraftEvent"].filter({});', 'filter'],
    ['concatenated bracket access', 'const n = "ProForm" + "Draft"; base44.entities[n].update("id", {});', 'update'],
    ['entity alias', 'const draft = base44.entities.ProFormDraft; draft.list();', 'list'],
    ['client alias', 'import { base44 as sdk } from "./client"; sdk.entities.ProFormDraft.get("id");', 'get'],
  ])('detects %s', (_label, source, operation) => {
    expect(scanSourceText({
      file: 'src/example.js',
      source,
      sensitiveEntities: ENTITIES,
    })).toEqual(expect.arrayContaining([expect.objectContaining({ operation })]));
  });

  it('allows backend service-role access and an explicit low-level attack file', async () => {
    const root = await createFixture({
      'base44/functions/backend.js': 'base44.entities.ProFormDraft.create({});',
      'tests/e2e/attack/direct-access.js': 'base44.entities["ProFormDraftEvent"].list();',
    });
    const result = await validateSensitiveEntityAccess({
      root,
      policyPath: 'policy.json',
      sourceOnly: true,
    });
    expect(result.findings).toEqual([]);
  });

  it('rejects expired exemptions', async () => {
    const root = await createFixture({}, basePolicy({
      exemptions: [{
        pattern: 'src/temporary.js',
        entity: 'ProFormDraft',
        operations: ['create'],
        reason: 'Synthetic validator test',
        owner: 'security-test',
        removeBy: '2025-01-01',
      }],
    }));
    const result = await validateSensitiveEntityAccess({
      root,
      policyPath: 'policy.json',
      sourceOnly: true,
      today: '2026-08-06',
    });
    expect(result.findings).toEqual([
      expect.objectContaining({ operation: 'exemption', rule: 'expired-exemption' }),
    ]);
  });

  it('detects built endpoint and SDK access without returning source text', () => {
    const findings = scanBuiltText({
      file: 'dist/app.js',
      source: 'client.entities["ProFormDraft"].filter({ secret: "synthetic" });',
      sensitiveEntities: ENTITIES,
    });
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'dist/app.js',
        operation: 'built_endpoint_or_sdk_access',
      }),
    ]));
    expect(JSON.stringify(findings)).not.toContain('synthetic');
  });

  it('fails built validation when direct access survives tree shaking', async () => {
    const root = await createFixture({
      'dist/app.js': 'client.entities.ProFormDraft.get("draft");',
    });
    const result = await validateSensitiveEntityAccess({
      root,
      policyPath: 'policy.json',
      builtOnly: true,
    });
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'no-sensitive-entity-access-in-built-output' }),
    ]));
  });

  it('requires source maps to be explicitly excluded from bundle policy', async () => {
    const root = await createFixture({}, basePolicy({
      builtOutput: { directory: 'dist', extensions: ['.js'] },
    }));
    const result = await validateSensitiveEntityAccess({
      root,
      policyPath: 'policy.json',
      builtOnly: true,
    });
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'built-source-maps-must-be-explicitly-excluded' }),
    ]);
  });
});
