import { describe, expect, it, vi } from 'vitest';
import { createProDraftOperationalTelemetry, sanitizeClientOperationalMetadata } from '@/lib/proDraftOperationalTelemetry';

describe('client operational telemetry', () => {
  it('uses a bounded FIFO queue and reports drops', () => {
    const telemetry = createProDraftOperationalTelemetry({maxQueueSize: 2, invoke: vi.fn()});
    for (const status of ['one', 'two', 'three']) telemetry.record({event_type: 'draft_save', status});
    expect(telemetry.getSafeDiagnostics()).toMatchObject({queued: 2, dropped: 1, authoritativeState: false});
  });
  it('flushes only through the injected backend function and preserves state on failure', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('synthetic transport failure')); const telemetry = createProDraftOperationalTelemetry({invoke});
    telemetry.record({event_type: 'draft_save'}); await expect(telemetry.flush({method: 'resume_token'})).resolves.toEqual({accepted: 0, rejected: 1});
    expect(invoke).toHaveBeenCalledOnce(); expect(telemetry.getSafeDiagnostics()).toMatchObject({queued: 1, failures: 1});
  });
  it('rejects canonical state, full identifiers, email, code, token, and fingerprints', () => {
    for (const input of [{canonical_state: '{}'}, {draft_id: 'draft-full'}, {email: 'synthetic@example.invalid'}, {recovery_code: 'ABCD-EFGH-IJKL'}, {resume_token: 'secret'}, {draft_fingerprint: 'abcdefabcdef'}]) expect(() => createProDraftOperationalTelemetry().record({event_type: 'draft_save', ...input})).toThrow();
    expect(() => sanitizeClientOperationalMetadata({reason: 'synthetic@example.invalid'})).toThrow();
  });
  it('accepts a critical local invariant event and remains best effort', () => {
    const telemetry = createProDraftOperationalTelemetry(); expect(telemetry.recordBestEffort({event_type: 'critical_invariant_failure', metadata: {reason: 'lost_ack'}})).toBe(true);
    expect(telemetry.recordBestEffort({event_type: 'draft_save_retry', error_code: 'NETWORK_RETRY'})).toBe(true);
    expect(telemetry.recordBestEffort({event_type: 'not_allowed'})).toBe(false);
  });
});
