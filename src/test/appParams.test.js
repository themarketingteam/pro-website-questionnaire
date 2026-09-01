import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Base44 app parameters on the custom domain', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.resetModules();
  });

  it('uses the production app and API defaults when no query or stored values exist', async () => {
    const { appParams } = await import('@/lib/app-params');

    expect(appParams.appId).toBe('6925fec3678942d22522b010');
    expect(appParams.serverUrl).toBe('https://base44.app');
  });

  it('rejects literal null parameters instead of producing /null/api/apps/null URLs', async () => {
    window.history.replaceState({}, '', '/?app_id=null&server_url=null');

    const { appParams } = await import('@/lib/app-params');

    expect(appParams.appId).toBe('6925fec3678942d22522b010');
    expect(appParams.serverUrl).toBe('https://base44.app');
  });

  it('ignores and clears stale editor function versions on a custom domain', async () => {
    localStorage.setItem('base44_functions_version', 'stale-preview-version');
    window.history.replaceState({}, '', '/?functions_version=another-stale-version');

    const { appParams } = await import('@/lib/app-params');

    expect(appParams.functionsVersion).toBeNull();
    expect(localStorage.getItem('base44_functions_version')).toBeNull();
  });

  it('never pins the source-controlled app to an older backend function bundle', async () => {
    const { shouldUseFunctionsVersion, resolveFunctionsVersion } = await import('@/lib/app-params');

    expect(shouldUseFunctionsVersion('app.base44.com')).toBe(true);
    expect(shouldUseFunctionsVersion('pro-website-questionnaire-2522b010.base44.app')).toBe(true);
    expect(shouldUseFunctionsVersion('proform.tmtwebsiteresources.xyz')).toBe(false);
    expect(resolveFunctionsVersion({
      hostname: 'pro-website-questionnaire-2522b010.base44.app',
      search: ''
    })).toBeNull();
    expect(resolveFunctionsVersion({
      hostname: 'pro-website-questionnaire-2522b010.base44.app',
      search: '?functions_version=current-editor-version'
    })).toBeNull();
  });

  it('still resolves production routing when browser storage is blocked', async () => {
    const originalGetItem = localStorage.getItem;
    const originalSetItem = localStorage.setItem;
    const originalRemoveItem = localStorage.removeItem;
    Object.defineProperties(localStorage, {
      getItem: { configurable: true, value: () => { throw new DOMException('Blocked', 'SecurityError'); } },
      setItem: { configurable: true, value: () => { throw new DOMException('Blocked', 'SecurityError'); } },
      removeItem: { configurable: true, value: () => { throw new DOMException('Blocked', 'SecurityError'); } },
    });

    try {
      vi.resetModules();
      const { appParams } = await import('@/lib/app-params');
      expect(appParams.appId).toBe('6925fec3678942d22522b010');
      expect(appParams.serverUrl).toBe('https://base44.app');
      expect(appParams.functionsVersion).toBeNull();
    } finally {
      Object.defineProperties(localStorage, {
        getItem: { configurable: true, value: originalGetItem },
        setItem: { configurable: true, value: originalSetItem },
        removeItem: { configurable: true, value: originalRemoveItem },
      });
    }
  });
});
