import { readFileSync } from 'node:fs';
import { parse } from 'jsonc-parser';
import { describe, expect, it, vi } from 'vitest';
import { OPERATIONAL_EVENT_TYPES, aggregateOperationalSummary, buildSafeOperationalMetadata, createOperationalEvent, recordOperationalEventBestEffort, severityForOperationalEvent, validateOperationalEvent } from '../../base44/functions/_shared/proDraftOperationalEvents/entry.ts';
import { OPERATIONAL_FINGERPRINT_PURPOSES, createOperationalFingerprint } from '../../base44/functions/_shared/proDraftOperationalFingerprints/entry.ts';

const SECRET = 'synthetic-operational-fingerprint-secret-000000000000';
const base = {event_id: 'evt_synthetic_1', event_type: 'draft_save', environment: 'test', severity: 'info'};

describe('operational event contract', () => {
  it('contains all 41 stable event categories', () => expect(Object.values(OPERATIONAL_EVENT_TYPES)).toHaveLength(41));
  it('validates a minimal event and rejects unknown or sensitive metadata', () => {
    expect(validateOperationalEvent(base)).toMatchObject(base);
    expect(() => validateOperationalEvent({...base, canonical_state: '{}'})).toThrow();
    expect(() => buildSafeOperationalMetadata({email: 'synthetic@example.invalid'})).toThrow();
    expect(buildSafeOperationalMetadata({phase: 'save', failure_streak: 2})).toBe('{"phase":"save","failure_streak":2}');
  });
  it('maps severity deterministically including critical invariants', () => {
    expect(severityForOperationalEvent('draft_save')).toBe('info');
    expect(severityForOperationalEvent('draft_save_retry')).toBe('warning');
    expect(severityForOperationalEvent('submitted_regression_blocked')).toBe('error');
    expect(severityForOperationalEvent('rls_boundary_failure')).toBe('critical');
    expect(severityForOperationalEvent('draft_save', {errorCode: 'LOST_ACKNOWLEDGED_STATE'})).toBe('critical');
    expect(severityForOperationalEvent('recovery_email_failed', {failureStreak: 2})).toBe('error');
    expect(severityForOperationalEvent('retention_apply', {status: 'failed'})).toBe('error');
  });
  it('creates server timestamp and never lets best-effort failure escape', async () => {
    expect(createOperationalEvent({...base, metadata: {phase: 'save'}}, {now: () => new Date('2026-08-06T00:00:00Z')})).toMatchObject({created_at_server: '2026-08-06T00:00:00.000Z'});
    expect(await recordOperationalEventBestEffort({create: vi.fn().mockRejectedValue(new Error('synthetic failure'))}, base)).toEqual({recorded: false, errorCode: 'OPERATIONAL_EVENT_WRITE_FAILED'});
  });
  it('uses consistent purpose-separated short HMAC fingerprints', async () => {
    const draft = await createOperationalFingerprint('synthetic-id', OPERATIONAL_FINGERPRINT_PURPOSES.DRAFT, SECRET);
    expect(draft).toMatch(/^[a-f0-9]{16}$/);
    expect(await createOperationalFingerprint('synthetic-id', OPERATIONAL_FINGERPRINT_PURPOSES.DRAFT, SECRET)).toBe(draft);
    expect(await createOperationalFingerprint('synthetic-id', OPERATIONAL_FINGERPRINT_PURPOSES.SESSION, SECRET)).not.toBe(draft);
    await expect(createOperationalFingerprint('synthetic-id', OPERATIONAL_FINGERPRINT_PURPOSES.DRAFT, 'short')).rejects.toThrow();
  });
  it('aggregates safe rates, percentiles, test-selected rows, and critical counts without row content', () => {
    const summary = aggregateOperationalSummary([{event_type: 'draft_save', severity: 'info', latency_ms: 10, retry_count: 0}, {event_type: 'draft_save_retry', severity: 'error', latency_ms: 30, retry_count: 1}, {event_type: 'rls_boundary_failure', severity: 'critical'}]);
    expect(summary).toMatchObject({total: 3, errorCount: 1, criticalCount: 1, retryCount: 1, rlsCriticalFailures: 1, latencyMs: {p50: 10, p95: 30}});
    expect(JSON.stringify(summary)).not.toMatch(/answer|canonical|@/i);
  });
  it('declares exactly three required fields and admin-only CRUD RLS', () => {
    const schema = parse(readFileSync('base44/entities/ProFormOperationalEvent.jsonc', 'utf8'));
    expect(schema.required).toEqual(['event_id', 'event_type', 'environment']);
    for (const action of ['create', 'read', 'update', 'delete']) expect(schema.rls[action]).toEqual({user_condition: {role: 'admin'}});
  });
});
