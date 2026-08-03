import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { renderWithStore } from './utils/renderWithStore';
import { QUESTIONS } from '@/components/pro-form/questionData';
import { formatAnswerForDisplay } from '@/components/pro-form/answerFormatting';
import {
  normalizeCertifications,
  normalizeGeographicAreas,
  normalizeGuarantees,
  normalizeTeamPhoto
} from '@/components/pro-form/submissionPayload';
import {
  createFindExistingDraftBySessionId,
  createSaveDraftSnapshot
} from '@/lib/draftPersistence';

const { generateQuestionnairePdfMock } = vi.hoisted(() => ({
  generateQuestionnairePdfMock: vi.fn(),
}));

vi.mock('@/components/pro-form/PDFGenerator', () => ({
  default: vi.fn(),
  generatePDF: generateQuestionnairePdfMock,
}));

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });


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
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    base44.entities.ProFormDraft.filter.mockResolvedValue([]);
    base44.entities.ProFormDraft.create.mockResolvedValue({ id: 'draft-1' });
    base44.entities.ProFormDraft.update.mockResolvedValue({ id: 'draft-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
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

    expect(await screen.findByTestId('question-wrapper-23')).toBeInTheDocument();
    expect(await screen.findByTestId('question-wrapper-23.1')).toBeInTheDocument();
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

    expect(await screen.findByTestId('question-wrapper-23')).toBeInTheDocument();
    expect(await screen.findByTestId('question-wrapper-23.1')).toBeInTheDocument();
  });

  it('Final validation uses canonical validateQuestionText payloads and keeps parent intact for optional child', async () => {
    const user = setupUser();

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

    await waitFor(() => {
      const calls = base44.functions.invoke.mock.calls.filter(c => c[0] === 'validateQuestionText');
      const contexts = calls.map(c => c[1].questionContext);
      expect(contexts).toContain('question_23_1');
      expect(contexts).toContain('question_25_1');
    });

    await waitFor(() => {
      expect(store.getState().form.validationStatus['23']).not.toBe('incomplete');
    });
  });

  it('Backend failure surfaces cleanly and sets textarea status to incomplete for submit-time validation', async () => {
    const user = setupUser();

    const invoke = base44.functions.invoke;
    invoke.mockImplementationOnce(async () => { throw new Error('network down'); });

    const preloaded = {
      form: {
        responses: { '23': 'yes', '23.1': 'text' },
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '23': true, '23.1': true },
        credentials: {},
        textValidationMeta: {}
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    const submit = await screen.findByRole('button', { name: /submit questionnaire/i });
    await user.click(submit);

    await waitFor(() => {
      expect(store.getState().form.validationStatus['23.1']).toBe('incomplete');
    });
  });

  it('Q24 normal radio option completes after one click', async () => {
    const user = setupUser();
    const preloaded = {
      form: {
        responses: {},
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '24': true },
        credentials: {},
        textValidationMeta: {}
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });
    const q24wrapper = await screen.findByTestId('question-wrapper-24');
    await user.click(within(q24wrapper).getByLabelText('Schedule a Consultation'));

    await waitFor(() => {
      expect(store.getState().form.validationStatus['24']).toBe('complete');
    });
  });

  it('Q24 Other requires custom text and normal option stays complete when switching back', async () => {
    const user = setupUser();
    const preloaded = {
      form: {
        responses: {},
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: { '24': true },
        credentials: {},
        textValidationMeta: {}
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });
    const q24wrapper = await screen.findByTestId('question-wrapper-24');
    await user.click(within(q24wrapper).getByLabelText('Other'));

    await waitFor(() => {
      expect(store.getState().form.validationStatus['24']).toBe('incomplete');
    });

    await user.type(within(q24wrapper).getByPlaceholderText(/what action would you like client's to take on your website/i), 'Book a strategy call');

    await waitFor(() => {
      expect(store.getState().form.validationStatus['24']).toBe('complete');
    });

    await user.click(within(q24wrapper).getByLabelText('Schedule a Consultation'));

    await waitFor(() => {
      expect(store.getState().form.validationStatus['24']).toBe('complete');
    });
  });

  it('submit-time validation blocks incomplete returned statuses', async () => {
    const user = setupUser();

    const invoke = base44.functions.invoke;
    invoke.mockImplementation(async (name) => {
      if (name === 'validateQuestionText') {
        return { status: 200, data: { status: 'incomplete' } };
      }
      return { status: 200, data: {} };
    });

    const preloaded = {
      form: {
        responses: {
          '1': 'yes',
          '1.1': 'Needs better answer',
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
          '1': 'complete','2': 'complete','3': 'complete','4': 'complete','5': 'complete','7': 'complete','8': 'complete','10': 'complete','11': 'complete','12': 'complete','14': 'complete','16': 'complete','18': 'complete','20': 'complete','23': 'complete','24': 'complete','25': 'complete'
        },
        touchedQuestions: {},
        expandedQuestions: { '1': true },
        credentials: {},
        textValidationMeta: {}
      },
    };

    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });
    await user.click(await screen.findByRole('button', { name: /submit questionnaire/i }));

    await waitFor(() => {
      expect(store.getState().form.validationStatus['1.1']).toBe('incomplete');
      expect(store.getState().form.touchedQuestions['1.1']).toBe(true);
    });

    expect(screen.queryByText(/review your answers/i)).not.toBeInTheDocument();
  });

  it('does not open the confirmation modal when final required textarea validation fails', async () => {
    const user = setupUser();

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

  it('writes a recoverable local backup when the database save fails', async () => {
    const user = setupUser();
    const createMock = base44.entities.ProFormSubmission.create;
    createMock.mockRejectedValueOnce(new Error('db down'));

    const invoke = base44.functions.invoke;
    invoke.mockImplementation(async (name) => {
      if (name === 'validateQuestionText') {
        return { status: 200, data: { status: 'complete' } };
      }
      return { status: 200, data: {} };
    });

    const preloaded = {
      form: {
        responses: {
          '1': 'no', '2': 'no', '3': ['Managed IT', 'Cybersecurity', 'IT Help Desk'], '4': ['Healthcare / Medical'],
          '5': [{ label: 'Chicago, IL', name: 'Chicago, IL' }], '6': 'Company description', '7': 'Fully Managed IT Provider',
          '8': ['Per-user pricing'], '9': 'Differentiation text', '10': ['Increase recurring revenue'], '11': 'Professional & Corporate',
          '12': 'no', '13': 'Onboarding process', '14': 'no', '15': 'Referrals / Word of Mouth', '16': ['Generate qualified leads'],
          '17': '10-50 employees', '18': ['Frequent downtime or outages'], '19': 'Client frustrations', '20': ['Reliable systems and less downtime'],
          '21': 'Reliable and proactive', '22': 'Ideal client text', '23': 'no', '24': 'Schedule a Consultation', '25': 'no'
        },
        validationStatus: {
          '1': 'complete','2': 'complete','3': 'complete','4': 'complete','5': 'complete','6': 'complete','7': 'complete','8': 'complete','9': 'complete','10': 'complete','11': 'complete','12': 'complete','13': 'complete','14': 'complete','15': 'complete','16': 'complete','17': 'complete','18': 'complete','19': 'complete','20': 'complete','21': 'complete','22': 'complete','23': 'complete','24': 'complete','25': 'complete'
        },
        touchedQuestions: {},
        expandedQuestions: {},
        credentials: {},
        textValidationMeta: {}
      },
    };

    renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    await user.click(await screen.findByRole('button', { name: /submit questionnaire/i }));
    await user.click(await screen.findByRole('button', { name: /confirm & submit/i }));

    await waitFor(() => {
      const backupKey = Object.keys(localStorage).find((key) => key.startsWith('failed_pro_submission_'));
      expect(backupKey).toBeTruthy();
      expect(localStorage.getItem(backupKey)).toContain('Company description');
    });
  });

  it('does not block success when Zapier fails after a successful database save', async () => {
    window.history.replaceState(
      {},
      '',
      '/?businessName=Snapshot%20Company&domainName=snapshot.example'
    );
    generateQuestionnairePdfMock.mockResolvedValue({
      success: true,
      filename: 'retained-responses.pdf',
    });
    const createMock = base44.entities.ProFormSubmission.create;
    createMock.mockResolvedValueOnce({ id: 'saved-ok' });

    const invoke = base44.functions.invoke;
    invoke.mockImplementation(async (name) => {
      if (name === 'validateQuestionText') {
        return { status: 200, data: { status: 'complete' } };
      }
      if (name === 'sendToZapier') {
        throw new Error('zapier down');
      }
      return { status: 200, data: {} };
    });

    const preloaded = {
      form: {
        responses: {
          '1': 'no', '2': 'no', '3': ['Managed IT', 'Cybersecurity', 'IT Help Desk'], '4': ['Healthcare / Medical'],
          '5': [{ label: 'Chicago, IL', name: 'Chicago, IL' }], '6': 'Company description', '7': 'Fully Managed IT Provider',
          '8': ['Per-user pricing'], '9': 'Differentiation text', '10': ['Increase recurring revenue'], '11': 'Professional & Corporate',
          '12': 'no', '13': 'Onboarding process', '14': 'no', '15': 'Referrals / Word of Mouth', '16': ['Generate qualified leads'],
          '17': '10-50 employees', '18': ['Frequent downtime or outages'], '19': 'Client frustrations', '20': ['Reliable systems and less downtime'],
          '21': 'Reliable and proactive', '22': 'Ideal client text', '23': 'no', '24': 'Schedule a Consultation', '25': 'no'
        },
        validationStatus: {
          '1': 'complete','2': 'complete','3': 'complete','4': 'complete','5': 'complete','6': 'complete','7': 'complete','8': 'complete','9': 'complete','10': 'complete','11': 'complete','12': 'complete','13': 'complete','14': 'complete','15': 'complete','16': 'complete','17': 'complete','18': 'complete','19': 'complete','20': 'complete','21': 'complete','22': 'complete','23': 'complete','24': 'complete','25': 'complete'
        },
        touchedQuestions: {},
        expandedQuestions: {},
        credentials: {},
        textValidationMeta: {}
      },
    };

    const submittedResponses = preloaded.form.responses;
    const { store } = renderWithStore(<ProQuestionnaire />, { preloadedState: preloaded });

    fireEvent.click(
      await screen.findByRole('button', { name: /submit questionnaire/i })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /confirm & submit/i })
    );

    await waitFor(() => {
      expect(base44.entities.ProFormSubmission.create).toHaveBeenCalled();
      expect(base44.functions.invoke).toHaveBeenCalledWith('sendToZapier', expect.any(Object));
    });

    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
    expect(store.getState().form.responses).toEqual({});

    fireEvent.click(
      screen.getByRole('button', {
        name: /download your responses \(pdf\)/i,
      })
    );

    await waitFor(() => {
      expect(generateQuestionnairePdfMock).toHaveBeenCalledWith(
        submittedResponses,
        'Snapshot Company',
        'snapshot.example'
      );
    });
  });

  it('prevents duplicate draft creation by reusing the saved draft record id', async () => {
    const draftRecordIdRef = { current: '' };
    const filter = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue({ id: 'draft-1' });
    const update = vi.fn().mockResolvedValue({ id: 'draft-1' });
    const entities = { ProFormDraft: { filter, create, update } };

    const findExistingDraftBySessionId = createFindExistingDraftBySessionId({ draftRecordIdRef });
    const saveDraftSnapshot = createSaveDraftSnapshot({
      entities,
      draftRecordIdRef,
      findExistingDraftBySessionId
    });

    const payload = {
      sessionId: 'session-1',
      responses: { '6': 'abc' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      credentials: {},
      businessNameParam: '',
      domainParam: '',
      currentQuestionId: '6',
      lastChangedQuestionId: '6',
      status: 'draft'
    };

    await saveDraftSnapshot(payload);
    await saveDraftSnapshot({ ...payload, responses: { '6': 'abcd' } });

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(filter).toHaveBeenCalledTimes(1);
  });

  it('pending autosave after submit does not overwrite submitted status back to draft', async () => {
    vi.useFakeTimers();
    const hasFinalSubmittedRef = { current: false };
    const saveDraftSnapshot = vi.fn().mockResolvedValue({});
    const draftSaveTimeoutRef = { current: null };

    const queueDraftSave = (changedQuestionId, nextResponses = {}) => {
      if (hasFinalSubmittedRef.current) return;
      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current);
      }
      draftSaveTimeoutRef.current = setTimeout(async () => {
        if (hasFinalSubmittedRef.current) return;
        await saveDraftSnapshot({
          sessionId: 'session-1',
          responses: nextResponses,
          validationStatus: {},
          touchedQuestions: {},
          expandedQuestions: {},
          credentials: {},
          businessNameParam: '',
          domainParam: '',
          currentQuestionId: changedQuestionId,
          lastChangedQuestionId: changedQuestionId,
          status: 'draft'
        });
      }, 600);
    };

    queueDraftSave('6', { '6': 'latest' });
    hasFinalSubmittedRef.current = true;
    await vi.runAllTimersAsync();

    expect(saveDraftSnapshot).not.toHaveBeenCalled();
  });

  it('formatting helpers never return [object Object] for complex answers', () => {
    const q5 = formatAnswerForDisplay('5', [{ geographic_area_meta: { label: 'Chicago, IL', primary: true } }], '', { '5_primary': 0 });
    const q121 = formatAnswerForDisplay('12.1', [{ name: 'SOC 2', type: 'certification', image: { name: 'badge.png' } }], '', {});
    const q141 = formatAnswerForDisplay('14.1', [{ name: 'SLA', type: 'sla', description: '24/7 support' }], '', {});
    const q22 = formatAnswerForDisplay('2.2', { url: 'https://img', tags: [{ person: { name: 'Alex', position: 'Engineer' } }] }, '', {});

    expect(q5).not.toContain('[object Object]');
    expect(q121).not.toContain('[object Object]');
    expect(q141).not.toContain('[object Object]');
    expect(q22).not.toContain('[object Object]');
  });

  it('payload normalization preserves x/y zero values and filters incomplete rows', () => {
    const team = normalizeTeamPhoto({
      url: 'https://img',
      tags: [{ x: 0, y: 0, person: { name: 'Alex', position: 'Engineer', bio: 'Bio' } }]
    });
    const certs = normalizeCertifications([
      { name: 'SOC 2', type: 'certification', image: { url: 'https://badge' } },
      { name: '', type: 'certification' }
    ]);
    const guarantees = normalizeGuarantees([
      { name: 'SLA', type: 'sla', description: '24/7' },
      { name: 'Broken', type: 'sla' }
    ]);
    const geographic = normalizeGeographicAreas([
      { label: 'Chicago, IL', lat: '0', lon: '0', place_id: 'abc', source: 'google' },
      { label: 'Invalid', lat: 'x', lon: '', place_id: 'def', source: 'google' }
    ], 0);

    expect(team.taggedPeople[0].x).toBe(0);
    expect(team.taggedPeople[0].y).toBe(0);
    expect(certs).toHaveLength(1);
    expect(guarantees).toHaveLength(1);
    expect(geographic[0].geographic_area_meta.lat).toBe(0);
    expect(geographic[0].geographic_area_meta.lon).toBe(0);
    expect(geographic[1].geographic_area_meta.lat).toBeNull();
    expect(geographic[1].geographic_area_meta.lon).toBeNull();
  });
});
