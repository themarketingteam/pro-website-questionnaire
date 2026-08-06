import { createListenerMiddleware } from '@reduxjs/toolkit';
import { recordPostReducerMutation } from './formSlice';
import {
  PRO_DRAFT_RELEVANT_ACTION_TYPES,
  coalesceProDraftMutations,
  mapProDraftActionToMutation,
} from '@/lib/proDraftMutationMetadata';
import { mapDraftMutationToEvent } from '@/lib/proDraftEventMapper';

const queueMicrotaskSafe = (callback) => {
  if (typeof globalThis.queueMicrotask === 'function') globalThis.queueMicrotask(callback);
  else Promise.resolve().then(callback);
};

/** Creates one listener registry for one questionnaire store. */
export const createProDraftListenerRuntime = (options = {}) => {
  const listenerMiddleware = createListenerMiddleware();
  let manager = null;
  let pending = [];
  let flushQueued = false;
  const eventTimers = new Map();
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const diagnostics = {
    capturedActionCount: 0,
    capturedMutationCount: 0,
    hydrationSkipCount: 0,
    readOnlySkipCount: 0,
  };

  const queueEvent = (mapping) => {
    if (!mapping || !manager?.queueEvent) return;
    if (mapping.debounceMs <= 0) {
      manager.queueEvent(mapping.event);
      return;
    }
    const previous = eventTimers.get(mapping.debounceKey);
    if (previous) clearTimer(previous);
    eventTimers.set(mapping.debounceKey, setTimer(() => {
      eventTimers.delete(mapping.debounceKey);
      manager?.queueEvent?.(mapping.event);
    }, mapping.debounceMs));
  };

  const flush = (api) => {
    flushQueued = false;
    const entries = pending;
    pending = [];
    const mutation = coalesceProDraftMutations(entries, options);
    if (!mutation || !manager) return;
    const form = api.getState()?.form || {};
    if (form.draftContext?.draftStatus === 'submitted'
      || form.draftSyncStatus?.state === 'submitted') {
      diagnostics.readOnlySkipCount += 1;
      return;
    }
    if (!mutation.alreadyRecorded) api.dispatch(recordPostReducerMutation(mutation));
    diagnostics.capturedMutationCount += 1;
    manager.capturePostReducerMutation?.(mutation);
    queueEvent(mapDraftMutationToEvent(mutation));
  };

  listenerMiddleware.startListening({
    predicate: (action) => PRO_DRAFT_RELEVANT_ACTION_TYPES.has(action.type),
    effect: (action, api) => {
      const mapped = mapProDraftActionToMutation(action);
      diagnostics.capturedActionCount += 1;
      if (!mapped || mapped.hydration) {
        if (mapped?.hydration) diagnostics.hydrationSkipCount += 1;
        return;
      }
      pending.push(mapped);
      if (!flushQueued) {
        flushQueued = true;
        queueMicrotaskSafe(() => flush(api));
      }
    },
  });

  return Object.freeze({
    middleware: listenerMiddleware.middleware,
    attachManager(nextManager) {
      manager = nextManager || null;
      return () => { if (manager === nextManager) manager = null; };
    },
    dispose() {
      manager = null;
      pending = [];
      for (const timer of eventTimers.values()) clearTimer(timer);
      eventTimers.clear();
      listenerMiddleware.clearListeners();
    },
    getDiagnostics: () => Object.freeze({
      ...diagnostics,
      managerAttached: Boolean(manager),
      pendingActionCount: pending.length,
      pendingEventCount: eventTimers.size,
      accessesTokens: false,
    }),
  });
};

export default createProDraftListenerRuntime;
