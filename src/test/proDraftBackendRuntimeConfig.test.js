import { describe, expect, it } from 'vitest';
import { parseStrictBoolean as parseFrontendBoolean } from '@/lib/proDraftRuntimeConfig';
import {
  ProDraftRuntimeConfigError,
  assertDurableDraftServerEnabled,
  assertExpectedEnvironment,
  getBackendRuntimeConfig,
  getSafeBackendRuntimeSummary,
  isDurableDraftServerEnabled,
  isEmailOtpServerEnabled,
  isMagicLinkServerEnabled,
  isPublicEmailRecoveryServerEnabled,
  normalizeBackendEnvironment,
  normalizeExternalSideEffectsMode,
  parseStrictBoolean as parseBackendBoolean,
} from '../../base44/functions/_shared/proDraftRuntimeConfig/entry.ts';

const enabledStagingEnvironment = (overrides = {}) => ({
  PRO_DRAFT_ENVIRONMENT: 'staging',
  PRO_DRAFT_V2_SERVER_ENABLED: 'true',
  PRO_DRAFT_V2_KILL_SWITCH: 'false',
  PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'false',
  PRO_DRAFT_EMAIL_OTP_ENABLED: 'false',
  PRO_DRAFT_MAGIC_LINK_ENABLED: 'false',
  PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'disabled',
  PRO_DRAFT_DIAGNOSTICS_ENABLED: 'true',
  PRO_DRAFT_BUILD_SHA: 'abc1234',
  ...overrides,
});

