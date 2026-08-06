import { describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_BOOTSTRAP_PHASES,
  PRO_DRAFT_BOOTSTRAP_OUTCOMES,
  createProDraftBootstrapCoordinator,
  reconcileInitialLocalAndServerState,
} from '@/lib/proDraftBootstrapCoordinator';
import { createProDraftCredentialVault } from '@/lib/proDraftCredentialVault';
import { createClientDraftIdentityContext } from '@/lib/proDraftClientIdentityContext';
import { createEmptyCanonicalDraftState } from '@/lib/questionnaireDraftState';
import { createResilientStorage } from '@/lib/resilientStorage';

const namespace = `ns_${'c'.repeat(32)}`;
const NOW = Date.parse('2033-05-18T00:00:00.000Z');
const runtime = Object.freeze({
  environment: 'staging',
  environmentRecognized: true,
  configurationValid: true,
  killSwitchEnabled: false,
  durableDraftV2Enabled: true,
  publicEmailRecoveryEnabled: true,
});
const cryptoProvider = {
  getRandomValues(bytes) {
    bytes.fill(7);
    return bytes;
  },
};

const identity = (overrides = {}) => createClientDraftIdentityContext({
  recoveryEmail: 'synthetic.owner@example.invalid',
  recoveryEmailSource: 'client_entered',
  recoveryEmailVerificationStatus: 'unverified',
  associationIntent: 'anonymous_start',
  anonymousRecoveryAcknowledged: false,
  ...overrides,
});

const canonical = (overrides = {}) => {
  const state = createEmptyCanonicalDraftState({
    draftId: overrides.draftId || 'draft-synthetic-1',
    sessionId: overrides.sessionId || 'session-synthetic-1',
  });
  Object.assign(state, {
    clientRevision: 1,
    serverRevision: 1,
    savedAtClient: '2033-05-18T00:00:00.000Z',
    savedAtServer: '2033-05-18T00:00:00.000Z',
    ...overrides,
  });
  return state;
};

const memoryStorage = () => createResilientStorage({
  indexedDB: null,
  localStorage: null,
  sessionStorage: null,
  timeoutMs: 20,
});

const credentialBundle = (overrides = {}) => ({
  version: 1,
  environment: 'staging',
  browserNamespace: namespace,
  draftId: 'draft-synthetic-1',
  sessionId: 'session-synthetic-1',
  resumeToken: 'R'.repeat(43),
  recoverySessionToken: null,
  recoverySessionExpiresAt: null,
  recoveryCode: null,
  recoveryCodeHint: 'JKMN',
  recoveryCodeVersion: 1,
  authorizationMethod: 'resume_token',
  storedAtClient: '2033-05-18T00:00:00.000Z',
  lastUsedAtClient: null,
  ...overrides,
});

const harness = (overrides = {}) => {
  const storage = overrides.storage || memoryStorage();
  const vault = overrides.credentialVault || createProDraftCredentialVault({
    storage,
    environment: 'staging',
    browserNamespace: namespace,
  });
  const apiClient = overrides.apiClient || {
    bootstrapProFormDraft: vi.fn(async () => ({ success: false })),
    loadProFormDraft: vi.fn(async () => ({ success: false })),
  };
  const recoveryApiClient = overrides.recoveryApiClient || {
    recoverProFormDraftByEmail: vi.fn(async () => ({ success: false })),
    recoverProFormDraftByCode: vi.fn(async () => ({ success: false })),
  };
  const cache = overrides.cache || {
    loadCanonicalDraftCache: vi.fn(async () => ({ ok: true, present: false, state: null })),
    saveCanonicalDraftCache: vi.fn(async () => ({ ok: true, written: true })),
  };
  const dispatch = overrides.dispatch || vi.fn((action) => action);
  const coordinator = createProDraftBootstrapCoordinator({
    runtimeConfig: overrides.runtimeConfig || runtime,
    storage,
    credentialVault: vault,
    apiClient,
    recoveryApiClient,
    canonicalCacheAdapter: cache,
    dispatch,
    identityContext: overrides.identityContext || identity(),
    browserNamespace: namespace,
    signedInvitationToken: overrides.signedInvitationToken,
    signedInvitationVerified: overrides.signedInvitationVerified,
    cryptoProvider,
    getDeviceId: async () => `pdd_${'D'.repeat(22)}`,
    now: () => NOW,
  });
  return { coordinator, storage, vault, apiClient, recoveryApiClient, cache, dispatch };
};

