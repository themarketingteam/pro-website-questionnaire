import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import userEvent from '@testing-library/user-event';

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { renderWithStore } from './utils/renderWithStore';
import { QUESTIONS } from '@/components/pro-form/questionData';


function getQ(id) {
  return QUESTIONS.find(q => q.id === id) || QUESTIONS.flatMap(q => q.conditionalChildren || []).find(c => c.id === id);
}

describe('Optional child behavior: Q23.1 and Q25.1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('23.1 empty does not mark parent 23 incomplete (parent remains complete)', async () => {
    const preloaded = {
      form: {
        responses: { '23': 'yes' },
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '23': true, '23.1': true },
        credentials: {},
      },
    };
    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    expect(await screen.findByTestId('question-wrapper-23')).toBeInTheDocument();
    expect(await screen.findByTestId('question-wrapper-23.1')).toBeInTheDocument();

    await waitFor(() => {
      expect(store.getState().form.validationStatus['23']).toBe('complete');
    });
  });

  it('Typing into 23.1 and clearing it never oscillates parent 23 status from complete', async () => {
    const user = setupUser();
    const preloaded = {
      form: {
        responses: { '23': 'yes', '23.1': '' },
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '23': true, '23.1': true },
        credentials: {},
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    const wrapper = await screen.findByTestId('question-wrapper-23.1');
    const textarea = await within(wrapper).findByPlaceholderText(/enter your response/i);

    await waitFor(() => {
      expect(store.getState().form.validationStatus['23']).toBe('complete');
    });

    // Type and clear repeatedly
    await user.type(textarea, 'Some notes');
    await user.clear(textarea);
    await user.type(textarea, 'More');

    await waitFor(() => {
      expect(store.getState().form.validationStatus['23']).toBe('complete');
    });
  });

  it('Q25/25.1 behaves safely: empty and typing do not affect parent 25', async () => {
    const user = setupUser();
    const preloaded = {
      form: {
        responses: { '25': 'yes', '25.1': '' },
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '25': true, '25.1': true },
        credentials: {},
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    expect(await screen.findByTestId('question-wrapper-25')).toBeInTheDocument();
    const wrapper = await screen.findByTestId('question-wrapper-25.1');

    await waitFor(() => {
      expect(store.getState().form.validationStatus['25']).toBe('complete');
    });

    const textarea = await within(wrapper).findByPlaceholderText(/enter your response/i);

    await user.type(textarea, 'Additional info');

    await waitFor(() => {
      expect(store.getState().form.validationStatus['25']).toBe('complete');
    });
  });
});