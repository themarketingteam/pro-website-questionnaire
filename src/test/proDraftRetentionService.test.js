import { describe, expect, it, vi } from 'vitest';
import { getRetentionPolicy } from '../../base44/functions/_shared/proDraftRetention/entry.ts';
import { issueRetentionApplyToken, verifyRetentionApplyToken } from '../../base44/functions/_shared/proDraftRetentionAuthorization/entry.ts';
import { analyzeRetentionPage, applyRetentionPage, runScheduledRetention } from '../../base44/functions/_shared/proDraftRetentionService/entry.ts';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const SECRET = 'synthetic-retention-service-secret-00000000000000000';
const HASH = 'b'.repeat(64);
const oldDraft = (id, patch = {}) => ({ id, environment: 'staging', status: 'active',
  created_date: '2024-01-01T00:00:00.000Z', ...patch });
const oldEvent = (id, draftId, patch = {}) => ({ id, draft_id: draftId, environment: 'staging',
  created_at_server: '2024-01-02T00:00:00.000Z', ...patch });

class MemoryRepository {
  constructor(drafts = [], events = []) {
    this.drafts = new Map(drafts.map((item) => [item.id, { ...item }]));
    this.events = new Map(events.map((item) => [item.id, { ...item }]));
    this.checkpoint = null;
    this.audits = [];
    this.deleteDraft = vi.fn(async (id) => { if (!this.drafts.delete(id)) throw new Error('missing'); });
    this.deleteEvent = vi.fn(async (id) => { if (!this.events.delete(id)) throw new Error('missing'); });
  }
  async getOrCreateCheckpoint(identity, initial = {}) {
    if (!this.checkpoint) this.checkpoint = { id: 'checkpoint-1', migration_name: identity.migrationName,
      environment: identity.environment, migration_version: identity.policyVersion, batch_id: identity.batchId,
      status: 'pending', phase: 'active', mode: 'dry_run', cursor: '0', ...initial };
    return this.checkpoint;
  }
  async updateCheckpoint(id, patch) { this.checkpoint = { ...this.checkpoint, ...patch }; return this.checkpoint; }
  async listDraftsByStatus(status, pageSize, skip = 0) {
    const rows = [...this.drafts.values()].filter((item) => item.status === status);
    return { items: rows.slice(skip, skip + pageSize), hasMore: rows.length > skip + pageSize,
      nextSkip: skip + Math.min(pageSize, rows.length - skip) };
  }
  async listEventsForDraft(draftId, limit) {
    const rows = [...this.events.values()].filter((item) => item.draft_id === draftId);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }
  async getDraft(id) { const item = this.drafts.get(id); if (!item) throw new Error('missing'); return { ...item }; }
  async fingerprint(value) { return value.fingerprint ?? HASH; }
  estimateBytes(value) { return JSON.stringify(value).length; }
  async createAuditEvent(value) { this.audits.push(value); return value; }
}

const input = (patch = {}) => ({ environment: 'staging', batchId: 'retention-batch-1',
  requestId: 'request-1', adminGrantTokenIdHash: 'a'.repeat(64), ...patch });
const options = (patch = {}) => ({ now: () => new Date(NOW), policy: getRetentionPolicy({}), ...patch });

async function finishAnalysis(repo, patch = {}) {
  let cursor;
  let result;
  do {
    result = await analyzeRetentionPage(repo, input({ cursor, ...patch }), options({ secret: SECRET }));
    cursor = result.cursor;
  } while (!result.complete);
  return result;
}

async function verifiedFor(repo) {
  const report = JSON.parse(repo.checkpoint.report_json);
  const issued = await issueRetentionApplyToken({ environment: 'staging', policyVersion: 1,
    cutoff: repo.checkpoint.retention_cutoff, reportHash: repo.checkpoint.retention_report_hash,
    maxDeletionCount: report.approvedRecords.length, batchId: 'retention-batch-1',
    adminGrantTokenIdHash: 'a'.repeat(64) }, { secret: SECRET, tokenIdGenerator: () => 'rat_service' });
  const verified = await verifyRetentionApplyToken(issued.token, { environment: 'staging',
    batchId: 'retention-batch-1', reportHash: repo.checkpoint.retention_report_hash }, { secret: SECRET });
  repo.checkpoint.retention_apply_token_hash = issued.tokenHash;
  return verified;
}

