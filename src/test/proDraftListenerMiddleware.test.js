import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';
import formReducer, {
  applyFormMutation,
  loadCanonicalDraftState,
  setResponse,
  setTouchedQuestion,
  setValidationStatus,
} from '@/components/store/formSlice';
import { createProDraftListenerRuntime } from '@/components/store/proDraftListenerMiddleware';
import { createDraftMutationMetadata } from '@/components/store/formMutationFactory';
import { createEmptyCanonicalDraftState } from '@/lib/questionnaireDraftState';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const setup = () => {
  const listener = createProDraftListenerRuntime({
    now: () => Date.parse('2026-08-06T12:00:00.000Z'),
    crypto: null,
    random: () => 0.25,
  });
  const store = configureStore({
    reducer: { form: formReducer },
    middleware: (defaults) => defaults().prepend(listener.middleware),
  });
  const manager = {
    capturePostReducerMutation: vi.fn(),
    queueEvent: vi.fn(),
  };
  listener.attachManager(manager);
  return { listener, manager, store };
};

describe('proDraftListenerMiddleware', () => {
  it('runs after reducers and coalesces one logical synchronous interaction', async () => {
    const { manager, store } = setup();
    store.dispatch(setResponse({ questionId: '6', value: 'answer' }));
    store.dispatch(setValidationStatus({ questionId: '6', status: 'complete' }));
    store.dispatch(setTouchedQuestion({ questionId: '6', touched: true }));
    await settle();

    expect(manager.capturePostReducerMutation).toHaveBeenCalledTimes(1);
    expect(store.getState().form.responses['6']).toBe('answer');
    expect(store.getState().form.validationStatus['6']).toBe('complete');
    expect(store.getState().form.touchedQuestions['6']).toBe(true);
    expect(store.getState().form.draftContext.clientRevision).toBe(1);
    expect(store.getState().form.lastChangedQuestionId).toBe('6');
  });

  it('does not schedule hydration or create a hydration loop', async () => {
    const { manager, store } = setup();
    store.dispatch(loadCanonicalDraftState(createEmptyCanonicalDraftState(), {
      source: 'browser',
      completedAt: '2026-08-06T12:00:00.000Z',
      namespace: 'listener-test',
      lastStateHash: null,
      storageMode: 'memory_only',
    }));
    await settle();
    expect(manager.capturePostReducerMutation).not.toHaveBeenCalled();
  });

  it('does not add a second revision to an atomic mutation', async () => {
    const { manager, store } = setup();
    store.dispatch(applyFormMutation({
      setResponses: { '5': [{ name: 'Austin' }] },
      setValidationStatus: { '5': 'complete' },
      setTouchedQuestions: { '5': true },
      lastChangedQuestionId: '5',
      mutationMetadata: createDraftMutationMetadata({
        mutationId: '11111111111111111111111111111111',
        mutationType: 'location_add',
        reason: 'response_change',
        changedAtClient: '2026-08-06T12:00:00.000Z',
        sourceTabId: null,
        baseServerRevision: 0,
      }),
    }));
    await settle();
    expect(store.getState().form.draftContext.clientRevision).toBe(1);
    expect(manager.capturePostReducerMutation).toHaveBeenCalledTimes(1);
    expect(manager.capturePostReducerMutation.mock.calls[0][0].mutationType)
      .toBe('location_add');
  });
});
