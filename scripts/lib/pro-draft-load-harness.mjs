import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createLoadMetricsCollector,
  evaluateLoadThresholds,
} from './pro-draft-load-metrics.mjs';

const SAFE_TEST_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const SAFE_FINGERPRINT = /^[a-f0-9]{64}$/u;
const PRODUCTION_HOST_SUFFIXES = Object.freeze([
  'mspsuccesswebsites.com',
  'qtrypzzcjebvfcihiynt.supabase.co',
]);
const CHECKPOINT_FILE = 'safe-progress-checkpoint.json';
const REPORT_FILES = Object.freeze([
  'load-summary.json',
  'latency-histograms.json',
  'integrity-summary.json',
  'failure-summary.json',
  'cleanup-summary.json',
  'load-summary.md',
]);

export const LOAD_PROFILES = Object.freeze({
  smoke: Object.freeze({ clients: 5, drafts: 10, durationSeconds: 120, concurrency: 5 }),
  'save-burst': Object.freeze({ clients: 100, drafts: 100, durationSeconds: 60, concurrency: 20 }),
  'continuous-typing': Object.freeze({ clients: 100, drafts: 100, durationSeconds: 900, concurrency: 20, keystrokesPerMinute: 20 }),
  recovery: Object.freeze({ clients: 100, drafts: 100, durationSeconds: 300, concurrency: 10, codeRecoveries: 100, emailRecoveries: 10 }),
  'multi-tab-conflict': Object.freeze({ clients: 100, drafts: 50, durationSeconds: 300, concurrency: 20 }),
  'submission-lock': Object.freeze({ clients: 25, drafts: 25, durationSeconds: 300, concurrency: 10 }),
  soak: Object.freeze({ clients: 100, drafts: 1_000, durationSeconds: 7_200, concurrency: 25, explicitStaging: true }),
  'full-capacity': Object.freeze({ clients: 250, drafts: 1_000, durationSeconds: 1_800, concurrency: 50, explicitStaging: true }),
  cleanup: Object.freeze({ clients: 0, drafts: 0, durationSeconds: 0, concurrency: 1, cleanupOnly: true }),
});

export class LoadHarnessError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'LoadHarnessError';
    this.code = code;
    this.status = details.status ?? 500;
    this.retryable = details.retryable === true;
    this.timedOut = details.timedOut === true;
  }
}

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const isProductionHostname = (hostname) => PRODUCTION_HOST_SUFFIXES.some((suffix) => (
  hostname === suffix || hostname.endsWith(`.${suffix}`)
));

const parseInteger = (value, code, minimum, maximum) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new LoadHarnessError(code, { status: 400 });
  }
  return parsed;
};

export const parseDurationSeconds = (value) => {
  const match = /^(\d+)(ms|s|m|h)?$/u.exec(String(value || ''));
  if (!match) throw new LoadHarnessError('LOAD_DURATION_INVALID', { status: 400 });
  const amount = Number(match[1]);
  const multiplier = { ms: 0.001, s: 1, m: 60, h: 3_600 }[match[2] || 's'];
  const seconds = Math.ceil(amount * multiplier);
  return parseInteger(seconds, 'LOAD_DURATION_INVALID', 1, 86_400);
};

const generatedRunId = (now = new Date()) => (
  `load-${now.toISOString().replace(/\D/gu, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`
);

