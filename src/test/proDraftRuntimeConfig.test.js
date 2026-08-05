import { describe, expect, it } from 'vitest';
import {
  APP_ENVIRONMENTS,
  frontendRuntimeConfig,
  getFrontendRuntimeConfig,
  getSafeFrontendRuntimeSummary,
  isDurableDraftClientEnabled,
  isEmailOtpClientEnabled,
  isMagicLinkClientEnabled,
  isProductionEnvironment,
  isPublicEmailRecoveryClientEnabled,
  isStagingEnvironment,
  normalizeAppEnvironment,
  parseStrictBoolean,
} from '@/lib/proDraftRuntimeConfig';

const enabledStagingEnvironment = (overrides = {}) => ({
  VITE_APP_ENVIRONMENT: 'staging',
  VITE_APP_BUILD_SHA: 'abc1234',
  VITE_APP_BUILD_TIME: '2026-08-05T12:00:00Z',
  VITE_PRO_DRAFT_V2_ENABLED: 'true',
  VITE_PRO_DRAFT_V2_KILL_SWITCH: 'false',
  VITE_PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'false',
  VITE_PRO_DRAFT_EMAIL_OTP_ENABLED: 'false',
  VITE_PRO_DRAFT_MAGIC_LINK_ENABLED: 'false',
  VITE_PRO_DRAFT_DIAGNOSTICS_ENABLED: 'true',
  VITE_STAGING_BANNER_ENABLED: 'true',
  ...overrides,
});

