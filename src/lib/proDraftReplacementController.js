import { loadCanonicalDraftState } from '@/components/store/formSlice';
import { selectCanonicalDraftState } from '@/components/store/draftSelectors';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import {
  removeCanonicalDraftCache,
  saveCanonicalDraftCache,
} from '@/lib/questionnaireCanonicalDraftCache';
import { proDraftApiClient } from '@/lib/proDraftApiClient';
import { defaultProDraftCredentialVault } from '@/lib/proDraftCredentialVault';
import {
  generateReplacementIdempotencyKey,
  generateReplacementResumeToken,
  proDraftReplacementApiClient,
} from '@/lib/proDraftReplacementApiClient';
import { frontendRuntimeConfig } from '@/lib/proDraftRuntimeConfig';

export const PRO_DRAFT_REPLACEMENT_CONTROLLER_VERSION = 1;
export const REPLACEMENT_CONTROLLER_ERROR_CODES = Object.freeze({
  IN_PROGRESS: 'DRAFT_REPLACEMENT_IN_PROGRESS',
  INVALID_STATE: 'DRAFT_REPLACEMENT_INVALID_STATE',
  LOCAL_FLUSH_FAILED: 'DRAFT_REPLACEMENT_LOCAL_FLUSH_FAILED',
  SERVER_SAVE_FAILED: 'DRAFT_REPLACEMENT_SERVER_SAVE_FAILED',
  PARTIAL_RECOVERY_FAILED: 'DRAFT_REPLACEMENT_PARTIAL_RECOVERY_FAILED',
  CREDENTIAL_SAVE_FAILED: 'DRAFT_REPLACEMENT_CREDENTIAL_SAVE_FAILED',
  CANONICAL_LOAD_FAILED: 'DRAFT_REPLACEMENT_CANONICAL_LOAD_FAILED',
});

const CLEANUP_PURPOSES = Object.freeze([
  'redux-state',
  'draft-cache',
  'last-server-base',
  'pending-events',
]);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/u;

const nowIso = (clock) => {
  const value = typeof clock === 'function' ? clock() : Date.now();
  return new Date(value).toISOString();
};

const controllerError = (code, message, cause = null) => Object.assign(
  new Error(message),
  { name: 'ProDraftReplacementControllerError', code, cause },
);

const resolveOperation = (target, names, fallback = null) => {
  for (const name of names) {
    if (typeof target?.[name] === 'function') return target[name].bind(target);
  }
  return fallback;
};

const safeStatus = (manager) => manager?.getStatus?.() || {};

const assertSuccessfulStage = (status, code, message) => {
  if (!status || status.errorCode || status.state === 'error') throw controllerError(code, message);
  return status;
};

