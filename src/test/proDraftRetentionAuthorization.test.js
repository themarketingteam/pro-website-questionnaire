import { describe, expect, it } from 'vitest';
import { issueRetentionApplyToken, verifyRetentionApplyToken } from '../../base44/functions/_shared/proDraftRetentionAuthorization/entry.ts';

const SECRET = 'synthetic-retention-secret-value-000000000000000000';
const input = { environment: 'staging', policyVersion: 1, cutoff: '2025-08-06T00:00:00.000Z',
  reportHash: 'a'.repeat(64), maxDeletionCount: 20, batchId: 'retention-batch-1',
  adminGrantTokenIdHash: 'b'.repeat(64) };

describe('retention apply authorization', () => {
  it('issues a two-hour, report-bound, purpose-separated token', async () => {
    const issued = await issueRetentionApplyToken(input, { secret: SECRET, clock: () => 1_700_000_000_000,
      tokenIdGenerator: () => 'rat_synthetic' });
    expect(issued.claims).toMatchObject({ scope: 'admin:retention-apply', ...input });
    expect(issued.claims.expiresAt - issued.claims.issuedAt).toBe(7200);
  });
  it('rejects a wrong report, cutoff, environment, or batch', async () => {
    const issued = await issueRetentionApplyToken(input, { secret: SECRET, tokenIdGenerator: () => 'rat_synthetic' });
    for (const expected of [{ reportHash: 'c'.repeat(64) }, { cutoff: '2025-09-01T00:00:00.000Z' },
      { environment: 'production' }, { batchId: 'other-batch' }]) {
      await expect(verifyRetentionApplyToken(issued.token, expected, { secret: SECRET })).rejects.toThrow();
    }
  });
  it('rejects missing/short secrets and counts above the bounded maximum', async () => {
    await expect(issueRetentionApplyToken(input, { secret: 'short' })).rejects.toThrow();
    await expect(issueRetentionApplyToken({ ...input, maxDeletionCount: 201 }, { secret: SECRET })).rejects.toThrow();
  });
});
