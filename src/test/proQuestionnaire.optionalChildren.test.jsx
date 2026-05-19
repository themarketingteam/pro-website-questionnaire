import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import userEvent from '@testing-library/user-event';
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

    // Parent visible
    expect(await screen.findByText(getQ('23').title)).toBeInTheDocument();
    // Child visible and empty
    expect(await screen.findByText(getQ('23.1').title)).toBeInTheDocument();

    await waitFor(() => {
      expect(store.getState().form.validationStatus['23']).toBe('complete');
    });
  });

  it('Typing into 23.1 and clearing it never oscillates parent 23 status from complete', async () => {
    const user = userEvent.setup();
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
    const user = userEvent.setup();
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

    // Parent and child visible
    expect(await screen.findByText(getQ('25').title)).toBeInTheDocument();
    expect(await screen.findByText(getQ('25.1').title)).toBeInTheDocument();

    await waitFor(() => {
      expect(store.getState().form.validationStatus['25']).toBe('complete');
    });

    const wrapper = await screen.findByTestId('question-wrapper-25.1');
    const textarea = await within(wrapper).findByPlaceholderText(/enter your response/i);

    await user.type(textarea, 'Additional info');

    await waitFor(() => {
      expect(store.getState().form.validationStatus['25']).toBe('complete');
    });
  });
});