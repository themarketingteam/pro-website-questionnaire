import { describe, expect, it } from 'vitest';
import { evaluateDraftRlsPrecheck } from './precheck-draft-rls-deployment.mjs';

const valid = () => ({
  branch: 'feature/durable-draft-recovery',
  schemaRlsValid: true,
  sourceFindings: [],
  builtOutputPresent: true,
  builtFindings: [],
  missingFunctions: [],
  serviceRoleFindings: [],
  evidence: { api: true, admin: true, lifecycle: true },
  stagingSecretsDocumented: true,
  stagingFlagsValid: true,
  appLinkKind: 'staging',
});

describe('draft RLS deployment precheck', () => {
  it('passes a complete valid feature checkout', () => {
    expect(evaluateDraftRlsPrecheck(valid())).toEqual({ ok: true, failures: [] });
  });

  it('fails on frontend or built direct access', () => {
    const result = evaluateDraftRlsPrecheck({
      ...valid(), sourceFindings: [{}], builtFindings: [{}],
    });
    expect(result.failures).toEqual(expect.arrayContaining([
      'FRONTEND_DIRECT_ACCESS_DETECTED', 'BUILT_DIRECT_ACCESS_DETECTED',
    ]));
  });

  it('fails on a missing function', () => {
    expect(evaluateDraftRlsPrecheck({
      ...valid(), missingFunctions: ['saveProFormDraft'],
    }).failures).toContain('REQUIRED_FUNCTION_MISSING');
  });

  it('fails on a production app link', () => {
    expect(evaluateDraftRlsPrecheck({
      ...valid(), appLinkKind: 'production',
    }).failures).toContain('PRODUCTION_APP_LINK_FORBIDDEN');
  });

  it('fails when any staging certification is missing', () => {
    expect(evaluateDraftRlsPrecheck({
      ...valid(), evidence: { api: true, admin: false, lifecycle: false },
    }).failures).toEqual(expect.arrayContaining([
      'STAGING_ADMIN_CERTIFICATION_MISSING',
      'STAGING_LIFECYCLE_CERTIFICATION_MISSING',
    ]));
  });
});
