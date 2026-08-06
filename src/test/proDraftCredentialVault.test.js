import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  PRO_DRAFT_CREDENTIAL_ERROR_CODES,
  PRO_DRAFT_CREDENTIAL_VAULT_VERSION,
  createCredentialVaultKey,
  createProDraftCredentialVault,
  getSafeCredentialVaultDiagnostics,
  validateCredentialBundle,
} from '@/lib/proDraftCredentialVault';
import { createResilientStorage } from '@/lib/resilientStorage';
import { createMemoryStorage } from '@/test/utils/storage';

const namespace = `ns_${'a'.repeat(32)}`;
const now = Date.parse('2033-05-18T00:00:00.000Z');

const bundle = (overrides = {}) => ({
  version: PRO_DRAFT_CREDENTIAL_VAULT_VERSION,
  environment: 'staging',
  browserNamespace: namespace,
  draftId: 'draft-synthetic-1',
  sessionId: 'session-synthetic-1',
  resumeToken: 'R'.repeat(43),
  recoverySessionToken: `${'a'.repeat(43)}.${'b'.repeat(43)}`,
  recoverySessionExpiresAt: '2033-05-19T00:00:00.000Z',
  recoveryCode: '2345-6789-ABCD-EFGH-JKMN',
  recoveryCodeHint: 'JKMN',
  recoveryCodeVersion: 1,
  authorizationMethod: 'recovery_code',
  storedAtClient: '2033-05-18T00:00:00.000Z',
  lastUsedAtClient: null,
  ...overrides,
});

const storage = (overrides = {}) => createResilientStorage({
  indexedDB: null,
  localStorage: null,
  sessionStorage: null,
  timeoutMs: 20,
  ...overrides,
});

const vault = (adapter = storage()) => createProDraftCredentialVault({
  storage: adapter,
  environment: 'staging',
  browserNamespace: namespace,
});

