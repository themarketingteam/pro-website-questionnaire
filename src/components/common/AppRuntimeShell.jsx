import EnvironmentBanner from './EnvironmentBanner';
import { getBuildMetadata } from '@/lib/buildMetadata';
import { frontendRuntimeConfig } from '@/lib/proDraftRuntimeConfig';

function booleanMarker(value) {
  return value === true ? 'true' : 'false';
}

/**
 * Stable, route-independent shell for safe runtime markers and environment UI.
 * `contents` avoids adding a production layout box when the banner is absent.
 */
export default function AppRuntimeShell({
  children,
  runtimeConfig = frontendRuntimeConfig,
  showUnknownEnvironmentWarning,
}) {
  const metadata = getBuildMetadata(runtimeConfig);

  return (
    <div
      className="contents"
      data-testid="application-runtime-shell"
      data-app-environment={metadata.environment}
      data-build-sha={metadata.buildSha}
      data-build-time={metadata.buildTime}
      data-draft-v2-enabled={booleanMarker(metadata.draftV2Enabled)}
      data-draft-v2-kill-switch={booleanMarker(metadata.draftV2KillSwitch)}
      data-public-email-recovery-enabled={booleanMarker(
        metadata.publicEmailRecoveryEnabled,
      )}
      data-otp-enabled={booleanMarker(metadata.otpEnabled)}
      data-magic-link-enabled={booleanMarker(metadata.magicLinkEnabled)}
    >
      <EnvironmentBanner
        runtimeConfig={runtimeConfig}
        showUnknownEnvironmentWarning={showUnknownEnvironmentWarning}
      />
      {children}
    </div>
  );
}
