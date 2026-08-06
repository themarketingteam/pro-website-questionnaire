import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOAD_PROFILES,
  assertSafeLoadReport,
  createInMemoryLoadAdapter,
  createLoadCheckpointStore,
  createSeededRandom,
  parseLoadTestArguments,
  runBoundedWorkerPool,
  runLoadHarness,
  validateLoadTestOptions,
} from '../../scripts/lib/pro-draft-load-harness.mjs';
import {
  LOAD_RELEASE_THRESHOLDS,
  calculatePercentile,
  createLoadMetricsCollector,
  evaluateLoadThresholds,
} from '../../scripts/lib/pro-draft-load-metrics.mjs';
import { createStagingBase44LoadAdapter } from '../../scripts/lib/pro-draft-load-staging-adapter.mjs';

const directories = [];
const temporaryDirectory = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pro-draft-load-'));
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

const parsed = (profile, output, extra = []) => parseLoadTestArguments([
  '--profile', profile,
  '--environment', 'staging',
  '--base-url', 'mock://durable-draft-staging',
  '--test-run-id', `load-${profile.replaceAll('-', '')}-0001`,
  '--output', output,
  '--cleanup', 'always',
  '--seed', '20260806',
  ...extra,
], {});

describe('load target, profiles, and bounded execution', () => {
  it('rejects production environments and documented production hosts', async () => {
    const output = await temporaryDirectory();
    expect(() => validateLoadTestOptions({
      ...parsed('smoke', output), environment: 'production',
    })).toThrow('LOAD_STAGING_ONLY');
    expect(() => validateLoadTestOptions({
      ...parsed('smoke', output), baseUrl: 'https://www.mspsuccesswebsites.com',
    })).toThrow('LOAD_PRODUCTION_TARGET_DENIED');
  });

  it('defines required profile capacities without running full capacity', () => {
    expect(LOAD_PROFILES.smoke).toMatchObject({ clients: 5, drafts: 10, durationSeconds: 120 });
    expect(LOAD_PROFILES['save-burst']).toMatchObject({ clients: 100, drafts: 100 });
    expect(LOAD_PROFILES['continuous-typing']).toMatchObject({ clients: 100, durationSeconds: 900 });
    expect(LOAD_PROFILES.soak).toMatchObject({ clients: 100, durationSeconds: 7_200 });
    expect(LOAD_PROFILES['full-capacity']).toMatchObject({ clients: 250, drafts: 1_000, durationSeconds: 1_800 });
  });

  it('requires explicit staging arguments and confirmation for soak/full', async () => {
    const output = await temporaryDirectory();
    expect(() => validateLoadTestOptions(parsed('full-capacity', output)))
      .toThrow('LOAD_EXPLICIT_CONFIRMATION_REQUIRED');
    expect(validateLoadTestOptions(parsed('full-capacity', output, [
      '--confirm', 'RUN_FULL_CAPACITY_STAGING',
    ]))).toMatchObject({ clients: 250, drafts: 1_000 });
  });

  it('requires an external staging credential derivation secret', async () => {
    await expect(createStagingBase44LoadAdapter({
      appId: 'synthetic-staging-app',
      productionAppId: 'synthetic-production-app',
      credentialSecret: '',
    })).rejects.toThrow('LOAD_STAGING_CREDENTIAL_SECRET_MISSING');
  });

  it('bounds workers and never exceeds configured concurrency', async () => {
    let active = 0;
    let maximum = 0;
    const result = await runBoundedWorkerPool({
      items: Array.from({ length: 40 }, (_value, index) => index),
      concurrency: 4,
      onActive: (count) => { maximum = Math.max(maximum, count); },
      worker: async (value) => {
        active += 1;
        expect(active).toBeLessThanOrEqual(4);
        await Promise.resolve();
        active -= 1;
        return value * 2;
      },
    });
    expect(maximum).toBe(4);
    expect(result).toHaveLength(40);
  });

  it('stops cooperatively when the abort signal is raised', async () => {
    const controller = new AbortController();
    await expect(runBoundedWorkerPool({
      items: [1, 2, 3],
      concurrency: 1,
      signal: controller.signal,
      worker: async (value) => {
        controller.abort();
        return value;
      },
    })).rejects.toThrow('LOAD_GRACEFUL_STOP');
  });
});

describe('metrics, thresholds, determinism, and reports', () => {
  it('calculates nearest-rank percentiles and all latency bands', () => {
    expect(calculatePercentile([1, 2, 3, 4, 100], 95)).toBe(100);
    const collector = createLoadMetricsCollector({ now: (() => {
      let value = 0;
      return () => { value += 1_000; return value; };
    })() });
    [100, 200, 300, 400].forEach((durationMs) => collector.record({
      operation: 'server_save', durationMs, success: true, logicalMutations: 2, eventRows: 1,
    }));
    expect(collector.summarize().latency.server_save).toMatchObject({
      p50: 200, p90: 400, p95: 400, p99: 400, max: 400,
    });
  });

  it('fails threshold verdicts for lost state, event amplification, and cleanup', () => {
    const collector = createLoadMetricsCollector();
    collector.record({ operation: 'server_save', success: true, logicalMutations: 1, eventRows: 3 });
    collector.increment('lostAcknowledgedStateCount');
    const result = evaluateLoadThresholds({
      metrics: collector.summarize(),
      cleanup: { unresolvedRecords: 1 },
    });
    expect(result.passed).toBe(false);
    expect(result.checks.filter(({ passed }) => !passed).map(({ id }) => id)).toEqual([
      'lost_acknowledged_state', 'event_amplification', 'cleanup_unresolved_records',
    ]);
    expect(LOAD_RELEASE_THRESHOLDS.successfulPathErrorRateExclusive).toBe(0.001);
  });

  it('reproduces seeded sequences exactly', () => {
    const first = createSeededRandom(20260806);
    const second = createSeededRandom(20260806);
    expect(Array.from({ length: 20 }, first)).toEqual(Array.from({ length: 20 }, second));
  });

  it('rejects credential-bearing report keys', () => {
    expect(() => assertSafeLoadReport({ resumeToken: 'synthetic' }))
      .toThrow('LOAD_REPORT_SENSITIVE_KEY');
    expect(assertSafeLoadReport({ draftFingerprint: 'a'.repeat(64), verdict: 'PASS' })).toBe(true);
  });
});

