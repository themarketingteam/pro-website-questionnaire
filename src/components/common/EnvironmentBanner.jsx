import { frontendRuntimeConfig } from '@/lib/proDraftRuntimeConfig';

export const STAGING_ENVIRONMENT_BANNER_TEXT =
  'STAGING — Test environment. Do not enter real client information.';

export const UNKNOWN_ENVIRONMENT_WARNING_TEXT =
  'Configuration warning — application environment is unknown. Durable draft V2 is disabled.';

const DEFAULT_SHOW_UNKNOWN_WARNING = Boolean(
  import.meta.env?.DEV || import.meta.env?.MODE === 'test',
);

export default function EnvironmentBanner({
  runtimeConfig = frontendRuntimeConfig,
  showUnknownEnvironmentWarning = DEFAULT_SHOW_UNKNOWN_WARNING,
}) {
  const showStagingBanner =
    runtimeConfig.environment === 'staging' &&
    runtimeConfig.stagingBannerEnabled === true;

  if (showStagingBanner) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="staging-environment-banner"
        className="sticky top-0 z-40 border-b border-amber-500 bg-amber-300 px-4 pb-2 text-slate-950 shadow-sm"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <p className="mx-auto max-w-7xl text-center text-sm font-bold leading-5 sm:text-left">
          {STAGING_ENVIRONMENT_BANNER_TEXT}
        </p>
      </div>
    );
  }

  if (
    runtimeConfig.environment === 'unknown' &&
    showUnknownEnvironmentWarning === true
  ) {
    return (
      <div
        role="alert"
        data-testid="unknown-environment-warning"
        className="border-b border-red-300 bg-red-50 px-4 py-2 text-red-950"
      >
        <p className="mx-auto max-w-7xl text-center text-sm font-semibold sm:text-left">
          {UNKNOWN_ENVIRONMENT_WARNING_TEXT}
        </p>
      </div>
    );
  }

  return null;
}
