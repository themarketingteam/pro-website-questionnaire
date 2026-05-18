import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/api/base44Client', () => ({
  base44: {
    entities: {
      ProFormSubmission: {
        create: vi.fn()
      }
    }
  }
}));

import { base44 } from '@/api/base44Client';
import {
  TimeoutError,
  classifySubmitError,
  createProFormSubmissionResilient,
  isRetryableSubmitError,
  serializeSubmitError
} from '@/lib/proSubmissionResilience';

describe('proSubmissionResilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes Error objects safely', () => {
    const error = new Error('Something went wrong');
    error.status = 500;
    const result = serializeSubmitError(error);

    expect(result.message).toBe('Something went wrong');
    expect(result.status).toBe(500);
    expect(result.failureKind).toBe('server');
  });

  it('serializes string errors safely', () => {
    const result = serializeSubmitError('failed to fetch');
    expect(result.message).toBe('failed to fetch');
    expect(result.failureKind).toBe('network');
  });

  it('classifies timeout errors', () => {
    expect(classifySubmitError(new TimeoutError())).toBe('timeout');
  });

  it('classifies 401 as auth', () => {
    expect(classifySubmitError({ status: 401, message: 'Unauthorized' })).toBe('auth');
  });

  it('classifies 403 as permission', () => {
    expect(classifySubmitError({ status: 403, message: 'Forbidden' })).toBe('permission');
  });

  it('classifies 422 validation errors', () => {
    expect(classifySubmitError({ status: 422, message: 'Validation failed: required field missing' })).toBe('validation');
  });

  it('returns false for non-retryable failures', () => {
    expect(isRetryableSubmitError({ status: 401, message: 'Unauthorized' })).toBe(false);
    expect(isRetryableSubmitError({ status: 403, message: 'Forbidden' })).toBe(false);
    expect(isRetryableSubmitError({ status: 422, message: 'Validation failed' })).toBe(false);
  });

  it('returns true for retryable failures', () => {
    expect(isRetryableSubmitError(new TimeoutError())).toBe(true);
    expect(isRetryableSubmitError({ message: 'Failed to fetch' })).toBe(true);
    expect(isRetryableSubmitError({ status: 503, message: 'Service unavailable' })).toBe(true);
    expect(isRetryableSubmitError({ status: 429, message: 'Too many requests' })).toBe(true);
  });

  it('retries transient failures and succeeds', async () => {
    base44.entities.ProFormSubmission.create
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'sub_123' });

    const promise = createProFormSubmissionResilient({ foo: 'bar' }, { baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.submission).toEqual({ id: 'sub_123' });
    expect(result.attempts).toBe(2);
  });

  it('does not retry validation failures', async () => {
    base44.entities.ProFormSubmission.create.mockRejectedValueOnce({ status: 422, message: 'Validation failed' });

    const result = await createProFormSubmissionResilient({ foo: 'bar' });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(base44.entities.ProFormSubmission.create).toHaveBeenCalledTimes(1);
  });
});