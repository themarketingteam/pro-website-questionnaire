import { createHash } from 'node:crypto';
import { parse } from 'jsonc-parser';

export const FAILURE_CODES = Object.freeze({
  APP_ID_COLLISION: 'APP_ID_COLLISION',
  DETACHED_HEAD_NOT_APPROVED_TAG: 'DETACHED_HEAD_NOT_APPROVED_TAG',
  DIRTY_WORKTREE: 'DIRTY_WORKTREE',
  FRONTEND_ENVIRONMENT_MISMATCH: 'FRONTEND_ENVIRONMENT_MISMATCH',
  GIT_BRANCH_MISMATCH: 'GIT_BRANCH_MISMATCH',
  GIT_BRANCH_UNAVAILABLE: 'GIT_BRANCH_UNAVAILABLE',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  LOCAL_APP_ID_MISMATCH: 'LOCAL_APP_ID_MISMATCH',
  MALFORMED_APP_LINK: 'MALFORMED_APP_LINK',
  MALFORMED_BASE44_CONFIG: 'MALFORMED_BASE44_CONFIG',
  MISSING_APP_ID: 'MISSING_APP_ID',
  MISSING_APP_LINK: 'MISSING_APP_LINK',
  MISSING_APP_NAME: 'MISSING_APP_NAME',
  MISSING_BASE44_CONFIG: 'MISSING_BASE44_CONFIG',
  MISSING_DEPLOY_ENVIRONMENT: 'MISSING_DEPLOY_ENVIRONMENT',
  MISSING_EXPECTED_APP_ID: 'MISSING_EXPECTED_APP_ID',
  MISSING_EXPECTED_GIT_BRANCH: 'MISSING_EXPECTED_GIT_BRANCH',
  MISSING_PRODUCTION_APP_ID: 'MISSING_PRODUCTION_APP_ID',
  MISSING_STAGING_APP_ID: 'MISSING_STAGING_APP_ID',
  PRODUCTION_DEPLOY_NOT_ALLOWED: 'PRODUCTION_DEPLOY_NOT_ALLOWED',
  PRODUCTION_EXPECTED_ID_MISMATCH: 'PRODUCTION_EXPECTED_ID_MISMATCH',
  PRODUCTION_REQUIRES_MAIN_OR_RELEASE_TAG: 'PRODUCTION_REQUIRES_MAIN_OR_RELEASE_TAG',
  PRODUCTION_USES_STAGING_APP_ID: 'PRODUCTION_USES_STAGING_APP_ID',
  REPOSITORY_ROOT_NOT_FOUND: 'REPOSITORY_ROOT_NOT_FOUND',
  STAGING_EXPECTED_ID_MISMATCH: 'STAGING_EXPECTED_ID_MISMATCH',
  STAGING_MAIN_FORBIDDEN: 'STAGING_MAIN_FORBIDDEN',
  STAGING_USES_PRODUCTION_APP_ID: 'STAGING_USES_PRODUCTION_APP_ID',
  UNKNOWN_DEPLOY_ENVIRONMENT: 'UNKNOWN_DEPLOY_ENVIRONMENT',
  VERIFICATION_INPUT_UNREADABLE: 'VERIFICATION_INPUT_UNREADABLE',
  WRAPPER_ENVIRONMENT_MISMATCH: 'WRAPPER_ENVIRONMENT_MISMATCH'
});

const ALLOWED_ENVIRONMENTS = new Set(['staging', 'production']);

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonc(text) {
  const errors = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false
  });

  return errors.length === 0 && value && typeof value === 'object'
    ? { ok: true, value }
    : { ok: false };
}

export function parseDeploymentFiles({ configText, appText }) {
  if (configText === undefined) {
    return { ok: false, code: FAILURE_CODES.MISSING_BASE44_CONFIG };
  }

  const config = parseJsonc(configText);
  if (!config.ok) {
    return { ok: false, code: FAILURE_CODES.MALFORMED_BASE44_CONFIG };
  }

  const appName = trimmedString(config.value.name);
  if (!appName) {
    return { ok: false, code: FAILURE_CODES.MISSING_APP_NAME };
  }

  if (appText === undefined) {
    return {
      ok: false,
      code: FAILURE_CODES.MISSING_APP_LINK,
      appName
    };
  }

  const app = parseJsonc(appText);
  if (!app.ok) {
    return {
      ok: false,
      code: FAILURE_CODES.MALFORMED_APP_LINK,
      appName
    };
  }

  const localAppId = trimmedString(app.value.id);
  if (!localAppId) {
    return {
      ok: false,
      code: FAILURE_CODES.MISSING_APP_ID,
      appName
    };
  }

  return {
    ok: true,
    appName,
    localAppId
  };
}

