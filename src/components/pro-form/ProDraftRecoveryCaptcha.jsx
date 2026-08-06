import { useEffect, useMemo, useRef, useState } from 'react';

const STAGING_TEST_TOKEN = 'staging-test-valid';
const ALLOWED_TEST_ENVIRONMENTS = new Set(['staging', 'test']);

const defaultSiteKey = () => String(
  // @ts-expect-error Vite injects this browser-only environment object.
  import.meta.env.VITE_PRO_DRAFT_CAPTCHA_SITE_KEY || '',
).trim();

/** @param {{ turnstile?: any }} [options] */
export const createBrowserRecoveryCaptchaProvider = ({ turnstile } = {}) => ({
  render(container, { siteKey, action, onToken, onError, onExpired }) {
    const api = turnstile || globalThis.turnstile;
    if (!api || typeof api.render !== 'function') {
      throw new Error('CAPTCHA_PROVIDER_UNAVAILABLE');
    }
    const widgetId = api.render(container, {
      sitekey: siteKey,
      action,
      callback: onToken,
      'error-callback': onError,
      'expired-callback': onExpired,
    });
    return () => {
      try { api.remove?.(widgetId); } catch {}
    };
  },
});

export default function ProDraftRecoveryCaptcha({
  required = false,
  environment = 'unknown',
  siteKey = defaultSiteKey(),
  provider,
  onToken,
  onError,
  resetKey = 0,
}) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const selectedProvider = useMemo(
    () => provider || createBrowserRecoveryCaptchaProvider(),
    [provider],
  );
  // @ts-expect-error Vite injects this browser-only environment object.
  const stagingTestEnabled = import.meta.env
    .VITE_PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED === 'true';

  useEffect(() => {
    if (!required) return undefined;
    let active = true;
    let cleanup;
    setStatus('loading');
    onToken?.(null);

    if (stagingTestEnabled && ALLOWED_TEST_ENVIRONMENTS.has(environment)) {
      setStatus('ready');
      onToken?.(STAGING_TEST_TOKEN);
      return () => { active = false; };
    }

    if (!siteKey || !containerRef.current) {
      setStatus('error');
      onError?.('CAPTCHA_CONFIGURATION_UNAVAILABLE');
      return () => { active = false; };
    }

    try {
      cleanup = selectedProvider.render(containerRef.current, {
        siteKey,
        action: 'recover_draft',
        onToken: (token) => {
          if (!active) return;
          if (environment === 'production' && token === STAGING_TEST_TOKEN) {
            setStatus('error');
            onToken?.(null);
            onError?.('CAPTCHA_STAGING_TOKEN_FORBIDDEN');
            return;
          }
          setStatus('ready');
          onToken?.(typeof token === 'string' && token ? token : null);
        },
        onError: () => {
          if (!active) return;
          setStatus('error');
          onToken?.(null);
          onError?.('CAPTCHA_PROVIDER_ERROR');
        },
        onExpired: () => {
          if (!active) return;
          setStatus('expired');
          onToken?.(null);
        },
      });
    } catch {
      setStatus('error');
      onError?.('CAPTCHA_PROVIDER_UNAVAILABLE');
    }

    return () => {
      active = false;
      onToken?.(null);
      try { cleanup?.(); } catch {}
    };
  }, [
    environment,
    onError,
    onToken,
    provider,
    required,
    resetKey,
    selectedProvider,
    siteKey,
    stagingTestEnabled,
  ]);

  if (!required) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-sm font-medium text-slate-800">
        Complete the security check to try recovery again.
      </p>
      <div ref={containerRef} data-testid="pro-draft-captcha-provider" />
      <p role="status" aria-live="polite" className="mt-2 text-sm text-slate-600">
        {status === 'loading' && 'Loading security check…'}
        {status === 'ready' && 'Security check ready.'}
        {status === 'expired' && 'The security check expired. Complete it again.'}
        {status === 'error' && 'The security check could not load. Please try again later.'}
      </p>
    </div>
  );
}