const response = (state = canonical(), overrides = {}) => ({
  success: true,
  created: false,
  resumed: true,
  authorizationMethod: 'resume_token',
  readOnly: state.draftStatus === 'submitted',
  draft: {
    draftId: state.draftId,
    sessionId: state.sessionId,
    readOnly: state.draftStatus === 'submitted',
    canonicalState: state,
  },
  ...overrides,
});

describe('pro draft bootstrap coordinator', () => {
  it('publishes the required phase and outcome model', () => {
    expect(PRO_DRAFT_BOOTSTRAP_PHASES).toEqual(expect.arrayContaining([
      'reading_identity', 'awaiting_client_choice', 'hydrating_redux', 'ready', 'error',
    ]));
    expect(PRO_DRAFT_BOOTSTRAP_OUTCOMES).toEqual(expect.arrayContaining([
      'stored_draft_resumed', 'email_draft_recovered', 'code_draft_recovered',
      'submitted_draft_loaded', 'local_only_recovery',
    ]));
  });

  it('returns legacy flow without touching Redux or APIs when V2 is disabled', async () => {
    const subject = harness({ runtimeConfig: { ...runtime, durableDraftV2Enabled: false } });
    const result = await subject.coordinator.bootstrap();
    expect(result).toMatchObject({ phase: 'ready', outcome: 'legacy_flow' });
    expect(subject.dispatch).not.toHaveBeenCalled();
    expect(subject.apiClient.bootstrapProFormDraft).not.toHaveBeenCalled();
  });

  it('awaits explicit client choice and never dispatches empty canonical state', async () => {
    const subject = harness();
    const result = await subject.coordinator.bootstrap();
    expect(result).toMatchObject({
      phase: 'awaiting_client_choice', clientChoiceRequired: true, outcome: null,
    });
    expect(subject.dispatch.mock.calls.map(([action]) => action.type))
      .not.toContain('form/loadCanonicalDraftState');
  });

  it('resumes stored credentials before presenting a choice', async () => {
    const subject = harness();
    await subject.vault.saveDraftCredentialBundle(credentialBundle());
    subject.apiClient.bootstrapProFormDraft.mockResolvedValue(response());
    const result = await subject.coordinator.bootstrap();
    expect(result.outcome).toBe('stored_draft_resumed');
    expect(subject.apiClient.bootstrapProFormDraft.mock.calls[0][0].authorization)
      .toEqual({ resumeToken: 'R'.repeat(43) });
    expect(subject.dispatch.mock.calls.filter(([action]) => (
      action.type === 'form/loadCanonicalDraftState'
    ))).toHaveLength(1);
  });

  it('falls back to a client choice after a stored resume failure', async () => {
    const subject = harness();
    await subject.vault.saveDraftCredentialBundle(credentialBundle());
    subject.apiClient.bootstrapProFormDraft.mockResolvedValue({
      success: false, errorCode: 'INVALID_AUTHORIZATION',
    });
    expect(await subject.coordinator.bootstrap()).toMatchObject({
      phase: 'awaiting_client_choice', clientChoiceRequired: true,
    });
  });

  it('hydrates an exact local draft only during a retryable authorization outage', async () => {
    const localState = canonical({ responses: { q1: 'local-only answer' } });
    const cache = {
      loadCanonicalDraftCache: vi.fn(async () => ({
        ok: true, present: true, state: localState,
      })),
      saveCanonicalDraftCache: vi.fn(async () => ({ ok: true })),
    };
    const subject = harness({ cache });
    await subject.vault.saveDraftCredentialBundle(credentialBundle());
    subject.apiClient.bootstrapProFormDraft.mockRejectedValue(Object.assign(
      new Error('Synthetic unavailable provider detail'),
      { code: 'DRAFT_API_INVOCATION_FAILED', retryable: true, status: 503 },
    ));
    expect(await subject.coordinator.bootstrap()).toMatchObject({
      outcome: 'local_only_recovery', pendingServerSync: true,
    });
  });

  it('removes an expired recovery session without blocking a valid resume token', async () => {
    const subject = harness();
    await subject.vault.saveDraftCredentialBundle(credentialBundle({
      recoverySessionToken: `${'a'.repeat(43)}.${'b'.repeat(43)}`,
      recoverySessionExpiresAt: '2033-05-17T00:00:00.000Z',
    }));
    subject.apiClient.bootstrapProFormDraft.mockResolvedValue(response());
    await subject.coordinator.bootstrap();
    const stored = await subject.vault.loadDraftCredentialBundle();
    expect(stored.bundle.resumeToken).toBe('R'.repeat(43));
    expect(stored.bundle.recoverySessionToken).toBeNull();
  });

  it('loads an exact draft from a nonexpired recovery session', async () => {
    const subject = harness();
    const token = `${'a'.repeat(43)}.${'b'.repeat(43)}`;
    await subject.vault.saveDraftCredentialBundle(credentialBundle({
      resumeToken: null,
      recoverySessionToken: token,
      recoverySessionExpiresAt: '2033-05-19T00:00:00.000Z',
      authorizationMethod: 'email',
    }));
    subject.apiClient.loadProFormDraft.mockResolvedValue(response());
    expect((await subject.coordinator.bootstrap()).outcome).toBe('stored_draft_resumed');
    expect(subject.apiClient.loadProFormDraft.mock.calls[0][0]).toMatchObject({
      authorization: { recoverySessionToken: token },
      requestedDraftId: 'draft-synthetic-1',
    });
  });

  it('exchanges a verified signed invitation and never stores the invitation token', async () => {
    const subject = harness({
      signedInvitationToken: `${'x'.repeat(43)}.${'y'.repeat(43)}`,
      signedInvitationVerified: true,
    });
    subject.apiClient.bootstrapProFormDraft.mockResolvedValue(response(canonical(), {
      authorizationMethod: 'signed_invitation',
    }));
    const result = await subject.coordinator.bootstrap();
    expect(result.outcome).toBe('signed_invitation_resumed');
    const loaded = await subject.vault.loadDraftCredentialBundle();
    expect(JSON.stringify(loaded.bundle)).not.toContain('x'.repeat(43));
  });

  it('does not use a verified invitation to search a changed replacement email', async () => {
    const changedIdentity = identity({
      signedInvitationEmail: 'signed.owner@example.invalid',
      recoveryEmail: 'replacement.owner@example.invalid',
    });
    const subject = harness({
      identityContext: changedIdentity,
      signedInvitationToken: `${'x'.repeat(43)}.${'y'.repeat(43)}`,
      signedInvitationVerified: true,
    });
    const result = await subject.coordinator.bootstrap();
    expect(result.phase).toBe('awaiting_client_choice');
    expect(subject.apiClient.bootstrapProFormDraft).not.toHaveBeenCalled();
  });

  it('creates an email-associated draft only after explicit action', async () => {
    const subject = harness();
    await subject.coordinator.bootstrap();
    subject.apiClient.bootstrapProFormDraft.mockResolvedValue(response(canonical(), {
      created: true,
      resumed: false,
      recoveryCode: '2345-6789-ABCD-EFGH-JKMN',
      authorizationMethod: 'new_anonymous_draft',
    }));
    const result = await subject.coordinator.createNewDraftAssociation();
    expect(result.outcome).toBe('new_draft_created');
    const request = subject.apiClient.bootstrapProFormDraft.mock.calls[0][0];
    expect(request.clientContext.recoveryEmailVerificationStatus).toBe('unverified');
    expect(subject.coordinator.getRecoveryCodeForDisplay()).toBe(
      '2345-6789-ABCD-EFGH-JKMN',
    );
  });

  it('creates an acknowledged anonymous draft', async () => {
    const anonymous = identity({
      recoveryEmail: '',
      recoveryEmailSource: 'anonymous',
      associationIntent: 'anonymous_start',
      anonymousRecoveryAcknowledged: true,
    });
    const subject = harness({ identityContext: anonymous });
    await subject.coordinator.bootstrap();
    subject.apiClient.bootstrapProFormDraft.mockResolvedValue(response(canonical(), {
      created: true, resumed: false,
    }));
    expect((await subject.coordinator.createNewDraftAssociation()).outcome)
      .toBe('anonymous_draft_created');
  });

  it('rejects an unacknowledged anonymous association', async () => {
    const anonymous = identity({
      recoveryEmail: '',
      recoveryEmailSource: 'anonymous',
      associationIntent: 'anonymous_start',
      anonymousRecoveryAcknowledged: true,
    });
    const subject = harness({ identityContext: anonymous });
    await subject.coordinator.bootstrap();
    const result = await subject.coordinator.createNewDraftAssociation({
      identity: { ...anonymous, anonymousRecoveryAcknowledged: false },
    });
    expect(result.errorCode).toBe('DRAFT_BOOTSTRAP_ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED');
    expect(subject.apiClient.bootstrapProFormDraft).not.toHaveBeenCalled();
  });

  it('recovers by normalized email, keeps it unverified, then loads exact draft', async () => {
    const token = `${'a'.repeat(43)}.${'b'.repeat(43)}`;
    const subject = harness();
    await subject.coordinator.bootstrap();
    subject.recoveryApiClient.recoverProFormDraftByEmail.mockResolvedValue({
      success: true,
      recoveryCompleted: true,
      recoverySessionToken: token,
      recoverySessionExpiresAt: '2033-05-19T00:00:00.000Z',
      otherEligibleDraftsAvailable: true,
      draft: { draftId: 'draft-synthetic-1', recoveryCodeHint: 'JKMN' },
    });
    subject.apiClient.loadProFormDraft.mockResolvedValue(response());
    const result = await subject.coordinator.recoverDraftByEmail(
      '  Synthetic.Owner@Example.invalid  ',
    );
    expect(result).toMatchObject({
      outcome: 'email_draft_recovered', otherEligibleDraftsAvailable: true,
    });
    expect(subject.recoveryApiClient.recoverProFormDraftByEmail.mock.calls[0][0].email)
      .toBe('synthetic.owner@example.invalid');
    const stored = await subject.vault.loadDraftCredentialBundle();
    expect(stored.bundle).toMatchObject({
      authorizationMethod: 'email', recoveryCode: null, recoveryCodeHint: 'JKMN',
    });
  });

  it('recovers by code without requiring or associating email', async () => {
    const token = `${'a'.repeat(43)}.${'b'.repeat(43)}`;
    const subject = harness();
    await subject.coordinator.bootstrap();
    subject.recoveryApiClient.recoverProFormDraftByCode.mockResolvedValue({
      success: true,
      recoveryCompleted: true,
      recoverySessionToken: token,
      recoverySessionExpiresAt: '2033-05-19T00:00:00.000Z',
      draft: { draftId: 'draft-synthetic-1', recoveryCodeHint: 'JKMN' },
    });
    subject.apiClient.loadProFormDraft.mockResolvedValue(response());
    const result = await subject.coordinator.recoverDraftByCode('2345 6789 abcd efgh jkmn');
    expect(result.outcome).toBe('code_draft_recovered');
    const request = subject.recoveryApiClient.recoverProFormDraftByCode.mock.calls[0][0];
    expect(request.recoveryCode).toBe('2345-6789-ABCD-EFGH-JKMN');
    expect(request).not.toHaveProperty('email');
    expect(subject.coordinator.getRecoveryCodeForDisplay())
      .toBe('2345-6789-ABCD-EFGH-JKMN');
  });

  it('hydrates submitted recovery as read-only', async () => {
    const submitted = canonical({ draftStatus: 'submitted' });
    const subject = harness();
    await subject.vault.saveDraftCredentialBundle(credentialBundle());
    subject.apiClient.bootstrapProFormDraft.mockResolvedValue(response(submitted));
    expect(await subject.coordinator.bootstrap()).toMatchObject({
      outcome: 'submitted_draft_loaded', readOnly: true,
    });
  });

  it.each(['cleared_superseded', 'expired', 'deleted'])(
    'does not hydrate a %s draft as active',
    async (draftStatus) => {
      const subject = harness();
      await subject.vault.saveDraftCredentialBundle(credentialBundle());
      subject.apiClient.bootstrapProFormDraft.mockResolvedValue(response(canonical({ draftStatus })));
      const result = await subject.coordinator.bootstrap();
      expect(result.outcome).not.toBe('stored_draft_resumed');
      expect(subject.dispatch.mock.calls.map(([action]) => action.type))
        .not.toContain('form/loadCanonicalDraftState');
    },
  );

  it('isolates malformed credentials and does not overwrite a valid local cache', async () => {
    const state = canonical();
    const cache = {
      loadCanonicalDraftCache: vi.fn(async () => ({ ok: true, present: true, state })),
      saveCanonicalDraftCache: vi.fn(),
    };
    const subject = harness({ cache });
    await subject.storage.setItem(
      `pro-questionnaire:v5:${namespace}:draft-credentials`,
      '{malformed',
    );
    expect((await subject.coordinator.bootstrap()).phase).toBe('awaiting_client_choice');
    expect(cache.saveCanonicalDraftCache).not.toHaveBeenCalled();
  });

  it('never dispatches credentials into Redux', async () => {
    const subject = harness();
    await subject.vault.saveDraftCredentialBundle(credentialBundle());
    subject.apiClient.bootstrapProFormDraft.mockResolvedValue(response());
    await subject.coordinator.bootstrap();
    const actions = JSON.stringify(subject.dispatch.mock.calls.map(([action]) => action));
    expect(actions).not.toMatch(/resumeToken|recoverySessionToken|recoveryCode|RRRR/iu);
  });

  it('safe diagnostics omit email, code, and tokens', async () => {
    const subject = harness();
    await subject.vault.saveDraftCredentialBundle(credentialBundle({
      recoveryCode: '2345-6789-ABCD-EFGH-JKMN',
    }), { allowRecoveryCode: true });
    const serialized = JSON.stringify((await subject.coordinator.bootstrap()).safeDiagnostics);
    expect(serialized).not.toMatch(/synthetic\.owner|2345-6789|RRRR|aaaa/iu);
  });

  it('reuses one in-flight bootstrap promise', async () => {
    const subject = harness();
    const first = subject.coordinator.bootstrap();
    const second = subject.coordinator.bootstrap();
    await Promise.all([first, second]);
    expect(subject.cache.loadCanonicalDraftCache).toHaveBeenCalledOnce();
  });

  it('cancels before async work may hydrate Redux', async () => {
    let release;
    const cache = {
      loadCanonicalDraftCache: vi.fn(() => new Promise((resolve) => { release = resolve; })),
      saveCanonicalDraftCache: vi.fn(),
    };
    const subject = harness({ cache });
    const pending = subject.coordinator.bootstrap();
    subject.coordinator.cancel();
    release({ ok: true, present: false, state: null });
    expect((await pending).errorCode).toBe('DRAFT_BOOTSTRAP_CANCELLED');
    expect(subject.dispatch.mock.calls.map(([action]) => action.type))
      .not.toContain('form/loadCanonicalDraftState');
  });
});