export function appIdFingerprint(appId) {
  const normalized = trimmedString(appId);
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function failure(code, context) {
  return {
    ok: false,
    code,
    ...context
  };
}

export function validateDeploymentTarget(input) {
  const environment = trimmedString(input.environment);
  const appName = trimmedString(input.appName);
  const localAppId = trimmedString(input.localAppId);
  const expectedAppId = trimmedString(input.expectedAppId);
  const productionAppId = trimmedString(input.productionAppId);
  const stagingAppId = trimmedString(input.stagingAppId);
  const expectedGitBranch = trimmedString(input.expectedGitBranch);
  const gitBranch = trimmedString(input.gitBranch);
  const exactGitTag = trimmedString(input.exactGitTag);
  const requiredEnvironment = trimmedString(input.requiredEnvironment);
  const frontendEnvironment = trimmedString(input.frontendEnvironment);

  const context = {
    environment: environment || 'UNSET',
    appName: appName || 'UNAVAILABLE',
    localAppId,
    gitBranch: gitBranch || (exactGitTag ? `DETACHED@${exactGitTag}` : 'DETACHED')
  };

  if (!environment) {
    return failure(FAILURE_CODES.MISSING_DEPLOY_ENVIRONMENT, context);
  }
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    return failure(FAILURE_CODES.UNKNOWN_DEPLOY_ENVIRONMENT, context);
  }
  if (requiredEnvironment && environment !== requiredEnvironment) {
    return failure(FAILURE_CODES.WRAPPER_ENVIRONMENT_MISMATCH, context);
  }
  if (frontendEnvironment && frontendEnvironment !== environment) {
    return failure(FAILURE_CODES.FRONTEND_ENVIRONMENT_MISMATCH, context);
  }
  if (!expectedAppId) {
    return failure(FAILURE_CODES.MISSING_EXPECTED_APP_ID, context);
  }
  if (!productionAppId) {
    return failure(FAILURE_CODES.MISSING_PRODUCTION_APP_ID, context);
  }
  if (!stagingAppId) {
    return failure(FAILURE_CODES.MISSING_STAGING_APP_ID, context);
  }
  if (!expectedGitBranch) {
    return failure(FAILURE_CODES.MISSING_EXPECTED_GIT_BRANCH, context);
  }
  if (productionAppId === stagingAppId) {
    return failure(FAILURE_CODES.APP_ID_COLLISION, context);
  }

  if (environment === 'staging') {
    if (expectedAppId === productionAppId) {
      return failure(FAILURE_CODES.STAGING_USES_PRODUCTION_APP_ID, context);
    }
    if (expectedAppId !== stagingAppId) {
      return failure(FAILURE_CODES.STAGING_EXPECTED_ID_MISMATCH, context);
    }
  } else {
    if (expectedAppId === stagingAppId) {
      return failure(FAILURE_CODES.PRODUCTION_USES_STAGING_APP_ID, context);
    }
    if (expectedAppId !== productionAppId) {
      return failure(FAILURE_CODES.PRODUCTION_EXPECTED_ID_MISMATCH, context);
    }
  }

  if (localAppId !== expectedAppId) {
    return failure(FAILURE_CODES.LOCAL_APP_ID_MISMATCH, context);
  }
  if (input.isDirty && !input.allowDirtyReadOnly) {
    return failure(FAILURE_CODES.DIRTY_WORKTREE, context);
  }

  if (environment === 'staging') {
    if (input.isDetachedHead) {
      return failure(FAILURE_CODES.DETACHED_HEAD_NOT_APPROVED_TAG, context);
    }
    if (!gitBranch) {
      return failure(FAILURE_CODES.GIT_BRANCH_UNAVAILABLE, context);
    }
    if (gitBranch === 'main') {
      return failure(FAILURE_CODES.STAGING_MAIN_FORBIDDEN, context);
    }
    if (gitBranch !== expectedGitBranch) {
      return failure(FAILURE_CODES.GIT_BRANCH_MISMATCH, context);
    }
  } else {
    if (input.allowProductionDeploy !== 'true') {
      return failure(FAILURE_CODES.PRODUCTION_DEPLOY_NOT_ALLOWED, context);
    }

    if (input.isDetachedHead) {
      const approvedTagReference = exactGitTag ? `refs/tags/${exactGitTag}` : '';
      if (!exactGitTag || expectedGitBranch !== approvedTagReference) {
        return failure(FAILURE_CODES.DETACHED_HEAD_NOT_APPROVED_TAG, context);
      }
    } else {
      if (!gitBranch) {
        return failure(FAILURE_CODES.GIT_BRANCH_UNAVAILABLE, context);
      }
      if (gitBranch !== 'main') {
        return failure(FAILURE_CODES.PRODUCTION_REQUIRES_MAIN_OR_RELEASE_TAG, context);
      }
      if (expectedGitBranch !== 'main') {
        return failure(FAILURE_CODES.GIT_BRANCH_MISMATCH, context);
      }
    }
  }

  return {
    ok: true,
    code: input.allowDirtyReadOnly ? 'PASS_READ_ONLY' : 'PASS',
    readOnly: Boolean(input.allowDirtyReadOnly),
    ...context
  };
}

function safeOutputValue(value, fallback) {
  const normalized = trimmedString(value);
  if (!normalized) return fallback;
  return normalized.replace(/[^a-zA-Z0-9 ._@/-]/g, '?').slice(0, 160);
}

export function formatVerificationOutput(result) {
  const fingerprint = appIdFingerprint(result.localAppId);
  const status = result.ok ? result.code : `FAIL: ${result.code}`;
  const environment = [
    'staging',
    'production',
    'UNSET',
    'UNDECLARED',
    'INVALID'
  ].includes(result.environment)
    ? result.environment
    : 'INVALID';

  return [
    `Environment: ${environment}`,
    `App name: ${safeOutputValue(result.appName, 'UNAVAILABLE')}`,
    `App-ID fingerprint: ${fingerprint || 'UNAVAILABLE'}`,
    `Git branch: ${safeOutputValue(result.gitBranch, 'UNAVAILABLE')}`,
    status
  ].join('\n');
}

export function fingerprintOnlyResult({ appName, localAppId, gitBranch }) {
  return {
    ok: true,
    code: 'PASS_READ_ONLY',
    readOnly: true,
    environment: 'UNDECLARED',
    appName,
    localAppId,
    gitBranch
  };
}
