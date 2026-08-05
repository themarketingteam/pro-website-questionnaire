/**
 * Central, browser-safe runtime configuration for the durable-draft client.
 *
 * This module intentionally reads only the named Vite variables below. It
 * never reads browser storage or arbitrary window state, and it never treats
 * a client-side flag as backend authorization.
 */

export const APP_ENVIRONMENTS = Object.freeze([
  'local',
  'test',
  'staging',
  'production',
  'unknown',
]);

const RECOGNIZED_APP_ENVIRONMENTS = new Set(
  APP_ENVIRONMENTS.filter((environment) => environment !== 'unknown'),
);

const STRICT_BOOLEAN_LITERALS = new Set(['true', 'false']);

/**
 * Only the exact lowercase string "true" enables a boolean flag.
 */
export function parseStrictBoolean(value) {
  return value === 'true';
}

/**
 * Unsupported, misspelled, or malformed environments become "unknown".
 */
export function normalizeAppEnvironment(value) {
  return typeof value === 'string' && APP_ENVIRONMENTS.includes(value)
    ? value
    : 'unknown';
}

function isStrictBooleanLiteral(value) {
  return STRICT_BOOLEAN_LITERALS.has(value);
}

function sanitizeBuildIdentifier(value, maxLength = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return '';
  }

  return /^[A-Za-z0-9._:+-]+$/.test(value) ? value : '';
}

/**
 * Build an immutable configuration from an injected Vite-like environment.
 * Missing values remain safe and never throw.
 */
export function getFrontendRuntimeConfig(envSource = {}) {
  const source = envSource && typeof envSource === 'object' ? envSource : {};
  const environment = normalizeAppEnvironment(source.VITE_APP_ENVIRONMENT);
  const environmentRecognized = RECOGNIZED_APP_ENVIRONMENTS.has(environment);
  const durableDraftV2FlagValid = isStrictBooleanLiteral(
    source.VITE_PRO_DRAFT_V2_ENABLED,
  );
  const killSwitchFlagValid = isStrictBooleanLiteral(
    source.VITE_PRO_DRAFT_V2_KILL_SWITCH,
  );
  const killSwitchEnabled = parseStrictBoolean(
    source.VITE_PRO_DRAFT_V2_KILL_SWITCH,
  );
  const configurationValid =
    environmentRecognized && durableDraftV2FlagValid && killSwitchFlagValid;
  const durableDraftV2Enabled =
    configurationValid &&
    parseStrictBoolean(source.VITE_PRO_DRAFT_V2_ENABLED) &&
    !killSwitchEnabled;

  return Object.freeze({
    environment,
    environmentRecognized,
    configurationValid,
    buildSha: sanitizeBuildIdentifier(source.VITE_APP_BUILD_SHA),
    buildTime: sanitizeBuildIdentifier(source.VITE_APP_BUILD_TIME),
    killSwitchEnabled,
    durableDraftV2Enabled,
    publicEmailRecoveryEnabled:
      durableDraftV2Enabled &&
      parseStrictBoolean(source.VITE_PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED),
    emailOtpEnabled:
      durableDraftV2Enabled &&
      parseStrictBoolean(source.VITE_PRO_DRAFT_EMAIL_OTP_ENABLED),
    magicLinkEnabled:
      durableDraftV2Enabled &&
      parseStrictBoolean(source.VITE_PRO_DRAFT_MAGIC_LINK_ENABLED),
    diagnosticsEnabled:
      environmentRecognized &&
      parseStrictBoolean(source.VITE_PRO_DRAFT_DIAGNOSTICS_ENABLED),
    stagingBannerEnabled:
      environment === 'staging' &&
      parseStrictBoolean(source.VITE_STAGING_BANNER_ENABLED),
  });
}

export const frontendRuntimeConfig = getFrontendRuntimeConfig(import.meta.env ?? {});

export function isProductionEnvironment(config = frontendRuntimeConfig) {
  return config.environment === 'production';
}

export function isStagingEnvironment(config = frontendRuntimeConfig) {
  return config.environment === 'staging';
}

export function isDurableDraftClientEnabled(config = frontendRuntimeConfig) {
  return config.durableDraftV2Enabled === true;
}

export function isPublicEmailRecoveryClientEnabled(config = frontendRuntimeConfig) {
  return config.publicEmailRecoveryEnabled === true;
}

export function isEmailOtpClientEnabled(config = frontendRuntimeConfig) {
  return config.emailOtpEnabled === true;
}

export function isMagicLinkClientEnabled(config = frontendRuntimeConfig) {
  return config.magicLinkEnabled === true;
}

export function getSafeFrontendRuntimeSummary(config = frontendRuntimeConfig) {
  return Object.freeze({
    environment: config.environment,
    environmentRecognized: config.environmentRecognized === true,
    configurationValid: config.configurationValid === true,
    buildSha: sanitizeBuildIdentifier(config.buildSha),
    buildTime: sanitizeBuildIdentifier(config.buildTime),
    killSwitchEnabled: config.killSwitchEnabled === true,
    durableDraftV2Enabled: config.durableDraftV2Enabled === true,
    publicEmailRecoveryEnabled: config.publicEmailRecoveryEnabled === true,
    emailOtpEnabled: config.emailOtpEnabled === true,
    magicLinkEnabled: config.magicLinkEnabled === true,
    diagnosticsEnabled: config.diagnosticsEnabled === true,
    stagingBannerEnabled: config.stagingBannerEnabled === true,
  });
}
