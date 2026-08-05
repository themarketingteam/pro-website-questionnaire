import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import AppRuntimeShell from '@/components/common/AppRuntimeShell';
import EnvironmentBanner, {
  STAGING_ENVIRONMENT_BANNER_TEXT,
  UNKNOWN_ENVIRONMENT_WARNING_TEXT,
} from '@/components/common/EnvironmentBanner';
import { getBuildMetadata } from '@/lib/buildMetadata';
import { getFrontendRuntimeConfig } from '@/lib/proDraftRuntimeConfig';

const runtimeEnvironment = (overrides = {}) => ({
  VITE_APP_ENVIRONMENT: 'staging',
  VITE_APP_BUILD_SHA: 'abc1234',
  VITE_APP_BUILD_TIME: '2026-08-05T18:30:00Z',
  VITE_PRO_DRAFT_V2_ENABLED: 'false',
  VITE_PRO_DRAFT_V2_KILL_SWITCH: 'true',
  VITE_PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'false',
  VITE_PRO_DRAFT_EMAIL_OTP_ENABLED: 'false',
  VITE_PRO_DRAFT_MAGIC_LINK_ENABLED: 'false',
  VITE_PRO_DRAFT_DIAGNOSTICS_ENABLED: 'true',
  VITE_STAGING_BANNER_ENABLED: 'true',
  ...overrides,
});

const runtimeConfig = (overrides = {}) =>
  getFrontendRuntimeConfig(runtimeEnvironment(overrides));

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('environment banner', () => {
  it('renders the exact accessible staging warning when both controls allow it', () => {
    render(<EnvironmentBanner runtimeConfig={runtimeConfig()} />);

    const banner = screen.getByTestId('staging-environment-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner).toHaveTextContent(STAGING_ENVIRONMENT_BANNER_TEXT);
  });

  it('does not render in staging when the banner flag is false', () => {
    render(
      <EnvironmentBanner
        runtimeConfig={runtimeConfig({ VITE_STAGING_BANNER_ENABLED: 'false' })}
      />,
    );

    expect(
      screen.queryByTestId('staging-environment-banner'),
    ).not.toBeInTheDocument();
  });

  it('does not render in production even if the raw banner flag is true', () => {
    render(
      <EnvironmentBanner
        runtimeConfig={runtimeConfig({ VITE_APP_ENVIRONMENT: 'production' })}
      />,
    );

    expect(
      screen.queryByTestId('staging-environment-banner'),
    ).not.toBeInTheDocument();
  });

  it('does not render from a staging URL query parameter', () => {
    window.history.replaceState({}, '', '/?staging=1');

    render(
      <EnvironmentBanner
        runtimeConfig={runtimeConfig({ VITE_APP_ENVIRONMENT: 'production' })}
      />,
    );

    expect(
      screen.queryByTestId('staging-environment-banner'),
    ).not.toBeInTheDocument();
  });

  it('shows a safe unknown-environment warning only when development/test allows it', () => {
    const unknown = runtimeConfig({ VITE_APP_ENVIRONMENT: 'preview' });
    const { rerender } = render(
      <EnvironmentBanner
        runtimeConfig={unknown}
        showUnknownEnvironmentWarning
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      UNKNOWN_ENVIRONMENT_WARNING_TEXT,
    );
    expect(screen.queryByText(/production environment/i)).not.toBeInTheDocument();

    rerender(
      <EnvironmentBanner
        runtimeConfig={unknown}
        showUnknownEnvironmentWarning={false}
      />,
    );
    expect(
      screen.queryByTestId('unknown-environment-warning'),
    ).not.toBeInTheDocument();
  });
});

describe('safe build metadata and runtime markers', () => {
  it('exports only the frozen safe build metadata contract', () => {
    const config = getFrontendRuntimeConfig({
      ...runtimeEnvironment(),
      VITE_BASE44_APP_ID: 'forbidden-app-id',
      VITE_BASE44_BACKEND_URL: 'https://forbidden.example.test',
      ACCESS_TOKEN: 'forbidden-access-token',
      EMAIL_ADDRESS: 'person@example.test',
      RECOVERY_CODE: 'forbidden-recovery-code',
    });
    const metadata = getBuildMetadata(config);
    const serialized = JSON.stringify(metadata);

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.keys(metadata)).toEqual([
      'environment',
      'buildSha',
      'buildTime',
      'draftV2Enabled',
      'draftV2KillSwitch',
      'publicEmailRecoveryEnabled',
      'otpEnabled',
      'magicLinkEnabled',
    ]);
    expect(metadata).toEqual({
      environment: 'staging',
      buildSha: 'abc1234',
      buildTime: '2026-08-05T18:30:00Z',
      draftV2Enabled: false,
      draftV2KillSwitch: true,
      publicEmailRecoveryEnabled: false,
      otpEnabled: false,
      magicLinkEnabled: false,
    });
    expect(serialized).not.toMatch(
      /forbidden|person@example|base44|access.?token|recovery.?code|backend.?url/i,
    );
  });

  it('normalizes absent build values to unknown without inferring production', () => {
    const metadata = getBuildMetadata(
      runtimeConfig({
        VITE_APP_ENVIRONMENT: undefined,
        VITE_APP_BUILD_SHA: undefined,
        VITE_APP_BUILD_TIME: undefined,
      }),
    );

    expect(metadata.environment).toBe('unknown');
    expect(metadata.buildSha).toBe('unknown');
    expect(metadata.buildTime).toBe('unknown');
    expect(metadata.draftV2Enabled).toBe(false);
  });

  it('publishes safe machine-readable markers once on the application shell', () => {
    render(
      <AppRuntimeShell runtimeConfig={runtimeConfig()}>
        <main>Questionnaire content</main>
      </AppRuntimeShell>,
    );

    const shell = screen.getByTestId('application-runtime-shell');
    expect(shell.dataset).toMatchObject({
      appEnvironment: 'staging',
      buildSha: 'abc1234',
      buildTime: '2026-08-05T18:30:00Z',
      draftV2Enabled: 'false',
      draftV2KillSwitch: 'true',
      publicEmailRecoveryEnabled: 'false',
      otpEnabled: 'false',
      magicLinkEnabled: 'false',
    });
    expect(screen.getAllByTestId('staging-environment-banner')).toHaveLength(1);
  });

  it('reports production-disabled markers without rendering a production banner', () => {
    render(
      <AppRuntimeShell
        runtimeConfig={runtimeConfig({ VITE_APP_ENVIRONMENT: 'production' })}
      >
        <main>Production content</main>
      </AppRuntimeShell>,
    );

    const shell = screen.getByTestId('application-runtime-shell');
    expect(shell).toHaveAttribute('data-app-environment', 'production');
    expect(shell).toHaveAttribute('data-draft-v2-enabled', 'false');
    expect(shell).toHaveAttribute('data-draft-v2-kill-switch', 'true');
    expect(shell).toHaveAttribute('data-public-email-recovery-enabled', 'false');
    expect(
      screen.queryByTestId('staging-environment-banner'),
    ).not.toBeInTheDocument();
  });

  it('does not render app IDs, URLs, tokens, emails, or recovery codes', () => {
    const config = getFrontendRuntimeConfig({
      ...runtimeEnvironment(),
      VITE_BASE44_APP_ID: 'forbidden-app-id',
      VITE_BASE44_BACKEND_URL: 'https://forbidden.example.test',
      ACCESS_TOKEN: 'forbidden-access-token',
      EMAIL_ADDRESS: 'person@example.test',
      RECOVERY_CODE: 'forbidden-recovery-code',
    });
    const { container } = render(
      <AppRuntimeShell runtimeConfig={config}>
        <main>Safe content</main>
      </AppRuntimeShell>,
    );

    expect(container.innerHTML).not.toMatch(
      /forbidden|person@example|base44|access.?token|recovery.?code|backend.?url/i,
    );
  });

  it('does not enable any runtime feature through banner rendering', () => {
    const config = runtimeConfig();
    render(<EnvironmentBanner runtimeConfig={config} />);

    expect(config.durableDraftV2Enabled).toBe(false);
    expect(config.publicEmailRecoveryEnabled).toBe(false);
    expect(config.emailOtpEnabled).toBe(false);
    expect(config.magicLinkEnabled).toBe(false);
    expect(config.killSwitchEnabled).toBe(true);
  });
});

