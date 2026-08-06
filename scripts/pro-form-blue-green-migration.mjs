#!/usr/bin/env node

import { createHmac, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATION_CLI_COMMANDS = Object.freeze([
  'plan', 'export', 'import', 'finalize', 'verify', 'status',
]);
export const APPLY_CONFIRMATION = 'APPLY_CROSS_APP_MIGRATION';
const ENTITIES = Object.freeze([
  'ProFormDraft', 'ProFormDraftEvent', 'ProFormSubmission',
  'ProFormSubmissionIntake', 'ProFormRecoverySecurityEvent',
]);
const FORBIDDEN_REPORT_KEYS = /(?:bundle|records?|admin.?grant|authorization|token|password|secret|email|answers?|data)/iu;
const FORBIDDEN_FLAG = /(?:grant|authorization|token|password|secret|app.?id|base.?url|device.?id)/iu;
const BINDING_PURPOSE = 'pro-form:cross-app-migration-authorization-binding:v1:';

export class MigrationCliError extends Error {
  constructor(code) {
    super('The migration CLI operation was rejected.');
    this.name = 'MigrationCliError';
    this.code = code;
  }
}
const fail = (code) => { throw new MigrationCliError(code); };
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stableValue(value[key])]));
};
const stableSerialize = (value) => JSON.stringify(stableValue(value));
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);

export function parseMigrationCliArguments(argv) {
  const [command, ...args] = argv;
  if (!MIGRATION_CLI_COMMANDS.includes(command)) return fail('MIGRATION_CLI_COMMAND_INVALID');
  const options = { command, dryRun: false, apply: false, confirm: null, encryptedExport: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) return fail('MIGRATION_CLI_ARGUMENT_INVALID');
    const [rawKey, inlineValue] = argument.slice(2).split('=', 2);
    if (FORBIDDEN_FLAG.test(rawKey)) return fail('MIGRATION_CLI_SECRET_ARGUMENT_REJECTED');
    if (rawKey === 'dry-run') options.dryRun = true;
    else if (rawKey === 'apply') options.apply = true;
    else if (rawKey === 'encrypted-export') options.encryptedExport = true;
    else if (rawKey === 'confirm') {
      options.confirm = inlineValue ?? args[++index];
    } else if (rawKey === 'conflict-threshold') {
      const value = inlineValue ?? args[++index];
      if (!/^\d+$/u.test(value ?? '')) return fail('MIGRATION_CLI_ARGUMENT_INVALID');
      options.conflictThreshold = Number(value);
    } else return fail('MIGRATION_CLI_ARGUMENT_INVALID');
  }
  if (options.dryRun && options.apply) return fail('MIGRATION_CLI_MODE_CONFLICT');
  if (options.encryptedExport) return fail('MIGRATION_CLI_ENCRYPTED_EXPORT_NOT_IMPLEMENTED');
  if (options.apply && options.confirm !== APPLY_CONFIRMATION) {
    return fail('MIGRATION_CLI_APPLY_CONFIRMATION_REQUIRED');
  }
  return Object.freeze(options);
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') return fail(`MIGRATION_CLI_${name}_MISSING`);
  return value.trim();
}

function decodeAuthorizationMetadata(token) {
  try {
    const [payload] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!safeId(claims.batchId) || !safeId(claims.migrationDirection)) throw new Error();
    return Object.freeze({ batchId: claims.batchId, direction: claims.migrationDirection });
  } catch {
    return fail('MIGRATION_CLI_AUTHORIZATION_METADATA_INVALID');
  }
}

