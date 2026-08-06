import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProDraftRecoveryCaptcha, {
  createBrowserRecoveryCaptchaProvider,
} from '@/components/pro-form/ProDraftRecoveryCaptcha';

describe('ProDraftRecoveryCaptcha', () => {
  it('does not render or request a token unless the backend requires CAPTCHA', () => {
    const provider = { render: vi.fn() };
    const onToken = vi.fn();
    const view = render(
      <ProDraftRecoveryCaptcha required={false} provider={provider} onToken={onToken} />,
    );
    expect(view.container).toBeEmptyDOMElement();
    expect(provider.render).not.toHaveBeenCalled();
    expect(onToken).not.toHaveBeenCalled();
  });

  it('renders the provider with the public site key and accessible status', async () => {
    const provider = {
      render: vi.fn((_node, options) => {
        options.onToken('synthetic-provider-token');
        return vi.fn();
      }),
    };
    const onToken = vi.fn();
    render(
      <ProDraftRecoveryCaptcha
        required
        environment="staging"
        siteKey="synthetic-public-site-key"
        provider={provider}
        onToken={onToken}
      />,
    );
    await waitFor(() => expect(onToken).toHaveBeenCalledWith('synthetic-provider-token'));
    expect(provider.render.mock.calls[0][1]).toMatchObject({
      siteKey: 'synthetic-public-site-key',
      action: 'recover_draft',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Security check ready.');
  });

  it('fails accessibly when the provider or site key is unavailable', async () => {
    const onError = vi.fn();
    render(
      <ProDraftRecoveryCaptcha
        required
        environment="production"
        siteKey=""
        provider={{ render: vi.fn() }}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalledWith(
      'CAPTCHA_CONFIGURATION_UNAVAILABLE',
    ));
    expect(screen.getByRole('status')).toHaveTextContent('could not load');
  });

  it('rejects the deterministic staging token in production', async () => {
    const provider = {
      render: vi.fn((_node, options) => {
        options.onToken('staging-test-valid');
        return vi.fn();
      }),
    };
    const onToken = vi.fn();
    const onError = vi.fn();
    render(
      <ProDraftRecoveryCaptcha
        required
        environment="production"
        siteKey="synthetic-public-site-key"
        provider={provider}
        onToken={onToken}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalledWith(
      'CAPTCHA_STAGING_TOKEN_FORBIDDEN',
    ));
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it('uses the deterministic test token only in an allowed staging environment', async () => {
    vi.stubEnv('VITE_PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED', 'true');
    const provider = { render: vi.fn() };
    const onToken = vi.fn();
    try {
      render(
        <ProDraftRecoveryCaptcha
          required
          environment="staging"
          provider={provider}
          onToken={onToken}
        />,
      );
      await waitFor(() => expect(onToken).toHaveBeenCalledWith('staging-test-valid'));
      expect(provider.render).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('clears the transient token and removes the widget on unmount', async () => {
    const remove = vi.fn();
    const turnstile = {
      render: vi.fn((_node, options) => {
        options.callback('synthetic-provider-token');
        return 'widget-id';
      }),
      remove,
    };
    const onToken = vi.fn();
    const provider = createBrowserRecoveryCaptchaProvider({ turnstile });
    const view = render(
      <ProDraftRecoveryCaptcha
        required
        environment="staging"
        siteKey="synthetic-public-site-key"
        provider={provider}
        onToken={onToken}
      />,
    );
    await waitFor(() => expect(onToken).toHaveBeenCalledWith('synthetic-provider-token'));
    view.unmount();
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(remove).toHaveBeenCalledWith('widget-id');
  });
});