function RouteFixture() {
  return (
    <>
      <nav>
        <Link to="/">Questionnaire</Link>
        <Link to="/thank-you">Thank you</Link>
        <Link to="/admin/draft-recovery">Admin</Link>
      </nav>
      <Routes>
        <Route path="/" element={<main>Questionnaire route</main>} />
        <Route path="/thank-you" element={<main>Thank-you route</main>} />
        <Route
          path="/admin/draft-recovery"
          element={<main>Admin route</main>}
        />
      </Routes>
    </>
  );
}

describe('route-independent shell integration', () => {
  it('keeps one staging banner across questionnaire, thank-you, and admin routes', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRuntimeShell runtimeConfig={runtimeConfig()}>
          <RouteFixture />
        </AppRuntimeShell>
      </MemoryRouter>,
    );

    expect(screen.getByText('Questionnaire route')).toBeInTheDocument();
    expect(screen.getAllByTestId('staging-environment-banner')).toHaveLength(1);

    fireEvent.click(screen.getByRole('link', { name: 'Thank you' }));
    expect(screen.getByText('Thank-you route')).toBeInTheDocument();
    expect(screen.getAllByTestId('staging-environment-banner')).toHaveLength(1);

    fireEvent.click(screen.getByRole('link', { name: 'Admin' }));
    expect(screen.getByText('Admin route')).toBeInTheDocument();
    expect(screen.getAllByTestId('staging-environment-banner')).toHaveLength(1);
  });
});
