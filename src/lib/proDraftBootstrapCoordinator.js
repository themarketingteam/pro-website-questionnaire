import {
  createClientDraftIdentityContext,
  deriveClientDraftAssociationDecision,
  getSafeClientIdentityContextDiagnostics,
  readProQuestionnaireIdentityParams,
} from './proDraftClientIdentityContext.js';
import {
  deriveQuestionnaireBrowserNamespace,
} from './questionnaireBrowserNamespace.js';
import {
  compareCanonicalDraftFreshness,
  createEmptyCanonicalDraftState,
  getSafeCanonicalDraftDiagnostics,
} from './questionnaireDraftState.js';
import {
  loadCanonicalDraftCache,
  saveCanonicalDraftCache,
} from './questionnaireCanonicalDraftCache.js';
import {
  createProDraftCredentialVault,
} from './proDraftCredentialVault.js';
import {
  generateClientBootstrapToken,
  generateDraftApiIdempotencyKey,
  proDraftApiClient,
} from './proDraftApiClient.js';
import { proDraftRecoveryApiClient } from './proDraftRecoveryApiClient.js';
import {
  deriveRecoveryCodeHint,
  formatRecoveryCode,
  normalizeRecoveryCodeInput,
} from './proDraftRecoveryCodeContract.js';
import { getOrCreateProDraftDeviceId } from './proDraftDeviceId.js';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
} from './proDraftRuntimeConfig.js';
import { normalizeRecoveryEmail } from './proDraftIdentity.js';
import { createResilientStorage } from './resilientStorage.js';
import {
  loadCanonicalDraftState,
  setDraftBootstrapError,
  setDraftBootstrapLoading,
} from '../components/store/formSlice.jsx';

export const PRO_DRAFT_BOOTSTRAP_PHASES = Object.freeze([
  'idle',
  'reading_identity',
  'reading_local_cache',
  'reading_credentials',
  'resuming_stored_draft',
  'awaiting_client_choice',
  'recovering_by_email',
  'recovering_by_code',
  'creating_new_draft',
  'loading_authorized_draft',
  'reconciling_state',
  'hydrating_redux',
  'ready',
  'error',
]);

export const PRO_DRAFT_BOOTSTRAP_OUTCOMES = Object.freeze([
  'legacy_flow',
  'new_draft_created',
  'stored_draft_resumed',
  'email_draft_recovered',
  'code_draft_recovered',
  'signed_invitation_resumed',
  'signed_invitation_new_draft',
  'anonymous_draft_created',
  'submitted_draft_loaded',
  'local_only_recovery',
  'empty_usable_fallback',
]);

export const PRO_DRAFT_BOOTSTRAP_ERROR_CODES = Object.freeze({
  CANCELLED: 'DRAFT_BOOTSTRAP_CANCELLED',
  INVALID_IDENTITY: 'DRAFT_BOOTSTRAP_INVALID_IDENTITY',
  INVALID_EMAIL: 'DRAFT_BOOTSTRAP_INVALID_EMAIL',
  INVALID_RECOVERY_CODE: 'DRAFT_BOOTSTRAP_INVALID_RECOVERY_CODE',
  ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED: 'DRAFT_BOOTSTRAP_ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED',
  AUTHORIZATION_FAILED: 'DRAFT_BOOTSTRAP_AUTHORIZATION_FAILED',
  RECOVERY_FAILED: 'DRAFT_BOOTSTRAP_RECOVERY_FAILED',
  LOAD_FAILED: 'DRAFT_BOOTSTRAP_LOAD_FAILED',
  CANONICAL_STATE_MISSING: 'DRAFT_BOOTSTRAP_CANONICAL_STATE_MISSING',
  HYDRATION_FAILED: 'DRAFT_BOOTSTRAP_HYDRATION_FAILED',
  CREDENTIAL_WRITE_FAILED: 'DRAFT_BOOTSTRAP_CREDENTIAL_WRITE_FAILED',
});

const PHASE_SET = new Set(PRO_DRAFT_BOOTSTRAP_PHASES);
const TERMINAL_DRAFT_STATUSES = new Set(['cleared_superseded', 'expired', 'deleted']);

const nowIso = (now = Date.now) => new Date(typeof now === 'function' ? now() : now).toISOString();

const safeErrorCode = (error, fallback) => (
  typeof (error?.code || error?.errorCode) === 'string'
    && /^[A-Z][A-Z0-9_.:-]{0,159}$/u.test(error.code || error.errorCode)
    ? (error.code || error.errorCode)
    : fallback
);

const isRetryableAuthorizationOutage = (error) => (
  error?.retryable === true
  || Number(error?.status) >= 500
  || [
    'DRAFT_API_CLIENT_UNAVAILABLE',
    'DRAFT_API_INVOCATION_FAILED',
    'DRAFT_API_RESPONSE_INVALID',
  ].includes(error?.code)
);