describe('retention analyze/apply execution', () => {
  it('dry run returns safe IDs and never invokes deletion', async () => {
    const repo = new MemoryRepository([oldDraft('draft-1')], [oldEvent('event-1', 'draft-1')]);
    const result = await finishAnalysis(repo);
    expect(result.counts).toMatchObject({ eligibleDrafts: 1, estimatedEvents: 1 });
    expect(repo.deleteDraft).not.toHaveBeenCalled(); expect(repo.deleteEvent).not.toHaveBeenCalled();
    expect(repo.checkpoint.retention_report_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(repo.audits.some((item) => item.attemptType === 'retention_dry_run')).toBe(true);
  });
  it('bounds each analysis page and persists a resumable cursor', async () => {
    const repo = new MemoryRepository([oldDraft('draft-1'), oldDraft('draft-2')]);
    const first = await analyzeRetentionPage(repo, input({ pageSize: 1 }), options());
    expect(first.complete).toBe(false); expect(first.cursor).toBe('active:1');
    const second = await analyzeRetentionPage(repo, input({ pageSize: 1, cursor: first.cursor }), options());
    expect(second.counts.eligibleDrafts).toBe(2);
  });
  it('requires a separate explicit completed-report step to issue apply authorization', async () => {
    const repo = new MemoryRepository([oldDraft('draft-1')]);
    await finishAnalysis(repo);
    const result = await analyzeRetentionPage(repo, input({ issueApplyToken: true }), options({ secret: SECRET }));
    expect(result.applyToken).toContain('.'); expect(result.reportHash).toBe(repo.checkpoint.retention_report_hash);
  });
  it('re-evaluates and skips a draft changed after analysis', async () => {
    const repo = new MemoryRepository([oldDraft('draft-1')]); await finishAnalysis(repo);
    repo.drafts.get('draft-1').fingerprint = 'c'.repeat(64);
    const result = await applyRetentionPage(repo, input({ verifiedToken: await verifiedFor(repo) }), options());
    expect(result).toMatchObject({ deletedDrafts: 0, skipped: 1 });
    expect(repo.drafts.has('draft-1')).toBe(true);
  });
  it('deletes eligible events before the eligible draft', async () => {
    const repo = new MemoryRepository([oldDraft('draft-1')], [oldEvent('event-1', 'draft-1')]);
    await finishAnalysis(repo);
    const order = [];
    repo.deleteEvent = vi.fn(async (id) => { order.push(`event:${id}`); repo.events.delete(id); });
    repo.deleteDraft = vi.fn(async (id) => { order.push(`draft:${id}`); repo.drafts.delete(id); });
    const result = await applyRetentionPage(repo, input({ verifiedToken: await verifiedFor(repo) }), options());
    expect(result).toMatchObject({ deletedEvents: 1, deletedDrafts: 1, complete: true });
    expect(order).toEqual(['event:event-1', 'draft:draft-1']);
  });
  it('does not delete a draft when an event deletion fails', async () => {
    const repo = new MemoryRepository([oldDraft('draft-1')], [oldEvent('event-1', 'draft-1')]);
    await finishAnalysis(repo); repo.deleteEvent = vi.fn(async () => { throw new Error('synthetic failure'); });
    const result = await applyRetentionPage(repo, input({ verifiedToken: await verifiedFor(repo) }), options());
    expect(result).toMatchObject({ deletedDrafts: 0, failed: 1 });
    expect(repo.drafts.has('draft-1')).toBe(true);
  });
  it('resumes apply from the checkpoint index with the same one-time run token', async () => {
    const repo = new MemoryRepository([oldDraft('draft-1'), oldDraft('draft-2')]); await finishAnalysis(repo);
    const verifiedToken = await verifiedFor(repo);
    const first = await applyRetentionPage(repo, input({ verifiedToken, pageSize: 1 }), options());
    const second = await applyRetentionPage(repo, input({ verifiedToken, pageSize: 1 }), options());
    expect(first.complete).toBe(false); expect(second.complete).toBe(true);
    expect(repo.deleteDraft).toHaveBeenCalledTimes(2);
  });
  it('rejects a report/token mismatch', async () => {
    const repo = new MemoryRepository([oldDraft('draft-1')]); await finishAnalysis(repo);
    const verifiedToken = await verifiedFor(repo);
    const mismatched = { ...verifiedToken, claims: { ...verifiedToken.claims, reportHash: 'd'.repeat(64) } };
    await expect(applyRetentionPage(repo, input({ verifiedToken: mismatched }), options())).rejects.toThrow();
  });
  it('keeps scheduled execution dry-run and blocks destructive env-only enablement', async () => {
    const dryRepo = new MemoryRepository([oldDraft('draft-1')]);
    const dry = await runScheduledRetention(dryRepo, input(), options());
    expect(dry).toMatchObject({ dryRun: true, alertRequired: true, alertType: 'retention_dry_run_report' });
    expect(dryRepo.deleteDraft).not.toHaveBeenCalled();
    const blockedRepo = new MemoryRepository();
    const blocked = await runScheduledRetention(blockedRepo, input(), options({ policy: getRetentionPolicy({ PRO_FORM_DRAFT_RETENTION_DRY_RUN: 'false' }) }));
    expect(blocked).toMatchObject({ dryRun: true, destructiveApplyBlocked: true,
      alertRequired: true, alertType: 'retention_destructive_schedule_blocked' });
  });
});
