import { describe, expect, it, vi } from 'vitest';
import {
  classifySensitiveEntityRequest,
  installSensitiveEntityNetworkGuard,
} from '../../tests/e2e/helpers/sensitiveEntityNetworkGuard.js';

describe('sensitive entity E2E network guard', () => {
  it('classifies the two entity endpoint shapes observed by the staging harness', () => {
    expect(classifySensitiveEntityRequest(
      'https://staging.example.test/api/entities/ProFormDraft/filter?email=redacted',
      'POST',
    )).toMatchObject({ entity: 'ProFormDraft', method: 'POST', operation: 'filter' });
    expect(classifySensitiveEntityRequest(
      'https://staging.example.test/api/apps/staging-app/entities/proformdraftevent/create',
      'POST',
    )).toMatchObject({ entity: 'ProFormDraftEvent', operation: 'create' });
  });

  it('allows function invocation and unrelated asset/entity requests', () => {
    expect(classifySensitiveEntityRequest(
      'https://staging.example.test/api/apps/staging-app/functions/saveProFormDraft',
      'POST',
    )).toBeNull();
    expect(classifySensitiveEntityRequest(
      'https://staging.example.test/assets/ProFormDraft.js',
    )).toBeNull();
    expect(classifySensitiveEntityRequest(
      'https://staging.example.test/api/entities/Query/list',
    )).toBeNull();
  });

  it('fails without retaining a query string or body', () => {
    const handlers = new Map();
    const page = {
      on: vi.fn((event, handler) => handlers.set(event, handler)),
      off: vi.fn(),
    };
    const guard = installSensitiveEntityNetworkGuard(page);

    handlers.get('request')({
      method: () => 'POST',
      url: () => 'https://staging.example.test/api/entities/ProFormRecoverySecurityEvent/list?token=never-report',
    });

    expect(guard.safeSummary()).toEqual({
      directSensitiveEntityRequestCount: 1,
      directSensitiveEntityRequests: [{
        entity: 'ProFormRecoverySecurityEvent',
        method: 'POST',
        operation: 'list',
        route: '/api/entities/<sensitive-entity>/list',
      }],
    });
    expect(() => guard.assertNoViolations()).toThrow('DIRECT_SENSITIVE_ENTITY_REQUEST_DETECTED');
    expect(JSON.stringify(guard.safeSummary())).not.toContain('never-report');
  });
});
