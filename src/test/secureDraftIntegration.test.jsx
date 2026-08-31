import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { renderWithStore } from './utils/renderWithStore';
import { base44 } from '@/api/base44Client';

const CREDENTIAL = 'integration_session_1234567890.abcdefghijklmnopqrstuvwxyzABCDEFGH';

const draftResponse = (overrides = {}) => ({
  draftId: 'integration-draft-1',
  sessionId: 'integration_session_1234567890',
  revision: 0,
  responses: {},
  validationStatus: {},
  touchedQuestions: {},
  expandedQuestions: {},
  credentials: {},
  status: 'draft',
  currentQuestionId: '',
  lastSavedAt: new Date().toISOString(),
  ...overrides
});

describe('secure questionnaire draft integration', () => {
  it('restores authoritative server answers before showing the questionnaire', async () => {
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        return {
          data: {
            success: true,
            resumeCredential: CREDENTIAL,
            draft: draftResponse({
              responses: { '6': 'Restored from the database' },
              validationStatus: { '6': 'complete' },
              touchedQuestions: { '6': true },
              expandedQuestions: { '6': true },
              currentQuestionId: '6'
            })
          }
        };
      }
      return { data: { success: true, draft: draftResponse({ responses: payload.responses }) } };
    });

    renderWithStore(<ProQuestionnaire />);
    const question = await screen.findByTestId('question-wrapper-6');
    expect(within(question).getByRole('textbox')).toHaveValue('Restored from the database');
  });

  it('coalesces rapid typing and persists the newest answer with ordered save metadata', async () => {
    const stored = {};
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        return {
          data: {
            success: true,
            resumeCredential: CREDENTIAL,
            draft: draftResponse({ expandedQuestions: { '6': true } })
          }
        };
      }
      if (payload.action === 'save') {
        Object.assign(stored, payload.responses);
        return {
          data: {
            success: true,
            draft: draftResponse({
              revision: payload.clientSequence,
              responses: { ...stored },
              lastSavedAt: new Date().toISOString()
            })
          }
        };
      }
      return { data: { success: true } };
    });

    renderWithStore(<ProQuestionnaire />, {
      preloadedState: {
        form: {
          responses: {},
          validationStatus: {},
          touchedQuestions: {},
          expandedQuestions: { '6': true },
          credentials: {},
          textValidationMeta: {}
        }
      }
    });
    const question = await screen.findByTestId('question-wrapper-6');
    const input = within(question).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.change(input, { target: { value: 'first, then newest' } });

    await waitFor(() => {
      const saveCalls = base44.functions.invoke.mock.calls.filter(([, payload]) => payload?.action === 'save');
      expect(saveCalls.length).toBeGreaterThan(0);
      expect(saveCalls.at(-1)[1]).toEqual(expect.objectContaining({
        responses: expect.objectContaining({ '6': 'first, then newest' }),
        changedKeys: expect.arrayContaining(['6'])
      }));
      expect(saveCalls.at(-1)[1].clientSequence).toBeGreaterThan(0);
    });
  });

  it('records an intentionally cleared answer as an explicit deletion', async () => {
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        return {
          data: {
            success: true,
            resumeCredential: CREDENTIAL,
            draft: draftResponse({
              responses: { '6': 'Previously saved answer' },
              expandedQuestions: { '6': true }
            })
          }
        };
      }
      return {
        data: {
          success: true,
          draft: draftResponse({
            revision: payload.clientSequence,
            responses: {},
            lastSavedAt: new Date().toISOString()
          })
        }
      };
    });

    renderWithStore(<ProQuestionnaire />);
    const question = await screen.findByTestId('question-wrapper-6');
    fireEvent.change(within(question).getByRole('textbox'), { target: { value: '' } });

    await waitFor(() => {
      const saveCalls = base44.functions.invoke.mock.calls.filter(([, payload]) => payload?.action === 'save');
      expect(saveCalls.length).toBeGreaterThan(0);
      expect(saveCalls.at(-1)[1].deletedKeys).toContain('6');
    });
  });
});
