import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStorageGetterThrows } from '@/test/utils/storage';

const importActualClientModule = async () => {
  vi.resetModules();
  vi.doUnmock('@/api/base44Client');
  vi.doMock('@base44/sdk', () => ({
    createClient: vi.fn(() => ({ bootstrap: true })),
  }));
  return import('@/api/base44Client');
};

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('Base44 client initialization', () => {
  it('passes only the verified Base44 client configuration keys', async () => {
    const { initializeBase44Client } = await importActualClientModule();
    const client = { synthetic: true };
    const createClient = vi.fn(() => client);
    const result = initializeBase44Client({
      appId: 'app-id',
      serverUrl: 'https://backend.example.test',
      token: 'synthetic-token',
      functionsVersion: 'v2',
    }, createClient);

    expect(createClient).toHaveBeenCalledWith({
      appId: 'app-id',
      serverUrl: 'https://backend.example.test',
      token: 'synthetic-token',
      functionsVersion: 'v2',
      requiresAuth: false,
    });
    expect(Object.keys(createClient.mock.calls[0][0]).sort()).toEqual([
      'appId',
      'functionsVersion',
      'requiresAuth',
      'serverUrl',
      'token',
    ]);
    expect(result.client).toBe(client);
    expect(result.diagnostics.success).toBe(true);
  });

  it('returns value-free diagnostics when client creation fails', async () => {
    const { BASE44_CLIENT_ERROR_CODES, initializeBase44Client } = await importActualClientModule();
    const result = initializeBase44Client({
      appId: 'app-id',
      serverUrl: 'https://backend.example.test',
      token: 'synthetic-secret-token',
    }, () => {
      throw new Error('Failure containing synthetic-secret-token');
    });

    expect(result.client).toBeNull();
    expect(result.diagnostics).toMatchObject({
      success: false,
      errorCode: BASE44_CLIENT_ERROR_CODES.CLIENT_CREATION_FAILED,
      hasAppId: true,
      hasServerUrl: true,
      hasToken: true,
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain('synthetic-secret-token');
  });

  it('does not fabricate an app ID or call the SDK when the app ID is absent', async () => {
    const { BASE44_CLIENT_ERROR_CODES, initializeBase44Client } = await importActualClientModule();
    const createClient = vi.fn();
    const result = initializeBase44Client({ serverUrl: 'https://backend.example.test' }, createClient);

    expect(createClient).not.toHaveBeenCalled();
    expect(result.client).toBeNull();
    expect(result.diagnostics.errorCode).toBe(BASE44_CLIENT_ERROR_CODES.MISSING_APP_ID);
  });

  it('protects SDK construction from a throwing localStorage property getter', async () => {
    const { initializeBase44Client } = await importActualClientModule();
    const restoreStorage = installStorageGetterThrows();
    const createClient = vi.fn(() => {
      expect(window.localStorage.getItem('base44_access_token')).toBeNull();
      return { synthetic: true };
    });

    try {
      const result = initializeBase44Client({ appId: 'app-id' }, createClient);
      expect(result.client).toEqual({ synthetic: true });
      expect(result.diagnostics.success).toBe(true);
      expect(createClient).toHaveBeenCalledTimes(1);
    } finally {
      restoreStorage();
    }
  });
});
