import {
  frontendRuntimeConfig,
  getSafeFrontendRuntimeSummary,
  normalizeAppEnvironment,
} from './proDraftRuntimeConfig';

const UNKNOWN_BUILD_VALUE = 'unknown';

/**
 * Produce the complete browser-safe build metadata contract from one runtime
 * configuration object. No identifiers, URLs, tokens, or arbitrary env values
 * are copied into the result.
 */
export function getBuildMetadata(config = frontendRuntimeConfig) {
  const summary = getSafeFrontendRuntimeSummary(config);

  return Object.freeze({
    environment: normalizeAppEnvironment(summary.environment),
    buildSha: summary.buildSha || UNKNOWN_BUILD_VALUE,
    buildTime: summary.buildTime || UNKNOWN_BUILD_VALUE,
    draftV2Enabled: summary.durableDraftV2Enabled === true,
    draftV2KillSwitch: summary.killSwitchEnabled === true,
    publicEmailRecoveryEnabled: summary.publicEmailRecoveryEnabled === true,
    otpEnabled: summary.emailOtpEnabled === true,
    magicLinkEnabled: summary.magicLinkEnabled === true,
  });
}

export const buildMetadata = getBuildMetadata();
