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
  syncStatus: EMPTY_STATUS,
  lastServerSavedAt: null,
  isReadOnly: false,
  hasConflict: false,
  retryNow: NOOP_ASYNC,
  markSubmitAttempted: NOOP_ASYNC,
  markSubmitFailed: NOOP_ASYNC,
  markSubmitted: NOOP_ASYNC,
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
  lifecycleAdapter = undefined,
  managerOptions = {},
}) => {
  const store = useStore();
  const persistence = useQuestionnairePersistence();
  const draftContext = useSelector(selectDraftContext);
  const draftKey = draftContext.draftId || draftContext.sessionId || 'draft-pending';
  const credentialVault = useMemo(() => (
    credentialVaultOverride || createProDraftCredentialVault({
      storage: persistence.storage,
      environment: runtimeConfig.environment,
      browserNamespace: persistence.namespace,
    })
  ), [
    credentialVaultOverride,
    persistence.namespace,
    persistence.storage,
    runtimeConfig.environment,
  ]);
  const stableInputs = useRef({
    managerFactory,
    draftApiClient,
    eventApiClient,
    credentialVault,
    conflictAdapter,
    lifecycleAdapter,
    managerOptions,
    pendingServerSync,
    persistence,
    runtimeConfig,
    store,
  });
  stableInputs.current = {
    managerFactory,
    draftApiClient,
    eventApiClient,
    credentialVault,
    conflictAdapter,
    lifecycleAdapter,
    managerOptions,
    pendingServerSync,
    persistence,
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
        namespace: inputs.persistence.namespace,
        storage: inputs.persistence.storage,
        localPersistence: inputs.persistence.localPersistence,
        canonicalCache: inputs.persistence.canonicalCacheAdapter,
        credentialVault: inputs.credentialVault,
        draftApiClient: inputs.draftApiClient,
        eventApiClient: inputs.eventApiClient,
        environment: inputs.runtimeConfig.environment,
        scheduleInitialSave: inputs.pendingServerSync,
        ...(inputs.conflictAdapter ? { conflictAdapter: inputs.conflictAdapter } : {}),
        ...(inputs.lifecycleAdapter ? { lifecycleAdapter: inputs.lifecycleAdapter } : {}),
        ...inputs.managerOptions,
      });
    },
  }), [draftKey, store]);
  const [syncStatus, setSyncStatus] = useState(() => record.manager.getStatus());

  useEffect(() => {
    record.mounts += 1;
    if (record.disposeTimer !== null) {
      clearTimeout(record.disposeTimer);
      record.disposeTimer = null;
    }
    const unsubscribe = record.manager.subscribeStatus(setSyncStatus);
    setSyncStatus(record.manager.start());
    return () => {
      unsubscribe();
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
  }, [draftKey, record, store]);

  const value = useMemo(() => Object.freeze({
    scheduleSave: record.manager.scheduleSave,
    flush: record.manager.flush,
    queueEvent: record.manager.queueEvent,
    syncStatus,
    lastServerSavedAt: syncStatus.lastServerSavedAt,
    isReadOnly: syncStatus.isReadOnly,
    hasConflict: syncStatus.hasConflict,
    retryNow: () => record.manager.saveImmediately('manual_save', { force: true }),
    markSubmitAttempted: record.manager.markSubmitAttempted,
    markSubmitFailed: record.manager.markSubmitFailed,
    markSubmitted: record.manager.markSubmitted,
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