const pickCanonicalState = (response) => response?.draft?.canonicalState || null;

const clientContextFromIdentity = (identityContext, environment, overrides = {}) => ({
  formType: 'pro-questionnaire',
  identityContextVersion: identityContext.identityVersion,
  associationIntent: identityContext.associationIntent,
  anonymousRecoveryAcknowledged: identityContext.anonymousRecoveryAcknowledged === true,
  ...(identityContext.userId ? { userId: identityContext.userId } : {}),
  ...(identityContext.userName ? { userName: identityContext.userName } : {}),
  ...(identityContext.businessName ? { businessName: identityContext.businessName } : {}),
  ...(identityContext.normalizedDomain ? { domainName: identityContext.normalizedDomain } : {}),
  ...(identityContext.normalizedRecoveryEmail ? {
    recoveryEmail: identityContext.normalizedRecoveryEmail,
    recoveryEmailSource: identityContext.recoveryEmailSource,
    recoveryEmailVerificationStatus: identityContext.recoveryEmailVerificationStatus,
  } : {}),
  environment,
  ...overrides,
});

const safeDraftSummary = (state, readOnly = false, metadata = {}) => Object.freeze({
  draftId: typeof state?.draftId === 'string' ? state.draftId : null,
  status: typeof state?.draftStatus === 'string' ? state.draftStatus : null,
  clientRevision: Number.isSafeInteger(state?.clientRevision) ? state.clientRevision : null,
  serverRevision: Number.isSafeInteger(state?.serverRevision) ? state.serverRevision : null,
  readOnly: readOnly === true || state?.draftStatus === 'submitted',
  businessNameDisplay: typeof metadata?.businessNameDisplay === 'string'
    ? metadata.businessNameDisplay
    : null,
  lastSavedAt: typeof metadata?.lastSavedAt === 'string'
    && Number.isFinite(Date.parse(metadata.lastSavedAt))
    ? metadata.lastSavedAt
    : (typeof state?.savedAtServer === 'string' ? state.savedAtServer : null),
});

export const getSafeBootstrapDiagnostics = (value = {}) => Object.freeze({
  phase: PHASE_SET.has(value.phase) ? value.phase : 'idle',
  outcome: PRO_DRAFT_BOOTSTRAP_OUTCOMES.includes(value.outcome) ? value.outcome : null,
  errorCode: typeof value.errorCode === 'string' ? value.errorCode : null,
  clientChoiceRequired: value.clientChoiceRequired === true,
  readOnly: value.readOnly === true,
  hasRecoveryCode: value.hasRecoveryCode === true,
  recoveryCodeHintPresent: value.recoveryCodeHintPresent === true,
  storageMode: typeof value.storageMode === 'string' ? value.storageMode : 'unknown',
  memoryOnly: value.memoryOnly === true,
  localCachePresent: value.localCachePresent === true,
  localCacheValid: value.localCacheValid === true,
  credentialsPresent: value.credentialsPresent === true,
  resumeAttempted: value.resumeAttempted === true,
  recoverySessionAttempted: value.recoverySessionAttempted === true,
  signedInvitationAttempted: value.signedInvitationAttempted === true,
  mergeRequired: value.mergeRequired === true,
  pendingServerSync: value.pendingServerSync === true,
  cancelled: value.cancelled === true,
  captchaRequired: value.captchaRequired === true,
  retryAfterSeconds: Number.isSafeInteger(value.retryAfterSeconds)
    && value.retryAfterSeconds >= 0
    && value.retryAfterSeconds <= 86400
    ? value.retryAfterSeconds
    : 0,
  ...(value.draftSummary ? { draftSummary: safeDraftSummary(
    value.draftSummary,
    value.readOnly,
  ) } : {}),
});