const maskRecoveryEmail = (email) => {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}${'*'.repeat(Math.min(6, Math.max(2, local.length - 1)))}@${domain}`;
};

const deliveryState = (emailDelivery, hasEmail) => {
  if (emailDelivery?.redirected === true) return 'staging_redirected';
  if (emailDelivery?.delivered === true) return 'success';
  if (emailDelivery?.failed === true || emailDelivery?.deliveryUncertain === true) return 'failure';
  return hasEmail ? 'failure' : 'no_email';
};

const exactNamespaceCleanup = async ({
  namespace,
  storage,
  credentialVault,
  canonicalCache,
}) => {
  const removeCredentials = resolveOperation(
    credentialVault,
    ['removeDraftCredentialBundle', 'remove'],
  );
  const credentialResult = await removeCredentials?.({
    namespace, browserNamespace: namespace, storage,
  });
  const removeCache = resolveOperation(
    canonicalCache,
    ['removeCanonicalDraftCache', 'remove'],
    removeCanonicalDraftCache,
  );
  const removals = [];
  for (const purpose of CLEANUP_PURPOSES) {
    if (purpose === 'draft-cache') {
      removals.push(Promise.resolve(removeCache({ namespace, storage })));
    } else {
      removals.push(Promise.resolve(storage?.removeItem?.(
        buildQuestionnaireStorageKey({ namespace, purpose }),
      )));
    }
  }
  await Promise.all(removals);
  return Object.freeze({
    namespace,
    credentialsRemoved: credentialResult?.ok !== false,
    purposesRemoved: CLEANUP_PURPOSES,
  });
};

const buildCredentialBundle = ({ response, namespace, environment, clock }) => Object.freeze({
  version: 1,
  environment,
  browserNamespace: namespace,
  draftId: response.replacementDraft.draftId,
  sessionId: response.replacementDraft.sessionId,
  resumeToken: response.resumeToken,
  recoverySessionToken: null,
  recoverySessionExpiresAt: null,
  recoveryCode: null,
  recoveryCodeHint: response.replacementDraft.recoveryCodeHint || null,
  recoveryCodeVersion: response.replacementDraft.recoveryCodeHint ? 1 : null,
  authorizationMethod: 'resume_token',
  storedAtClient: nowIso(clock),
  lastUsedAtClient: nowIso(clock),
});

const loadReplacementCanonical = async ({
  response,
  namespace,
  environment,
  draftApiClient,
  canonicalCache,
  storage,
  store,
  clock,
}) => {
  if (!response.resumeToken) {
    throw controllerError(
      REPLACEMENT_CONTROLLER_ERROR_CODES.CANONICAL_LOAD_FAILED,
      'The replacement was committed, but its one-time credentials are unavailable.',
    );
  }
  const loaded = await draftApiClient.loadProFormDraft({
    authorization: { resumeToken: response.resumeToken },
    requestedDraftId: response.replacementDraft.draftId,
    includeCanonicalState: true,
    upgradeLegacyOnLoad: false,
    clientContext: {
      formType: 'pro-questionnaire',
      identityContextVersion: 1,
      associationIntent: response.operation,
      anonymousRecoveryAcknowledged: true,
      environment,
    },
  });
  const canonicalState = loaded?.canonicalState || loaded?.draft?.canonicalState;
  if (!canonicalState || canonicalState.draftId !== response.replacementDraft.draftId
    || canonicalState.draftStatus !== 'active') {
    throw controllerError(
      REPLACEMENT_CONTROLLER_ERROR_CODES.CANONICAL_LOAD_FAILED,
      'The new draft could not be loaded safely.',
    );
  }
  const saveCache = resolveOperation(
    canonicalCache,
    ['saveCanonicalDraftCache', 'save'],
    saveCanonicalDraftCache,
  );
  const saved = await saveCache({ namespace, storage, state: canonicalState, now: clock });
  if (saved?.ok === false) {
    throw controllerError(
      REPLACEMENT_CONTROLLER_ERROR_CODES.CANONICAL_LOAD_FAILED,
      'The new draft could not be cached safely.',
    );
  }
  store.dispatch(loadCanonicalDraftState(canonicalState, {
    source: 'server',
    completedAt: nowIso(clock),
    namespace,
    lastStateHash: loaded.stateHash || null,
    storageMode: storage?.getMode?.() || 'unknown',
  }));
  return canonicalState;
};

export async function recoverReplacementAfterPartialFailure({
  operation,
  apiClient,
  request,
  retainedCredentials,
}) {
  const method = operation === 'clear_all'
    ? apiClient.clearAndReplaceProFormDraft
    : apiClient.startNewProFormDraft;
  if (typeof method !== 'function') {
    throw controllerError(
      REPLACEMENT_CONTROLLER_ERROR_CODES.PARTIAL_RECOVERY_FAILED,
      'The replacement recovery path is unavailable.',
    );
  }
  const recovered = await method.call(apiClient, request);
  if (recovered?.success !== true) {
    throw controllerError(
      REPLACEMENT_CONTROLLER_ERROR_CODES.PARTIAL_RECOVERY_FAILED,
      'The replacement is still being confirmed. Current browser data was preserved.',
    );
  }
  return Object.freeze({
    ...recovered,
    recoveryCode: recovered.recoveryCode || retainedCredentials?.recoveryCode || null,
    resumeToken: recovered.resumeToken || retainedCredentials?.resumeToken || null,
    recoverySessionToken: recovered.recoverySessionToken
      || retainedCredentials?.recoverySessionToken || null,
  });
}

export function createProDraftReplacementController(options = {}) {
  const manager = options.syncManager;
  const store = options.store;
  const credentialVault = options.credentialVault || defaultProDraftCredentialVault;
  const canonicalCache = options.canonicalCache || {
    removeCanonicalDraftCache,
    saveCanonicalDraftCache,
  };
  const namespaceService = options.namespaceService || {
    deriveForDraft: (draftId) => deriveQuestionnaireBrowserNamespace(/** @type {any} */ ({
      currentAuthorizedDraftId: draftId,
    })),
  };
  const apiClient = options.apiClient || proDraftReplacementApiClient;
  const draftApiClient = options.draftApiClient || proDraftApiClient;
  const storage = options.storage;
  const environment = options.environment || frontendRuntimeConfig.environment;
  const clock = options.clock || Date.now;
  const idempotencyGenerator = options.idempotencyGenerator
    || generateReplacementIdempotencyKey;
  const tokenGenerator = options.tokenGenerator || generateReplacementResumeToken;
  let inFlightPromise = null;
  let rawCredentialMemory = null;
  let currentDraftId = options.draftId || null;

  if (!manager || !store || !storage) {
    throw new TypeError('PRO_DRAFT_REPLACEMENT_CONTROLLER_DEPENDENCIES_REQUIRED');
  }

  const execute = (operation) => {
    if (inFlightPromise) return inFlightPromise;
    inFlightPromise = (async () => {
      const selected = selectCanonicalDraftState(store.getState());
      const canonical = selected?.state;
      const oldNamespace = options.namespace || canonical?.namespace
        || store.getState()?.form?.draftContext?.namespace;
      if (!canonical?.draftId || !SAFE_ID.test(canonical.draftId) || !oldNamespace) {
        throw controllerError(
          REPLACEMENT_CONTROLLER_ERROR_CODES.INVALID_STATE,
          'The current draft is not ready for replacement.',
        );
      }
      if (operation === 'clear_all' && canonical.draftStatus === 'submitted') {
        throw controllerError(
          REPLACEMENT_CONTROLLER_ERROR_CODES.INVALID_STATE,
          'Clear All is unavailable for submitted questionnaires.',
        );
      }
      if (operation === 'start_new_after_submission' && canonical.draftStatus !== 'submitted') {
        throw controllerError(
          REPLACEMENT_CONTROLLER_ERROR_CODES.INVALID_STATE,
          'Start New is available only for submitted questionnaires.',
        );
      }

      const localStatus = await manager.flush({ localOnly: true, reason: 'replacement_prepare' });
      assertSuccessfulStage(
        localStatus,
        REPLACEMENT_CONTROLLER_ERROR_CODES.LOCAL_FLUSH_FAILED,
        'The latest local changes could not be saved.',
      );
      const serverStatus = operation === 'clear_all'
        ? await manager.saveImmediately('clear_all_prepare', { force: true })
        : safeStatus(manager);
      assertSuccessfulStage(
        serverStatus,
        REPLACEMENT_CONTROLLER_ERROR_CODES.SERVER_SAVE_FAILED,
        'The latest draft revision was not accepted by the server.',
      );
      const expectedServerRevision = Number.isSafeInteger(serverStatus.confirmedServerRevision)
        ? serverStatus.confirmedServerRevision
        : canonical.serverRevision;
      await manager.stop?.();

      const request = Object.freeze({
        browserNamespace: oldNamespace,
        storage,
        sourceDraftId: canonical.draftId,
        expectedServerRevision,
        idempotencyKey: idempotencyGenerator(),
        clientReplacementResumeToken: tokenGenerator(),
        ...(options.testRunId ? { testRunId: options.testRunId } : {}),
      });
      let response;
      try {
        const method = operation === 'clear_all'
          ? apiClient.clearAndReplaceProFormDraft
          : apiClient.startNewProFormDraft;
        response = await method.call(apiClient, request);
        if (response?.replacementRecoveryRequired === true) {
          rawCredentialMemory = Object.freeze({
            recoveryCode: response.recoveryCode || null,
            resumeToken: response.resumeToken || request.clientReplacementResumeToken,
            recoverySessionToken: response.recoverySessionToken || null,
          });
          response = await recoverReplacementAfterPartialFailure({
            operation, apiClient, request, retainedCredentials: rawCredentialMemory,
          });
        }
      } catch (error) {
        await manager.start?.();
        throw error;
      }

      rawCredentialMemory = Object.freeze({
        recoveryCode: response.recoveryCode || rawCredentialMemory?.recoveryCode || null,
        resumeToken: response.resumeToken || rawCredentialMemory?.resumeToken || null,
        recoverySessionToken: response.recoverySessionToken
          || rawCredentialMemory?.recoverySessionToken || null,
      });
      response = Object.freeze({ ...response, ...rawCredentialMemory });
      if (operation === 'clear_all') manager.invalidateAfterSupersession?.();
      await manager.dispose?.();

      const newNamespace = namespaceService.deriveForDraft(response.replacementDraft.draftId);
      const bundle = buildCredentialBundle({
        response, namespace: newNamespace, environment, clock,
      });
      const saveCredentials = resolveOperation(
        credentialVault,
        ['saveDraftCredentialBundle', 'save'],
      );
      const credentialResult = await saveCredentials?.(bundle, {
        namespace: newNamespace,
        browserNamespace: newNamespace,
        storage,
        allowRecoveryCode: false,
      });
      if (!credentialResult?.ok) {
        throw controllerError(
          REPLACEMENT_CONTROLLER_ERROR_CODES.CREDENTIAL_SAVE_FAILED,
          'The new draft was created, but its browser credentials could not be saved.',
        );
      }

      if (operation === 'clear_all') {
        await exactNamespaceCleanup({
          namespace: oldNamespace, storage, credentialVault, canonicalCache,
        });
      }

      const canonicalState = await loadReplacementCanonical({
        response,
        namespace: newNamespace,
        environment,
        draftApiClient,
        canonicalCache,
        storage,
        store,
        clock,
      });
      currentDraftId = response.replacementDraft.draftId;
      const replacementManager = await options.createSyncManager?.({
        draftId: currentDraftId,
        sessionId: response.replacementDraft.sessionId,
        namespace: newNamespace,
        canonicalState,
      });
      replacementManager?.start?.();
      options.historyAdapter?.replaceState?.({
        draftId: canonical.draftId,
        namespace: oldNamespace,
        readOnly: operation === 'start_new_after_submission' || operation === 'clear_all',
        superseded: operation === 'clear_all',
      }, '');
      options.historyAdapter?.pushState?.({
        draftId: currentDraftId,
        namespace: newNamespace,
        readOnly: false,
      }, '');
      await options.onNamespaceChange?.({
        namespace: newNamespace,
        draftId: currentDraftId,
        canonicalState,
      });

      const recoveryEmail = canonical.credentials?.recoveryEmail || '';
      return Object.freeze({
        success: true,
        operation,
        oldDraftId: canonical.draftId,
        oldNamespace,
        newDraftId: currentDraftId,
        newNamespace,
        canonicalState,
        recoveryCode: rawCredentialMemory.recoveryCode,
        emailDeliveryState: deliveryState(response.emailDelivery, Boolean(recoveryEmail)),
        maskedRecoveryEmail: maskRecoveryEmail(recoveryEmail),
        emailRetryAllowed: response.emailDelivery?.canRetry === true,
        rawCredentialsRemainInMemory: true,
        submittedSourcePreserved: operation === 'start_new_after_submission',
      });
    })().finally(() => { inFlightPromise = null; });
    return inFlightPromise;
  };

  return Object.freeze({
    executeClearAll: () => execute('clear_all'),
    executeStartNew: () => execute('start_new_after_submission'),
    recoverReplacementAfterPartialFailure: (details) => recoverReplacementAfterPartialFailure({
      ...details, apiClient,
    }),
    acknowledgeRecoveryCode() {
      rawCredentialMemory = null;
    },
    getDiagnostics: () => Object.freeze({
      version: PRO_DRAFT_REPLACEMENT_CONTROLLER_VERSION,
      inProgress: Boolean(inFlightPromise),
      currentDraftId,
      rawCredentialsInMemory: Boolean(rawCredentialMemory),
      rawCredentialsInRedux: false,
      usesHardReload: false,
      exactNamespaceCleanup: true,
    }),
  });
}

let defaultController = null;

export function executeClearAll(options) {
  if (options) return createProDraftReplacementController(options).executeClearAll();
  if (!defaultController) throw new TypeError('PRO_DRAFT_REPLACEMENT_CONTROLLER_REQUIRED');
  return defaultController.executeClearAll();
}

export function executeStartNew(options) {
  if (options) return createProDraftReplacementController(options).executeStartNew();
  if (!defaultController) throw new TypeError('PRO_DRAFT_REPLACEMENT_CONTROLLER_REQUIRED');
  return defaultController.executeStartNew();
}

export function getSafeReplacementControllerDiagnostics(controller = defaultController) {
  return controller?.getDiagnostics?.() || Object.freeze({
    version: PRO_DRAFT_REPLACEMENT_CONTROLLER_VERSION,
    inProgress: false,
    currentDraftId: null,
    rawCredentialsInMemory: false,
    rawCredentialsInRedux: false,
    usesHardReload: false,
    exactNamespaceCleanup: true,
  });
}
