import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Provider } from 'react-redux';
import { createResilientStorage } from '@/lib/resilientStorage';
import { safeGetWindowLocationHref } from '@/lib/browserSafety';
import { safeRemoveSearchParameter } from '@/lib/app-params';
import {
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import {
  createClientDraftIdentityContext,
  getSafeClientIdentityContextDiagnostics,
  readProQuestionnaireIdentityParams,
} from '@/lib/proDraftClientIdentityContext';
import {
  compareCanonicalDraftFreshness,
  createEmptyCanonicalDraftState,
  hashCanonicalDraftState,
} from '@/lib/questionnaireDraftState';
import {
  inspectCanonicalDraftCache,
  inspectLegacyCanonicalDraftCachePresence,
  loadCanonicalDraftCache,
  removeCanonicalDraftCache,
} from '@/lib/questionnaireCanonicalDraftCache';
import {
  createQuestionnaireStore,
  defaultCanonicalDraftCacheAdapter,
} from './store/store';
import {
  loadCanonicalDraftState,
  loadInitialState,
  patchDraftContext,
  resetForm,
  setDraftIdentityContext,
  setDraftBootstrapLoading,
  setDraftBootstrapReady,
} from './store/formSlice';
import { normalizePersistedQuestionnaireState } from './store/normalization';
import { selectCanonicalDraftState } from './store/draftSelectors';
import {
  getLocalCanonicalPersistenceStatus,
  startLocalCanonicalDraftPersistence,
  stopLocalCanonicalDraftPersistence,
} from './store/localCanonicalDraftPersistence';
import { QuestionnairePersistenceProvider } from './store/QuestionnairePersistenceContext';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
} from '@/lib/proDraftRuntimeConfig';

const questionnaireRuntimeCache = new Map();

const toReduxDraftIdentityPayload = (context) => ({
  recoveryEmail: context.normalizedRecoveryEmail || null,
  identityContextVersion: context.identityVersion,
  recoveryEmailSource: context.recoveryEmailSource,
  recoveryEmailVerificationStatus: context.recoveryEmailVerificationStatus,
  identityAssociationIntent: context.associationIntent,
  anonymousRecoveryAcknowledged: context.anonymousRecoveryAcknowledged,
  signedInvitationEmailChanged: context.signedInvitationEmailChanged,
});

export const resolveClientQuestionnaireIdentity = (href) => {
  const params = readProQuestionnaireIdentityParams({ href });
  try {
    const context = createClientDraftIdentityContext(params);
    return Object.freeze({
      context,
      safeDiagnostics: getSafeClientIdentityContextDiagnostics(context),
    });
  } catch (error) {
    const context = createClientDraftIdentityContext({
      ...params,
      recoveryEmail: '',
      signedInvitationEmail: '',
      recoveryEmailSource: 'migrated_legacy',
      associationIntent: 'legacy_migration',
    });
    return Object.freeze({
      context,
      safeDiagnostics: getSafeClientIdentityContextDiagnostics(context, error?.code || 'INVALID_INPUT'),
    });
  }
};

const defaultStorageFactory = (_namespace) => createResilientStorage();

