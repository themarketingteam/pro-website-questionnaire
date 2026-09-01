import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { renderWithStore } from './utils/renderWithStore';
import { base44 } from '@/api/base44Client';

const CREDENTIAL = 'integration_session_1234567890.abcdefghijklmnopqrstuvwxyzABCDEFGH';
const REPLACEMENT_CREDENTIAL = 'replacement_session_1234567890.HGFEDCBAabcdefghijklmnopqrstuvwxyz';

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
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

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

  it('does not merge another draft\'s persisted Redux answers into an explicit shared link', async () => {
    window.history.replaceState({}, '', `/#draft=${CREDENTIAL}`);
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        return {
          data: {
            success: true,
            resumeCredential: CREDENTIAL,
            draft: draftResponse({ responses: {}, expandedQuestions: {} })
          }
        };
      }
      return { data: { success: true, draft: draftResponse({ responses: payload.responses }) } };
    });

    const { store } = renderWithStore(<ProQuestionnaire />, {
      preloadedState: {
        form: {
          responses: { '6': 'Stale answer from a different draft' },
          validationStatus: { '6': 'complete' },
          touchedQuestions: { '6': true },
          expandedQuestions: { '6': true },
          credentials: {},
          textValidationMeta: {}
        }
      }
    });

    await screen.findByRole('button', { name: 'Submit Questionnaire' });
    await waitFor(() => {
      expect(store.getState().form.responses['6']).toBeUndefined();
    });
    const saveCalls = base44.functions.invoke.mock.calls.filter(([, payload]) => payload?.action === 'save');
    saveCalls.forEach(([, payload]) => {
      expect(payload.responses?.['6']).toBeUndefined();
    });
  });

  it('keeps the form locked while Base44 is unavailable and recovers through Retry now', async () => {
    let bootstrapRequests = 0;
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        bootstrapRequests += 1;
        if (bootstrapRequests <= 3) throw Object.assign(new Error('Failed to fetch'), { status: 503 });
        return {
          data: {
            success: true,
            resumeCredential: CREDENTIAL,
            draft: draftResponse()
          }
        };
      }
      return { data: { success: true, draft: draftResponse({ revision: payload.clientSequence }) } };
    });

    renderWithStore(<ProQuestionnaire />);

    expect(await screen.findByText('Reconnecting secure draft saving…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Questionnaire' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(await screen.findByRole('button', { name: 'Submit Questionnaire' })).toBeInTheDocument();
    expect(bootstrapRequests).toBe(4);
  });

  it('automatically retries bootstrap when an offline browser comes back online', async () => {
    let bootstrapRequests = 0;
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        bootstrapRequests += 1;
        if (bootstrapRequests <= 3) throw new TypeError('Failed to fetch while offline');
        return {
          data: {
            success: true,
            resumeCredential: CREDENTIAL,
            draft: draftResponse()
          }
        };
      }
      return { data: { success: true, draft: draftResponse({ revision: payload.clientSequence }) } };
    });

    renderWithStore(<ProQuestionnaire />);
    expect(await screen.findByText('Reconnecting secure draft saving…')).toBeInTheDocument();
    fireEvent(window, new Event('online'));
    expect(await screen.findByRole('button', { name: 'Submit Questionnaire' })).toBeInTheDocument();
    expect(bootstrapRequests).toBe(4);
  });

  it('locks and re-bootstrap saves current answers when a draft credential is rejected', async () => {
    let bootstrapRequests = 0;
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        bootstrapRequests += 1;
        return {
          data: {
            success: true,
            resumeCredential: bootstrapRequests === 1 ? CREDENTIAL : REPLACEMENT_CREDENTIAL,
            draft: draftResponse({
              sessionId: bootstrapRequests === 1
                ? 'integration_session_1234567890'
                : 'replacement_session_1234567890',
              expandedQuestions: { '6': true }
            })
          }
        };
      }
      if (
        payload.action === 'save'
        && payload.resumeCredential === CREDENTIAL
        && payload.responses?.['6']
      ) {
        throw Object.assign(new Error('Credential rejected'), { status: 401 });
      }
      return {
        data: {
          success: true,
          draft: draftResponse({
            revision: payload.clientSequence,
            responses: payload.responses,
            lastSavedAt: new Date().toISOString()
          })
        }
      };
    });

    renderWithStore(<ProQuestionnaire />);
    const question = await screen.findByTestId('question-wrapper-6');
    fireEvent.change(within(question).getByRole('textbox'), { target: { value: 'Preserve during re-bootstrap' } });

    await waitFor(() => {
      expect(bootstrapRequests).toBe(2);
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'syncProQuestionnaireDraft',
        expect.objectContaining({
          action: 'save',
          resumeCredential: REPLACEMENT_CREDENTIAL,
          responses: expect.objectContaining({ '6': 'Preserve during re-bootstrap' })
        })
      );
    });
    expect(screen.getByRole('button', { name: 'Submit Questionnaire' })).toBeInTheDocument();
  });

  it('reports a database-unconfirmed save persistently when local storage is also blocked', async () => {
    const originalSetItem = localStorage.setItem;
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      value: () => { throw new DOMException('Blocked', 'SecurityError'); }
    });
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
      throw Object.assign(new Error('Draft rejected'), { status: 400 });
    });

    const view = renderWithStore(<ProQuestionnaire />);
    try {
      const question = await screen.findByTestId('question-wrapper-6');
      fireEvent.change(within(question).getByRole('textbox'), { target: { value: 'Must reach the database' } });
      expect(await screen.findByText(/database has not confirmed this change, and this browser blocked/i)).toBeInTheDocument();
      expect(screen.getByText('Save interrupted')).toBeInTheDocument();
      expect(window.location.hash).toContain('draft=');
    } finally {
      view.unmount();
      Object.defineProperty(localStorage, 'setItem', { configurable: true, value: originalSetItem });
    }
  });

  it('flushes the latest pending answer when a mobile browser backgrounds the page', async () => {
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
      return { data: { success: true, draft: draftResponse({ revision: payload.clientSequence, responses: payload.responses }) } };
    });

    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    renderWithStore(<ProQuestionnaire />);
    const question = await screen.findByTestId('question-wrapper-6');
    fireEvent.change(within(question).getByRole('textbox'), { target: { value: 'Background-safe answer' } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'syncProQuestionnaireDraft',
        expect.objectContaining({
          action: 'save',
          source: 'visibility_flush',
          responses: expect.objectContaining({ '6': 'Background-safe answer' })
        })
      );
    });
    if (originalVisibilityState) Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    else delete document.visibilityState;
  });

  it('retries a transient rejected answer save in the background until the database confirms it', async () => {
    let answerSaveRequests = 0;
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
      if (payload.action === 'save' && payload.responses?.['6']) {
        answerSaveRequests += 1;
        if (answerSaveRequests <= 3) throw Object.assign(new Error('Temporary Base44 outage'), { status: 503 });
      }
      return {
        data: {
          success: true,
          draft: draftResponse({
            revision: payload.clientSequence,
            responses: payload.responses,
            lastSavedAt: new Date().toISOString()
          })
        }
      };
    });

    renderWithStore(<ProQuestionnaire />);
    const question = await screen.findByTestId('question-wrapper-6');
    fireEvent.change(within(question).getByRole('textbox'), { target: { value: 'Retry this answer' } });

    await waitFor(() => expect(answerSaveRequests).toBe(4));
    const answerSaveCalls = base44.functions.invoke.mock.calls.filter(([, payload]) => (
      payload?.action === 'save' && payload.responses?.['6'] === 'Retry this answer'
    ));
    expect(answerSaveCalls.at(-1)[1].source).toBe('background_retry');
  });

  it('uses a keepalive request when the tab closes immediately after an answer', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchMock;
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
      return { data: { success: true, draft: draftResponse({ revision: payload.clientSequence }) } };
    });

    const view = renderWithStore(<ProQuestionnaire />);
    try {
      const question = await screen.findByTestId('question-wrapper-6');
      fireEvent.change(within(question).getByRole('textbox'), { target: { value: 'Close-safe answer' } });
      window.dispatchEvent(new Event('pagehide'));
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/functions/syncProQuestionnaireDraft'),
        expect.objectContaining({ keepalive: true })
      );
      const request = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
      expect(request.source).toBe('pagehide_flush');
      expect(request.changedKeys).toContain('6');
      expect(request.responses['6']).toBe('Close-safe answer');
    } finally {
      view.unmount();
      globalThis.fetch = originalFetch;
    }
  });

  it('sends business identity with the first server-side draft bootstrap', async () => {
    window.history.replaceState({}, '', '/?businessName=Managed%20247&domainName=https%3A%2F%2Fmanaged247.example');
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        return {
          data: {
            success: true,
            resumeCredential: CREDENTIAL,
            draft: draftResponse({ credentials: payload.credentials })
          }
        };
      }
      return { data: { success: true, draft: draftResponse({ revision: payload.clientSequence }) } };
    });

    renderWithStore(<ProQuestionnaire />);
    await screen.findByRole('button', { name: 'Submit Questionnaire' });
    expect(base44.functions.invoke).toHaveBeenCalledWith(
      'syncProQuestionnaireDraft',
      expect.objectContaining({
        action: 'bootstrap',
        credentials: expect.objectContaining({
          businessName: 'Managed 247',
          domain: 'managed247.example'
        })
      })
    );
  });
  it('synchronizes newer URL identity into an existing server draft immediately after restore', async () => {
    window.history.replaceState(
      {},
      '',
      `/?businessName=Updated%20Business&domainName=updated.example#draft=${CREDENTIAL}`
    );
    base44.functions.invoke.mockImplementation(async (name, payload) => {
      if (name !== 'syncProQuestionnaireDraft') return { data: { success: true } };
      if (payload.action === 'bootstrap') {
        return {
          data: {
            success: true,
            resumeCredential: CREDENTIAL,
            draft: draftResponse({
              credentials: {
                businessName: 'Prior Business',
                domain: 'prior.example',
                userId: '',
                userName: '',
                userEmail: ''
              }
            })
          }
        };
      }
      return {
        data: {
          success: true,
          draft: draftResponse({
            revision: payload.clientSequence,
            credentials: payload.credentials,
            responses: payload.responses
          })
        }
      };
    });

    renderWithStore(<ProQuestionnaire />);
    await screen.findByRole('button', { name: 'Submit Questionnaire' });
    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'syncProQuestionnaireDraft',
        expect.objectContaining({
          action: 'save',
          source: 'identity_sync',
          credentials: expect.objectContaining({
            businessName: 'Updated Business',
            domain: 'updated.example'
          })
        })
      );
    });
  });
});