describe('pro draft credential vault', () => {
  it('uses the scoped versioned key without draft or credential material', () => {
    const key = createCredentialVaultKey(namespace);
    expect(key).toBe(`pro-questionnaire:v5:${namespace}:draft-credentials`);
    expect(key).not.toMatch(/draft-synthetic|2345|RRRR|email/iu);
  });

  it('saves and loads a normalized credential bundle', async () => {
    const subject = vault();
    const saved = await subject.saveDraftCredentialBundle(bundle(), { allowRecoveryCode: true });
    const loaded = await subject.loadDraftCredentialBundle();
    expect(saved.ok).toBe(true);
    expect(loaded.bundle).toEqual(saved.bundle);
    expect(loaded.safeDiagnostics).toMatchObject({
      hasResumeToken: true,
      hasRecoverySession: true,
      hasRecoveryCode: true,
      memoryOnly: true,
    });
  });

  it('prefers IndexedDB and reports it truthfully', async () => {
    const adapter = storage({
      indexedDB: new IDBFactory(),
      databaseName: 'draft-credential-vault-idb',
      localStorage: createMemoryStorage(),
    });
    const saved = await vault(adapter).saveDraftCredentialBundle(bundle(), {
      allowRecoveryCode: true,
    });
    expect(saved.storageMode).toBe('indexeddb');
    expect(saved.safeDiagnostics.durable).toBe(true);
  });

  it('falls back to localStorage', async () => {
    const adapter = storage({ localStorage: createMemoryStorage() });
    const saved = await vault(adapter).saveDraftCredentialBundle(bundle(), {
      allowRecoveryCode: true,
    });
    expect(saved.storageMode).toBe('localstorage');
    expect(saved.safeDiagnostics.durable).toBe(true);
  });

  it('keeps credentials in page memory when persistent storage is blocked', async () => {
    const adapter = storage();
    const subject = vault(adapter);
    await subject.saveDraftCredentialBundle(bundle(), { allowRecoveryCode: true });
    expect((await subject.loadDraftCredentialBundle()).bundle.recoveryCode).toBe(
      '2345-6789-ABCD-EFGH-JKMN',
    );
    expect(adapter.getMode()).toBe('memory_only');
  });

  it('treats malformed JSON as a safe isolated vault failure', async () => {
    const adapter = storage();
    await adapter.setItem(createCredentialVaultKey(namespace), '{bad');
    const loaded = await vault(adapter).loadDraftCredentialBundle();
    expect(loaded).toMatchObject({
      ok: false,
      present: true,
      bundle: null,
      errorCode: PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_BUNDLE,
    });
  });

  it('repairs only a malformed recovery session and preserves a valid resume token', async () => {
    const adapter = storage();
    await adapter.setItem(createCredentialVaultKey(namespace), JSON.stringify(bundle({
      recoverySessionToken: 'malformed-session',
    })));
    const loaded = await vault(adapter).loadDraftCredentialBundle();
    expect(loaded).toMatchObject({ ok: true, repaired: true });
    expect(loaded.bundle).toMatchObject({
      resumeToken: 'R'.repeat(43),
      recoverySessionToken: null,
      recoverySessionExpiresAt: null,
    });
  });

  it('repairs only a malformed resume token and preserves a valid recovery session', async () => {
    const adapter = storage();
    await adapter.setItem(createCredentialVaultKey(namespace), JSON.stringify(bundle({
      resumeToken: 'bad token',
    })));
    const loaded = await vault(adapter).loadDraftCredentialBundle();
    expect(loaded.bundle.resumeToken).toBeNull();
    expect(loaded.bundle.recoverySessionToken).toBe(`${'a'.repeat(43)}.${'b'.repeat(43)}`);
  });

  it('rejects a future vault version', () => {
    expect(() => validateCredentialBundle(bundle({ version: 2 }), {
      environment: 'staging', browserNamespace: namespace,
    })).toThrow(expect.objectContaining({
      code: PRO_DRAFT_CREDENTIAL_ERROR_CODES.UNSUPPORTED_VERSION,
    }));
  });

  it.each([
    ['environment', { environment: 'preview' }, PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_ENVIRONMENT],
    ['environment mismatch', { environment: 'production' }, PRO_DRAFT_CREDENTIAL_ERROR_CODES.ENVIRONMENT_MISMATCH],
    ['authorization method', { authorizationMethod: 'admin_grant' }, PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_AUTHORIZATION_METHOD],
    ['resume token', { resumeToken: 'contains whitespace' }, PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RESUME_TOKEN],
    ['recovery session', { recoverySessionToken: 'one-segment' }, PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_SESSION_TOKEN],
    ['identifier', { draftId: 42 }, PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_IDENTIFIER],
  ])('rejects invalid %s', (_label, patch, code) => {
    expect(() => validateCredentialBundle(bundle(patch), {
      environment: 'staging', browserNamespace: namespace,
    })).toThrow(expect.objectContaining({ code }));
  });

  it('accepts epoch expiration and normalizes it to ISO', () => {
    const normalized = validateCredentialBundle(bundle({
      recoverySessionExpiresAt: 2_000_000_000,
    }), { environment: 'staging', browserNamespace: namespace });
    expect(normalized.recoverySessionExpiresAt).toBe('2033-05-18T03:33:20.000Z');
  });

  it('rejects malformed recovery code and mismatched hint', () => {
    expect(() => validateCredentialBundle(bundle({ recoveryCode: 'not-a-code' }), {
      environment: 'staging', browserNamespace: namespace,
    })).toThrow(expect.objectContaining({
      code: PRO_DRAFT_CREDENTIAL_ERROR_CODES.INVALID_RECOVERY_CODE,
    }));
    expect(() => validateCredentialBundle(bundle({ recoveryCodeHint: '2345' }), {
      environment: 'staging', browserNamespace: namespace,
    })).toThrow();
  });

  it('permits hint-only email recovery but enforces raw-code provenance policy', async () => {
    const subject = vault();
    const hintOnly = bundle({
      recoveryCode: null,
      recoveryCodeHint: 'JKMN',
      authorizationMethod: 'email',
    });
    expect((await subject.saveDraftCredentialBundle(hintOnly, {
      allowRecoveryCode: false,
    })).ok).toBe(true);
    const denied = await subject.saveDraftCredentialBundle(bundle());
    expect(denied.errorCode).toBe(
      PRO_DRAFT_CREDENTIAL_ERROR_CODES.RECOVERY_CODE_STORAGE_NOT_ALLOWED,
    );
  });

  it('removes only an expired recovery session and preserves resume/code/local identity', async () => {
    const subject = vault();
    await subject.saveDraftCredentialBundle(bundle({
      recoverySessionExpiresAt: '2033-05-17T00:00:00.000Z',
    }), { allowRecoveryCode: true });
    const result = await subject.removeExpiredRecoverySession({ now: () => now });
    expect(result.bundle).toMatchObject({
      recoverySessionToken: null,
      recoverySessionExpiresAt: null,
      resumeToken: 'R'.repeat(43),
      recoveryCode: '2345-6789-ABCD-EFGH-JKMN',
      draftId: 'draft-synthetic-1',
    });
    expect(result.safeDiagnostics.recoverySessionExpired).toBe(true);
  });

  it('does not mutate a nonexpired recovery session', async () => {
    const subject = vault();
    await subject.saveDraftCredentialBundle(bundle(), { allowRecoveryCode: true });
    const result = await subject.removeExpiredRecoverySession({ now: () => now });
    expect(result.bundle.recoverySessionToken).toBe(`${'a'.repeat(43)}.${'b'.repeat(43)}`);
  });

  it('preserves the last good serialized value after rejected replacement', async () => {
    const subject = vault();
    await subject.saveDraftCredentialBundle(bundle(), { allowRecoveryCode: true });
    const failed = await subject.saveDraftCredentialBundle(bundle({ resumeToken: {} }), {
      allowRecoveryCode: true,
    });
    expect(failed.ok).toBe(false);
    expect((await subject.loadDraftCredentialBundle()).bundle.resumeToken).toBe('R'.repeat(43));
  });

  it('safe diagnostics omit every credential value', () => {
    const diagnostics = getSafeCredentialVaultDiagnostics({
      ok: true, present: true, bundle: bundle(), storageMode: 'localstorage',
    });
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toMatch(/RRRR|2345-6789|aaaa|draft-synthetic-1|session-synthetic/iu);
  });

  it('removes the scoped credential record', async () => {
    const subject = vault();
    await subject.saveDraftCredentialBundle(bundle(), { allowRecoveryCode: true });
    expect((await subject.removeDraftCredentialBundle()).removed).toBe(true);
    expect((await subject.loadDraftCredentialBundle()).present).toBe(false);
  });
});