const isSemanticallyEmptyValue = (value) => {
  if (value === null || value === undefined || value === '' || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

const isSemanticallyEmptyMap = (value) => (
  Object.values(value || {}).every(isSemanticallyEmptyValue)
);

const resolveCacheOperation = (adapter, names, fallback) => {
  for (const name of names) {
    if (typeof adapter?.[name] === 'function') return adapter[name].bind(adapter);
  }
  return fallback;
};

export const isCanonicalQuestionnaireDraftEmpty = (state) => {
  try {
    const empty = createEmptyCanonicalDraftState();
    return (
      state.draftId === null
      && state.sessionId === null
      && state.draftStatus === empty.draftStatus
      && state.clientRevision === 0
      && state.serverRevision === 0
      && isSemanticallyEmptyMap(state.responses)
      && isSemanticallyEmptyMap(state.validationStatus)
      && isSemanticallyEmptyMap(state.touchedQuestions)
      && isSemanticallyEmptyMap(state.expandedQuestions)
      && isSemanticallyEmptyMap(state.textValidationMeta)
      && isSemanticallyEmptyMap(state.credentials)
      && isSemanticallyEmptyMap(state.uiDraftState)
      && isSemanticallyEmptyMap(state.fieldChangeMetadata)
      && state.currentQuestionId === null
      && state.lastChangedQuestionId === null
      && state.lastMutation === null
      && state.submission.finalSubmissionId === null
      && state.submission.submittedAt === null
    );
  } catch {
    return false;
  }
};

/** @param {any} [options] @returns {Promise<any>} */
export const selectLocalQuestionnaireBootstrapSource = async (options = {}) => {
  const {
    reduxState,
    cacheState,
    cachePresent,
    cacheValid,
    hashOptions = {},
  } = options;
  if (!cachePresent || !cacheValid || !cacheState) {
    return Object.freeze({
      source: 'redux',
      reason: cachePresent ? 'cache_invalid' : 'cache_missing',
      suppressInitialWrite: Boolean(cachePresent),
    });
  }
  const reduxEmpty = isCanonicalQuestionnaireDraftEmpty(reduxState);
  const cacheEmpty = isCanonicalQuestionnaireDraftEmpty(cacheState);
  if (reduxEmpty && !cacheEmpty) {
    return Object.freeze({ source: 'cache', reason: 'redux_empty', suppressInitialWrite: true });
  }
  if (!reduxEmpty && cacheEmpty) {
    return Object.freeze({ source: 'redux', reason: 'cache_empty', suppressInitialWrite: false });
  }

  const [reduxHash, cacheHash] = await Promise.all([
    hashCanonicalDraftState(reduxState, hashOptions),
    hashCanonicalDraftState(cacheState, hashOptions),
  ]);
  if (reduxHash === cacheHash) {
    return Object.freeze({
      source: 'redux',
      reason: 'equivalent_hash',
      suppressInitialWrite: true,
      initialHash: reduxHash,
    });
  }

  const freshness = await compareCanonicalDraftFreshness(
    reduxState,
    cacheState,
    hashOptions,
  );
  if (freshness.result === 'b_newer') {
    return Object.freeze({
      source: 'cache',
      reason: freshness.reason,
      suppressInitialWrite: true,
      initialHash: cacheHash,
    });
  }
  if (freshness.result === 'a_newer') {
    return Object.freeze({
      source: 'redux',
      reason: freshness.reason,
      suppressInitialWrite: false,
    });
  }
  return Object.freeze({
    source: 'redux',
    reason: freshness.reason,
    suppressInitialWrite: true,
    initialHash: reduxHash,
  });
};

export const bootstrapQuestionnaireStoreRuntime = async (runtime, options = {}) => {
  const now = options.now || Date.now;
  const completedAt = () => new Date(now()).toISOString();
  const cacheAdapter = options.canonicalCacheAdapter
    || runtime.canonicalCacheAdapter
    || defaultCanonicalDraftCacheAdapter;
  const cacheOptions = {
    namespace: runtime.namespace,
    storage: runtime.storage,
    timeoutMs: options.cacheTimeoutMs,
    ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
    ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
    ...(options.identityContext ? { expectedIdentityContext: options.identityContext } : {}),
  };
  runtime.store.dispatch(setDraftBootstrapLoading({
    source: 'browser',
    startedAt: completedAt(),
    beginNew: true,
  }));

  const normalized = normalizePersistedQuestionnaireState(runtime.store.getState()?.form);
  runtime.store.dispatch(loadInitialState(normalized));
  if (options.identityContext) {
    runtime.store.dispatch(setDraftIdentityContext(
      toReduxDraftIdentityPayload(options.identityContext),
    ));
  }
  runtime.store.dispatch(patchDraftContext({ namespace: runtime.namespace }));

  const inspect = resolveCacheOperation(
    cacheAdapter,
    ['inspectCanonicalDraftCache', 'inspect'],
    inspectCanonicalDraftCache,
  );
  const load = resolveCacheOperation(
    cacheAdapter,
    ['loadCanonicalDraftCache', 'load'],
    loadCanonicalDraftCache,
  );
  let inspection;
  try {
    inspection = await inspect(cacheOptions);
  } catch {
    inspection = {
      present: true,
      valid: false,
      errorCode: 'CANONICAL_CACHE_INSPECTION_FAILED',
    };
  }
  let legacyInspection = { present: false, versions: [], errorCode: null };
  if (!inspection?.present) {
    const inspectLegacy = resolveCacheOperation(
      cacheAdapter,
      ['inspectLegacyCanonicalDraftCachePresence', 'inspectLegacy'],
      inspectLegacyCanonicalDraftCachePresence,
    );
    try { legacyInspection = await inspectLegacy(cacheOptions); } catch {}
  }
  let cacheResult;
  if (inspection?.present && inspection?.valid) {
    try {
      cacheResult = await load(cacheOptions);
    } catch {
      cacheResult = {
        ok: false,
        present: true,
        state: null,
        envelope: null,
        errorCode: 'CANONICAL_CACHE_READ_FAILED',
      };
    }
  } else {
    cacheResult = {
      ok: false,
      present: inspection?.present === true,
      state: null,
      envelope: null,
      errorCode: inspection?.errorCode || null,
    };
  }

  let reduxResult = selectCanonicalDraftState(runtime.store.getState());
  if (!reduxResult.ok) {
    runtime.store.dispatch(resetForm());
    runtime.store.dispatch(patchDraftContext({ namespace: runtime.namespace }));
    reduxResult = selectCanonicalDraftState(runtime.store.getState());
  }
  const decision = /** @type {any} */ (await selectLocalQuestionnaireBootstrapSource({
    reduxState: reduxResult.state,
    cacheState: cacheResult.state,
    cachePresent: inspection?.present === true,
    cacheValid: cacheResult.ok === true && cacheResult.present === true,
    hashOptions: {
      ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
      ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
    },
  }));

  if (decision.source === 'cache') {
    const state = {
      ...cacheResult.state,
      savedAtClient: cacheResult.envelope?.savedAtClient
        || cacheResult.state.savedAtClient,
    };
    runtime.store.dispatch(loadCanonicalDraftState(state, {
      source: 'browser',
      completedAt: completedAt(),
      namespace: runtime.namespace,
      lastStateHash: cacheResult.envelope?.canonicalStateHash || decision.initialHash || null,
      storageMode: cacheResult.envelope?.storageMode || runtime.storage.getMode?.() || 'unknown',
    }));
  } else {
    runtime.store.dispatch(setDraftBootstrapReady({
      source: 'browser',
      completedAt: completedAt(),
    }));
  }

  let initialHash = decision.initialHash;
  if (decision.suppressInitialWrite && !initialHash) {
    const selected = selectCanonicalDraftState(runtime.store.getState());
    if (selected.ok) {
      initialHash = await hashCanonicalDraftState(selected.state, {
        ...(Object.hasOwn(options, 'crypto') ? { crypto: options.crypto } : {}),
        ...(options.TextEncoder ? { TextEncoder: options.TextEncoder } : {}),
      });
    }
  }
  if (runtime.localPersistence && options.startLocalPersistence !== false) {
    startLocalCanonicalDraftPersistence(runtime.localPersistence, {
      initialHash,
      scheduleInitial: true,
    });
  }
  return Object.freeze({
    ...runtime,
    bootstrapDiagnostics: Object.freeze({
      source: decision.source,
      reason: decision.reason,
      cachePresent: inspection?.present === true,
      cacheValid: cacheResult.ok === true && cacheResult.present === true,
      legacyCachePresent: legacyInspection?.present === true,
      legacyNamespaceVersions: Array.isArray(legacyInspection?.versions)
        ? legacyInspection.versions
        : [],
      ...getSafeClientIdentityContextDiagnostics(options.identityContext || {}),
    }),
  });
};

/**
 * @param {{
 *   namespace?: string,
 *   storageFactory?: (namespace?: string) => any,
 *   storeFactory?: (options?: any) => any,
 *   rehydrationTimeoutMs?: number,
 *   canonicalCacheAdapter?: any,
 *   cacheTimeoutMs?: number,
 *   identityContext?: any,
 *   startLocalPersistence?: boolean,
 * }} [options]
 */
export const createQuestionnaireStoreRuntime = async ({
  namespace,
  identityContext,
  storageFactory = defaultStorageFactory,
  storeFactory = createQuestionnaireStore,
  rehydrationTimeoutMs,
  canonicalCacheAdapter = defaultCanonicalDraftCacheAdapter,
  cacheTimeoutMs,
  startLocalPersistence = true,
} = {}) => {
  const storage = storageFactory(namespace);
  try { await storage.probe?.(); } catch {}
  const runtime = storeFactory({
    namespace,
    storage,
    rehydrationTimeoutMs,
    canonicalCacheAdapter,
    enableLocalPersistence: true,
    startLocalPersistence: false,
  });
  await runtime.ready;
  return bootstrapQuestionnaireStoreRuntime(runtime, {
    canonicalCacheAdapter,
    cacheTimeoutMs,
    identityContext,
    startLocalPersistence,
  });
};

/** @param {{ namespace?: string, [key: string]: any }} options */
const getOrCreateQuestionnaireRuntime = ({ namespace, ...options }) => {
  if (!questionnaireRuntimeCache.has(namespace)) {
    questionnaireRuntimeCache.set(
      namespace,
      createQuestionnaireStoreRuntime({ namespace, ...options }),
    );
  }
  return questionnaireRuntimeCache.get(namespace);
};

export const resetQuestionnaireStoreRuntimeCacheForTests = () => {
  for (const runtimePromise of questionnaireRuntimeCache.values()) {
    Promise.resolve(runtimePromise).then((runtime) => runtime.dispose?.()).catch(() => {});
  }
  questionnaireRuntimeCache.clear();
};

const StoreBootstrapLoader = () => (
  <div
    role="status"
    aria-live="polite"
    data-testid="questionnaire-store-bootstrap"
    className="min-h-[12rem] flex items-center justify-center bg-white"
  >
    <div className="flex items-center gap-3 text-sm text-slate-700">
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700"
        aria-hidden="true"
      />
      Preparing your questionnaire…
    </div>
  </div>
);

/** @param {{
 *   children?: import('react').ReactNode,
 *   locationHref?: string,
 *   storageFactory?: (namespace?: string) => any,
 *   storeFactory?: (options?: any) => any,
 *   rehydrationTimeoutMs?: number,
 *   cacheTimeoutMs?: number,
 *   canonicalCacheAdapter?: any,
 *   onRuntimeReady?: (runtime: any) => void,
 *   useRuntimeCache?: boolean,
 * }} props
 */
export default function ReduxProvider({
  children,
  locationHref,
  storageFactory = defaultStorageFactory,
  storeFactory = createQuestionnaireStore,
  rehydrationTimeoutMs,
  cacheTimeoutMs,
  canonicalCacheAdapter = defaultCanonicalDraftCacheAdapter,
  onRuntimeReady,
  useRuntimeCache = true,
}) {
  const resolvedHref = typeof locationHref === 'string'
    ? locationHref
    : safeGetWindowLocationHref();
  const identity = useMemo(() => resolveClientQuestionnaireIdentity(resolvedHref), [resolvedHref]);
  const namespace = useMemo(() => deriveQuestionnaireBrowserNamespace(
    identity.context,
  ), [identity]);
  const [runtime, setRuntime] = useState(null);
  const runtimeRef = useRef(null);
  const ordinaryLocalPersistenceEnabled = !isDurableDraftClientEnabled(
    frontendRuntimeConfig,
  );

  const switchDraftRuntime = useCallback(async ({ namespace: nextNamespace }) => {
    if (typeof nextNamespace !== 'string' || nextNamespace === runtimeRef.current?.namespace) {
      return true;
    }
    const nextRuntime = await getOrCreateQuestionnaireRuntime({
      namespace: nextNamespace,
      identityContext: identity.context,
      storageFactory,
      storeFactory,
      rehydrationTimeoutMs,
      cacheTimeoutMs,
      canonicalCacheAdapter,
      startLocalPersistence: ordinaryLocalPersistenceEnabled,
    });
    await stopLocalCanonicalDraftPersistence(runtimeRef.current?.localPersistence);
    runtimeRef.current = nextRuntime;
    setRuntime(nextRuntime);
    return true;
  }, [
    cacheTimeoutMs,
    canonicalCacheAdapter,
    identity.context,
    ordinaryLocalPersistenceEnabled,
    rehydrationTimeoutMs,
    storageFactory,
    storeFactory,
  ]);

  useEffect(() => {
    const onPopState = (event) => {
      const target = event.state;
      if (!target?.namespace || target.superseded === true) return;
      void switchDraftRuntime({ namespace: target.namespace });
    };
    globalThis.addEventListener?.('popstate', onPopState);
    return () => globalThis.removeEventListener?.('popstate', onPopState);
  }, [switchDraftRuntime]);

  useEffect(() => {
    let active = true;
    let mountedRuntime = null;
    setRuntime(null);

    const options = {
      namespace,
      identityContext: identity.context,
      storageFactory,
      storeFactory,
      rehydrationTimeoutMs,
      cacheTimeoutMs,
      canonicalCacheAdapter,
      startLocalPersistence: ordinaryLocalPersistenceEnabled,
    };
    const runtimePromise = useRuntimeCache
      ? getOrCreateQuestionnaireRuntime(options)
      : createQuestionnaireStoreRuntime(options);

    runtimePromise.then(async (nextRuntime) => {
      let shouldReset = false;
      try {
        const url = new URL(resolvedHref || '/', 'https://questionnaire.invalid');
        shouldReset = url.searchParams.get('resetFormState') === '1';
      } catch {
        shouldReset = false;
      }

      if (shouldReset) {
        await stopLocalCanonicalDraftPersistence(nextRuntime.localPersistence);
        try { await nextRuntime.persistor.purge(); } catch {}
        const remove = resolveCacheOperation(
          nextRuntime.canonicalCacheAdapter || canonicalCacheAdapter,
          ['removeCanonicalDraftCache', 'remove'],
          removeCanonicalDraftCache,
        );
        try { await remove({ namespace, storage: nextRuntime.storage }); } catch {}
        nextRuntime.store.dispatch(resetForm());
        nextRuntime.store.dispatch(setDraftIdentityContext(
          toReduxDraftIdentityPayload(identity.context),
        ));
        nextRuntime.store.dispatch(patchDraftContext({ namespace }));
        try { await nextRuntime.persistor.flush(); } catch {}
        if (ordinaryLocalPersistenceEnabled) {
          startLocalCanonicalDraftPersistence(nextRuntime.localPersistence, {
            scheduleInitial: true,
          });
        }
        safeRemoveSearchParameter('resetFormState');
      }

      if (!active) {
        await stopLocalCanonicalDraftPersistence(nextRuntime.localPersistence);
        if (!useRuntimeCache) await nextRuntime.dispose?.();
        return;
      }
      if (ordinaryLocalPersistenceEnabled) {
        startLocalCanonicalDraftPersistence(nextRuntime.localPersistence, {
          scheduleInitial: false,
        });
      }
      mountedRuntime = nextRuntime;
      runtimeRef.current = nextRuntime;
      setRuntime(nextRuntime);
      try { onRuntimeReady?.(nextRuntime); } catch {}
    }).catch(async () => {
      if (!active) return;
      const fallbackStorage = createResilientStorage({
        indexedDB: null,
        localStorage: null,
        sessionStorage: null,
      });
      const fallbackRuntime = createQuestionnaireStore({
        namespace,
        storage: fallbackStorage,
        rehydrationTimeoutMs,
        canonicalCacheAdapter,
        startLocalPersistence: false,
      });
      await fallbackRuntime.ready;
      const bootstrappedFallback = await bootstrapQuestionnaireStoreRuntime(fallbackRuntime, {
        canonicalCacheAdapter,
        cacheTimeoutMs,
        identityContext: identity.context,
        startLocalPersistence: ordinaryLocalPersistenceEnabled,
      });
      if (active) {
        runtimeRef.current = bootstrappedFallback;
        setRuntime(bootstrappedFallback);
      }
      else await bootstrappedFallback.dispose?.();
    });

    return () => {
      active = false;
      if (mountedRuntime) {
        void stopLocalCanonicalDraftPersistence(mountedRuntime.localPersistence);
      }
    };
  }, [
    cacheTimeoutMs,
    canonicalCacheAdapter,
    namespace,
    identity,
    onRuntimeReady,
    ordinaryLocalPersistenceEnabled,
    rehydrationTimeoutMs,
    resolvedHref,
    storageFactory,
    storeFactory,
    useRuntimeCache,
  ]);

  if (!runtime) return <StoreBootstrapLoader />;

  const diagnostics = runtime.getDiagnostics();
  const persistenceContext = {
    namespace: runtime.namespace,
    storage: runtime.storage,
    storageMode: diagnostics.storageMode,
    durable: diagnostics.durable,
    rehydrationStatus: diagnostics.rehydrationStatus,
    getStorageDiagnostics: runtime.getDiagnostics,
    getLocalPersistenceStatus: () => getLocalCanonicalPersistenceStatus(
      runtime.localPersistence,
    ),
    localPersistence: runtime.localPersistence,
    canonicalCacheAdapter: runtime.canonicalCacheAdapter,
    draftListenerRuntime: runtime.draftListenerRuntime,
    switchDraftRuntime,
  };

  return (
    <Provider store={runtime.store}>
      <QuestionnairePersistenceProvider value={persistenceContext}>
        {children}
      </QuestionnairePersistenceProvider>
    </Provider>
  );
}
