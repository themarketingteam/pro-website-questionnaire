import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { renderWithStore } from './utils/renderWithStore';
import { QUESTIONS } from '@/components/pro-form/questionData';

// Mock base44 SDK
vi.mock('@/api/base44Client', () => {
  return {
    base44: {
      functions: {
        invoke: vi.fn().mockResolvedValue({ status: 200, data: { status: 'needs_work', message: 'ok', characterCount: 5 } }),
      },
      entities: {
        ProFormSubmission: { create: vi.fn().mockResolvedValue({ id: 'x' }) }
      },
      auth: {
        isAuthenticated: vi.fn().mockResolvedValue(true),
        me: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
      },
      analytics: { track: vi.fn() },
      connectors: { connectAppUser: vi.fn(), disconnectAppUser: vi.fn() },
      users: { inviteUser: vi.fn() }
    },
  };
});

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

    // Parent status should be computed as complete (no required children)
    const state = store.getState();
    expect(state.form.validationStatus['23']).toBe('complete');
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

    // Locate the 23.1 textarea using its section container (by child title)
    const childHeading = await screen.findByText(getQ('23.1').title);
    const container = childHeading.closest('section, div');
    const scope = container ? within(container) : screen;
    const textarea = await scope.findByPlaceholderText(/enter your response/i);

    // Initial parent status is complete
    expect(store.getState().form.validationStatus['23']).toBe('complete');

    // Type and clear repeatedly
    await user.type(textarea, 'Some notes');
    await user.clear(textarea);
    await user.type(textarea, 'More');

    // Parent remains complete (no oscillation)
    expect(store.getState().form.validationStatus['23']).toBe('complete');
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

    // Parent is complete initially
    expect(store.getState().form.validationStatus['25']).toBe('complete');

    // Type into 25.1 and ensure parent stays complete
    const childHeading = await screen.findByText(getQ('25.1').title);
    const container = childHeading.closest('section, div');
    const scope = container ? within(container) : screen;
    const textarea = await scope.findByPlaceholderText(/enter your response/i);

    await user.type(textarea, 'Additional info');

    expect(store.getState().form.validationStatus['25']).toBe('complete');
  });
});