export const parseLoadTestArguments = (argv, env = process.env) => {
  const values = {
    baseUrl: env.PRO_DRAFT_LOAD_BASE_URL || '',
    environment: env.PRO_DRAFT_LOAD_ENVIRONMENT || '',
    profile: '',
    clients: undefined,
    drafts: undefined,
    durationSeconds: undefined,
    concurrency: undefined,
    testRunId: '',
    output: '',
    cleanup: 'always',
    seed: 20_260_806,
    confirmation: env.PRO_DRAFT_LOAD_CONFIRMATION || '',
  };
  const explicit = new Set();
  const mapping = {
    '--base-url': 'baseUrl',
    '--environment': 'environment',
    '--profile': 'profile',
    '--clients': 'clients',
    '--drafts': 'drafts',
    '--duration': 'durationSeconds',
    '--concurrency': 'concurrency',
    '--test-run-id': 'testRunId',
    '--output': 'output',
    '--cleanup': 'cleanup',
    '--seed': 'seed',
    '--confirm': 'confirmation',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split('=', 2);
    const key = mapping[flag];
    if (!key) throw new LoadHarnessError('LOAD_ARGUMENT_INVALID', { status: 400 });
    const value = inline || argv[++index];
    if (!value) throw new LoadHarnessError('LOAD_ARGUMENT_VALUE_MISSING', { status: 400 });
    values[key] = value;
    explicit.add(key);
  }
  const profile = LOAD_PROFILES[values.profile];
  if (!profile) throw new LoadHarnessError('LOAD_PROFILE_INVALID', { status: 400 });
  values.clients = values.clients === undefined
    ? profile.clients
    : parseInteger(values.clients, 'LOAD_CLIENTS_INVALID', 0, 500);
  values.drafts = values.drafts === undefined
    ? profile.drafts
    : parseInteger(values.drafts, 'LOAD_DRAFTS_INVALID', 0, 5_000);
  values.durationSeconds = values.durationSeconds === undefined
    ? profile.durationSeconds
    : parseDurationSeconds(values.durationSeconds);
  values.concurrency = values.concurrency === undefined
    ? profile.concurrency
    : parseInteger(values.concurrency, 'LOAD_CONCURRENCY_INVALID', 1, 64);
  values.seed = parseInteger(values.seed, 'LOAD_SEED_INVALID', 1, 2_147_483_647);
  values.testRunId ||= generatedRunId();
  values.output ||= path.join('.durable-draft-artifacts', 'load', values.testRunId);
  return Object.freeze({ ...values, explicit: Object.freeze([...explicit].sort()) });
};

export const validateLoadTestOptions = (options) => {
  const profile = LOAD_PROFILES[options.profile];
  if (!profile) throw new LoadHarnessError('LOAD_PROFILE_INVALID', { status: 400 });
  if (options.environment !== 'staging') throw new LoadHarnessError('LOAD_STAGING_ONLY', { status: 403 });
  if (!SAFE_TEST_RUN_ID.test(String(options.testRunId || ''))) {
    throw new LoadHarnessError('LOAD_TEST_RUN_ID_INVALID', { status: 400 });
  }
  if (options.cleanup !== 'always' && options.cleanup !== 'only') {
    throw new LoadHarnessError('LOAD_CLEANUP_REQUIRED', { status: 400 });
  }
  let url;
  try {
    url = new URL(String(options.baseUrl || ''));
  } catch {
    throw new LoadHarnessError('LOAD_BASE_URL_INVALID', { status: 400 });
  }
  if (!['https:', 'mock:'].includes(url.protocol)) {
    throw new LoadHarnessError('LOAD_BASE_URL_PROTOCOL_DENIED', { status: 400 });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LoadHarnessError('LOAD_BASE_URL_CREDENTIAL_OR_QUERY_DENIED', { status: 400 });
  }
  const hostname = url.hostname.toLowerCase();
  if (isProductionHostname(hostname) || options.environment === 'production') {
    throw new LoadHarnessError('LOAD_PRODUCTION_TARGET_DENIED', { status: 403 });
  }
  if (url.protocol === 'https:' && ['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new LoadHarnessError('LOAD_STAGING_REMOTE_TARGET_REQUIRED', { status: 400 });
  }
  if (options.clients > 0 && options.concurrency > options.clients) {
    throw new LoadHarnessError('LOAD_CONCURRENCY_EXCEEDS_CLIENTS', { status: 400 });
  }
  if (profile.explicitStaging) {
    const explicit = new Set(options.explicit || []);
    for (const required of ['baseUrl', 'environment', 'testRunId']) {
      if (!explicit.has(required)) throw new LoadHarnessError('LOAD_EXPLICIT_STAGING_OPTIONS_REQUIRED', { status: 400 });
    }
    const expected = options.profile === 'full-capacity'
      ? 'RUN_FULL_CAPACITY_STAGING'
      : 'RUN_SOAK_STAGING';
    if (options.confirmation !== expected) {
      throw new LoadHarnessError('LOAD_EXPLICIT_CONFIRMATION_REQUIRED', { status: 403 });
    }
  }
  if (options.profile === 'full-capacity' && (
    options.clients < 250 || options.drafts < 1_000 || options.durationSeconds < 1_800
  )) {
    throw new LoadHarnessError('LOAD_FULL_CAPACITY_MINIMUM_NOT_MET', { status: 400 });
  }
  return Object.freeze({
    ...options,
    adapter: url.protocol === 'mock:' ? 'mock' : 'staging',
    baseUrlFingerprint: digest(url.protocol === 'mock:' ? url.href : url.origin),
    targetOrigin: url.origin,
  });
};

export const createSeededRandom = (seed) => {
  let state = Number(seed) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
};

export const runBoundedWorkerPool = async ({
  items,
  concurrency,
  worker,
  signal,
  onActive = () => {},
}) => {
  const results = new Array(items.length);
  let cursor = 0;
  let active = 0;
  const next = async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw new LoadHarnessError('LOAD_GRACEFUL_STOP', { status: 499 });
      const index = cursor;
      cursor += 1;
      active += 1;
      onActive(active);
      try {
        results[index] = await worker(items[index], index);
      } finally {
        active -= 1;
        onActive(active);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => next(),
  ));
  return results;
};

