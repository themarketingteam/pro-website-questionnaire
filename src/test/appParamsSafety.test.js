import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '@/test/utils/storage';
import {
  getAppParams,
  getSafeAppParamDiagnostics,
  safeRemoveSearchParameter,
} from '@/lib/app-params';

const createWindow = ({
  href = 'https://questionnaire.example.test/form',
  storage = createMemoryStorage(),
  replaceState,
} = {}) => {
  const currentUrl = new URL(href);
  const location = {
    hash: currentUrl.hash,
    href: currentUrl.href,
    pathname: currentUrl.pathname,
    search: currentUrl.search,
  };
  const history = {
    replaceState: replaceState || vi.fn((_state, _title, nextUrl) => {
      const replacement = new URL(nextUrl, currentUrl.origin);
      location.hash = replacement.hash;
      location.href = replacement.href;
      location.pathname = replacement.pathname;
      location.search = replacement.search;
    }),
  };

  return { history, localStorage: storage, location };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safe Base44 application parameters', () => {
  it('uses query values before environment and storage values', () => {
    const storage = createMemoryStorage({
      base44_app_id: 'stored-app',
      base44_server_url: 'https://stored.example.test',
    });
    const windowObject = createWindow({
      href: 'https://questionnaire.example.test/form?app_id=query-app&server_url=https%3A%2F%2Fquery.example.test',
      storage,
    });

    const params = getAppParams({
      environment: {
        VITE_BASE44_APP_ID: 'environment-app',
        VITE_BASE44_BACKEND_URL: 'https://environment.example.test',
      },
      windowObject,
    });

    expect(params.appId).toBe('query-app');
    expect(params.serverUrl).toBe('https://query.example.test');
    expect(storage.getItem('base44_app_id')).toBe('query-app');
  });

  it('uses environment values before stored values and does not persist empty defaults', () => {
    const storage = createMemoryStorage({
      base44_app_id: 'stored-app',
      base44_server_url: 'https://stored.example.test',
    });
    const params = getAppParams({
      environment: {
        VITE_BASE44_APP_ID: 'environment-app',
        VITE_BASE44_BACKEND_URL: '',
      },
      windowObject: createWindow({ storage }),
    });

    expect(params.appId).toBe('environment-app');
    expect(params.serverUrl).toBe('https://stored.example.test');
    expect(storage.getItem('base44_server_url')).toBe('https://stored.example.test');
  });

  it('returns the token while removing only that query parameter', () => {
    const windowObject = createWindow({
      href: 'https://questionnaire.example.test/form?keep=yes&access_token=synthetic-token#question-2',
    });

    const params = getAppParams({ environment: {}, windowObject });

    expect(params.token).toBe('synthetic-token');
    expect(windowObject.location.search).toBe('?keep=yes');
    expect(windowObject.location.hash).toBe('#question-2');
    expect(params.fromUrl).toBe('https://questionnaire.example.test/form?keep=yes#question-2');
  });

  it('keeps the captured token safe when replaceState throws', () => {
    const windowObject = createWindow({
      href: 'https://questionnaire.example.test/form?access_token=synthetic-token&keep=yes#question-2',
      replaceState: vi.fn(() => {
        throw new DOMException('Synthetic history denial', 'SecurityError');
      }),
    });

    const params = getAppParams({ environment: {}, windowObject });

    expect(params.token).toBe('synthetic-token');
    expect(windowObject.location.search).toContain('access_token=synthetic-token');
    expect(getSafeAppParamDiagnostics(params).tokenRemovalSucceeded).toBe(false);
  });

  it('continues without persistence when the localStorage getter throws', () => {
    const windowObject = createWindow();
    Object.defineProperty(windowObject, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Synthetic getter denial', 'SecurityError');
      },
    });

    expect(() => getAppParams({
      environment: { VITE_BASE44_APP_ID: 'environment-app' },
      windowObject,
    })).not.toThrow();
    expect(getAppParams({
      environment: { VITE_BASE44_APP_ID: 'environment-app' },
      windowObject,
    }).appId).toBe('environment-app');
  });

  it.each([
    ['read', {
      getItem() { throw new DOMException('Synthetic read denial', 'SecurityError'); },
      setItem() {},
    }],
    ['write', {
      getItem() { return null; },
      setItem() { throw new DOMException('Synthetic quota denial', 'QuotaExceededError'); },
    }],
  ])('continues when localStorage %s operations throw', (_operation, storage) => {
    const params = getAppParams({
      environment: { VITE_BASE44_APP_ID: 'environment-app' },
      windowObject: createWindow({ storage }),
    });

    expect(params.appId).toBe('environment-app');
  });

  it('continues without a window or document', () => {
    vi.stubGlobal('document', undefined);

    const params = getAppParams({
      environment: { VITE_BASE44_APP_ID: 'environment-app' },
      windowObject: null,
    });

    expect(params).toEqual({
      appId: 'environment-app',
      serverUrl: null,
      token: null,
      fromUrl: null,
      functionsVersion: null,
    });
    expect(safeRemoveSearchParameter('access_token', null)).toBe(false);
  });

  it('imports safely with window and document unavailable', async () => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);

    const importedModule = await import('@/lib/app-params');

    expect(importedModule.appParams).toMatchObject({
      token: null,
      fromUrl: null,
      functionsVersion: null,
    });
  });

  it('imports safely and removes a token when document is unavailable', async () => {
    window.history.replaceState(
      {},
      '',
      '/form?keep=yes&access_token=synthetic-import-token#question-2',
    );
    vi.resetModules();
    vi.stubGlobal('document', undefined);

    const importedModule = await import('@/lib/app-params');

    expect(importedModule.appParams.token).toBe('synthetic-import-token');
    expect(window.location.search).toBe('?keep=yes');
    expect(window.location.hash).toBe('#question-2');
  });

  it('continues when URLSearchParams construction fails', () => {
    vi.stubGlobal('URLSearchParams', class BrokenUrlSearchParams {
      constructor() {
        throw new TypeError('Synthetic URL parser failure');
      }
    });

    const params = getAppParams({
      environment: { VITE_BASE44_APP_ID: 'environment-app' },
      windowObject: createWindow({ href: 'https://questionnaire.example.test/form?app_id=query-app' }),
    });

    expect(params.appId).toBe('environment-app');
    expect(getSafeAppParamDiagnostics(params).urlParseSucceeded).toBe(false);
  });
});
