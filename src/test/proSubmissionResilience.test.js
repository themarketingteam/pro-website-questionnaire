import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/api/base44Client', () => ({
  base44: {
    entities: {
      ProFormSubmission: {
        create: vi.fn()
      }
    },
    functions: {
      invoke: vi.fn()
    }
  }
}));

import { base44 } from '@/api/base44Client';
import {
  TimeoutError,
  classifySubmitError,
  createProFormSubmissionResilient,
  createProFormSubmissionWithFallback,
  isRetryableSubmitError,
  serializeSubmitError,
  validateSubmissionReceipt
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

  it('requires a real receipt and rejects missing or reordered organized pages', () => {
    const tree = { format: 'page-tree-v1', pages: [{ label: 'First', source: 'custom' }, { label: 'Second', source: 'custom' }] };
    const payload = { metadata: { questionnaire_payload_version: 2 }, userdata: { service_offerings_structure: tree, service_offerings: [], service_offerings_other: 'First, Second' } };
    expect(() => validateSubmissionReceipt(null, payload)).toThrow(/receipt/);
    expect(() => validateSubmissionReceipt({ id: 'receipt' }, payload)).toThrow(/pages/);
    expect(validateSubmissionReceipt({ id: 'receipt', ...payload }, payload).id).toBe('receipt');
    const reordered = structuredClone(payload);
    reordered.userdata.service_offerings_structure.pages.reverse();
    reordered.userdata.service_offerings_other = 'Second, First';
    expect(() => validateSubmissionReceipt({ id: 'receipt', ...reordered }, payload)).toThrow(/pages/);
  });

  it('never bypasses secured submission for an organized payload with missing draft context', async () => {
    const payload = { metadata: { questionnaire_payload_version: 2 }, userdata: { service_offerings_structure: { format: 'page-tree-v1', pages: [] }, service_offerings: [], service_offerings_other: '' } };
    const result = await createProFormSubmissionWithFallback(payload);
    expect(result).toMatchObject({ ok: false, attempts: 0, error: { code: 'DRAFT_CONTEXT_REQUIRED' } });
    expect(base44.entities.ProFormSubmission.create).not.toHaveBeenCalled();
    expect(base44.functions.invoke).not.toHaveBeenCalled();
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

  it('passes transform and validation flags to fallback for null payload path', async () => {
    base44.functions.invoke.mockResolvedValueOnce({
      data: {
        success: true,
        received: true,
        submissionCreated: false,
        intakeId: 'intake_123',
        zapierSent: false
      }
    });

    const transformError = { message: 'transform failed' };
    const validationError = { message: 'validation failed' };

    const result = await createProFormSubmissionWithFallback(null, {
      responseSnapshot: { step: 1 },
      rawResponses: { q1: 'a' },
      transformFailed: true,
      transformError,
      validationFailed: true,
      validationError,
      questionnaireSessionId: 'session_123',
      draftId: 'draft_123',
      submitContext: { source: 'test' }
    });

    expect(result.ok).toBe(true);
    expect(base44.functions.invoke).toHaveBeenCalledWith('submitProQuestionnaireFallback', expect.objectContaining({
      transformedPayload: null,
      transformFailed: true,
      transformError,
      validationFailed: true,
      validationError,
      questionnaireSessionId: 'session_123',
      draftId: 'draft_123'
    }));
  });

  it('passes transform and validation flags to fallback for payload path', async () => {
    base44.entities.ProFormSubmission.create.mockRejectedValueOnce({ status: 503, message: 'Server unavailable' });
    base44.functions.invoke.mockResolvedValueOnce({
      data: {
        success: true,
        received: true,
        submissionCreated: false,
        intakeId: 'intake_456',
        zapierSent: false
      }
    });

    const transformError = { message: 'transform warning' };
    const validationError = { message: 'validation warning' };

    const result = await createProFormSubmissionWithFallback({ metadata: {}, userdata: {} }, {
      responseSnapshot: { step: 2 },
      rawResponses: { q2: 'b' },
      transformFailed: false,
      transformError,
      validationFailed: true,
      validationError,
      questionnaireSessionId: 'session_456',
      draftId: 'draft_456',
      submitContext: { source: 'test' },
      maxAttempts: 1,
      timeoutMs: 100,
      baseDelayMs: 10
    });

    expect(result.ok).toBe(true);
    expect(base44.functions.invoke).toHaveBeenCalledWith('submitProQuestionnaireFallback', expect.objectContaining({
      transformedPayload: { metadata: {}, userdata: {} },
      transformFailed: false,
      transformError,
      validationFailed: true,
      validationError,
      questionnaireSessionId: 'session_456',
      draftId: 'draft_456'
    }));
  });
});
