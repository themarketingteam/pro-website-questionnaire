import { useEffect, useMemo, useState } from 'react';
import { Provider } from 'react-redux';
import { createResilientStorage } from '@/lib/resilientStorage';
import { safeGetWindowLocationHref } from '@/lib/browserSafety';
import { safeRemoveSearchParameter } from '@/lib/app-params';
import {
  deriveQuestionnaireBrowserNamespace,
  readQuestionnaireIdentityFromUrl,
} from '@/lib/questionnaireBrowserNamespace';
import { createQuestionnaireStore } from './store/store';
import { resetForm } from './store/formSlice';
import { QuestionnairePersistenceProvider } from './store/QuestionnairePersistenceContext';

const questionnaireRuntimeCache = new Map();

const defaultStorageFactory = (_namespace) => createResilientStorage();

/**
 * @param {{
 *   namespace?: string,
 *   storageFactory?: (namespace?: string) => any,
 *   storeFactory?: (options?: any) => any,
 *   rehydrationTimeoutMs?: number,
 * }} [options]
 */
export const createQuestionnaireStoreRuntime = async ({
  namespace,
  storageFactory = defaultStorageFactory,
  storeFactory = createQuestionnaireStore,
  rehydrationTimeoutMs,
} = {}) => {
  const storage = storageFactory(namespace);
  try { await storage.probe?.(); } catch {}
  const runtime = storeFactory({ namespace, storage, rehydrationTimeoutMs });
  await runtime.ready;
  return runtime;
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
    Promise.resolve(runtimePromise).then((runtime) => runtime.persistor.pause()).catch(() => {});
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
  onRuntimeReady,
  useRuntimeCache = true,
}) {
  const resolvedHref = typeof locationHref === 'string'
    ? locationHref
    : safeGetWindowLocationHref();
  const namespace = useMemo(() => deriveQuestionnaireBrowserNamespace(
    readQuestionnaireIdentityFromUrl({ href: resolvedHref }),
  ), [resolvedHref]);
  const [runtime, setRuntime] = useState(null);

  useEffect(() => {
    let active = true;
    setRuntime(null);

    const options = {
      namespace,
      storageFactory,
      storeFactory,
      rehydrationTimeoutMs,
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
        try { await nextRuntime.persistor.purge(); } catch {}
        nextRuntime.store.dispatch(resetForm());
        try { await nextRuntime.persistor.flush(); } catch {}
        safeRemoveSearchParameter('resetFormState');
      }

      if (!active) return;
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
      });
      await fallbackRuntime.ready;
      if (active) setRuntime(fallbackRuntime);
    });

    return () => { active = false; };
  }, [
    namespace,
    onRuntimeReady,
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
  };

  return (
    <Provider store={runtime.store}>
      <QuestionnairePersistenceProvider value={persistenceContext}>
        {children}
      </QuestionnairePersistenceProvider>
    </Provider>
  );
}
