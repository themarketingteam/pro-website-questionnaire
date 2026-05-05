import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import userEvent from '@testing-library/user-event';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { renderWithStore } from './utils/renderWithStore';
import { QUESTIONS } from '@/components/pro-form/questionData';

// Mock base44 SDK
vi.mock('@/api/base44Client', () => {
  return {
    base44: {
      functions: {
        invoke: vi.fn(),
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

let base44;
beforeAll(async () => {
  ({ base44 } = await import('@/api/base44Client'));
});

function getQ(id) {
  return QUESTIONS.find(q => q.id === id);
}

describe('ProQuestionnaire regression: Q23/Q23.1 and Q25/25.1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Q23 answered Yes, then 23.1 expanded: renders without crash or loop', async () => {
    const preloaded = {
      form: {
        responses: { '23': 'yes' },
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '23': true },
        credentials: {},
      },
    };
    renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    // Parent present
    expect(await screen.findByText(getQ('23').title)).toBeInTheDocument();
    // Child 23.1 visible when parent expanded+yes
    expect(await screen.findByText(getQ('23').conditionalChildren[0].title)).toBeInTheDocument();
  });

  it('Persisted state with Q23=yes and 23.1 expanded rehydrates safely', async () => {
    const preloaded = {
      form: {
        responses: { '23': 'yes' },
        validationStatus: {},
        touchedQuestions: { '23': true },
        expandedQuestions: { '23': true, '23.1': true },
        credentials: {},
      },
    };

    renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    expect(await screen.findByText(getQ('23').title)).toBeInTheDocument();
    expect(await screen.findByText(getQ('23').conditionalChildren[0].title)).toBeInTheDocument();
  });

  it('Final validation uses canonical validateQuestionText payloads and keeps parent intact for optional child', async () => {
    const user = userEvent.setup();

    const invoke = base44.functions.invoke;
    invoke.mockImplementation(async (_name, payload) => {
      if (_name === 'validateQuestionText') {
        // Ensure canonical context
        expect(payload.questionContext === 'question_23_1' || payload.questionContext === 'question_25_1').toBe(true);
        return { status: 200, data: { status: 'complete', message: 'ok', characterCount: (payload.text||'').length } };
      }
      return { status: 200, data: {} };
    });

    const preloaded = {
      form: {
        responses: {
          '23': 'yes',
          '23.1': 'Some optional notes',
          '25': 'yes',
          '25.1': 'Additional info',
        },
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '23': true, '25': true },
        credentials: {},
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    const submit = await screen.findByRole('button', { name: /submit questionnaire/i });
    await user.click(submit);

    const calls = base44.functions.invoke.mock.calls.filter(c => c[0] === 'validateQuestionText');
    const contexts = calls.map(c => c[1].questionContext);
    expect(contexts).toContain('question_23_1');
    expect(contexts).toContain('question_25_1');

    // Optional child should not set parent 23 to incomplete
    const state = store.getState();
    expect(state.form.validationStatus['23']).not.toBe('incomplete');
  });

  it('Backend failure surfaces cleanly and sets textarea status to incomplete for submit-time validation', async () => {
    const user = userEvent.setup();

    const invoke = base44.functions.invoke;
    invoke.mockImplementationOnce(async () => { throw new Error('network down'); });

    const preloaded = {
      form: {
        responses: { '23': 'yes', '23.1': 'text' },
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '23': true },
        credentials: {},
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    const submit = await screen.findByRole('button', { name: /submit questionnaire/i });
    await user.click(submit);

    const status = store.getState().form.validationStatus['23.1'];
    expect(status).toBe('incomplete');
  });

  it('does not open the confirmation modal when final required textarea validation fails', async () => {
    const user = userEvent.setup();

    const invoke = base44.functions.invoke;
    invoke.mockImplementation(async (name) => {
      if (name === 'validateQuestionText') {
        throw new Error('network down');
      }
      return { status: 200, data: {} };
    });

    const preloaded = {
      form: {
        responses: {
          '1': 'yes',
          '1.1': 'Short bad answer',
          '2': 'no',
          '3': ['Managed IT'],
          '4': ['Healthcare / Medical'],
          '5': [{ label: 'Chicago, IL', name: 'Chicago, IL' }],
          '6': 'Company description',
          '7': 'Fully Managed IT Provider',
          '8': ['Per-user pricing'],
          '9': 'Differentiation text',
          '10': ['Increase recurring revenue'],
          '11': 'Professional & Corporate',
          '12': 'no',
          '13': 'Onboarding process',
          '14': 'no',
          '15': 'Referrals / Word of Mouth',
          '16': ['Generate qualified leads'],
          '17': '10-50 employees',
          '18': ['Frequent downtime or outages'],
          '19': 'Client frustrations',
          '20': ['Reliable systems and less downtime'],
          '21': 'Reliable and proactive',
          '22': 'Ideal client text',
          '23': 'no',
          '24': 'Schedule a Consultation',
          '25': 'no'
        },
        validationStatus: {
          '1': 'complete',
          '2': 'complete',
          '3': 'complete',
          '4': 'complete',
          '5': 'complete',
          '7': 'complete',
          '8': 'complete',
          '10': 'complete',
          '11': 'complete',
          '12': 'complete',
          '14': 'complete',
          '16': 'complete',
          '18': 'complete',
          '20': 'complete',
          '23': 'complete',
          '24': 'complete',
          '25': 'complete'
        },
        touchedQuestions: {},
        expandedQuestions: { '1': true },
        credentials: {},
        textValidationMeta: {}
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    const submit = await screen.findByRole('button', { name: /submit questionnaire/i });
    await user.click(submit);

    await waitFor(() => {
      expect(store.getState().form.validationStatus['1.1']).toBe('incomplete');
      expect(store.getState().form.touchedQuestions['1.1']).toBe(true);
    });

    expect(screen.queryByText(/review your answers/i)).not.toBeInTheDocument();
  });
});