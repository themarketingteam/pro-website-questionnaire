import { useEffect, useMemo, useRef, useState } from 'react';
import { createProDraftBootstrapCoordinator } from '../lib/proDraftBootstrapCoordinator.js';

const coordinatorByStore = new WeakMap();

const recordFor = (store, options) => {
  if (!store || (typeof store !== 'object' && typeof store !== 'function')) {
    return {
      coordinator: options.coordinator || createProDraftBootstrapCoordinator(options),
      mounts: 0,
      timer: null,
      bootstrapPromise: null,
    };
  }
  let record = coordinatorByStore.get(store);
  if (!record) {
    record = {
      coordinator: options.coordinator || createProDraftBootstrapCoordinator({ ...options, store }),
      mounts: 0,
      timer: null,
      bootstrapPromise: null,
    };
    coordinatorByStore.set(store, record);
  }
  return record;
};

export const resetProDraftBootstrapHookCacheForTests = () => {
  // WeakMap entries are intentionally not enumerable. Tests should use a fresh store.
};

export const useProDraftBootstrap = (options = {}) => {
  const optionsRef = useRef(options);
  const store = options.store;
  const record = useMemo(() => recordFor(store, optionsRef.current), [store]);
  const coordinator = record.coordinator;
  const [snapshot, setSnapshot] = useState(() => coordinator.getState());

  useEffect(() => {
    record.mounts += 1;
    if (record.timer !== null) {
      clearTimeout(record.timer);
      record.timer = null;
    }
    let mounted = true;
    const unsubscribe = coordinator.subscribe((next) => {
      if (mounted) setSnapshot(next);
    });
    if (!record.bootstrapPromise) {
      record.bootstrapPromise = Promise.resolve(
        coordinator.bootstrap(optionsRef.current.bootstrapInput),
      );
    }
    void record.bootstrapPromise.then((next) => {
      if (mounted) setSnapshot(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
      record.mounts -= 1;
      record.timer = setTimeout(() => {
        record.timer = null;
        if (record.mounts === 0) {
          coordinator.cancel();
          if (store) coordinatorByStore.delete(store);
        }
      }, 0);
    };
  }, [coordinator, record, store]);

  return Object.freeze({
    phase: snapshot.phase,
    outcome: snapshot.outcome,
    errorCode: snapshot.errorCode,
    draftSummary: snapshot.draftSummary || null,
    clientChoiceRequired: snapshot.clientChoiceRequired === true,
    readOnly: snapshot.readOnly === true,
    hasRecoveryCode: snapshot.hasRecoveryCode === true,
    memoryOnly: snapshot.memoryOnly === true,
    storageMode: snapshot.storageMode || 'unknown',
    mergeRequired: snapshot.mergeRequired === true,
    pendingServerSync: snapshot.pendingServerSync === true,
    createNewDraftAssociation: coordinator.createNewDraftAssociation,
    recoverDraftByEmail: coordinator.recoverDraftByEmail,
    recoverDraftByCode: coordinator.recoverDraftByCode,
    getRecoveryCodeForDisplay: coordinator.getRecoveryCodeForDisplay,
    getRecoveryCodeHint: coordinator.getRecoveryCodeHint,
    clearCurrentDraftCredentials: coordinator.clearCurrentDraftCredentials,
    replaceCurrentDraftCredentials: coordinator.replaceCurrentDraftCredentials,
    coordinator,
  });
};

export default useProDraftBootstrap;