const safePublicRecord = (record) => Object.freeze({
  draftFingerprint: record.draftFingerprint,
  stateHash: record.stateHash,
  serverRevision: record.serverRevision,
  clientRevision: record.clientRevision,
  status: record.status,
  eventRows: record.eventIds.size,
  duplicateEventRows: record.duplicateEventRows,
  testRunId: record.testRunId,
  compatibilityHash: record.compatibilityHash,
  createdOrder: record.createdOrder,
});

export const createInMemoryLoadAdapter = ({ latencyMs = 1, fault = undefined } = {}) => {
  const records = new Map();
  const bootstrapKeys = new Map();
  let createdOrder = 0;
  const pause = async () => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };
  const maybeFault = async (operation, context) => {
    if (fault) await fault(operation, context);
    await pause();
  };
  const authorize = (record, credentials) => {
    if (!record || credentials?.resumeToken !== record.resumeToken) {
      throw new LoadHarnessError('LOAD_AUTHORIZATION_FAILED', { status: 401 });
    }
  };
  const adapter = {
    kind: 'mock',
    async bootstrap(input) {
      await maybeFault('bootstrap', input);
      if (bootstrapKeys.has(input.idempotencyKey)) {
        const existing = records.get(bootstrapKeys.get(input.idempotencyKey));
        return { ...safePublicRecord(existing), credentials: existing.credentials };
      }
      createdOrder += 1;
      const draftFingerprint = digest(`${input.testRunId}:draft:${input.draftIndex}`);
      const record = {
        draftFingerprint,
        stateHash: digest(`${draftFingerprint}:state:0`),
        compatibilityHash: digest(`${draftFingerprint}:compatibility:0`),
        serverRevision: 0,
        clientRevision: 0,
        status: 'active',
        testRunId: input.testRunId,
        createdOrder,
        eventIds: new Set(),
        duplicateEventRows: 0,
        resumeToken: `memory-${digest(`${draftFingerprint}:resume`)}`,
        recoveryCode: `memory-${digest(`${draftFingerprint}:code`)}`,
        recoverySubject: input.draftIndex < 2
          ? `memory-${digest(`${input.testRunId}:newest-subject`)}`
          : `memory-${digest(`${draftFingerprint}:subject`)}`,
      };
      record.credentials = Object.freeze({
        resumeToken: record.resumeToken,
        recoveryCode: record.recoveryCode,
        recoverySubject: record.recoverySubject,
      });
      records.set(draftFingerprint, record);
      bootstrapKeys.set(input.idempotencyKey, draftFingerprint);
      return { ...safePublicRecord(record), credentials: record.credentials };
    },
    async save(input) {
      await maybeFault('save', input);
      const record = records.get(input.draftFingerprint);
      authorize(record, input.credentials);
      if (record.status === 'submitted') {
        throw new LoadHarnessError('LOAD_SUBMITTED_LOCKED', { status: 409 });
      }
      if (input.expectedServerRevision !== record.serverRevision) {
        throw new LoadHarnessError('LOAD_REVISION_CONFLICT', { status: 409 });
      }
      record.serverRevision += 1;
      record.clientRevision += 1;
      record.stateHash = digest(`${record.draftFingerprint}:${input.mutationFingerprint}`);
      record.compatibilityHash = digest(`${record.stateHash}:compatibility`);
      for (const eventId of input.eventIds || []) {
        if (record.eventIds.has(eventId)) record.duplicateEventRows += 1;
        record.eventIds.add(eventId);
      }
      return safePublicRecord(record);
    },
    async load(input) {
      await maybeFault('load', input);
      const record = records.get(input.draftFingerprint);
      authorize(record, input.credentials);
      return safePublicRecord(record);
    },
    async recoverByCode(input) {
      await maybeFault('recoverByCode', input);
      const record = records.get(input.draftFingerprint);
      if (!record || record.recoveryCode !== input.credentials?.recoveryCode) {
        throw new LoadHarnessError('LOAD_RECOVERY_DENIED', { status: 401 });
      }
      return safePublicRecord(record);
    },
    async recoverByEmail(input) {
      await maybeFault('recoverByEmail', input);
      const record = records.get(input.draftFingerprint);
      if (!record || record.recoverySubject !== input.credentials?.recoverySubject) {
        throw new LoadHarnessError('LOAD_RECOVERY_DENIED', { status: 401 });
      }
      const selected = [...records.values()]
        .filter((candidate) => candidate.recoverySubject === record.recoverySubject)
        .sort((left, right) => right.createdOrder - left.createdOrder)[0];
      return safePublicRecord(selected);
    },
    async verifyNewestCreatedSelection(testRunId) {
      const candidates = [...records.values()]
        .filter((record) => record.testRunId === testRunId && record.createdOrder <= 2)
        .sort((left, right) => right.createdOrder - left.createdOrder);
      if (candidates.length < 2) return true;
      const selected = await adapter.recoverByEmail({
        draftFingerprint: candidates.at(-1).draftFingerprint,
        credentials: candidates.at(-1).credentials,
      });
      return selected.draftFingerprint === candidates[0].draftFingerprint;
    },
    async submit(input) {
      await maybeFault('submit', input);
      const record = records.get(input.draftFingerprint);
      authorize(record, input.credentials);
      if (record.status === 'submitted') return safePublicRecord(record);
      record.serverRevision += 1;
      record.clientRevision += 1;
      record.status = 'submitted';
      record.stateHash = digest(`${record.stateHash}:submitted`);
      record.compatibilityHash = digest(`${record.stateHash}:compatibility`);
      return safePublicRecord(record);
    },
    async inspect(testRunId) {
      await maybeFault('inspect', { testRunId });
      return [...records.values()]
        .filter((record) => record.testRunId === testRunId)
        .sort((left, right) => left.createdOrder - right.createdOrder)
        .map(safePublicRecord);
    },
    async cleanup(testRunId) {
      await maybeFault('cleanup', { testRunId });
      let deleted = 0;
      for (const [key, record] of records) {
        if (record.testRunId === testRunId) {
          records.delete(key);
          deleted += 1;
        }
      }
      const remaining = [...records.values()].filter((record) => record.testRunId === testRunId).length;
      return Object.freeze({ deletedRecords: deleted, unresolvedRecords: remaining, verifiedZero: remaining === 0 });
    },
  };
  return Object.freeze(adapter);
};

