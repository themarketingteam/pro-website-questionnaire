import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  APPLY_CONFIRMATION,
  bindMigrationAuthorization,
  calculateLocalBundleHash,
  loadMigrationCliConfig,
  parseMigrationCliArguments,
  redactMigrationUrl,
  runMigrationCli,
} from '../../scripts/pro-form-blue-green-migration.mjs';

const claims = Buffer.from(JSON.stringify({ batchId: 'batch-1', migrationDirection: 'blue_to_green' })).toString('base64url');
const authorization = `${claims}.synthetic-signature`;
const env = (reportDir, patch = {}) => ({
  PRO_MIGRATION_SOURCE_BASE_URL: 'https://blue.synthetic.test',
  PRO_MIGRATION_DESTINATION_BASE_URL: 'https://green.synthetic.test',
  PRO_MIGRATION_SOURCE_APP_ID: 'app-blue-test',
  PRO_MIGRATION_DESTINATION_APP_ID: 'app-green-test',
  PRO_MIGRATION_SOURCE_ADMIN_GRANT: 'synthetic.source-grant',
  PRO_MIGRATION_DESTINATION_ADMIN_GRANT: 'synthetic.destination-grant',
  PRO_MIGRATION_SOURCE_DEVICE_ID: 'source-device',
  PRO_MIGRATION_DESTINATION_DEVICE_ID: 'destination-device',
  PRO_MIGRATION_AUTHORIZATION: authorization,
  PRO_MIGRATION_DIRECTION: 'blue_to_green',
  PRO_MIGRATION_REPORT_DIR: reportDir,
  PRO_MIGRATION_SOURCE_ENVIRONMENT: 'production',
  PRO_MIGRATION_DESTINATION_ENVIRONMENT: 'production',
  ...patch,
});
const bundle = { bundleVersion: 1, entityName: 'ProFormDraft', batchId: 'batch-1', recordCount: 1, records: [{ data: { responses_json: 'synthetic-private-answer' } }], signature: 'signature' };
const response = (body) => ({ ok: true, json: async () => ({ success: true, ...body }) });

describe('blue/green migration CLI safety', () => {
  it('supports the six required commands', () => {
    for (const command of ['plan', 'export', 'import', 'finalize', 'verify', 'status']) {
      expect(parseMigrationCliArguments([command]).command).toBe(command);
    }
  });

  it('rejects secrets and app IDs supplied as command-line arguments', () => {
    expect(() => parseMigrationCliArguments(['plan', '--admin-grant=x'])).toThrowError(expect.objectContaining({ code: 'MIGRATION_CLI_SECRET_ARGUMENT_REJECTED' }));
    expect(() => parseMigrationCliArguments(['plan', '--source-app-id=x'])).toThrowError(expect.objectContaining({ code: 'MIGRATION_CLI_SECRET_ARGUMENT_REJECTED' }));
  });

  it('requires explicit apply and the exact confirmation phrase', () => {
    expect(() => parseMigrationCliArguments(['import', '--apply'])).toThrowError(expect.objectContaining({ code: 'MIGRATION_CLI_APPLY_CONFIRMATION_REQUIRED' }));
    expect(parseMigrationCliArguments(['import', '--apply', '--confirm', APPLY_CONFIRMATION])).toMatchObject({ apply: true });
  });

  it('blocks raw and not-yet-implemented encrypted disk export', () => {
    expect(() => parseMigrationCliArguments(['export', '--encrypted-export'])).toThrowError(expect.objectContaining({ code: 'MIGRATION_CLI_ENCRYPTED_EXPORT_NOT_IMPLEMENTED' }));
  });

  it('rejects same-app and cross-environment routes', () => {
    expect(() => loadMigrationCliConfig(env('/tmp/report', { PRO_MIGRATION_DESTINATION_APP_ID: 'app-blue-test' }))).toThrowError(expect.objectContaining({ code: 'MIGRATION_CLI_ROUTE_INVALID' }));
    expect(() => loadMigrationCliConfig(env('/tmp/report', { PRO_MIGRATION_SOURCE_ENVIRONMENT: 'staging' }))).toThrowError(expect.objectContaining({ code: 'MIGRATION_CLI_ENVIRONMENT_CROSSING_REJECTED' }));
  });

  it('requires explicit fixture mode outside production', () => {
    expect(() => loadMigrationCliConfig(env('/tmp/report', { PRO_MIGRATION_SOURCE_ENVIRONMENT: 'staging', PRO_MIGRATION_DESTINATION_ENVIRONMENT: 'staging' }))).toThrowError(expect.objectContaining({ code: 'MIGRATION_CLI_TEST_MODE_REQUIRED' }));
    expect(loadMigrationCliConfig(env('/tmp/report', { PRO_MIGRATION_SOURCE_ENVIRONMENT: 'staging', PRO_MIGRATION_DESTINATION_ENVIRONMENT: 'staging', PRO_MIGRATION_TEST_MODE: 'staging_fixture' }))).toMatchObject({ testMode: 'staging_fixture' });
  });

  it('redacts URLs and binds authorization to an exact bundle hash', () => {
    expect(redactMigrationUrl('https://private.synthetic.test/path?q=x')).toBe('https://<redacted-host>');
    const hash = calculateLocalBundleHash(bundle);
    expect(bindMigrationAuthorization(authorization, hash)).toMatch(new RegExp(`^${authorization.replace('.', '\\.')}\\.`, 'u'));
  });

  it('streams a bundle in memory and writes only a safe report', async () => {
    const reportDir = await mkdtemp(path.join(os.tmpdir(), 'pro-migration-test-'));
    const fetch = async (url) => url.includes('exportProFormMigrationBatch')
      ? response({ bundle, nextCursor: null, snapshotCutoff: '2026-08-06T00:00:00Z', counts: { scanned: 1, exported: 1 } })
      : response({ counts: { created: 1, updated: 0, unchanged: 0, conflicted: 0, failed: 0 } });
    const result = await runMigrationCli(parseMigrationCliArguments(['import', '--dry-run']), { env: env(reportDir), fetch });
    expect(result).toMatchObject({ complete: true, protectedPayloadPersistence: false, counts: { created: 5 } });
    const files = await readdir(reportDir);
    expect(files).toEqual(['import-batch-1.json']);
    const report = await readFile(path.join(reportDir, files[0]), 'utf8');
    expect(report).not.toContain('synthetic-private-answer');
    expect(report).not.toContain('synthetic.source-grant');
  });

  it('writes a content-free resume checkpoint only during confirmed apply', async () => {
    const reportDir = await mkdtemp(path.join(os.tmpdir(), 'pro-migration-resume-'));
    const fetch = async (url) => url.includes('exportProFormMigrationBatch')
      ? response({ bundle, nextCursor: null, snapshotCutoff: '2026-08-06T00:00:00Z', counts: { scanned: 1, exported: 1 } })
      : response({ counts: { created: 1, updated: 0, unchanged: 0, conflicted: 0, failed: 0 } });
    await runMigrationCli(parseMigrationCliArguments(['import', '--apply', '--confirm', APPLY_CONFIRMATION]), { env: env(reportDir), fetch });
    const resume = await readFile(path.join(reportDir, 'resume-batch-1.json'), 'utf8');
    expect(resume).toContain('"sequence": 4');
    expect(resume).not.toContain('synthetic-private-answer');
    expect(resume).not.toContain('records');
  });
});