export function loadMigrationCliConfig(env = process.env) {
  const authorization = required(env, 'PRO_MIGRATION_AUTHORIZATION');
  const metadata = decodeAuthorizationMetadata(authorization);
  const config = {
    sourceBaseUrl: required(env, 'PRO_MIGRATION_SOURCE_BASE_URL'),
    destinationBaseUrl: required(env, 'PRO_MIGRATION_DESTINATION_BASE_URL'),
    sourceAppId: required(env, 'PRO_MIGRATION_SOURCE_APP_ID'),
    destinationAppId: required(env, 'PRO_MIGRATION_DESTINATION_APP_ID'),
    sourceAdminGrant: required(env, 'PRO_MIGRATION_SOURCE_ADMIN_GRANT'),
    destinationAdminGrant: required(env, 'PRO_MIGRATION_DESTINATION_ADMIN_GRANT'),
    sourceDeviceId: required(env, 'PRO_MIGRATION_SOURCE_DEVICE_ID'),
    destinationDeviceId: required(env, 'PRO_MIGRATION_DESTINATION_DEVICE_ID'),
    authorization,
    direction: required(env, 'PRO_MIGRATION_DIRECTION'),
    reportDir: path.resolve(required(env, 'PRO_MIGRATION_REPORT_DIR')),
    sourceEnvironment: required(env, 'PRO_MIGRATION_SOURCE_ENVIRONMENT'),
    destinationEnvironment: required(env, 'PRO_MIGRATION_DESTINATION_ENVIRONMENT'),
    batchId: metadata.batchId,
    testMode: env.PRO_MIGRATION_TEST_MODE ?? null,
  };
  for (const url of [config.sourceBaseUrl, config.destinationBaseUrl]) {
    let parsed;
    try { parsed = new URL(url); } catch { return fail('MIGRATION_CLI_URL_INVALID'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password
      || (parsed.protocol === 'http:' && parsed.hostname !== 'localhost')) {
      return fail('MIGRATION_CLI_URL_INVALID');
    }
  }
  if (!safeId(config.sourceAppId) || !safeId(config.destinationAppId)
    || config.sourceAppId === config.destinationAppId
    || !['blue_to_green', 'green_to_blue'].includes(config.direction)
    || config.direction !== metadata.direction) {
    return fail('MIGRATION_CLI_ROUTE_INVALID');
  }
  if (config.sourceEnvironment !== config.destinationEnvironment) {
    return fail('MIGRATION_CLI_ENVIRONMENT_CROSSING_REJECTED');
  }
  if (config.sourceEnvironment !== 'production') {
    if (!['staging', 'test'].includes(config.sourceEnvironment)
      || config.testMode !== 'staging_fixture') {
      return fail('MIGRATION_CLI_TEST_MODE_REQUIRED');
    }
  }
  return Object.freeze(config);
}

export function redactMigrationUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//<redacted-host>`;
  } catch { return '<invalid-url>'; }
}

export function calculateLocalBundleHash(bundle) {
  const { signature: _signature, ...unsigned } = bundle;
  return createHash('sha256').update(stableSerialize(unsigned)).digest('hex');
}

export function bindMigrationAuthorization(authorization, bundleHash) {
  if (!/^[a-f0-9]{64}$/u.test(bundleHash)) return fail('MIGRATION_CLI_BUNDLE_HASH_INVALID');
  const binding = createHmac('sha256', authorization)
    .update(`${BINDING_PURPOSE}${bundleHash}`).digest('base64url');
  return `${authorization}.${binding}`;
}

function assertSafeReport(value, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeReport(entry, [...pathParts, String(index)]));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEYS.test(key)) return fail('MIGRATION_CLI_UNSAFE_REPORT_REJECTED');
    assertSafeReport(child, [...pathParts, key]);
  }
}

