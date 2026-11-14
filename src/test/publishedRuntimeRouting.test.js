import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APP_ID = '6925fec3678942d22522b010';
const ENDPOINT = `https://base44.app/api/apps/${APP_ID}/functions/syncProQuestionnaireDraft`;
const CREDENTIAL = 'synthetic_session_1234567890.abcdefghijklmnopqrstuvwxyzABCDEFGH';

function visit(url) {
  const location = new URL(url);
  vi.stubGlobal('window', {
    localStorage,
    location,
    history: { replaceState(_state, _title, value) { location.href = new URL(value, location).href; } },
  });
}

describe('published Pro destination authority', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each(['proform.tmtwebsiteresources.xyz', 'pro-website-questionnaire-2522b010.base44.app'])(
    'ignores forged routing on %s and keeps authenticated recovery at the canonical endpoint',
    async (hostname) => {
      localStorage.setItem('base44_app_id', 'cached-other-app');
      localStorage.setItem('base44_server_url', 'https://cached-destination.invalid');
      localStorage.setItem('base44_functions_version', 'cached-old-functions');
      visit(`https://${hostname}/?app_id=forged-other-app&server_url=https%3A%2F%2Fforged-destination.invalid&functions_version=obsolete&from_url=https%3A%2F%2Fforged-return.invalid&access_token=synthetic-login-token#draft=${CREDENTIAL}`);
      const { appParams } = await import('@/lib/app-params');
      expect(appParams).toMatchObject({ appId: APP_ID, serverUrl: 'https://base44.app', functionsVersion: null, token: 'synthetic-login-token' });
      expect(new URL(appParams.fromUrl).hostname).toBe(hostname);
      expect(window.location.hash).toBe(`#draft=${CREDENTIAL}`);
      expect(window.location.search).not.toContain('access_token');
      expect(localStorage.getItem('base44_app_id')).toBeNull();
      expect(localStorage.getItem('base44_server_url')).toBeNull();
      expect(localStorage.getItem('base44_functions_version')).toBeNull();

      // Exercise the native keepalive code, which does not use the SDK client.
      const { flushDraftMutationKeepalive } = await import('@/lib/draftPersistence');
      const fetchImpl = vi.fn(async () => ({ ok: true }));
      const payload = { action: 'save', resumeCredential: CREDENTIAL, responses: { '6': 'Preserved answer' } };
      expect(flushDraftMutationKeepalive({ payload, fetchImpl })).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({
        headers: { 'Content-Type': 'application/json', 'X-App-Id': APP_ID },
        body: JSON.stringify(payload), keepalive: true, credentials: 'omit',
      }));
    },
  );

  it.each(['methods', 'getter'])('pins published routing when storage %s deny access', async (failure) => {
    visit('https://proform.tmtwebsiteresources.xyz/?app_id=forged&server_url=https%3A%2F%2Fforged.invalid');
    if (failure === 'getter') Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage denied'); } });
    else window.localStorage = {
        getItem() { throw new Error('Storage denied'); },
        setItem() { throw new Error('Storage denied'); },
        removeItem() { throw new Error('Storage denied'); },
      };
    const { appParams } = await import('@/lib/app-params');
    expect(appParams.appId).toBe(APP_ID);
    expect(appParams.serverUrl).toBe('https://base44.app');
  });

  it.each(['localhost:5173', '127.0.0.1:5173', 'questionnaire.test'])(
    'retains explicit test routing on %s', async (hostname) => {
      visit(`http://${hostname}/?app_id=synthetic-test-app&server_url=http%3A%2F%2Flocalhost%3A7777`);
      const { appParams } = await import('@/lib/app-params');
      expect(appParams.appId).toBe('synthetic-test-app');
      expect(appParams.serverUrl).toBe('http://localhost:7777');
    },
  );
});
