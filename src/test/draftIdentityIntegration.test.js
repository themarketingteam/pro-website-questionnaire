import { describe, expect, it } from 'vitest';
import {
  createClientDraftIdentityContext,
  compareSignedAndEnteredEmail,
  deriveClientDraftAssociationDecision,
  getSafeClientIdentityContextDiagnostics,
  readProQuestionnaireIdentityParams,
} from '@/lib/proDraftClientIdentityContext';
import {
  buildLegacyQuestionnaireStorageKey,
  deriveNamespaceSeed,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import {
  createEmptyCanonicalDraftState,
  extractCanonicalStateFromLegacyDraftRecord,
  hashCanonicalDraftState,
  normalizeCanonicalDraftState,
} from '@/lib/questionnaireDraftState';
import {
  CANONICAL_DRAFT_CACHE_ERROR_CODES,
  inspectLegacyCanonicalDraftCachePresence,
  loadCanonicalDraftCache,
  saveCanonicalDraftCache,
} from '@/lib/questionnaireCanonicalDraftCache';
import reducer, {
  createInitialFormState,
  patchDraftIdentityContext,
  setDraftIdentityContext,
  setDraftStatus,
} from '@/components/store/formSlice';
import {
  selectDraftIdentityContext,
  selectAnonymousRecoveryAcknowledged,
  selectHasRecoveryEmail,
  selectIdentityAssociationIntent,
  selectRecoveryEmailSource,
  selectRecoveryEmailVerificationStatus,
  selectRequiresNewDraftAssociation,
  selectSafeDraftIdentityDiagnostics,
  selectSignedInvitationEmailChanged,
} from '@/components/store/draftSelectors';

const clientIdentityPayload = (overrides = {}) => ({
  recoveryEmail: 'Person@Example.TEST',
  identityContextVersion: 1,
  recoveryEmailSource: 'client_entered',
  recoveryEmailVerificationStatus: 'unverified',
  identityAssociationIntent: 'new_invitation',
  anonymousRecoveryAcknowledged: false,
  signedInvitationEmailChanged: false,
  ...overrides,
});

const memoryStorage = () => {
  const values = new Map();
  return {
    values,
    getMode: () => 'memory',
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => values.set(key, value),
    removeItem: async (key) => values.delete(key),
  };
};

const prohibitedIdentityMaterialFields = Object.freeze([
  'recoveryCode',
  'recoveryCodeHash',
  'resumeToken',
  'recoverySessionToken',
  'draftAccessToken',
  'adminGrant',
  'identityKeyHash',
  'emailLookupHash',
  'signedInvitationToken',
]);

describe('draft identity integration boundary', () => {
  it('reads URL identity as an untrusted claim', () => {
    const params = readProQuestionnaireIdentityParams({
      href: 'https://example.test/?userEmail=Person%40Example.TEST&signedInvitationId=claim-1',
    });
    expect(params).toMatchObject({
      recoveryEmail: 'Person@Example.TEST',
      signedInvitationId: 'claim-1',
      sourceTrust: 'untrusted_url',
    });
  });

  it('does not promote a signed-style URL to verified identity', () => {
    const context = createClientDraftIdentityContext({
      recoveryEmail: 'person@example.test',
      signedInvitationEmail: 'person@example.test',
      signedInvitationId: 'claim-1',
      recoveryEmailSource: 'signed_invitation',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
      associationIntent: 'resume_current_draft',
    });
    expect(context).toMatchObject({
      invitationId: null,
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
    });
  });

  it('accepts backend-verified signed invitation context explicitly', () => {
    const context = createClientDraftIdentityContext({
      recoveryEmail: 'person@example.test',
      signedInvitationEmail: 'person@example.test',
      signedInvitationId: 'verified-1',
      recoveryEmailSource: 'signed_invitation',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
      associationIntent: 'resume_current_draft',
    }, { trustedBackendResult: true });
    expect(context.invitationId).toBe('verified-1');
    expect(context.recoveryEmailVerificationStatus).toBe('verified_signed_invitation');
  });

  it('compares normalized signed and entered email values', () => {
    expect(compareSignedAndEnteredEmail(
      'Person@Example.TEST',
      'person@example.test',
    ).changed).toBe(false);
  });

  it('marks a changed signed email as a new unverified association', () => {
    const context = createClientDraftIdentityContext({
      signedInvitationEmail: 'old@example.test',
      recoveryEmail: 'new@example.test',
    });
    expect(context).toMatchObject({
      associationIntent: 'changed_signed_email',
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
      signedInvitationEmailChanged: true,
    });
  });

  it('derives the changed-email association decision safely', () => {
    const decision = deriveClientDraftAssociationDecision({
      associationIntent: 'changed_signed_email',
    });
    expect(decision).toMatchObject({
      valid: true,
      requiresNewDraftAssociation: true,
      requiresNewAssociation: true,
      mayReuseSignedInvitationNamespace: false,
      mustNotSearchReplacementEmail: true,
    });
  });

  it('requires acknowledgement for an explicit anonymous start', () => {
    expect(() => createClientDraftIdentityContext({
      recoveryEmailSource: 'anonymous',
      associationIntent: 'anonymous_start',
      recoveryEmail: '',
    })).toThrow();
  });

  it('builds acknowledged anonymous context without an email', () => {
    const context = createClientDraftIdentityContext({
      recoveryEmailSource: 'anonymous',
      associationIntent: 'anonymous_start',
      anonymousRecoveryAcknowledged: true,
      recoveryEmail: '',
    });
    expect(context.anonymousRecoveryAcknowledged).toBe(true);
    expect(context.normalizedRecoveryEmail).toBe(null);
  });

  it('keeps safe client diagnostics free of raw email', () => {
    const context = createClientDraftIdentityContext({ recoveryEmail: 'private@example.test' });
    const diagnostics = getSafeClientIdentityContextDiagnostics(context);
    expect(diagnostics.hasRecoveryEmail).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain('private@example.test');
  });

  it('normalizes recovery email into canonical credentials', () => {
    const state = normalizeCanonicalDraftState({
      ...createEmptyCanonicalDraftState(),
      credentials: { recoveryEmail: ' Person@Example.TEST ' },
      identityContext: {
        identityContextVersion: 1,
        recoveryEmailSource: 'client_entered',
        recoveryEmailVerificationStatus: 'unverified',
        identityAssociationIntent: 'new_invitation',
        anonymousRecoveryAcknowledged: false,
        signedInvitationEmailChanged: false,
      },
    });
    expect(state.credentials.recoveryEmail).toBe('person@example.test');
  });

  it('preserves verified signed-invitation metadata in canonical state', () => {
    const state = normalizeCanonicalDraftState({
      ...createEmptyCanonicalDraftState(),
      credentials: { recoveryEmail: 'signed@example.test' },
      identityContext: {
        identityContextVersion: 1,
        recoveryEmailSource: 'signed_invitation',
        recoveryEmailVerificationStatus: 'verified_signed_invitation',
        identityAssociationIntent: 'resume_current_draft',
        anonymousRecoveryAcknowledged: false,
        signedInvitationEmailChanged: false,
      },
    });
    expect(state.identityContext).toMatchObject({
      recoveryEmailSource: 'signed_invitation',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
      identityAssociationIntent: 'resume_current_draft',
    });
  });

  it('rejects unsupported canonical identity enums', () => {
    expect(() => normalizeCanonicalDraftState({
      ...createEmptyCanonicalDraftState(),
      identityContext: {
        ...createEmptyCanonicalDraftState().identityContext,
        recoveryEmailSource: 'invented_source',
      },
    })).toThrow();
  });

  it('rejects unsupported canonical verification status', () => {
    expect(() => normalizeCanonicalDraftState({
      ...createEmptyCanonicalDraftState(),
      identityContext: {
        ...createEmptyCanonicalDraftState().identityContext,
        recoveryEmailVerificationStatus: 'implicitly_verified',
      },
    })).toThrow();
  });

  it('rejects secret-bearing identity fields', () => {
    expect(() => normalizeCanonicalDraftState({
      ...createEmptyCanonicalDraftState(),
      identityContext: {
        ...createEmptyCanonicalDraftState().identityContext,
        recoveryCodeHash: 'forbidden',
      },
    })).toThrow();
  });

  it('keeps prohibited recovery material out of canonical and Redux output', () => {
    const canonicalJson = JSON.stringify(createEmptyCanonicalDraftState());
    const reduxJson = JSON.stringify(createInitialFormState());
    for (const field of prohibitedIdentityMaterialFields) {
      expect(canonicalJson).not.toContain(`"${field}"`);
      expect(reduxJson).not.toContain(`"${field}"`);
    }
  });

  it('includes identity metadata in the canonical hash', async () => {
    const first = createEmptyCanonicalDraftState();
    const second = {
      ...first,
      identityContext: {
        ...first.identityContext,
        identityAssociationIntent: 'resume_current_draft',
      },
    };
    expect(await hashCanonicalDraftState(first)).not.toBe(await hashCanonicalDraftState(second));
  });

  it('warns on malformed legacy recovery email without losing responses', () => {
    const state = extractCanonicalStateFromLegacyDraftRecord({
      id: 'legacy-1',
      status: 'draft',
      responses_json: JSON.stringify({ 6: 'Synthetic preserved response' }),
      recovery_email: 'not-an-email',
    });
    expect(state.responses['6']).toBe('Synthetic preserved response');
    expect(state.compatibility.migrationWarnings).toContain('MALFORMED_LEGACY_RECOVERY_EMAIL');
    expect(state.identityContext).toEqual(createEmptyCanonicalDraftState().identityContext);
  });

  it('sets Redux recovery email and metadata atomically', () => {
    const state = reducer(createInitialFormState(), setDraftIdentityContext(clientIdentityPayload()));
    expect(state.credentials.recoveryEmail).toBe('person@example.test');
    expect(state.draftContext.recoveryEmailSource).toBe('client_entered');
  });

  it('makes an invalid raw identity action an atomic no-op', () => {
    const before = reducer(createInitialFormState(), setDraftIdentityContext(clientIdentityPayload()));
    const after = reducer(before, {
      type: 'form/setDraftIdentityContext',
      payload: { ...clientIdentityPayload(), recoveryEmailSource: 'bad_source' },
    });
    expect(after).toEqual(before);
  });

  it('preserves the submitted-state mutation lock', () => {
    const submitted = reducer(createInitialFormState(), setDraftStatus('submitted'));
    const after = reducer(submitted, setDraftIdentityContext(clientIdentityPayload()));
    expect(after.credentials.recoveryEmail).toBeUndefined();
    expect(after.draftContext.draftStatus).toBe('submitted');
  });

  it('patches changed-email metadata and email together', () => {
    const before = reducer(createInitialFormState(), setDraftIdentityContext(clientIdentityPayload()));
    const after = reducer(before, patchDraftIdentityContext({
      recoveryEmail: 'new@example.test',
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
      identityAssociationIntent: 'changed_signed_email',
      signedInvitationEmailChanged: true,
    }));
    expect(after.credentials.recoveryEmail).toBe('new@example.test');
    expect(after.draftContext.signedInvitationEmailChanged).toBe(true);
  });

  it('exposes the seven identity selectors without PII', () => {
    const form = reducer(createInitialFormState(), setDraftIdentityContext(clientIdentityPayload({
      identityAssociationIntent: 'changed_signed_email',
      signedInvitationEmailChanged: true,
    })));
    const root = { form };
    expect(selectDraftIdentityContext(root).identityContextVersion).toBe(1);
    expect(selectRecoveryEmailSource(root)).toBe('client_entered');
    expect(selectRecoveryEmailVerificationStatus(root)).toBe('unverified');
    expect(selectIdentityAssociationIntent(root)).toBe('changed_signed_email');
    expect(selectHasRecoveryEmail(root)).toBe(true);
    expect(selectSignedInvitationEmailChanged(root)).toBe(true);
    expect(selectAnonymousRecoveryAcknowledged(root)).toBe(false);
    expect(selectRequiresNewDraftAssociation(root)).toBe(true);
    expect(selectSafeDraftIdentityDiagnostics(root)).not.toHaveProperty('recoveryEmail');
  });

  it('uses verified invitation then authorized draft and isolates changed signed email', () => {
    const verifiedIdentity = {
      invitationId: 'invite-1',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
      currentAuthorizedDraftId: 'draft-1',
      recoveryEmail: 'signed@example.test',
    };
    expect(deriveNamespaceSeed(verifiedIdentity)).toBe('invitation:invite-1');
    const verifiedNamespace = deriveQuestionnaireBrowserNamespace(verifiedIdentity);
    const unchangedNamespace = deriveQuestionnaireBrowserNamespace({
      ...verifiedIdentity,
      signedInvitationEmailChanged: false,
    });
    expect(unchangedNamespace).toBe(verifiedNamespace);
    expect(deriveNamespaceSeed({
      ...verifiedIdentity,
      signedInvitationEmailChanged: true,
    })).toBe('draft:draft-1');
    const changedNamespace = deriveQuestionnaireBrowserNamespace({
      ...verifiedIdentity,
      signedInvitationEmailChanged: true,
    });
    const anonymousNamespace = deriveQuestionnaireBrowserNamespace({}, {
      anonymousLaunchId: 'synthetic-anonymous-integration',
    });
    expect(changedNamespace).not.toBe(verifiedNamespace);
    expect(anonymousNamespace).not.toBe(verifiedNamespace);
  });

  it('rejects mismatched cache identity while preserving the stored envelope', async () => {
    const storage = memoryStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'cache-user' });
    const state = normalizeCanonicalDraftState({
      ...createEmptyCanonicalDraftState(),
      credentials: { recoveryEmail: 'old@example.test' },
      identityContext: {
        identityContextVersion: 1,
        recoveryEmailSource: 'client_entered',
        recoveryEmailVerificationStatus: 'unverified',
        identityAssociationIntent: 'new_invitation',
        anonymousRecoveryAcknowledged: false,
        signedInvitationEmailChanged: false,
      },
    });
    expect((await saveCanonicalDraftCache({ namespace, state, storage })).ok).toBe(true);
    const matchingLoad = await loadCanonicalDraftCache({
      namespace,
      storage,
      expectedIdentityContext: {
        ...state.identityContext,
        recoveryEmail: state.credentials.recoveryEmail,
      },
    });
    expect(matchingLoad.ok).toBe(true);
    expect(matchingLoad.state.identityContext).toEqual(state.identityContext);
    expect(matchingLoad.state.credentials.recoveryEmail).toBe('old@example.test');
    const before = [...storage.values.values()][0];
    const loaded = await loadCanonicalDraftCache({
      namespace,
      storage,
      expectedIdentityContext: {
        ...state.identityContext,
        recoveryEmail: 'new@example.test',
      },
    });
    expect(loaded.errorCode).toBe(CANONICAL_DRAFT_CACHE_ERROR_CODES.IDENTITY_MISMATCH);
    expect([...storage.values.values()][0]).toBe(before);
  });

  it('detects legacy v4 cache keys without reading or deleting them', async () => {
    const storage = memoryStorage();
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'legacy-user' });
    const key = buildLegacyQuestionnaireStorageKey({
      namespace,
      purpose: 'draft-cache',
      version: 'v4',
    });
    await storage.setItem(key, 'opaque-legacy-value');
    const result = await inspectLegacyCanonicalDraftCachePresence({ namespace, storage });
    expect(result).toEqual({ present: true, versions: ['v4'], errorCode: null });
    expect(await storage.getItem(key)).toBe('opaque-legacy-value');
  });
});