describe('frontend durable-draft runtime configuration', () => {
  it('keeps every durable-draft workflow disabled in the default test build', () => {
    expect(frontendRuntimeConfig.durableDraftV2Enabled).toBe(false);
    expect(frontendRuntimeConfig.publicEmailRecoveryEnabled).toBe(false);
    expect(frontendRuntimeConfig.emailOtpEnabled).toBe(false);
    expect(frontendRuntimeConfig.magicLinkEnabled).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['TRUE', false],
    ['1', false],
    ['yes', false],
    ['', false],
    [undefined, false],
    [true, false],
  ])('parses %p with exact lowercase-only semantics', (value, expected) => {
    expect(parseStrictBoolean(value)).toBe(expected);
  });

  it('restricts and freezes the environment catalog', () => {
    expect(APP_ENVIRONMENTS).toEqual([
      'local',
      'test',
      'staging',
      'production',
      'unknown',
    ]);
    expect(Object.isFrozen(APP_ENVIRONMENTS)).toBe(true);
    expect(normalizeAppEnvironment('STAGING')).toBe('unknown');
    expect(normalizeAppEnvironment(' staging ')).toBe('unknown');
    expect(normalizeAppEnvironment(undefined)).toBe('unknown');
  });

  it('enables V2 only for a recognized environment and explicit controls', () => {
    const config = getFrontendRuntimeConfig(enabledStagingEnvironment());

    expect(config.configurationValid).toBe(true);
    expect(isDurableDraftClientEnabled(config)).toBe(true);
    expect(isStagingEnvironment(config)).toBe(true);
    expect(isProductionEnvironment(config)).toBe(false);
  });

  it('fails closed for unknown, missing, or malformed enable controls', () => {
    const unknown = getFrontendRuntimeConfig(
      enabledStagingEnvironment({ VITE_APP_ENVIRONMENT: 'preview' }),
    );
    const missingKillSwitch = getFrontendRuntimeConfig(
      enabledStagingEnvironment({ VITE_PRO_DRAFT_V2_KILL_SWITCH: undefined }),
    );
    const malformedEnable = getFrontendRuntimeConfig(
      enabledStagingEnvironment({ VITE_PRO_DRAFT_V2_ENABLED: 'TRUE' }),
    );

    expect(unknown.environment).toBe('unknown');
    expect(isDurableDraftClientEnabled(unknown)).toBe(false);
    expect(missingKillSwitch.configurationValid).toBe(false);
    expect(isDurableDraftClientEnabled(missingKillSwitch)).toBe(false);
    expect(malformedEnable.configurationValid).toBe(false);
    expect(isDurableDraftClientEnabled(malformedEnable)).toBe(false);
  });

  it('lets the kill switch override every enabled client workflow', () => {
    const config = getFrontendRuntimeConfig(
      enabledStagingEnvironment({
        VITE_PRO_DRAFT_V2_KILL_SWITCH: 'true',
        VITE_PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'true',
        VITE_PRO_DRAFT_EMAIL_OTP_ENABLED: 'true',
        VITE_PRO_DRAFT_MAGIC_LINK_ENABLED: 'true',
      }),
    );

    expect(config.killSwitchEnabled).toBe(true);
    expect(isDurableDraftClientEnabled(config)).toBe(false);
    expect(isPublicEmailRecoveryClientEnabled(config)).toBe(false);
    expect(isEmailOtpClientEnabled(config)).toBe(false);
    expect(isMagicLinkClientEnabled(config)).toBe(false);
  });

  it.each([
    ['public email', 'VITE_PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED', 'publicEmailRecoveryEnabled'],
    ['OTP', 'VITE_PRO_DRAFT_EMAIL_OTP_ENABLED', 'emailOtpEnabled'],
    ['magic link', 'VITE_PRO_DRAFT_MAGIC_LINK_ENABLED', 'magicLinkEnabled'],
  ])('%s requires client V2 as well as its own flag', (_label, flag, field) => {
    const withoutV2 = getFrontendRuntimeConfig(
      enabledStagingEnvironment({
        VITE_PRO_DRAFT_V2_ENABLED: 'false',
        [flag]: 'true',
      }),
    );
    const withV2 = getFrontendRuntimeConfig(
      enabledStagingEnvironment({ [flag]: 'true' }),
    );

    expect(withoutV2[field]).toBe(false);
    expect(withV2[field]).toBe(true);
  });

  it('does not allow staging banner behavior in production', () => {
    const config = getFrontendRuntimeConfig(
      enabledStagingEnvironment({
        VITE_APP_ENVIRONMENT: 'production',
        VITE_STAGING_BANNER_ENABLED: 'true',
      }),
    );

    expect(isProductionEnvironment(config)).toBe(true);
    expect(config.stagingBannerEnabled).toBe(false);
  });

  it('returns frozen configuration and safe diagnostic fields only', () => {
    const config = getFrontendRuntimeConfig({
      ...enabledStagingEnvironment(),
      VITE_BASE44_APP_ID: 'forbidden-app-id',
      VITE_BASE44_BACKEND_URL: 'https://forbidden.example.test',
      ACCESS_TOKEN: 'forbidden-token',
      RECOVERY_CODE: 'forbidden-code',
      EMAIL_ADDRESS: 'person@example.test',
      AWS_SECRET_ACCESS_KEY: 'forbidden-aws-value',
      ZAPIER_WEBHOOK_URL: 'https://hooks.example.test/forbidden',
    });
    const summary = getSafeFrontendRuntimeSummary(config);
    const serialized = JSON.stringify(summary);

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.keys(summary)).toEqual([
      'environment',
      'environmentRecognized',
      'configurationValid',
      'buildSha',
      'buildTime',
      'killSwitchEnabled',
      'durableDraftV2Enabled',
      'publicEmailRecoveryEnabled',
      'emailOtpEnabled',
      'magicLinkEnabled',
      'diagnosticsEnabled',
      'stagingBannerEnabled',
    ]);
    expect(serialized).not.toMatch(
      /forbidden|person@example|base44|access.?token|recovery.?code|aws|webhook/i,
    );
    expect(() => {
      config.environment = 'production';
    }).toThrow();
  });

  it('uses injected input without mutating import.meta.env', () => {
    const originalEnvironment = { ...import.meta.env };
    const injected = enabledStagingEnvironment();

    getFrontendRuntimeConfig(injected);

    expect(import.meta.env).toEqual(originalEnvironment);
    expect(injected).toEqual(enabledStagingEnvironment());
  });
});