describe('initial local/server reconciliation', () => {
  it('uses server-only state', async () => {
    const serverState = canonical();
    expect(await reconcileInitialLocalAndServerState({ serverState })).toMatchObject({
      state: serverState, source: 'server', pendingServerSync: false,
    });
  });

  it('uses authorized local-only state and marks pending server sync', async () => {
    const localState = canonical();
    expect(await reconcileInitialLocalAndServerState({
      localState, hasExactDraftAuthorization: true,
    })).toMatchObject({ state: localState, source: 'browser', pendingServerSync: true });
  });

  it('uses server consistently for equal state', async () => {
    const serverState = canonical();
    const localState = canonical();
    expect(await reconcileInitialLocalAndServerState({ localState, serverState }))
      .toMatchObject({ state: serverState, source: 'server', reason: 'state_hash' });
  });

  it('uses a server-newer state', async () => {
    const localState = canonical({ serverRevision: 1 });
    const serverState = canonical({ serverRevision: 2 });
    expect(await reconcileInitialLocalAndServerState({ localState, serverState }))
      .toMatchObject({ state: serverState, source: 'server', pendingServerSync: false });
  });

  it('uses a local-newer state and marks pending sync', async () => {
    const localState = canonical({ clientRevision: 3 });
    const serverState = canonical({ clientRevision: 2 });
    expect(await reconcileInitialLocalAndServerState({ localState, serverState }))
      .toMatchObject({ state: localState, source: 'browser', pendingServerSync: true });
  });

  it('preserves both diverged states and marks merge required', async () => {
    const localState = canonical({ responses: { q1: 'local' } });
    const serverState = canonical({ responses: { q1: 'server' } });
    const result = await reconcileInitialLocalAndServerState({ localState, serverState });
    expect(result).toMatchObject({
      state: serverState, mergeRequired: true, localState, serverState,
    });
  });

  it('rejects incompatible local state without deleting it', async () => {
    const localState = canonical({ draftId: 'draft-other' });
    const serverState = canonical();
    const result = await reconcileInitialLocalAndServerState({ localState, serverState });
    expect(result).toMatchObject({ state: serverState, compatible: false, localState });
  });

  it('gives submitted server state precedence over active local state', async () => {
    const localState = canonical({ draftStatus: 'active', clientRevision: 99 });
    const serverState = canonical({ draftStatus: 'submitted', clientRevision: 1 });
    expect(await reconcileInitialLocalAndServerState({ localState, serverState }))
      .toMatchObject({ state: serverState, reason: 'submitted_state_protection' });
  });
});
