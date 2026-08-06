import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSelector, useStore } from 'react-redux';
import { useQuestionnairePersistence } from '@/components/store/QuestionnairePersistenceContext';
import { selectDraftContext } from '@/components/store/draftSelectors';
import { createProDraftCredentialVault } from '@/lib/proDraftCredentialVault';
import { proDraftApiClient } from '@/lib/proDraftApiClient';
import {
  createProFormDraftSyncManager,
  getSafeDraftSyncDiagnostics,
} from '@/lib/proFormDraftSyncManager';
import { frontendRuntimeConfig } from '@/lib/proDraftRuntimeConfig';
import { createProDraftTabCoordinator } from '@/lib/proDraftTabCoordinator';
import { createLocalCanonicalDraftPersistence } from '@/components/store/localCanonicalDraftPersistence';

const EMPTY_STATUS = Object.freeze({
  state: 'idle',
  active: false,
  online: true,
  storageMode: 'unknown',
  pending: false,
  inFlight: false,
  retryCount: 0,
  errorCode: null,
  lastLocalSavedAt: null,
  lastServerSavedAt: null,
  confirmedClientRevision: null,
  confirmedServerRevision: null,
  isReadOnly: false,
  hasConflict: false,
  locked: false,
  disposed: false,
  eventQueueSize: 0,
  eventRetryCount: 0,
  eventErrorCode: null,
  pagehideStrategy: 'not_attempted',
});

const NOOP_ASYNC = async (..._args) => EMPTY_STATUS;
const DEFAULT_CONTEXT = Object.freeze({
  scheduleSave: (..._args) => EMPTY_STATUS,
  flush: NOOP_ASYNC,
  queueEvent: (..._args) => false,
  flushEvents: NOOP_ASYNC,
  syncStatus: EMPTY_STATUS,
  lastServerSavedAt: null,
  isReadOnly: false,
  hasConflict: false,
  pendingConflict: null,
  resolveConflictChoices: NOOP_ASYNC,
  retryNow: NOOP_ASYNC,
  markSubmitAttempted: NOOP_ASYNC,
  markSubmitFailed: NOOP_ASYNC,
  markSubmitted: NOOP_ASYNC,
  cancelPendingOrdinaryWork: (..._args) => EMPTY_STATUS,
  replacementLifecycle: null,
  enabled: false,
});

const ProDraftSyncContext = createContext(/** @type {any} */ (DEFAULT_CONTEXT));
const recordsByStore = new WeakMap();

const storeRecords = (store) => {
  let records = recordsByStore.get(store);
  if (!records) {
    records = new Map();
    recordsByStore.set(store, records);
  }
  return records;
};

const recordFor = ({ store, draftKey, createManager }) => {
  const records = storeRecords(store);
  let record = records.get(draftKey);
  if (!record) {
    record = {
      manager: createManager(),
      mounts: 0,
      disposeTimer: null,
    };
    records.set(draftKey, record);
  }
  return record;
};

