import { describe, expect, it, vi } from 'vitest';
import { SAFE_LOG_REDACTION, buildSafeLogMetadata, createSafeLogger, redactSafeLogValue } from '@/lib/safeLogger';
import { redactSafeLogValue as redactServerLogValue } from '../../base44/functions/_shared/safeLogger/entry.ts';

describe('safe logger', () => {
  it('recursively redacts sensitive keys and recognizable credential values', () => {
    const result = redactSafeLogValue({nested: {email: 'synthetic@example.invalid'}, harmless: 'ok', url: 'https://example.invalid/?token=synthetic-value'});
    expect(result).toEqual({nested: {email: SAFE_LOG_REDACTION}, harmless: 'ok', url: SAFE_LOG_REDACTION});
  });
  it('redacts recovery-code, AWS-key, and token-shaped strings', () => {
    for (const value of ['ABCD-EFGH-IJKL', `AKIA${'A'.repeat(16)}`, `${'a'.repeat(24)}.${'b'.repeat(16)}`]) {
      expect(redactSafeLogValue(value)).toBe(SAFE_LOG_REDACTION);
      expect(redactServerLogValue(value)).toBe(SAFE_LOG_REDACTION);
    }
  });
  it('drops unapproved metadata and never stringifies arbitrary errors', () => {
    expect(buildSafeLogMetadata({requestId: 'req_1', payload: {answer: 'x'}, error: new Error('private')})).toEqual({requestId: 'req_1'});
    expect(buildSafeLogMetadata({errorCode: 'DRAFT_SAVE_FAILED'})).toEqual({errorCode: 'DRAFT_SAVE_FAILED'});
  });
  it('writes one structured safe envelope', () => {
    const info = vi.fn(); createSafeLogger({debug: vi.fn(), info, warn: vi.fn(), error: vi.fn()}).info('draft_save', {status: 'ok', email: 'synthetic@example.invalid'});
    expect(JSON.parse(info.mock.calls[0][0])).toEqual({event: 'draft_save', status: 'ok'});
  });
});