export const reconcileInitialLocalAndServerState = async ({
  localState,
  serverState,
  hasExactDraftAuthorization = false,
  compare = compareCanonicalDraftFreshness,
  hashOptions,
} = {}) => {
  if (!serverState && !localState) {
    return Object.freeze({
      state: null,
      source: 'none',
      pendingServerSync: false,
      mergeRequired: false,
      compatible: true,
      localState: null,
      serverState: null,
      reason: 'no_state',
    });
  }
  if (!serverState) {
    return Object.freeze({
      state: hasExactDraftAuthorization ? localState : null,
      source: hasExactDraftAuthorization ? 'browser' : 'none',
      pendingServerSync: hasExactDraftAuthorization,
      mergeRequired: false,
      compatible: hasExactDraftAuthorization,
      localState,
      serverState: null,
      reason: hasExactDraftAuthorization ? 'local_only_authorized' : 'local_not_authorized',
    });
  }
  if (!localState) {
    return Object.freeze({
      state: serverState,
      source: 'server',
      pendingServerSync: false,
      mergeRequired: false,
      compatible: true,
      localState: null,
      serverState,
      reason: 'server_only',
    });
  }
  const freshness = await compare(localState, serverState, hashOptions);
  if (!freshness.compatible || freshness.result === 'incompatible') {
    return Object.freeze({
      state: serverState,
      source: 'server',
      pendingServerSync: false,
      mergeRequired: false,
      compatible: false,
      localState,
      serverState,
      reason: freshness.reason,
    });
  }
  if (freshness.result === 'diverged' || freshness.requiresMerge) {
    return Object.freeze({
      state: serverState,
      source: 'server',
      pendingServerSync: false,
      mergeRequired: true,
      compatible: true,
      localState,
      serverState,
      reason: freshness.reason,
    });
  }
  if (freshness.result === 'a_newer') {
    return Object.freeze({
      state: localState,
      source: 'browser',
      pendingServerSync: true,
      mergeRequired: false,
      compatible: true,
      localState,
      serverState,
      reason: freshness.reason,
    });
  }
  return Object.freeze({
    state: serverState,
    source: 'server',
    pendingServerSync: false,
    mergeRequired: false,
    compatible: true,
    localState,
    serverState,
    reason: freshness.reason,
  });
};

const createCredentialBundle = ({
  existing,
  environment,
  browserNamespace,
  draft,
  resumeToken,
  recoverySessionToken,
  recoverySessionExpiresAt,
  recoveryCode,
  recoveryCodeHint,
  recoveryCodeVersion,
  authorizationMethod,
  now,
}) => ({
  version: 1,
  environment,
  browserNamespace,
  draftId: draft?.draftId ?? existing?.draftId ?? null,
  sessionId: draft?.sessionId ?? draft?.canonicalState?.sessionId ?? existing?.sessionId ?? null,
  resumeToken: resumeToken ?? existing?.resumeToken ?? null,
  recoverySessionToken: recoverySessionToken ?? existing?.recoverySessionToken ?? null,
  recoverySessionExpiresAt:
    recoverySessionExpiresAt ?? existing?.recoverySessionExpiresAt ?? null,
  recoveryCode: recoveryCode ?? existing?.recoveryCode ?? null,
  recoveryCodeHint: recoveryCodeHint ?? existing?.recoveryCodeHint ?? null,
  recoveryCodeVersion: recoveryCodeVersion ?? existing?.recoveryCodeVersion ?? null,
  authorizationMethod: authorizationMethod ?? existing?.authorizationMethod ?? null,
  storedAtClient: existing?.storedAtClient ?? nowIso(now),
  lastUsedAtClient: nowIso(now),
});

const resultWithDiagnostics = (details) => Object.freeze({
  ...details,
  safeDiagnostics: getSafeBootstrapDiagnostics(details),
});