const EnabledProDraftSyncProvider = ({
  children,
  runtimeConfig = frontendRuntimeConfig,
  pendingServerSync = false,
  managerFactory = createProFormDraftSyncManager,
  draftApiClient = proDraftApiClient,
  eventApiClient = draftApiClient,
  credentialVault: credentialVaultOverride = undefined,
  conflictAdapter = undefined,
  tabCoordinator: tabCoordinatorOverride = undefined,
  lifecycleAdapter = undefined,
  managerOptions = {},
}) => {
  const store = useStore();
  const persistence = useQuestionnairePersistence();
  const draftContext = useSelector(selectDraftContext);
  const activeNamespace = draftContext.namespace || persistence.namespace;
  const draftKey = `${activeNamespace}:${draftContext.draftId || draftContext.sessionId || 'draft-pending'}`;
  const credentialVault = useMemo(() => (
    credentialVaultOverride || createProDraftCredentialVault({
      storage: persistence.storage,
      environment: runtimeConfig.environment,
      browserNamespace: activeNamespace,
    })
  ), [
    credentialVaultOverride,
    activeNamespace,
    persistence.storage,
    runtimeConfig.environment,
  ]);
  const tabCoordinator = useMemo(() => (
    tabCoordinatorOverride || createProDraftTabCoordinator({
      namespace: activeNamespace,
    })
  ), [activeNamespace, tabCoordinatorOverride]);
  const activeLocalPersistence = useMemo(() => (
    activeNamespace === persistence.namespace
      ? persistence.localPersistence
      : createLocalCanonicalDraftPersistence({
        store,
        namespace: activeNamespace,
        storage: persistence.storage,
        cacheAdapter: persistence.canonicalCacheAdapter,
      })
  ), [
    activeNamespace,
    persistence.canonicalCacheAdapter,
    persistence.localPersistence,
    persistence.namespace,
    persistence.storage,
    store,
  ]);
  const coordinatorConflictAdapter = useMemo(() => Object.freeze({
    handleConflict(details) {
      tabCoordinator.broadcast({
        type: 'conflict_detected',
        status: 'conflict',
        serverRevision: details?.conflicts?.[0]?.serverMetadata?.serverRevision,
      });
    },
    broadcastAcceptedRevision(details) {
      tabCoordinator.broadcast({
        type: 'server_revision_accepted',
        status: 'saved',
        clientRevision: details?.clientRevision,
        serverRevision: details?.serverRevision,
        stateHash: details?.stateHash,
      });
    },
    broadcastLocalRevision(details) {
      tabCoordinator.broadcast({ type: 'local_revision_changed', ...details, status: 'active' });
    },
    broadcastSaveInProgress(details) {
      tabCoordinator.broadcast({ type: 'save_in_progress', ...details, status: 'saving' });
    },
    broadcastTerminalStatus(details) {
      tabCoordinator.broadcast({
        type: details?.status === 'submitted' ? 'draft_submitted' : 'draft_superseded',
        ...details,
        status: details?.status === 'submitted' ? 'submitted' : 'superseded',
      });
    },
  }), [tabCoordinator]);
  const stableInputs = useRef({
    managerFactory,
    draftApiClient,
    eventApiClient,
    credentialVault,
    conflictAdapter: conflictAdapter || coordinatorConflictAdapter,
    tabCoordinator,
    lifecycleAdapter,
    managerOptions,
    pendingServerSync,
    persistence,
    activeLocalPersistence,
    runtimeConfig,
    store,
  });
  stableInputs.current = {
    managerFactory,
    draftApiClient,
    eventApiClient,
    credentialVault,
    conflictAdapter: conflictAdapter || coordinatorConflictAdapter,
    tabCoordinator,
    lifecycleAdapter,
    managerOptions,
    pendingServerSync,
    persistence,
    activeLocalPersistence,
    runtimeConfig,
    store,
  };
  const record = useMemo(() => recordFor({
    store,
    draftKey,
    createManager: () => {
      const inputs = stableInputs.current;
      return inputs.managerFactory({
        store: inputs.store,
        namespace: activeNamespace,
        storage: inputs.persistence.storage,
        localPersistence: inputs.activeLocalPersistence,
        canonicalCache: inputs.persistence.canonicalCacheAdapter,
        credentialVault: inputs.credentialVault,
        draftApiClient: inputs.draftApiClient,
        eventApiClient: inputs.eventApiClient,
        environment: inputs.runtimeConfig.environment,
        scheduleInitialSave: inputs.pendingServerSync,
        observeStoreChanges: false,
        ...(inputs.conflictAdapter ? { conflictAdapter: inputs.conflictAdapter } : {}),
        sourceTabId: inputs.tabCoordinator.getSourceTabId(),
        ...(inputs.lifecycleAdapter ? { lifecycleAdapter: inputs.lifecycleAdapter } : {}),
        ...inputs.managerOptions,
      });
    },
  }), [activeNamespace, draftKey, store]);
  const [syncStatus, setSyncStatus] = useState(() => record.manager.getStatus());

  useEffect(() => {
    tabCoordinator.start();
    const unsubscribeTabs = tabCoordinator.subscribe(record.manager.handleTabMessage);
    record.mounts += 1;
    if (record.disposeTimer !== null) {
      clearTimeout(record.disposeTimer);
      record.disposeTimer = null;
    }
    const unsubscribe = record.manager.subscribeStatus(setSyncStatus);
    const detachListener = persistence.draftListenerRuntime?.attachManager?.(record.manager)
      || (() => {});
    setSyncStatus(record.manager.start());
    return () => {
      unsubscribe();
      detachListener();
      unsubscribeTabs();
      tabCoordinator.stop();
      record.mounts -= 1;
      record.disposeTimer = setTimeout(() => {
        record.disposeTimer = null;
        if (record.mounts !== 0) return;
        void record.manager.dispose();
        const records = recordsByStore.get(store);
        records?.delete(draftKey);
        if (records?.size === 0) recordsByStore.delete(store);
      }, 0);
    };
  }, [draftKey, persistence.draftListenerRuntime, record, store, tabCoordinator]);

  const value = useMemo(() => Object.freeze({
    scheduleSave: record.manager.scheduleSave,
    flush: record.manager.flush,
    queueEvent: record.manager.queueEvent,
    flushEvents: record.manager.flushEvents,
    syncStatus,
    lastServerSavedAt: syncStatus.lastServerSavedAt,
    isReadOnly: syncStatus.isReadOnly,
    hasConflict: syncStatus.hasConflict,
    pendingConflict: record.manager.getPendingConflict?.() || null,
    resolveConflictChoices: record.manager.resolveConflictChoices || NOOP_ASYNC,
    retryNow: () => record.manager.saveImmediately('manual_save', { force: true }),
    markSubmitAttempted: record.manager.markSubmitAttempted,
    markSubmitFailed: record.manager.markSubmitFailed,
    markSubmitted: record.manager.markSubmitted,
    cancelPendingOrdinaryWork: record.manager.cancelPendingOrdinaryWork,
    replacementLifecycle: Object.freeze({
      flush: record.manager.flush,
      saveImmediately: record.manager.saveImmediately,
      stop: record.manager.stop,
      start: record.manager.start,
      invalidateAfterSupersession: record.manager.invalidateAfterSupersession,
      dispose: record.manager.dispose,
      getStatus: record.manager.getStatus,
      getDraftIdentity: record.manager.getDraftIdentity,
    }),
    getSafeDiagnostics: () => getSafeDraftSyncDiagnostics(record.manager),
    enabled: true,
  }), [record.manager, syncStatus]);

  return (
    <ProDraftSyncContext.Provider value={value}>
      {children}
    </ProDraftSyncContext.Provider>
  );
};

export const ProDraftSyncProvider = ({ children, enabled = true, ...props }) => {
  if (!enabled) {
    return (
      <ProDraftSyncContext.Provider value={DEFAULT_CONTEXT}>
        {children}
      </ProDraftSyncContext.Provider>
    );
  }
  return (
    <EnabledProDraftSyncProvider {...props}>
      {children}
    </EnabledProDraftSyncProvider>
  );
};

export const useProDraftSyncContext = () => useContext(ProDraftSyncContext);

export default ProDraftSyncProvider;
