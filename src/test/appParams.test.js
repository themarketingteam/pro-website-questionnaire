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
});