describe('backend durable-draft runtime configuration', () => {
  it('keeps every durable-draft workflow disabled without backend values', () => {
    const config = getBackendRuntimeConfig();

    expect(config.durableDraftV2Enabled).toBe(false);
    expect(config.publicEmailRecoveryEnabled).toBe(false);
    expect(config.emailOtpEnabled).toBe(false);
    expect(config.magicLinkEnabled).toBe(false);
  });

  it.each(['true', 'false', 'TRUE', '1', 'yes', '', undefined, true])(
    'agrees with the frontend parser for %p',
    (value) => {
      expect(parseBackendBoolean(value)).toBe(parseFrontendBoolean(value));
    },
  );

  it('normalizes unsupported environment and mode values to safe values', () => {
    expect(normalizeBackendEnvironment('STAGING')).toBe('unknown');
    expect(normalizeBackendEnvironment(' staging ')).toBe('unknown');
    expect(normalizeBackendEnvironment(undefined)).toBe('unknown');
    expect(normalizeExternalSideEffectsMode('PRODUCTION')).toBe('disabled');
    expect(normalizeExternalSideEffectsMode('')).toBe('disabled');
  });

  it('enables backend V2 only with explicit valid controls', () => {
    const config = getBackendRuntimeConfig(enabledStagingEnvironment());

    expect(config.configurationValid).toBe(true);
    expect(isDurableDraftServerEnabled(config)).toBe(true);
    expect(assertDurableDraftServerEnabled(config)).toBe(config);
    expect(assertExpectedEnvironment('staging', config)).toBe(config);
  });

  it('fails closed for unknown, missing, and malformed configuration', () => {
    const unknown = getBackendRuntimeConfig(
      enabledStagingEnvironment({ PRO_DRAFT_ENVIRONMENT: 'preview' }),
    );
    const missingMode = getBackendRuntimeConfig(
      enabledStagingEnvironment({ PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: undefined }),
    );
    const malformedKillSwitch = getBackendRuntimeConfig(
      enabledStagingEnvironment({ PRO_DRAFT_V2_KILL_SWITCH: 'FALSE' }),
    );

    expect(unknown.environment).toBe('unknown');
    expect(isDurableDraftServerEnabled(unknown)).toBe(false);
    expect(missingMode.externalSideEffectsMode).toBe('disabled');
    expect(missingMode.configurationValid).toBe(false);
    expect(isDurableDraftServerEnabled(missingMode)).toBe(false);
    expect(malformedKillSwitch.configurationValid).toBe(false);
    expect(isDurableDraftServerEnabled(malformedKillSwitch)).toBe(false);
  });

  it('lets the kill switch override every enabled backend workflow', () => {
    const config = getBackendRuntimeConfig(
      enabledStagingEnvironment({
        PRO_DRAFT_V2_KILL_SWITCH: 'true',
        PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'true',
        PRO_DRAFT_EMAIL_OTP_ENABLED: 'true',
        PRO_DRAFT_MAGIC_LINK_ENABLED: 'true',
      }),
    );

    expect(config.killSwitchEnabled).toBe(true);
    expect(isDurableDraftServerEnabled(config)).toBe(false);
    expect(isPublicEmailRecoveryServerEnabled(config)).toBe(false);
    expect(isEmailOtpServerEnabled(config)).toBe(false);
    expect(isMagicLinkServerEnabled(config)).toBe(false);
    expect(config.diagnosticsEnabled).toBe(false);
  });

  it.each([
    ['public email', 'PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED', 'publicEmailRecoveryEnabled'],
    ['OTP', 'PRO_DRAFT_EMAIL_OTP_ENABLED', 'emailOtpEnabled'],
    ['magic link', 'PRO_DRAFT_MAGIC_LINK_ENABLED', 'magicLinkEnabled'],
  ])('%s requires backend V2 as well as its own flag', (_label, flag, field) => {
    const withoutV2 = getBackendRuntimeConfig(
      enabledStagingEnvironment({
        PRO_DRAFT_V2_SERVER_ENABLED: 'false',
        [flag]: 'true',
      }),
    );
    const withV2 = getBackendRuntimeConfig(
      enabledStagingEnvironment({ [flag]: 'true' }),
    );

    expect(withoutV2[field]).toBe(false);
    expect(withV2[field]).toBe(true);
  });

  it('rejects production side effects in staging', () => {
    const config = getBackendRuntimeConfig(
      enabledStagingEnvironment({
        PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'production',
      }),
    );

    expect(config.externalSideEffectsConfigurationValid).toBe(false);
    expect(config.configurationValid).toBe(false);
    expect(isDurableDraftServerEnabled(config)).toBe(false);
  });

  it('rejects staging redirect side effects in production', () => {
    const config = getBackendRuntimeConfig(
      enabledStagingEnvironment({
        PRO_DRAFT_ENVIRONMENT: 'production',
        PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
      }),
    );

    expect(config.externalSideEffectsConfigurationValid).toBe(false);
    expect(config.configurationValid).toBe(false);
    expect(isDurableDraftServerEnabled(config)).toBe(false);
  });

  it('accepts only the environment-appropriate enabled side-effect modes', () => {
    const staging = getBackendRuntimeConfig(
      enabledStagingEnvironment({
        PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
      }),
    );
    const production = getBackendRuntimeConfig(
      enabledStagingEnvironment({
        PRO_DRAFT_ENVIRONMENT: 'production',
        PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'production',
      }),
    );

    expect(staging.configurationValid).toBe(true);
    expect(production.configurationValid).toBe(true);
  });

  it('throws a frozen safe structured error when V2 is disabled', () => {
    const config = getBackendRuntimeConfig(
      enabledStagingEnvironment({ PRO_DRAFT_V2_SERVER_ENABLED: 'false' }),
    );

    try {
      assertDurableDraftServerEnabled(config);
      throw new Error('Expected assertDurableDraftServerEnabled to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProDraftRuntimeConfigError);
      expect(error.code).toBe('PRO_DRAFT_DISABLED');
      expect(error.status).toBe(503);
      expect(error.toSafeResponse()).toEqual({
        ok: false,
        error: {
          code: 'PRO_DRAFT_DISABLED',
          message: 'Durable draft processing is unavailable.',
          details: {
            environment: 'staging',
            configurationValid: true,
            killSwitchEnabled: false,
          },
        },
      });
      expect(Object.isFrozen(error.details)).toBe(true);
      expect(Object.isFrozen(error.toSafeResponse())).toBe(true);
    }
  });

  it('rejects an unexpected environment with a safe error', () => {
    const config = getBackendRuntimeConfig(enabledStagingEnvironment());

    expect(() => assertExpectedEnvironment('production', config)).toThrowError(
      expect.objectContaining({
        code: 'PRO_DRAFT_ENVIRONMENT_MISMATCH',
        status: 503,
      }),
    );
  });

  it('returns frozen configuration and safe diagnostic fields only', () => {
    const config = getBackendRuntimeConfig({
      ...enabledStagingEnvironment(),
      BASE44_APP_ID: 'forbidden-app-id',
      BASE44_SERVICE_ROLE_KEY: 'forbidden-service-role',
      ACCESS_TOKEN: 'forbidden-token',
      RECOVERY_CODE: 'forbidden-code',
      EMAIL_ADDRESS: 'person@example.test',
      AWS_SECRET_ACCESS_KEY: 'forbidden-aws-value',
      ZAPIER_WEBHOOK_URL: 'https://hooks.example.test/forbidden',
    });
    const summary = getSafeBackendRuntimeSummary(config);
    const serialized = JSON.stringify(summary);

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.keys(summary)).toEqual([
      'environment',
      'environmentRecognized',
      'configurationValid',
      'externalSideEffectsMode',
      'externalSideEffectsConfigurationValid',
      'buildSha',
      'killSwitchEnabled',
      'durableDraftV2Enabled',
      'publicEmailRecoveryEnabled',
      'emailOtpEnabled',
      'magicLinkEnabled',
      'diagnosticsEnabled',
    ]);
    expect(serialized).not.toMatch(
      /forbidden|person@example|base44|access.?token|recovery.?code|aws|webhook/i,
    );
    expect(() => {
      config.environment = 'production';
    }).toThrow();
  });
});