describe('mock workload, integrity, cleanup, and resume', () => {
  it('runs the smoke profile, verifies state, and leaves zero records', async () => {
    const output = await temporaryDirectory();
    const adapter = createInMemoryLoadAdapter({ latencyMs: 0 });
    const result = await runLoadHarness({
      options: parsed('smoke', output),
      adapter,
      commit: 'a'.repeat(40),
    });
    expect(result).toMatchObject({
      verdict: 'PASS',
      integrity: { mismatchCount: 0, checkedRecords: 10 },
      cleanup: { unresolvedRecords: 0, verifiedZero: true },
    });
    expect(result.metrics.requestsPerLogicalMutation).toBeLessThan(1);
    expect(JSON.parse(await readFile(path.join(output, 'load-summary.json'), 'utf8')))
      .toMatchObject({ verdict: 'PASS', profile: 'smoke' });
  });

  it('marks a final-state mismatch as a release failure', async () => {
    const output = await temporaryDirectory();
    const base = createInMemoryLoadAdapter({ latencyMs: 0 });
    const adapter = Object.freeze({
      ...base,
      async inspect(testRunId) {
        const records = await base.inspect(testRunId);
        return records.map((record, index) => (
          index === 0
            ? { ...record, stateHash: 'f'.repeat(64), duplicateEventRows: 1 }
            : record
        ));
      },
    });
    const result = await runLoadHarness({ options: parsed('smoke', output), adapter });
    expect(result.verdict).toBe('FAIL');
    expect(result.integrity.mismatchCodes).toContain('STATE_HASH_MISMATCH');
    expect(result.integrity.mismatchCodes).toContain('DUPLICATE_EVENT');
  });

  it('writes and resumes only safe deterministic checkpoint metadata', async () => {
    const output = await temporaryDirectory();
    const store = createLoadCheckpointStore(output);
    const expected = {
      testRunId: 'load-resume-0001',
      profile: 'smoke',
      seed: 20260806,
      configurationFingerprint: 'a'.repeat(64),
    };
    await store.write({
      ...expected,
      completedOperationIndexes: [3, 1, 3],
      draftFingerprints: ['b'.repeat(64)],
      resumeToken: 'must-not-persist',
    });
    await expect(store.read(expected)).resolves.toMatchObject({
      completedOperationIndexes: [1, 3],
      draftFingerprints: ['b'.repeat(64)],
    });
    expect(await readFile(store.filePath, 'utf8')).not.toContain('resumeToken');
  });

  it('resumes remaining operation indexes without replaying completed work', async () => {
    const output = await temporaryDirectory();
    let saveCalls = 0;
    const adapter = createInMemoryLoadAdapter({
      latencyMs: 0,
      fault: async (operation) => { if (operation === 'save') saveCalls += 1; },
    });
    const options = parsed('smoke', output);
    const draft = await adapter.bootstrap({
      testRunId: options.testRunId,
      draftIndex: 0,
      idempotencyKey: createHash('sha256')
        .update(`${options.testRunId}:bootstrap:0`).digest('hex'),
    });
    await adapter.save({
      ...draft,
      expectedServerRevision: draft.serverRevision,
      mutationFingerprint: 'pre-interruption-completed-save',
      eventIds: Array.from({ length: 5 }, (_value, index) => `event-0-${index}`),
    });
    saveCalls = 0;
    const configuration = {
      profile: options.profile,
      clients: options.clients,
      drafts: options.drafts,
      durationSeconds: options.durationSeconds,
      concurrency: options.concurrency,
      cleanup: options.cleanup,
      environment: options.environment,
    };
    await createLoadCheckpointStore(output).write({
      testRunId: options.testRunId,
      profile: options.profile,
      seed: options.seed,
      configurationFingerprint: createHash('sha256')
        .update(JSON.stringify(configuration)).digest('hex'),
      completedOperationIndexes: [0],
      draftFingerprints: [draft.draftFingerprint],
    });

    const result = await runLoadHarness({ options, adapter });

    expect(result.verdict).toBe('PASS');
    expect(saveCalls).toBe(9);
    expect(result.cleanup).toMatchObject({ verifiedZero: true, unresolvedRecords: 0 });
  });

  it('does not retry a server failure inside the load harness', async () => {
    const output = await temporaryDirectory();
    const fault = vi.fn(async (operation) => {
      if (operation === 'save') throw Object.assign(new Error('synthetic'), {
        code: 'CHAOS_HTTP_500', status: 500, retryable: true,
      });
    });
    const result = await runLoadHarness({
      options: parsed('smoke', output, ['--concurrency', '1']),
      adapter: createInMemoryLoadAdapter({ latencyMs: 0, fault }),
    });
    expect(result.verdict).toBe('BLOCKED');
    expect(result.metrics.counters.retryCount).toBe(0);
    expect(fault.mock.calls.filter(([operation]) => operation === 'save')).toHaveLength(1);
  });
});
