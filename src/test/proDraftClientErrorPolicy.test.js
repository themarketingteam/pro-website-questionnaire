import { describe, expect, it, vi } from 'vitest';
import {
  emitSafeDraftClientMetric,
  normalizeProDraftClientError,
} from '@/lib/proDraftClientErrorPolicy';

const responseError = (status, errorCode, message = 'raw provider detail') => ({
  response: { status, data: { errorCode, message, requestId: 'unsafe-request-id' } },
});

describe('draft client error policy', () => {
  it.each([
    [401, 'AUTHORIZATION_DENIED', 'authorization_required'],
    [500, 'RLS_POLICY_DENIED', 'service_configuration'],
    [503, 'SERVICE_ROLE_CONFIGURATION_FAILED', 'service_configuration'],
    [409, 'REVISION_CONFLICT', 'conflict'],
    [409, 'DRAFT_SUBMITTED_LOCKED', 'submitted_or_superseded_lock'],
    [429, 'RATE_LIMITED', 'rate_limit'],
  ])('normalizes %s/%s to %s', (status, code, kind) => {
    const result = normalizeProDraftClientError(responseError(status, code));
    expect(result.kind).toBe(kind);
    expect(result.message).not.toContain('raw provider detail');
    expect(result.preserveLocalState).toBe(true);
    expect(result.exposeRawError).toBe(false);
  });

  it('never retries authorization, RLS, or lock failures', () => {
    for (const error of [
      responseError(401, 'AUTHORIZATION_DENIED'),
      responseError(500, 'RLS_POLICY_DENIED'),
      responseError(409, 'DRAFT_SUBMITTED_LOCKED'),
    ]) expect(normalizeProDraftClientError(error).retryable).toBe(false);
  });

  it('keeps recovery failures generic and admin authorization actionable', () => {
    expect(normalizeProDraftClientError(responseError(401, 'AUTHORIZATION_DENIED'), {
      audience: 'recovery',
    }).message).toBe('We could not recover a questionnaire with the information provided.');
    expect(normalizeProDraftClientError(responseError(401, 'AUTHORIZATION_DENIED'), {
      audience: 'admin',
    })).toMatchObject({ reauthorizeAdmin: true, authorizationRequired: true });
  });

  it('emits bounded metrics without provider text or payloads', () => {
    const metric = vi.fn();
    const normalized = normalizeProDraftClientError(responseError(500, 'RLS_POLICY_DENIED'));
    expect(emitSafeDraftClientMetric(metric, { operation: 'save', ...normalized })).toBe(true);
    expect(metric).toHaveBeenCalledWith({
      operation: 'save', kind: 'service_configuration', status: 500, retryable: false,
    });
  });
});
