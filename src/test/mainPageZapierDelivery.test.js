import { beforeEach, describe, expect, it, vi } from 'vitest';

const transformedPayload = {
  metadata: {
    business_name: 'Live Client',
    businessDomain: 'live-client.example',
  },
  userdata: { question_1: 'answer' },
};

vi.mock('@/components/pro-form/submissionPayload', () => ({
  transformResponsesToPayload: vi.fn(() => transformedPayload),
  validateSubmissionPayload: vi.fn(() => ({ ok: true, errors: [] })),
}));

vi.mock('@/lib/proPayloadRepair', () => ({
  repairProSubmissionPayload: vi.fn((payload) => ({
    ok: true,
    payload,
    warnings: [],
    errors: [],
  })),
}));

vi.mock('@/lib/proSubmissionResilience', () => ({
  createProFormSubmissionWithFallback: vi.fn(async () => ({
    ok: true,
    submission: { id: 'submission-live-1' },
    usedFallback: false,
    receivedViaIntake: false,
    zapierSent: false,
  })),
  serializeSubmitError: vi.fn((error) => ({
    message: error?.message || String(error || 'Unknown error'),
    failureKind: 'unknown',
  })),
}));

vi.mock('@/lib/clarity', () => ({
  trackClarityEvent: vi.fn(),
}));

import { base44 } from '@/api/base44Client';
import { submitProQuestionnaire } from '@/lib/proQuestionnaireSubmit';

describe('main-page Zapier delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for the Zapier function before reporting final submission success', async () => {
    let resolveZapier;
    const zapierResponse = new Promise((resolve) => {
      resolveZapier = resolve;
    });
    base44.functions.invoke.mockImplementation(async (name) => {
      if (name === 'sendToZapier') return await zapierResponse;
      return { data: { success: true } };
    });

    const onFinalSubmitSuccess = vi.fn();
    const submissionPromise = submitProQuestionnaire({
      businessName: 'Live Client',
      domain: 'live-client.example',
      responses: { '1': 'answer' },
      validationStatus: { '1': 'complete' },
      touchedQuestions: {},
      expandedQuestions: {},
      credentials: {},
      questionnaireSessionId: 'session-live-1',
      saveDraftNow: vi.fn(async () => ({ id: 'draft-live-1' })),
      createDraftEvent: vi.fn(async () => ({ id: 'event-live-1' })),
      onFinalSubmitSuccess,
    });

    await vi.waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith('sendToZapier', transformedPayload);
    });
    expect(onFinalSubmitSuccess).not.toHaveBeenCalled();

    resolveZapier({ data: { success: true } });
    await submissionPromise;

    expect(onFinalSubmitSuccess).toHaveBeenCalledOnce();
  });

  it('uses only the injected V2 sync/event path and suppresses legacy draft entity writes', async () => {
    base44.functions.invoke.mockResolvedValue({ data: { success: true } });
    const saveDraftNow = vi.fn(async ({ status }) => ({
      id: status === 'submitted' ? 'submission-live-1' : 'draft-live-1',
    }));
    const createDraftEvent = vi.fn(async () => ({ accepted: true }));

    await submitProQuestionnaire({
      businessName: 'Live Client',
      domain: 'live-client.example',
      responses: { '1': 'answer' },
      validationStatus: { '1': 'complete' },
      touchedQuestions: {},
      expandedQuestions: {},
      credentials: {},
      questionnaireSessionId: 'session-live-1',
      saveDraftNow,
      createDraftEvent,
      legacyDraftPersistenceEnabled: false,
    });

    expect(saveDraftNow).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submit_attempted',
    }));
    expect(saveDraftNow).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      finalSubmissionId: 'submission-live-1',
    }));
    expect(createDraftEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'submitted',
    }));
    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).not.toHaveBeenCalled();
  });
});
