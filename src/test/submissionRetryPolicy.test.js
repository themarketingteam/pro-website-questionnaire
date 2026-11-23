import { describe, expect, it } from 'vitest';
import { isAutomaticRetryExcluded, isSubmissionRetryDue, nextSubmissionRetryAt } from '../../base44/shared/submissionRetryPolicy.ts';

describe('automatic submission retry policy', () => {
  it('skips the immediate hourly boundary after each failed attempt', () => {
    expect(nextSubmissionRetryAt('2026-11-23T15:33:00-06:00')).toBe('2026-11-23T23:00:00.000Z');
    expect(nextSubmissionRetryAt('2026-11-23T17:00:25-06:00')).toBe('2026-11-24T01:00:00.000Z');
    expect(nextSubmissionRetryAt('2026-11-23T15:00:00-06:00')).toBe('2026-11-23T23:00:00.000Z');
  });
  it('handles near-boundary, date rollover and Central daylight-saving boundaries as elapsed hourly boundaries', () => {
    expect(nextSubmissionRetryAt('2026-11-23T15:59:59.999-06:00')).toBe('2026-11-23T23:00:00.000Z');
    expect(nextSubmissionRetryAt('2026-11-23T23:33:00Z')).toBe('2026-11-24T01:00:00.000Z');
    expect(nextSubmissionRetryAt('2026-03-08T01:33:00-06:00')).toBe('2026-03-08T09:00:00.000Z');
    expect(nextSubmissionRetryAt('2026-11-01T01:33:00-05:00')).toBe('2026-11-01T08:00:00.000Z');
    expect(() => nextSubmissionRetryAt('not-a-time')).toThrow(/valid retry timestamp/);
  });
  it('catches up overdue jobs and expired worker leases without running early or overlapping active work', () => {
    const job = { state: 'queued', nextAttemptAt: '2026-11-23T23:00:00Z' };
    expect(isSubmissionRetryDue(job, '2026-11-23T22:59:59Z')).toBe(false);
    expect(isSubmissionRetryDue(job, '2026-11-23T23:00:00Z')).toBe(true);
    expect(isSubmissionRetryDue(job, '2026-11-24T02:00:00Z')).toBe(true);
    expect(isSubmissionRetryDue({ ...job, state: 'running', leaseExpiresAt: '2026-11-24T02:01:00Z' }, '2026-11-24T02:00:00Z')).toBe(false);
    expect(isSubmissionRetryDue({ ...job, state: 'running', leaseExpiresAt: '2026-11-24T01:59:00Z' }, '2026-11-24T02:00:00Z')).toBe(true);
  });
  it('does not schedule accepted, explicitly stopped, review-only, excluded, or undated work', () => {
    const job = { state: 'queued', nextAttemptAt: '2026-11-23T23:00:00Z' };
    for (const state of ['succeeded', 'accepted', 'cancelled', 'superseded', 'needs_review', 'excluded', 'unknown']) expect(isSubmissionRetryDue({ ...job, state }, '2026-11-24T02:00:00Z')).toBe(false);
    expect(isSubmissionRetryDue({ ...job, acceptedAt: '2026-11-23T22:00:00Z' }, '2026-11-24T02:00:00Z')).toBe(false);
    expect(isSubmissionRetryDue({ ...job, excluded: true }, '2026-11-24T02:00:00Z')).toBe(false);
    expect(isSubmissionRetryDue({ state: 'queued' }, '2026-11-24T02:00:00Z')).toBe(false);
  });
  it('excludes retained DO NOT DELIVER and reserved-domain fixtures without treating an ordinary customer as a test', () => {
    expect(isAutomaticRetryExcluded({ business_name: 'SYNTHETIC UI VALIDATION DO NOT DELIVER', domain: 'real-looking.com' })).toBe(true);
    expect(isAutomaticRetryExcluded({}, { metadata: { business_name: 'Review Client', businessDomain: 'https://pro-ui-validation.example.test/path' } })).toBe(true);
    expect(isAutomaticRetryExcluded({ domain: 'client.invalid' })).toBe(true);
    expect(isAutomaticRetryExcluded({ domain: 'example.com' })).toBe(true);
    expect(isAutomaticRetryExcluded({ automatic_retry_excluded: true })).toBe(true);
    expect(isAutomaticRetryExcluded({ business_name: 'Customer Networks', domain: 'customer-networks.com' })).toBe(false);
  });
});
