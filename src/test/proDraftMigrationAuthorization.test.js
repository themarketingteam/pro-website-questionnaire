import { describe, expect, it } from 'vitest';
import {
  MIGRATION_APPLY_SCOPE,
  MIGRATION_APPLY_TOKEN_TTL_SECONDS,
  PRO_FORM_MIGRATION_APPLY_SECRET,
  getSafeMigrationAuthorizationDiagnostics,
  hashAdminGrantTokenId,
  issueMigrationApplyToken,
  verifyMigrationApplyToken,
} from '../../base44/functions/_shared/proDraftMigrationAuthorization/authorization.js';

const secret = 'migration-secret-material-that-is-at-least-thirty-two-bytes';
const input = { environment: 'staging', migrationName: 'legacy-v1', migrationVersion: 1, batchId: 'batch-1', reportHash: 'a'.repeat(64), maxRecordCount: 10, adminGrantTokenIdHash: 'b'.repeat(64) };
const options = { secret, clock: () => 1_000_000, tokenIdGenerator: () => 'mat_test_token' };

describe('migration apply authorization', () => {
  it('issues the required scoped two-hour token', async () => {
    const issued = await issueMigrationApplyToken(input, options);
    expect(issued.claims.scope).toBe(MIGRATION_APPLY_SCOPE);
    expect(issued.claims.expiresAt - issued.claims.issuedAt).toBe(MIGRATION_APPLY_TOKEN_TTL_SECONDS);
  });
  it('binds every migration identity claim', async () => {
    const issued = await issueMigrationApplyToken(input, options);
    await expect(verifyMigrationApplyToken(issued.token, { ...input }, options)).resolves.toMatchObject({ tokenHash: issued.tokenHash });
  });
  it('rejects a changed environment', async () => {
    const issued = await issueMigrationApplyToken(input, options);
    await expect(verifyMigrationApplyToken(issued.token, { ...input, environment: 'production' }, options)).rejects.toMatchObject({ code: 'MIGRATION_APPLY_TOKEN_CLAIM_MISMATCH' });
  });
  it('rejects a changed report hash', async () => {
    const issued = await issueMigrationApplyToken(input, options);
    await expect(verifyMigrationApplyToken(issued.token, { ...input, reportHash: 'c'.repeat(64) }, options)).rejects.toMatchObject({ code: 'MIGRATION_APPLY_TOKEN_CLAIM_MISMATCH' });
  });
  it('rejects a changed batch', async () => {
    const issued = await issueMigrationApplyToken(input, options);
    await expect(verifyMigrationApplyToken(issued.token, { ...input, batchId: 'batch-2' }, options)).rejects.toMatchObject({ code: 'MIGRATION_APPLY_TOKEN_CLAIM_MISMATCH' });
  });
  it('rejects an expired token', async () => {
    const issued = await issueMigrationApplyToken(input, options);
    await expect(verifyMigrationApplyToken(issued.token, input, { ...options, clock: () => 1_000_000 + 7_200_000 })).rejects.toMatchObject({ code: 'MIGRATION_APPLY_TOKEN_EXPIRED' });
  });
  it('rejects a tampered signature', async () => {
    const issued = await issueMigrationApplyToken(input, options);
    await expect(verifyMigrationApplyToken(`${issued.token.slice(0, -1)}x`, input, options)).rejects.toMatchObject({ code: 'MIGRATION_APPLY_TOKEN_INVALID' });
  });
  it('rejects invalid maximum counts', async () => {
    await expect(issueMigrationApplyToken({ ...input, maxRecordCount: -1 }, options)).rejects.toMatchObject({ code: 'MIGRATION_APPLY_TOKEN_INVALID' });
  });
  it('hashes the admin grant token identifier without returning it', async () => {
    const hash = await hashAdminGrantTokenId('grant-token-1');
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hash).not.toContain('grant-token-1');
  });
  it('reports only safe authorization diagnostics', () => {
    expect(getSafeMigrationAuthorizationDiagnostics()).toEqual(expect.objectContaining({ secretName: PRO_FORM_MIGRATION_APPLY_SECRET, oneTime: true, ttlSeconds: 7200 }));
  });
});
