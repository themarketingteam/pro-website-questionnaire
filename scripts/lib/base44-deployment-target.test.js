import { describe, expect, it } from 'vitest';
import {
  FAILURE_CODES,
  appIdFingerprint,
  formatVerificationOutput,
  parseDeploymentFiles,
  validateDeploymentTarget
} from './base44-deployment-target.js';

const STAGING_ID = 'staging-app-id';
const PRODUCTION_ID = 'production-app-id';

function validStaging(overrides = {}) {
  return {
    appName: 'Pro Website Questionnaire',
    localAppId: STAGING_ID,
    environment: 'staging',
    expectedAppId: STAGING_ID,
    productionAppId: PRODUCTION_ID,
    stagingAppId: STAGING_ID,
    allowProductionDeploy: 'false',
    expectedGitBranch: 'feature/durable-draft-recovery',
    gitBranch: 'feature/durable-draft-recovery',
    exactGitTag: '',
    isDetachedHead: false,
    isDirty: false,
    ...overrides
  };
}

function validProduction(overrides = {}) {
  return {
    ...validStaging(),
    localAppId: PRODUCTION_ID,
    environment: 'production',
    expectedAppId: PRODUCTION_ID,
    allowProductionDeploy: 'true',
    expectedGitBranch: 'main',
    gitBranch: 'main',
    ...overrides
  };
}

describe('validateDeploymentTarget', () => {
  it('accepts a valid staging target', () => {
    expect(validateDeploymentTarget(validStaging())).toMatchObject({
      ok: true,
      code: 'PASS',
      environment: 'staging'
    });
  });

  it('accepts a valid production target only with an explicit allow flag', () => {
    expect(validateDeploymentTarget(validProduction())).toMatchObject({
      ok: true,
      code: 'PASS',
      environment: 'production'
    });
  });

  it('rejects a missing environment declaration', () => {
    expect(
      validateDeploymentTarget(validStaging({ environment: '' })).code
    ).toBe(FAILURE_CODES.MISSING_DEPLOY_ENVIRONMENT);
  });

  it('rejects an unknown environment declaration', () => {
    expect(
      validateDeploymentTarget(validStaging({ environment: 'preview' })).code
    ).toBe(FAILURE_CODES.UNKNOWN_DEPLOY_ENVIRONMENT);
  });

  it('rejects a missing expected app ID', () => {
    expect(
      validateDeploymentTarget(validStaging({ expectedAppId: '' })).code
    ).toBe(FAILURE_CODES.MISSING_EXPECTED_APP_ID);
  });

  it('rejects staging and production app-ID collision', () => {
    expect(
      validateDeploymentTarget(
        validStaging({ productionAppId: STAGING_ID })
      ).code
    ).toBe(FAILURE_CODES.APP_ID_COLLISION);
  });

  it('rejects staging configured with the production app ID', () => {
    expect(
      validateDeploymentTarget(
        validStaging({
          expectedAppId: PRODUCTION_ID,
          localAppId: PRODUCTION_ID
        })
      ).code
    ).toBe(FAILURE_CODES.STAGING_USES_PRODUCTION_APP_ID);
  });

  it('rejects production configured with the staging app ID', () => {
    expect(
      validateDeploymentTarget(
        validProduction({
          expectedAppId: STAGING_ID,
          localAppId: STAGING_ID
        })
      ).code
    ).toBe(FAILURE_CODES.PRODUCTION_USES_STAGING_APP_ID);
  });

  it('rejects the wrong staging branch', () => {
    expect(
      validateDeploymentTarget(validStaging({ gitBranch: 'feature/other' })).code
    ).toBe(FAILURE_CODES.GIT_BRANCH_MISMATCH);
  });

  it('rejects a dirty working tree by default', () => {
    expect(
      validateDeploymentTarget(validStaging({ isDirty: true })).code
    ).toBe(FAILURE_CODES.DIRTY_WORKTREE);
  });

  it('rejects production when the allow flag is not the exact string true', () => {
    for (const allowProductionDeploy of ['', 'false', 'TRUE', '1']) {
      expect(
        validateDeploymentTarget(
          validProduction({ allowProductionDeploy })
        ).code
      ).toBe(FAILURE_CODES.PRODUCTION_DEPLOY_NOT_ALLOWED);
    }
  });

  it('never includes app IDs or unrelated secret values in formatted output', () => {
    const result = validateDeploymentTarget({
      ...validStaging(),
      environment: 'super-secret-value',
      unrelatedSecret: 'super-secret-value'
    });
    const output = formatVerificationOutput(result);

    expect(output).not.toContain(STAGING_ID);
    expect(output).not.toContain(PRODUCTION_ID);
    expect(output).not.toContain('super-secret-value');
    expect(output).toContain(appIdFingerprint(STAGING_ID));
  });
});

describe('parseDeploymentFiles', () => {
  const configText = `{
    // JSONC comments and trailing commas are supported.
    "name": "Pro Website Questionnaire",
  }`;

  it('rejects a missing .app.jsonc document', () => {
    expect(parseDeploymentFiles({ configText, appText: undefined }).code).toBe(
      FAILURE_CODES.MISSING_APP_LINK
    );
  });

  it('rejects malformed JSONC', () => {
    expect(parseDeploymentFiles({ configText, appText: '{"id":' }).code).toBe(
      FAILURE_CODES.MALFORMED_APP_LINK
    );
  });

  it('rejects a link document without an ID field', () => {
    expect(parseDeploymentFiles({ configText, appText: '{}' }).code).toBe(
      FAILURE_CODES.MISSING_APP_ID
    );
  });
});

describe('appIdFingerprint', () => {
  it('produces a stable SHA-256 fingerprint', () => {
    expect(appIdFingerprint(STAGING_ID)).toBe(
      '9c6256d79585e088f225a9455f20dbe4aa91d8f71edf50053c7915778a1a0abe'
    );
  });
});