export async function writeSafeMigrationReport(reportDir, name, report) {
  assertSafeReport(report);
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(name)) return fail('MIGRATION_CLI_REPORT_NAME_INVALID');
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  const destination = path.join(reportDir, `${name}.json`);
  await writeFile(destination, `${JSON.stringify(stableValue(report), null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600,
  });
  return destination;
}

async function readResumeState(config) {
  const file = path.join(config.reportDir, `resume-${config.batchId}.json`);
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (value.version !== 1 || value.batchId !== config.batchId
      || !Number.isInteger(value.sequence) || value.sequence < -1
      || (value.lastHash !== null && !/^[a-f0-9]{64}$/u.test(value.lastHash))) throw new Error();
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, batchId: config.batchId, sequence: -1, lastHash: null, entityIndex: 0, cursor: null, snapshotCutoff: null };
    return fail('MIGRATION_CLI_RESUME_STATE_INVALID');
  }
}

async function invokeFunction(fetchImpl, baseUrl, functionName, payload) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/u, '')}/functions/${functionName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(payload),
  });
  let result;
  try { result = await response.json(); } catch { return fail('MIGRATION_CLI_RESPONSE_INVALID'); }
  if (!response.ok || result?.success === false) {
    const code = typeof result?.errorCode === 'string' ? result.errorCode : 'MIGRATION_CLI_REMOTE_FAILURE';
    return fail(code);
  }
  return result;
}

function baseRequest(config, destination = false) {
  return {
    apiVersion: 1,
    adminGrant: destination ? config.destinationAdminGrant : config.sourceAdminGrant,
    deviceId: destination ? config.destinationDeviceId : config.sourceDeviceId,
    migrationAuthorization: config.authorization,
    migrationDirection: config.direction,
    batchId: config.batchId,
  };
}

function safePlan(config, command, apply) {
  return Object.freeze({
    version: 1,
    command,
    apply,
    direction: config.direction,
    sourceEnvironment: config.sourceEnvironment,
    destinationEnvironment: config.destinationEnvironment,
    sourceEndpoint: redactMigrationUrl(config.sourceBaseUrl),
    destinationEndpoint: redactMigrationUrl(config.destinationBaseUrl),
    entityNames: ENTITIES,
    streamsInMemory: true,
    protectedPayloadPersistence: false,
    deletesSupported: false,
  });
}

export async function runMigrationCli(options, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const config = loadMigrationCliConfig(env);
  const plan = safePlan(config, options.command, options.apply === true);
  if (options.command === 'plan') return plan;
  if (typeof fetchImpl !== 'function') return fail('MIGRATION_CLI_FETCH_UNAVAILABLE');
  if (options.command === 'status' || options.command === 'verify') {
    const status = await invokeFunction(fetchImpl, config.destinationBaseUrl,
      'getProFormMigrationStatus', {
        ...baseRequest(config, true), sourceAppId: config.sourceAppId,
      });
    const safe = { ...plan, status: status.status ?? status };
    if (options.command === 'verify') {
      const body = safe.status;
      const conflicts = Number(body?.conflictCount?.count ?? 0);
      const unresolved = Number(body?.unresolvedRelationshipCount?.count ?? 0);
      return { ...safe, verified: conflicts === 0 && unresolved === 0 };
    }
    return safe;
  }
  if (options.command === 'finalize') {
    const result = await invokeFunction(fetchImpl, config.destinationBaseUrl,
      'finalizeProFormMigrationRelationships', {
        ...baseRequest(config, true),
        sourceAppId: config.sourceAppId,
        apply: options.apply === true,
      });
    return { ...plan, counts: result.counts, cutoverReady: result.cutoverReady === true };
  }
  const state = await readResumeState(config);
  const maxEntities = options.command === 'export' ? 1 : ENTITIES.length;
  const aggregate = { scanned: 0, exported: 0, created: 0, updated: 0, unchanged: 0, conflicted: 0, failed: 0 };
  for (let entityIndex = state.entityIndex; entityIndex < maxEntities; entityIndex += 1) {
    const entityName = ENTITIES[entityIndex];
    let cursor = entityIndex === state.entityIndex ? state.cursor : null;
    let snapshotCutoff = entityIndex === state.entityIndex ? state.snapshotCutoff : null;
    do {
      const sequence = state.sequence + 1;
      const exported = await invokeFunction(fetchImpl, config.sourceBaseUrl,
        'exportProFormMigrationBatch', {
          ...baseRequest(config),
          destinationAppId: config.destinationAppId,
          entityName,
          pageSize: 100,
          cursor,
          snapshotCutoff,
          previousBundleHash: state.lastHash,
          sequence,
          includeTestRecords: config.testMode === 'staging_fixture',
          ...(config.testMode === 'staging_fixture' ? { testRunId: 'migration-cli-fixture' } : {}),
        });
      const bundle = exported.bundle;
      const bundleHash = calculateLocalBundleHash(bundle);
      aggregate.scanned += Number(exported.counts?.scanned ?? 0);
      aggregate.exported += Number(exported.counts?.exported ?? 0);
      if (options.command === 'import') {
        const imported = await invokeFunction(fetchImpl, config.destinationBaseUrl,
          'importProFormMigrationBatch', {
            ...baseRequest(config, true),
            migrationAuthorization: bindMigrationAuthorization(config.authorization, bundleHash),
            bundle,
            apply: options.apply === true,
          });
        for (const key of ['created', 'updated', 'unchanged', 'conflicted', 'failed']) {
          aggregate[key] += Number(imported.counts?.[key] ?? 0);
        }
        if (aggregate.conflicted > (options.conflictThreshold ?? 0)) {
          return fail('MIGRATION_CLI_CONFLICT_THRESHOLD_EXCEEDED');
        }
      }
      cursor = exported.nextCursor;
      snapshotCutoff = exported.snapshotCutoff;
      if (options.apply === true) {
        state.sequence = sequence;
        state.lastHash = bundleHash;
      }
      state.entityIndex = entityIndex;
      state.cursor = cursor;
      state.snapshotCutoff = snapshotCutoff;
      if (options.apply === true) {
        await writeSafeMigrationReport(config.reportDir, `resume-${config.batchId}`, state);
      }
      if (options.command === 'export') cursor = null;
    } while (cursor);
    state.entityIndex = entityIndex + 1;
    state.cursor = null;
    state.snapshotCutoff = null;
  }
  const report = { ...plan, counts: aggregate, complete: true };
  await writeSafeMigrationReport(config.reportDir, `${options.command}-${config.batchId}`, report);
  return report;
}

async function main() {
  try {
    const options = parseMigrationCliArguments(process.argv.slice(2));
    const result = await runMigrationCli(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof MigrationCliError ? error.code : 'MIGRATION_CLI_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
