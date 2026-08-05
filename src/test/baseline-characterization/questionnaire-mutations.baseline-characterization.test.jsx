import React from 'react';
import { Provider } from 'react-redux';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { store, persistor } from '@/components/store/store';
import { loadInitialState } from '@/components/store/formSlice';
import { createFindExistingDraftBySessionId } from '@/lib/draftPersistence';

const REDUX_STORAGE_KEY = 'persist:pro-questionnaire-root';
const SESSION_STORAGE_KEY = 'pro_questionnaire_session_id';

const completeFormState = (overrides = {}) => ({
  responses: {},
  validationStatus: {},
  touchedQuestions: {},
  expandedQuestions: {},
  credentials: {},
  textValidationMeta: {},
  ...overrides,
});

const waitForBootstrap = () => {
  if (persistor.getState().bootstrapped) return Promise.resolve();

  return new Promise((resolve) => {
    const unsubscribe = persistor.subscribe(() => {
      if (persistor.getState().bootstrapped) {
        unsubscribe();
        resolve();
      }
    });
  });
};

const renderQuestionnaire = async () => {
  let rendered;

  await act(async () => {
    rendered = render(
      <Provider store={store}>
        <ProQuestionnaire />
      </Provider>
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  return rendered;
};

const readPersistedResponses = () => {
  const root = JSON.parse(localStorage.getItem(REDUX_STORAGE_KEY));
  return JSON.parse(root.responses);
};

const makeLocation = (label, placeId) => ({
  name: label,
  label,
  lat: 35.1,
  lon: -86.7,
  place_id: placeId,
  source: 'google',
  originalName: label,
  originalLabel: label,
  isGreaterArea: false,
  isCity: true,
});

let base44;

describe('baseline characterization: questionnaire mutation bypasses', () => {
  beforeAll(async () => {
    ({ base44 } = await import('@/api/base44Client'));
    await waitForBootstrap();
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    window.history.replaceState(
      {},
      '',
      '/?businessName=Synthetic%20Mutation%20Client&domainName=mutation.invalid'
    );
    localStorage.setItem(SESSION_STORAGE_KEY, 'synthetic-stable-session');

    window.google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({}),
        places: {
          PlaceAutocompleteElement: function PlaceAutocompleteElement() {
            return document.createElement('div');
          },
        },
      },
    };

    store.dispatch(loadInitialState(completeFormState()));
    await persistor.flush();

    base44.entities.ProFormDraft.filter.mockReset().mockResolvedValue([]);
    base44.entities.ProFormDraft.create.mockReset().mockResolvedValue({ id: 'synthetic-draft' });
    base44.entities.ProFormDraft.update.mockReset().mockResolvedValue({ id: 'synthetic-draft' });
    base44.entities.ProFormDraftEvent.create.mockReset().mockResolvedValue({ id: 'synthetic-event' });
  });

  it('[BC-Q5-001][DR-MUT-001][DR-LOCAL-001] adds a location to Redux/browser but not draft/event', async () => {
    store.dispatch(loadInitialState(completeFormState({ expandedQuestions: { '5': true } })));
    await renderQuestionnaire();

    fireEvent.click(await screen.findByRole('button', { name: /add manually/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter location manually/i), {
      target: { value: 'Synthetic City, XY' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(store.getState().form.responses['5']).toHaveLength(1));
    await persistor.flush();

    expect(readPersistedResponses()['5'][0].label).toBe('Synthetic City, XY');
    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).not.toHaveBeenCalled();
  });

  it('[BC-Q5-002][DR-MUT-001][DR-LOCAL-001] updates a location in Redux/browser but not draft/event', async () => {
    store.dispatch(loadInitialState(completeFormState({
      responses: { '5': [makeLocation('Synthetic City, XY', 'synthetic-place-a')] },
      validationStatus: { '5': 'complete' },
      expandedQuestions: { '5': true },
    })));
    await renderQuestionnaire();

    fireEvent.click(await screen.findByRole('checkbox', { name: /greater area/i }));

    await waitFor(() => {
      expect(store.getState().form.responses['5'][0].isGreaterArea).toBe(true);
    });
    await persistor.flush();

    expect(readPersistedResponses()['5'][0].name).toBe('Greater Synthetic City Area');
    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).not.toHaveBeenCalled();
  });

  it('[BC-Q5-003][DR-MUT-001][DR-LOCAL-001] sets primary in Redux/browser but not draft/event', async () => {
    store.dispatch(loadInitialState(completeFormState({
      responses: {
        '5': [
          makeLocation('Synthetic City A, XY', 'synthetic-place-a'),
          makeLocation('Synthetic City B, XY', 'synthetic-place-b'),
        ],
        '5_primary': 0,
      },
      validationStatus: { '5': 'complete' },
      expandedQuestions: { '5': true },
    })));
    await renderQuestionnaire();

    fireEvent.click(await screen.findByTitle('Set as primary'));

    await waitFor(() => expect(store.getState().form.responses['5_primary']).toBe(1));
    await persistor.flush();

    expect(readPersistedResponses()['5_primary']).toBe(1);
    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).not.toHaveBeenCalled();
  });

  it('[BC-Q5-004][DR-MUT-001][DR-LOCAL-001] removes a location and repairs primary only in Redux/browser', async () => {
    store.dispatch(loadInitialState(completeFormState({
      responses: {
        '5': [
          makeLocation('Synthetic City A, XY', 'synthetic-place-a'),
          makeLocation('Synthetic City B, XY', 'synthetic-place-b'),
        ],
        '5_primary': 1,
      },
      validationStatus: { '5': 'complete' },
      expandedQuestions: { '5': true },
    })));
    await renderQuestionnaire();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Remove' }))[0]);

    await waitFor(() => {
      expect(store.getState().form.responses['5']).toHaveLength(1);
      expect(store.getState().form.responses['5_primary']).toBe(0);
    });
    await persistor.flush();

    expect(readPersistedResponses()['5']).toHaveLength(1);
    expect(readPersistedResponses()['5_primary']).toBe(0);
    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).not.toHaveBeenCalled();
  });

  it('[BC-RESET-001][DR-MUT-001] resets response/auxiliary browser state without a server snapshot or event', async () => {
    store.dispatch(loadInitialState(completeFormState({
      responses: { '7': 'Other', '7_other': 'Synthetic delivery model' },
      validationStatus: { '7': 'complete' },
      touchedQuestions: { '7': true },
      expandedQuestions: { '7': true },
    })));
    await renderQuestionnaire();

    const wrapper = await screen.findByTestId('question-wrapper-7');
    fireEvent.click(within(wrapper).getByRole('button', { name: /reset question/i }));

    await waitFor(() => {
      expect(store.getState().form.responses['7']).toBeUndefined();
      expect(store.getState().form.responses['7_other']).toBeUndefined();
      expect(store.getState().form.validationStatus['7']).toBe('incomplete');
    });
    await persistor.flush();

    expect(readPersistedResponses()['7']).toBeUndefined();
    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).not.toHaveBeenCalled();
  });

  it('[BC-CLEAR-001][DR-CLEAR-001][DR-CLEAR-002] clears Redux but queues no empty server snapshot and retains the session', async () => {
    store.dispatch(loadInitialState(completeFormState({
      responses: { '6': 'Synthetic answer to clear' },
      validationStatus: { '6': 'complete' },
      touchedQuestions: { '6': true },
      expandedQuestions: { '6': true },
    })));
    await persistor.flush();
    await renderQuestionnaire();

    fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /yes, clear all/i }));

    expect(store.getState().form.responses).toEqual({});
    expect(readPersistedResponses()['6']).toBe('Synthetic answer to clear');
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe('synthetic-stable-session');
    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('[BC-CLEAR-002][DR-CLEAR-001] can rediscover the old server draft because the session ID is unchanged', async () => {
    const draftRecordIdRef = { current: '' };
    const filter = vi.fn().mockResolvedValue([{
      id: 'synthetic-old-draft',
      session_id: 'synthetic-stable-session',
      responses_json: JSON.stringify({ '6': 'Synthetic old answer' }),
    }]);
    const findExistingDraft = createFindExistingDraftBySessionId({ draftRecordIdRef });

    const found = await findExistingDraft({
      sessionId: localStorage.getItem(SESSION_STORAGE_KEY),
      entities: { ProFormDraft: { filter } },
    });

    expect(found.id).toBe('synthetic-old-draft');
    expect(filter).toHaveBeenCalledWith({ session_id: 'synthetic-stable-session' });
  });

  it('[BC-COND-001][DR-MUT-001][DR-SAVE-001] cleans hidden child browser state but cancels the queued server snapshot', async () => {
    store.dispatch(loadInitialState(completeFormState({
      responses: { '1': 'yes', '1.1': 'Synthetic child answer' },
      validationStatus: { '1': 'complete', '1.1': 'complete' },
      touchedQuestions: { '1': true, '1.1': true },
      expandedQuestions: { '1': true, '1.1': true },
      textValidationMeta: {
        '1.1': { lastValidatedValue: 'Synthetic child answer', isDirty: false },
      },
    })));
    await renderQuestionnaire();

    const parent = await screen.findByTestId('question-wrapper-1');
    vi.useFakeTimers();
    fireEvent.click(within(parent).getByLabelText('No'));

    const form = store.getState().form;
    expect(form.responses['1']).toBe('no');
    expect(form.responses['1.1']).toBeUndefined();
    expect(form.validationStatus['1.1']).toBeUndefined();
    expect(form.touchedQuestions['1.1']).toBe(false);
    expect(form.expandedQuestions['1.1']).toBe(false);
    expect(form.textValidationMeta['1.1']).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(base44.entities.ProFormDraft.filter).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).toHaveBeenCalled();

    vi.useRealTimers();
    await persistor.flush();
    expect(readPersistedResponses()['1.1']).toBeUndefined();
  });
});