export const createProDraftBootstrapCoordinator = (options = {}) => {
  const runtimeConfig = options.runtimeConfig || frontendRuntimeConfig;
  const storage = options.storage || createResilientStorage(options.storageOptions);
  const apiClient = options.apiClient || proDraftApiClient;
  const recoveryApiClient = options.recoveryApiClient || proDraftRecoveryApiClient;
  const cache = options.canonicalCacheAdapter || {
    loadCanonicalDraftCache,
    saveCanonicalDraftCache,
  };
  const listeners = new Set();
  let state = Object.freeze({
    phase: 'idle', outcome: null, errorCode: null, clientChoiceRequired: false,
    readOnly: false, hasRecoveryCode: false, recoveryCodeHintPresent: false,
    storageMode: 'unknown', memoryOnly: false, draftSummary: null,
    captchaRequired: false, retryAfterSeconds: 0,
  });
  let bootstrapPromise = null;
  let cancelled = false;
  let identityContext = null;
  let browserNamespace = null;
  let localCacheResult = null;
  let credentialVault = null;
  let credentials = null;
  let recoveryCodeForDisplay = null;

  const notify = () => {
    for (const listener of listeners) {
      try { listener(state); } catch {}
    }
  };
  const transition = (phase, patch = {}) => {
    if (cancelled && phase !== 'error') return state;
    state = Object.freeze({ ...state, ...patch, phase });
    notify();
    try { options.onTransition?.(getSafeBootstrapDiagnostics(state)); } catch {}
    return state;
  };
  const assertActive = () => {
    if (cancelled) throw Object.assign(new Error('Draft bootstrap cancelled.'), {
      code: PRO_DRAFT_BOOTSTRAP_ERROR_CODES.CANCELLED,
    });
  };
  const vaultFor = (namespace) => {
    if (!credentialVault) {
      credentialVault = options.credentialVault || createProDraftCredentialVault({
        storage,
        environment: runtimeConfig.environment,
        browserNamespace: namespace,
      });
    }
    return credentialVault;
  };
  const dispatch = (action) => {
    assertActive();
    if (typeof options.store?.dispatch === 'function') return options.store.dispatch(action);
    if (typeof options.dispatch === 'function') return options.dispatch(action);
    return action;
  };
  const cacheLoad = async (namespace) => {
    const operation = cache.loadCanonicalDraftCache || cache.load;
    if (typeof operation !== 'function') return { ok: true, present: false, state: null };
    return operation({ namespace, storage, expectedIdentityContext: identityContext });
  };
  const cacheSave = async (namespace, canonicalState) => {
    const operation = cache.saveCanonicalDraftCache || cache.save;
    if (typeof operation !== 'function') return { ok: true };
    return operation({ namespace, storage, state: canonicalState, now: options.now });
  };
  const setCredentialBundle = async (input, policy = {}) => {
    const saved = await vaultFor(browserNamespace).saveDraftCredentialBundle(input, {
      allowRecoveryCode: policy.allowRecoveryCode !== false,
      now: options.now,
    });
    if (!saved.ok) {
      throw Object.assign(new Error('Credential persistence failed.'), {
        code: PRO_DRAFT_BOOTSTRAP_ERROR_CODES.CREDENTIAL_WRITE_FAILED,
      });
    }
    credentials = saved.bundle;
    recoveryCodeForDisplay = saved.bundle?.recoveryCode || null;
    return saved;
  };
  const hydrate = async ({
    serverState,
    readOnly,
    outcome,
    hasExactDraftAuthorization = true,
    draftMetadata = null,
  }) => {
    transition('reconciling_state');
    const localState = localCacheResult?.ok && localCacheResult?.present
      ? localCacheResult.state : null;
    const reconciled = await reconcileInitialLocalAndServerState({
      localState,
      serverState,
      hasExactDraftAuthorization,
      hashOptions: options.hashOptions,
    });
    assertActive();
    if (!reconciled.state) {
      throw Object.assign(new Error('No canonical draft state was returned.'), {
        code: PRO_DRAFT_BOOTSTRAP_ERROR_CODES.CANONICAL_STATE_MISSING,
      });
    }
    if (TERMINAL_DRAFT_STATUSES.has(reconciled.state.draftStatus)) {
      throw Object.assign(new Error('The draft is no longer active.'), {
        code: PRO_DRAFT_BOOTSTRAP_ERROR_CODES.AUTHORIZATION_FAILED,
      });
    }
    transition('hydrating_redux', {
      mergeRequired: reconciled.mergeRequired,
      pendingServerSync: reconciled.pendingServerSync,
    });
    dispatch(loadCanonicalDraftState(reconciled.state, {
      source: reconciled.source === 'browser' ? 'browser' : 'server',
      completedAt: nowIso(options.now),
      namespace: browserNamespace,
      storageMode: credentials ? state.storageMode : storage.getMode?.() || 'unknown',
    }));
    await cacheSave(browserNamespace, reconciled.state);
    assertActive();
    const effectiveReadOnly = readOnly === true || reconciled.state.draftStatus === 'submitted';
    const effectiveOutcome = effectiveReadOnly ? 'submitted_draft_loaded' : outcome;
    const finished = resultWithDiagnostics({
      phase: 'ready',
      outcome: effectiveOutcome,
      errorCode: null,
      clientChoiceRequired: false,
      readOnly: effectiveReadOnly,
      hasRecoveryCode: Boolean(recoveryCodeForDisplay),
      recoveryCodeHintPresent: Boolean(credentials?.recoveryCodeHint),
      storageMode: state.storageMode,
      memoryOnly: state.memoryOnly,
      draftSummary: safeDraftSummary(reconciled.state, effectiveReadOnly, draftMetadata),
      captchaRequired: false,
      retryAfterSeconds: 0,
      mergeRequired: reconciled.mergeRequired,
      pendingServerSync: reconciled.pendingServerSync,
      reconciliation: Object.freeze({
        source: reconciled.source,
        reason: reconciled.reason,
        compatible: reconciled.compatible,
        mergeRequired: reconciled.mergeRequired,
        pendingServerSync: reconciled.pendingServerSync,
        local: getSafeCanonicalDraftDiagnostics(reconciled.localState || {}),
        server: getSafeCanonicalDraftDiagnostics(reconciled.serverState || {}),
      }),
    });
    state = Object.freeze({ ...state, ...finished });
    notify();
    return finished;
  };

  const loadAuthorized = async ({ authorization, draftId, outcome }) => {
    transition('loading_authorized_draft');
    const response = await apiClient.loadProFormDraft({
      authorization,
      requestedDraftId: draftId,
      includeCanonicalState: true,
      upgradeLegacyOnLoad: false,
      clientContext: clientContextFromIdentity(
        identityContext,
        runtimeConfig.environment,
        { associationIntent: 'resume_current_draft' },
      ),
    });
    if (!response?.success || !pickCanonicalState(response)) {
      throw Object.assign(new Error('Draft load failed.'), {
        code: safeErrorCode(response, PRO_DRAFT_BOOTSTRAP_ERROR_CODES.LOAD_FAILED),
      });
    }
    return hydrate({
      serverState: pickCanonicalState(response),
      readOnly: response.readOnly === true || response.draft?.readOnly === true,
      outcome,
      draftMetadata: response.draft,
    });
  };

  const resumeStored = async () => {
    transition('resuming_stored_draft', { resumeAttempted: true });
    const response = await apiClient.bootstrapProFormDraft({
      idempotencyKey: generateDraftApiIdempotencyKey(options.cryptoProvider),
      authorization: { resumeToken: credentials.resumeToken },
      clientContext: clientContextFromIdentity(
        identityContext,
        runtimeConfig.environment,
        { associationIntent: 'resume_current_draft' },
      ),
    });
    if (!response?.success || !pickCanonicalState(response)) return null;
    await setCredentialBundle(createCredentialBundle({
      existing: credentials,
      environment: runtimeConfig.environment,
      browserNamespace,
      draft: response.draft,
      authorizationMethod: response.authorizationMethod || 'resume_token',
      now: options.now,
    }));
    return hydrate({
      serverState: pickCanonicalState(response),
      readOnly: response.readOnly === true || response.draft?.readOnly === true,
      outcome: 'stored_draft_resumed',
      draftMetadata: response.draft,
    });
  };

  const recoverWith = async ({
    method,
    input,
    keepRecoveryCode = true,
    captchaToken,
  }) => {
    const byCode = method === 'code';
    transition(byCode ? 'recovering_by_code' : 'recovering_by_email');
    let normalizedCode = null;
    let request;
    if (byCode) {
      const normalized = normalizeRecoveryCodeInput(input);
      if (!normalized.valid) {
        throw Object.assign(new Error('Recovery code is invalid.'), {
          code: PRO_DRAFT_BOOTSTRAP_ERROR_CODES.INVALID_RECOVERY_CODE,
        });
      }
      normalizedCode = formatRecoveryCode(normalized.normalizedCode);
      request = {
        recoveryCode: normalizedCode,
        deviceId: await (options.getDeviceId || getOrCreateProDraftDeviceId)({
          storage,
          cryptoProvider: options.cryptoProvider,
        }),
        clientContext: { environment: runtimeConfig.environment },
        ...(typeof captchaToken === 'string' && captchaToken
          ? { captchaToken }
          : {}),
      };
    } else {
      const normalized = normalizeRecoveryEmail(input);
      if (!normalized.valid || !normalized.normalizedEmail) {
        throw Object.assign(new Error('Recovery email is invalid.'), {
          code: PRO_DRAFT_BOOTSTRAP_ERROR_CODES.INVALID_EMAIL,
        });
      }
      request = {
        email: normalized.normalizedEmail,
        clientContext: { environment: runtimeConfig.environment },
        ...(typeof captchaToken === 'string' && captchaToken
          ? { captchaToken }
          : {}),
      };
    }
    const response = byCode
      ? await recoveryApiClient.recoverProFormDraftByCode(request)
      : await recoveryApiClient.recoverProFormDraftByEmail(request);
    if (!response?.success || !response.recoveryCompleted) {
      throw Object.assign(new Error('Draft recovery failed.'), {
        code: safeErrorCode(response, PRO_DRAFT_BOOTSTRAP_ERROR_CODES.RECOVERY_FAILED),
        captchaRequired: response?.captchaRequired === true,
        retryAfterSeconds: Number.isSafeInteger(response?.retryAfterSeconds)
          ? response.retryAfterSeconds
          : 0,
      });
    }
    let existingForRecoveredDraft = credentials?.draftId === response.draft?.draftId
      ? credentials
      : null;
    if (!byCode && existingForRecoveredDraft) {
      existingForRecoveredDraft = { ...existingForRecoveredDraft, recoveryCode: null };
    }
    const fullCode = byCode && keepRecoveryCode ? normalizedCode : null;
    const bundle = createCredentialBundle({
      existing: existingForRecoveredDraft,
      environment: runtimeConfig.environment,
      browserNamespace,
      draft: response.draft,
      recoverySessionToken: response.recoverySessionToken,
      recoverySessionExpiresAt: response.recoverySessionExpiresAt,
      recoveryCode: fullCode,
      recoveryCodeHint: response.draft?.recoveryCodeHint
        || (fullCode ? deriveRecoveryCodeHint(fullCode) : null),
      recoveryCodeVersion: response.draft?.recoveryCodeVersion || (fullCode ? 1 : null),
      authorizationMethod: byCode ? 'recovery_code' : 'email',
      now: options.now,
    });
    const saved = await setCredentialBundle(bundle, { allowRecoveryCode: byCode && keepRecoveryCode });
    state = Object.freeze({
      ...state,
      storageMode: saved.storageMode,
      memoryOnly: saved.storageMode === 'memory_only',
    });
    const loaded = await loadAuthorized({
      authorization: { recoverySessionToken: response.recoverySessionToken },
      draftId: response.draft.draftId,
      outcome: byCode ? 'code_draft_recovered' : 'email_draft_recovered',
    });
    return resultWithDiagnostics({
      ...loaded,
      otherEligibleDraftsAvailable: byCode
        ? false
        : response.otherEligibleDraftsAvailable === true,
    });
  };

  const createNew = async ({ identity = identityContext, anonymousAcknowledged } = {}) => {
    const nextIdentity = anonymousAcknowledged === undefined ? identity : {
      ...identity,
      anonymousRecoveryAcknowledged: anonymousAcknowledged === true,
    };
    if (!nextIdentity?.normalizedRecoveryEmail
      && nextIdentity?.anonymousRecoveryAcknowledged !== true) {
      throw Object.assign(new Error('Anonymous recovery acknowledgement is required.'), {
        code: PRO_DRAFT_BOOTSTRAP_ERROR_CODES.ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED,
      });
    }
    transition('creating_new_draft');
    const clientBootstrapToken = generateClientBootstrapToken(options.cryptoProvider);
    const response = await apiClient.bootstrapProFormDraft({
      idempotencyKey: generateDraftApiIdempotencyKey(options.cryptoProvider),
      authorization: options.signedInvitationToken && options.signedInvitationVerified
        ? { signedDraftAccessToken: options.signedInvitationToken }
        : {},
      clientBootstrapToken,
      clientContext: clientContextFromIdentity(nextIdentity, runtimeConfig.environment),
    });
    if (!response?.success || !pickCanonicalState(response)) {
      throw Object.assign(new Error('Draft creation failed.'), {
        code: safeErrorCode(response, PRO_DRAFT_BOOTSTRAP_ERROR_CODES.AUTHORIZATION_FAILED),
      });
    }
    const issuedCode = response.recoveryCode || null;
    const bundle = createCredentialBundle({
      existing: null,
      environment: runtimeConfig.environment,
      browserNamespace,
      draft: response.draft,
      resumeToken: response.created ? (response.resumeToken || clientBootstrapToken) : null,
      recoveryCode: issuedCode,
      recoveryCodeHint: issuedCode ? deriveRecoveryCodeHint(issuedCode) : null,
      recoveryCodeVersion: issuedCode ? 1 : null,
      authorizationMethod: response.authorizationMethod
        || (options.signedInvitationToken ? 'signed_invitation' : 'new_anonymous_draft'),
      now: options.now,
    });
    const saved = await setCredentialBundle(bundle, { allowRecoveryCode: Boolean(issuedCode) });
    state = Object.freeze({
      ...state,
      storageMode: saved.storageMode,
      memoryOnly: saved.storageMode === 'memory_only',
    });
    let outcome;
    if (options.signedInvitationToken && options.signedInvitationVerified) {
      outcome = response.created ? 'signed_invitation_new_draft' : 'signed_invitation_resumed';
    } else if (!nextIdentity.normalizedRecoveryEmail) {
      outcome = 'anonymous_draft_created';
    } else {
      outcome = 'new_draft_created';
    }
    return hydrate({
      serverState: pickCanonicalState(response),
      readOnly: response.readOnly === true || response.draft?.readOnly === true,
      outcome,
      draftMetadata: response.draft,
    });
  };

  const bootstrap = async (input = {}) => {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      if (!isDurableDraftClientEnabled(runtimeConfig)) {
        const legacy = resultWithDiagnostics({
          phase: 'ready', outcome: 'legacy_flow', errorCode: null,
          clientChoiceRequired: false, readOnly: false, hasRecoveryCode: false,
          recoveryCodeHintPresent: false, storageMode: 'unknown', memoryOnly: false,
        });
        state = legacy;
        notify();
        return legacy;
      }
      try {
        dispatch(setDraftBootstrapLoading({
          source: 'browser', startedAt: nowIso(options.now), beginNew: true,
        }));
        transition('reading_identity');
        identityContext = input.identityContext || options.identityContext;
        if (!identityContext) {
          const params = (options.readIdentityParams || readProQuestionnaireIdentityParams)({
            href: input.href ?? options.href,
          });
          identityContext = (options.createIdentityContext || createClientDraftIdentityContext)(params);
        }
        browserNamespace = input.browserNamespace || options.browserNamespace
          || (options.deriveNamespace || deriveQuestionnaireBrowserNamespace)(identityContext);
        const identityDecision = deriveClientDraftAssociationDecision(identityContext);
        if (!identityDecision.valid) {
          throw Object.assign(new Error('Draft identity is invalid.'), {
            code: PRO_DRAFT_BOOTSTRAP_ERROR_CODES.INVALID_IDENTITY,
          });
        }
        transition('reading_local_cache');
        localCacheResult = await cacheLoad(browserNamespace);
        assertActive();
        transition('reading_credentials', {
          localCachePresent: localCacheResult?.present === true,
          localCacheValid: localCacheResult?.ok === true && localCacheResult?.present === true,
        });
        const loaded = await vaultFor(browserNamespace).removeExpiredRecoverySession({
          now: options.now,
        });
        credentials = loaded.ok ? loaded.bundle : null;
        recoveryCodeForDisplay = credentials?.recoveryCode || null;
        state = Object.freeze({
          ...state,
          credentialsPresent: Boolean(credentials),
          hasRecoveryCode: Boolean(recoveryCodeForDisplay),
          recoveryCodeHintPresent: Boolean(credentials?.recoveryCodeHint),
          storageMode: loaded.storageMode || 'unknown',
          memoryOnly: loaded.storageMode === 'memory_only',
        });
        let authorizedLocalFallbackAvailable = false;
        if (credentials?.resumeToken) {
          try {
            const resumed = await resumeStored();
            if (resumed) return resumed;
          } catch (error) {
            if (error?.code === PRO_DRAFT_BOOTSTRAP_ERROR_CODES.CANCELLED) throw error;
            authorizedLocalFallbackAvailable = isRetryableAuthorizationOutage(error);
          }
        }
        if (credentials?.recoverySessionToken && credentials?.draftId) {
          state = Object.freeze({ ...state, recoverySessionAttempted: true });
          try {
            return await loadAuthorized({
              authorization: { recoverySessionToken: credentials.recoverySessionToken },
              draftId: credentials.draftId,
              outcome: 'stored_draft_resumed',
            });
          } catch (error) {
            if (error?.code === PRO_DRAFT_BOOTSTRAP_ERROR_CODES.CANCELLED) throw error;
            authorizedLocalFallbackAvailable = authorizedLocalFallbackAvailable
              || isRetryableAuthorizationOutage(error);
          }
        }
        if (
          authorizedLocalFallbackAvailable
          && localCacheResult?.ok
          && localCacheResult?.present
          && localCacheResult.state?.draftId === credentials?.draftId
        ) {
          return hydrate({
            serverState: null,
            readOnly: localCacheResult.state?.draftStatus === 'submitted',
            outcome: 'local_only_recovery',
            hasExactDraftAuthorization: true,
          });
        }
        const signedInvitationMayResume = options.signedInvitationVerified === true
          && typeof options.signedInvitationToken === 'string'
          && !identityDecision.mustNotSearchReplacementEmail;
        if (signedInvitationMayResume) {
          state = Object.freeze({ ...state, signedInvitationAttempted: true });
          transition('resuming_stored_draft');
          const clientBootstrapToken = generateClientBootstrapToken(options.cryptoProvider);
          const response = await apiClient.bootstrapProFormDraft({
            idempotencyKey: generateDraftApiIdempotencyKey(options.cryptoProvider),
            authorization: { signedDraftAccessToken: options.signedInvitationToken },
            clientBootstrapToken,
            clientContext: clientContextFromIdentity(identityContext, runtimeConfig.environment),
          });
          if (response?.success && pickCanonicalState(response)) {
            const issuedCode = response.recoveryCode || null;
            const existingForSignedDraft = credentials?.draftId === response.draft?.draftId
              ? credentials
              : null;
            const saved = await setCredentialBundle(createCredentialBundle({
              existing: existingForSignedDraft,
              environment: runtimeConfig.environment,
              browserNamespace,
              draft: response.draft,
              resumeToken: response.created ? (response.resumeToken || clientBootstrapToken) : null,
              recoveryCode: issuedCode,
              recoveryCodeHint: issuedCode ? deriveRecoveryCodeHint(issuedCode) : null,
              recoveryCodeVersion: issuedCode ? 1 : null,
              authorizationMethod: 'signed_invitation',
              now: options.now,
            }), { allowRecoveryCode: Boolean(issuedCode) });
            state = Object.freeze({
              ...state,
              storageMode: saved.storageMode,
              memoryOnly: saved.storageMode === 'memory_only',
            });
            return hydrate({
              serverState: pickCanonicalState(response),
              readOnly: response.readOnly === true || response.draft?.readOnly === true,
              outcome: response.created
                ? 'signed_invitation_new_draft' : 'signed_invitation_resumed',
              draftMetadata: response.draft,
            });
          }
        }
        const waiting = resultWithDiagnostics({
          ...state,
          phase: 'awaiting_client_choice',
          outcome: null,
          errorCode: null,
          clientChoiceRequired: true,
          readOnly: false,
          identity: getSafeClientIdentityContextDiagnostics(identityContext),
        });
        state = waiting;
        notify();
        return waiting;
      } catch (error) {
        const code = safeErrorCode(error, PRO_DRAFT_BOOTSTRAP_ERROR_CODES.HYDRATION_FAILED);
        if (!cancelled) {
          try { dispatch(setDraftBootstrapError({ errorCode: code, completedAt: nowIso(options.now) })); } catch {}
        }
        const failure = resultWithDiagnostics({
          ...state,
          phase: 'error', outcome: null, errorCode: code,
          clientChoiceRequired: false, cancelled,
        });
        state = failure;
        notify();
        return failure;
      }
    })();
    return bootstrapPromise;
  };

  const action = async (operation) => {
    if (!identityContext || !browserNamespace) {
      const initial = await bootstrap();
      if (initial.phase !== 'awaiting_client_choice') return initial;
    }
    try {
      return await operation();
    } catch (error) {
      const code = safeErrorCode(error, PRO_DRAFT_BOOTSTRAP_ERROR_CODES.HYDRATION_FAILED);
      const failure = resultWithDiagnostics({
        ...state,
        phase: 'error', outcome: null, errorCode: code,
        clientChoiceRequired: false, cancelled,
        captchaRequired: error?.captchaRequired === true,
        retryAfterSeconds: Number.isSafeInteger(error?.retryAfterSeconds)
          && error.retryAfterSeconds >= 0
          && error.retryAfterSeconds <= 86400
          ? error.retryAfterSeconds
          : 0,
      });
      state = failure;
      notify();
      return failure;
    }
  };

  return Object.freeze({
    bootstrap: (input) => bootstrap(input),
    resumeDraftFromStoredCredentials: () => action(resumeStored),
    recoverDraftByEmail: (email, recoveryOptions = {}) => action(() => recoverWith({
      method: 'email',
      input: email,
      captchaToken: recoveryOptions.captchaToken,
    })),
    recoverDraftByCode: (code, recoveryOptions = {}) => action(() => recoverWith({
      method: 'code',
      input: code,
      keepRecoveryCode: recoveryOptions.keepInBrowser !== false,
      captchaToken: recoveryOptions.captchaToken,
    })),
    loadAuthorizedDraft: (input) => action(() => loadAuthorized(input)),
    createNewDraftAssociation: (input) => action(() => createNew(input)),
    getState: () => state,
    getSafeDiagnostics: () => getSafeBootstrapDiagnostics(state),
    getRecoveryCodeForDisplay: () => recoveryCodeForDisplay,
    getRecoveryCodeHint: () => credentials?.recoveryCodeHint || null,
    getCredentialStorageMode: () => state.storageMode,
    clearCurrentDraftCredentials: async () => {
      recoveryCodeForDisplay = null;
      credentials = null;
      return credentialVault?.removeDraftCredentialBundle() || { ok: true, removed: false };
    },
    replaceCurrentDraftCredentials: (bundle, replaceOptions) => action(async () => {
      const saved = await setCredentialBundle(bundle, replaceOptions);
      return resultWithDiagnostics({ ...state, storageMode: saved.storageMode });
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel: () => {
      cancelled = true;
      listeners.clear();
    },
  });
};

let defaultCoordinator;
const getDefaultCoordinator = () => {
  if (!defaultCoordinator) defaultCoordinator = createProDraftBootstrapCoordinator();
  return defaultCoordinator;
};

export const bootstrapProDraftEntry = (input, options) => (
  (options?.coordinator || getDefaultCoordinator()).bootstrap(input)
);
export const resumeDraftFromStoredCredentials = (options) => (
  (options?.coordinator || getDefaultCoordinator()).resumeDraftFromStoredCredentials()
);
export const recoverDraftByEmail = (email, options) => (
  (options?.coordinator || getDefaultCoordinator()).recoverDraftByEmail(email)
);
export const recoverDraftByCode = (code, options) => (
  (options?.coordinator || getDefaultCoordinator()).recoverDraftByCode(code, options)
);
export const loadAuthorizedDraft = (input, options) => (
  (options?.coordinator || getDefaultCoordinator()).loadAuthorizedDraft(input)
);
export const createNewDraftAssociation = (input, options) => (
  (options?.coordinator || getDefaultCoordinator()).createNewDraftAssociation(input)
);

export const createEmptyProDraftBootstrapStateForTests = () => createEmptyCanonicalDraftState();