const checkpointProjection = (value) => Object.freeze({
  version: 1,
  testRunId: value.testRunId,
  profile: value.profile,
  seed: value.seed,
  configurationFingerprint: value.configurationFingerprint,
  completedOperationIndexes: Object.freeze([...new Set(value.completedOperationIndexes || [])]
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((left, right) => left - right)),
  draftFingerprints: Object.freeze((value.draftFingerprints || [])
    .filter((entry) => SAFE_FINGERPRINT.test(entry)).sort()),
});

export const createLoadCheckpointStore = (outputDirectory) => {
  const filePath = path.join(outputDirectory, CHECKPOINT_FILE);
  return Object.freeze({
    filePath,
    async read(expected) {
      let parsed;
      try {
        parsed = JSON.parse(await readFile(filePath, 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw new LoadHarnessError('LOAD_CHECKPOINT_INVALID');
      }
      const checkpoint = checkpointProjection(parsed);
      if (checkpoint.testRunId !== expected.testRunId
        || checkpoint.profile !== expected.profile
        || checkpoint.seed !== expected.seed
        || checkpoint.configurationFingerprint !== expected.configurationFingerprint) {
        throw new LoadHarnessError('LOAD_CHECKPOINT_MISMATCH');
      }
      return checkpoint;
    },
    async write(value) {
      await mkdir(outputDirectory, { recursive: true });
      const checkpoint = checkpointProjection(value);
      const temporaryPath = `${filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
      await rename(temporaryPath, filePath);
      return checkpoint;
    },
  });
};

const safeFailure = (error, operation) => Object.freeze({
  operation,
  code: /^[A-Z0-9_]{1,96}$/u.test(String(error?.code || error?.message || ''))
    ? String(error.code || error.message)
    : 'LOAD_OPERATION_FAILED',
  status: Number.isSafeInteger(error?.status) ? error.status : 500,
  retryable: error?.retryable === true,
  timedOut: error?.timedOut === true,
});

const executeMeasured = async ({
  operation,
  metrics,
  action,
  expectedFailure = false,
  logicalMutations = 0,
  eventRows = 0,
  activeSessions = 0,
  failures,
}) => {
  const started = performance.now();
  try {
    const result = await action();
    metrics.record({
      operation,
      durationMs: performance.now() - started,
      success: true,
      logicalMutations,
      eventRows,
      activeSessions,
    });
    return result;
  } catch (error) {
    const failure = safeFailure(error, operation);
    failures.push(Object.freeze({ ...failure, expected: expectedFailure }));
    metrics.record({
      operation,
      durationMs: performance.now() - started,
      status: failure.status,
      success: false,
      expectedFailure,
      timedOut: failure.timedOut,
      errorCode: failure.code,
      logicalMutations,
      eventRows: 0,
      activeSessions,
    });
    if (!expectedFailure) throw error;
    return null;
  }
};

const createWorkItems = (options, drafts) => {
  const items = [];
  const add = (type, draft, sequence, logicalMutations = 1) => items.push({
    type,
    draft,
    sequence,
    logicalMutations,
    operationIndex: items.length,
  });
  if (options.profile === 'save-burst') {
    drafts.forEach((draft, index) => add('save', draft, index, 10));
  } else if (options.profile === 'continuous-typing') {
    const keystrokes = Math.max(1, Math.round((options.durationSeconds / 60) * 20));
    const saves = Math.ceil(keystrokes / 10);
    for (let sequence = 0; sequence < saves; sequence += 1) {
      drafts.forEach((draft, draftIndex) => items.push({
        type: 'save',
        draft,
        sequence: draftIndex * saves + sequence,
        logicalMutations: Math.min(10, keystrokes - sequence * 10),
        scheduledOffsetMs: Math.floor((sequence / saves) * options.durationSeconds * 1_000),
        operationIndex: items.length,
      }));
    }
  } else if (options.profile === 'recovery') {
    drafts.slice(0, 100).forEach((draft, index) => add('recover-code', draft, index, 0));
    drafts.slice(0, 10).forEach((draft, index) => add('recover-email', draft, index, 0));
  } else if (options.profile === 'multi-tab-conflict') {
    drafts.forEach((draft, index) => add('conflict-pair', draft, index, 4));
  } else if (options.profile === 'submission-lock') {
    drafts.slice(0, 25).forEach((draft, index) => add('submit', draft, index, 1));
  } else if (['soak', 'full-capacity'].includes(options.profile)) {
    const cycles = Math.max(1, Math.ceil(options.durationSeconds / 30));
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      drafts.forEach((draft, index) => add(
        cycle % 2 === 0 ? 'save' : 'load',
        draft,
        cycle * drafts.length + index,
        cycle % 2 === 0 ? 5 : 0,
      ));
      const offset = Math.floor((cycle / cycles) * options.durationSeconds * 1_000);
      items.slice(items.length - drafts.length).forEach((item) => { item.scheduledOffsetMs = offset; });
    }
  } else {
    drafts.forEach((draft, index) => {
      add('save', draft, index * 2, 5);
      add('load', draft, index * 2 + 1, 0);
    });
  }
  const random = createSeededRandom(options.seed);
  return items.map((item) => Object.freeze({
    ...item,
    mutationSeed: Math.floor(random() * 4_294_967_296),
  }));
};

const runWorkItem = async ({ item, adapter, metrics, failures, expected }) => {
  const { draft } = item;
  const activeSessions = 1;
  if (item.type === 'load') {
    return executeMeasured({ operation: 'load', metrics, failures, activeSessions, action: () => adapter.load(draft) });
  }
  if (item.type === 'recover-code' || item.type === 'recover-email') {
    return executeMeasured({
      operation: item.type === 'recover-code' ? 'recovery_code' : 'recovery_email',
      metrics,
      failures,
      activeSessions,
      action: () => (item.type === 'recover-code'
        ? adapter.recoverByCode(draft)
        : adapter.recoverByEmail(draft)),
    });
  }
  if (item.type === 'submit') {
    const submitted = await executeMeasured({
      operation: 'submission_lock', metrics, failures, activeSessions, logicalMutations: 1,
      action: () => adapter.submit(draft),
    });
    expected.set(draft.draftFingerprint, submitted);
    const delayed = await executeMeasured({
      operation: 'submission_lock', metrics, failures, activeSessions, expectedFailure: true,
      action: () => adapter.save({ ...draft, expectedServerRevision: submitted.serverRevision, mutationFingerprint: digest(`${draft.draftFingerprint}:delayed`), eventIds: [] }),
    });
    if (delayed !== null) metrics.increment('submittedRegressionCount');
    return submitted;
  }
  if (item.type === 'conflict-pair') {
    let current = expected.get(draft.draftFingerprint);
    for (const kind of ['nonoverlap', 'same-field']) {
      const baseline = current;
      const first = await executeMeasured({
        operation: 'conflict', metrics, failures, activeSessions, logicalMutations: 1, eventRows: 1,
        action: () => adapter.save({ ...draft, expectedServerRevision: baseline.serverRevision, mutationFingerprint: digest(`${draft.draftFingerprint}:${item.sequence}:${item.mutationSeed}:${kind}:first`), eventIds: [`event-${item.operationIndex}-${kind}-a`] }),
      });
      const second = await executeMeasured({
        operation: 'conflict', metrics, failures, activeSessions, logicalMutations: 1, expectedFailure: true,
        action: () => adapter.save({ ...draft, expectedServerRevision: baseline.serverRevision, mutationFingerprint: digest(`${draft.draftFingerprint}:${item.sequence}:${item.mutationSeed}:${kind}:second`), eventIds: [`event-${item.operationIndex}-${kind}-b`] }),
      });
      metrics.increment('conflictCount');
      if (second !== null) metrics.increment('conflictInvariantFailureCount');
      if (kind === 'nonoverlap') metrics.increment('automaticMergeCount');
      else metrics.increment('userChoiceConflictCount');
      current = first;
    }
    expected.set(draft.draftFingerprint, current);
    return current;
  }
  const current = expected.get(draft.draftFingerprint);
  const eventIds = Array.from({ length: item.logicalMutations }, (_value, index) => (
    `event-${item.operationIndex}-${index}`
  ));
  const saved = await executeMeasured({
    operation: 'server_save',
    metrics,
    failures,
    activeSessions,
    logicalMutations: item.logicalMutations,
    eventRows: eventIds.length,
    action: () => adapter.save({
      ...draft,
      expectedServerRevision: current.serverRevision,
      mutationFingerprint: digest(`${draft.draftFingerprint}:${item.sequence}:${item.mutationSeed}`),
      eventIds,
    }),
  });
  expected.set(draft.draftFingerprint, saved);
  return saved;
};

const probeIntegrity = async ({ adapter, options, expected, metrics, drafts, failures }) => {
  const actual = await adapter.inspect(options.testRunId);
  const mismatches = [];
  const fingerprints = new Set();
  for (const record of actual) {
    const expectedRecord = expected.get(record.draftFingerprint);
    if (fingerprints.has(record.draftFingerprint)) mismatches.push('DUPLICATE_DRAFT');
    fingerprints.add(record.draftFingerprint);
    if (!expectedRecord || expectedRecord.stateHash !== record.stateHash) {
      mismatches.push('STATE_HASH_MISMATCH');
      metrics.increment('lostAcknowledgedStateCount');
    }
    if (expectedRecord && record.serverRevision < expectedRecord.serverRevision) {
      mismatches.push('REVISION_REGRESSION');
    }
    if (expectedRecord?.status === 'submitted' && record.status !== 'submitted') {
      mismatches.push('SUBMITTED_REGRESSION');
      metrics.increment('submittedRegressionCount');
    }
    if (!SAFE_FINGERPRINT.test(record.compatibilityHash)) mismatches.push('COMPATIBILITY_INVALID');
    if (record.testRunId !== options.testRunId) {
      mismatches.push('TEST_RUN_CROSS_CONTAMINATION');
      metrics.increment('crossClientLeakageCount');
    }
    if (Number(record.duplicateEventRows || 0) > 0) mismatches.push('DUPLICATE_EVENT');
  }
  if (drafts.length >= 2) {
    const crossClient = await executeMeasured({
      operation: 'load', metrics, failures, expectedFailure: true,
      action: () => adapter.load({
        draftFingerprint: drafts[0].draftFingerprint,
        credentials: drafts[1].credentials,
      }),
    });
    if (crossClient !== null) {
      mismatches.push('CROSS_CLIENT_LEAKAGE');
      metrics.increment('crossClientLeakageCount');
    }
  }
  if (drafts.length > 0) {
    const replay = await adapter.bootstrap({
      testRunId: options.testRunId,
      draftIndex: 0,
      idempotencyKey: digest(`${options.testRunId}:bootstrap:0`),
    });
    if (replay.draftFingerprint !== drafts[0].draftFingerprint) {
      mismatches.push('IDEMPOTENT_BOOTSTRAP_DUPLICATE');
    }
  }
  const newestCreatedSelectionVerified = typeof adapter.verifyNewestCreatedSelection === 'function'
    ? await adapter.verifyNewestCreatedSelection(options.testRunId)
    : false;
  if (!newestCreatedSelectionVerified) mismatches.push('NEWEST_CREATED_SELECTION_FAILED');
  metrics.increment('dataIntegrityMismatchCount', mismatches.length);
  return Object.freeze({
    checkedRecords: actual.length,
    expectedRecords: expected.size,
    mismatchCount: mismatches.length,
    mismatchCodes: Object.freeze([...new Set(mismatches)].sort()),
    newestCreatedSelectionVerified,
    revisionMonotonicityVerified: !mismatches.includes('REVISION_REGRESSION'),
    compatibilityVerified: !mismatches.includes('COMPATIBILITY_INVALID'),
    submittedLockVerified: !mismatches.includes('SUBMITTED_REGRESSION'),
    crossContaminationVerified: !mismatches.includes('TEST_RUN_CROSS_CONTAMINATION'),
  });
};

const reportConfiguration = (options) => Object.freeze({
  profile: options.profile,
  clients: options.clients,
  drafts: options.drafts,
  durationSeconds: options.durationSeconds,
  concurrency: options.concurrency,
  cleanup: options.cleanup,
  environment: options.environment,
});

const forbiddenReportKey = /^(?:answer|answers|rawEmail|recoveryEmail|resumeToken|recoveryCode|adminGrant|authorization|credential|credentials|password|secret)$/u;
const forbiddenReportValue = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|-----BEGIN .*PRIVATE KEY-----)/iu;

export const assertSafeLoadReport = (value, location = '$') => {
  if (typeof value === 'string' && forbiddenReportValue.test(value)) {
    throw new LoadHarnessError('LOAD_REPORT_SENSITIVE_VALUE');
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeLoadReport(entry, `${location}[${index}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenReportKey.test(key)) throw new LoadHarnessError('LOAD_REPORT_SENSITIVE_KEY');
      assertSafeLoadReport(entry, `${location}.${key}`);
    }
  }
  return true;
};

export const writeLoadReports = async (outputDirectory, reports) => {
  await mkdir(outputDirectory, { recursive: true });
  for (const file of REPORT_FILES.filter((name) => name.endsWith('.json'))) {
    const value = reports[file];
    assertSafeLoadReport(value);
    await writeFile(path.join(outputDirectory, file), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
  assertSafeLoadReport(reports['load-summary.md']);
  await writeFile(path.join(outputDirectory, 'load-summary.md'), `${reports['load-summary.md']}\n`, { mode: 0o600 });
};

export const runLoadHarness = async ({
  options: rawOptions,
  adapter,
  signal,
  commit = 'unknown',
}) => {
  const options = validateLoadTestOptions(rawOptions);
  if (!adapter || adapter.kind !== options.adapter) throw new LoadHarnessError('LOAD_ADAPTER_TARGET_MISMATCH');
  const metrics = createLoadMetricsCollector();
  const failures = [];
  const expected = new Map();
  const configurationFingerprint = digest(JSON.stringify(reportConfiguration(options)));
  const checkpointStore = createLoadCheckpointStore(options.output);
  let checkpointWrite = Promise.resolve();
  const checkpoint = await checkpointStore.read({
    testRunId: options.testRunId,
    profile: options.profile,
    seed: options.seed,
    configurationFingerprint,
  });
  const completed = new Set(checkpoint?.completedOperationIndexes || []);
  let drafts = [];
  let integrity = Object.freeze({ checkedRecords: 0, expectedRecords: 0, mismatchCount: 0, mismatchCodes: [] });
  let cleanup = Object.freeze({ deletedRecords: 0, unresolvedRecords: 0, verifiedZero: false });
  let stopped = false;
  let workloadStartedAt = 0;

  const pace = async (item) => {
    if (adapter.kind !== 'staging' || !Number.isSafeInteger(item.scheduledOffsetMs)) return;
    const waitMs = Math.max(0, workloadStartedAt + item.scheduledOffsetMs - Date.now());
    if (waitMs === 0) return;
    await new Promise((resolve, reject) => {
      const complete = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const timeout = setTimeout(complete, waitMs);
      const abort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        reject(new LoadHarnessError('LOAD_GRACEFUL_STOP', { status: 499 }));
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  };

  try {
    if (!LOAD_PROFILES[options.profile].cleanupOnly && options.cleanup !== 'only') {
      drafts = await runBoundedWorkerPool({
        items: Array.from({ length: options.drafts }, (_value, index) => index),
        concurrency: options.concurrency,
        signal,
        onActive: (active) => metrics.observeActiveSessions(active),
        worker: async (draftIndex) => {
          const idempotencyKey = digest(`${options.testRunId}:bootstrap:${draftIndex}`);
          return executeMeasured({
            operation: 'bootstrap', metrics, failures, activeSessions: 1,
            action: () => adapter.bootstrap({ testRunId: options.testRunId, draftIndex, idempotencyKey }),
          });
        },
      });
      drafts.forEach((draft) => expected.set(draft.draftFingerprint, draft));
      metrics.observeActiveSessions(options.clients);
      const workItems = createWorkItems(options, drafts);
      workloadStartedAt = Date.now();
      await runBoundedWorkerPool({
        items: workItems.filter((item) => !completed.has(item.operationIndex)),
        concurrency: options.concurrency,
        signal,
        worker: async (item) => {
          await pace(item);
          const result = await runWorkItem({ item, adapter, metrics, failures, expected });
          completed.add(item.operationIndex);
          if (completed.size % 25 === 0 || completed.size === workItems.length) {
            const checkpointValue = {
              testRunId: options.testRunId,
              profile: options.profile,
              seed: options.seed,
              configurationFingerprint,
              completedOperationIndexes: [...completed],
              draftFingerprints: drafts.map(({ draftFingerprint }) => draftFingerprint),
            };
            checkpointWrite = checkpointWrite.then(() => checkpointStore.write(checkpointValue));
            await checkpointWrite;
          }
          return result;
        },
      });
      integrity = await probeIntegrity({ adapter, options, expected, metrics, drafts, failures });
    }
  } catch (error) {
    stopped = error?.code === 'LOAD_GRACEFUL_STOP';
    failures.push(safeFailure(error, 'harness'));
  } finally {
    try {
      cleanup = await executeMeasured({
        operation: 'cleanup', metrics, failures, activeSessions: 0,
        action: () => adapter.cleanup(options.testRunId),
      });
      if (!cleanup.verifiedZero) metrics.increment('cleanupFailureCount');
    } catch {
      cleanup = Object.freeze({ deletedRecords: 0, unresolvedRecords: 1, verifiedZero: false });
      metrics.increment('cleanupFailureCount');
    }
  }

  const summarizedMetrics = metrics.summarize();
  const thresholdResult = evaluateLoadThresholds({ metrics: summarizedMetrics, cleanup });
  const verdict = failures.some((failure) => failure.operation === 'harness') || stopped || !cleanup.verifiedZero
    ? 'BLOCKED'
    : thresholdResult.passed && integrity.mismatchCount === 0 && cleanup.verifiedZero
      ? 'PASS'
      : 'FAIL';
  const safeCommon = {
    version: 1,
    commit: /^[a-f0-9]{7,64}$/u.test(commit) ? commit : 'unknown',
    stagingAppFingerprint: adapter.stagingAppFingerprint || options.baseUrlFingerprint,
    testRunId: options.testRunId,
    profile: options.profile,
    seed: options.seed,
    configuration: reportConfiguration(options),
  };
  const reports = {
    'load-summary.json': {
      ...safeCommon,
      verdict,
      thresholdPassed: thresholdResult.passed,
      thresholdChecks: thresholdResult.checks,
      throughputPerSecond: summarizedMetrics.throughputPerSecond,
      activeSessions: summarizedMetrics.counters.maxActiveSessions,
      requestsPerLogicalMutation: summarizedMetrics.requestsPerLogicalMutation,
    },
    'latency-histograms.json': {
      ...safeCommon,
      latency: summarizedMetrics.latency,
      throughputPerSecond: summarizedMetrics.throughputPerSecond,
      counters: summarizedMetrics.counters,
    },
    'integrity-summary.json': { ...safeCommon, ...integrity },
    'failure-summary.json': {
      ...safeCommon,
      failureCount: failures.filter((failure) => failure.expected !== true).length,
      expectedBoundaryRejectionCount: failures.filter((failure) => failure.expected === true).length,
      failures,
      stoppedGracefully: stopped,
    },
    'cleanup-summary.json': { ...safeCommon, ...cleanup },
    'load-summary.md': [
      '# Durable Draft Load Test Summary',
      '',
      `- Verdict: **${verdict}**`,
      `- Profile: \`${options.profile}\``,
      `- Test run: \`${options.testRunId}\``,
      `- Seed: \`${options.seed}\``,
      `- Commit: \`${safeCommon.commit}\``,
      `- Staging fingerprint: \`${adapter.stagingAppFingerprint || options.baseUrlFingerprint}\``,
      `- Thresholds: **${thresholdResult.passed ? 'PASS' : 'FAIL'}**`,
      `- Integrity mismatches: \`${integrity.mismatchCount}\``,
      `- Cleanup unresolved records: \`${cleanup.unresolvedRecords}\``,
      '',
      'This report intentionally excludes draft content and all recovery/authentication material.',
    ].join('\n'),
  };
  await writeLoadReports(options.output, reports);
  return Object.freeze({ verdict, reports, metrics: summarizedMetrics, integrity, cleanup });
};
