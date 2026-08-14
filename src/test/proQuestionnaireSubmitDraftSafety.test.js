import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSubmission: vi.fn(),
  invoke: vi.fn()
}));

vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: mocks.invoke } }
}));

vi.mock('@/components/pro-form/submissionPayload', () => ({
  transformResponsesToPayload: vi.fn(() => ({ metadata: {}, userdata: {} })),
  validateSubmissionPayload: vi.fn(() => ({ ok: true, errors: [] }))
}));

vi.mock('@/lib/proSubmissionResilience', () => ({
  createProFormSubmissionWithFallback: mocks.createSubmission,
  serializeSubmitError: vi.fn((error) => ({
    name: error?.name || 'Error',
    message: error?.message || 'submission failed',
    failureKind: error?.failureKind || 'server'
  }))
}));

vi.mock('@/lib/proPayloadRepair', () => ({
  repairProSubmissionPayload: vi.fn((payload) => ({
    ok: true,
    payload,
    warnings: [],
    errors: []
  }))
}));

vi.mock('@/lib/clarity', () => ({ trackClarityEvent: vi.fn() }));
vi.mock('@/lib/submitDebugFlags', () => ({
  getSubmitDebugFailureMode: vi.fn(() => ''),
  shouldSimulateSubmitFailure: vi.fn(() => false)
}));

import { submitProQuestionnaire, SubmitFlowError } from '@/lib/proQuestionnaireSubmit';

const baseArguments = (saveDraftNow) => ({
  businessName: 'Synthetic Company',
  domain: 'synthetic.invalid',
  responses: { '6': 'A complete synthetic answer' },
  validationStatus: { '6': 'complete' },
  touchedQuestions: { '6': true },
  expandedQuestions: { '6': true },
  credentials: {},
  questionnaireSessionId: 'synthetic-session',
  saveDraftNow,
  createDraftEvent: vi.fn(async () => null),
  serviceOptionsGrouped: {}
});

describe('final questionnaire draft safety barrier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({ data: { success: true } });
  });

  it('links a successful durable submission only after the required final draft save', async () => {
    const saveDraftNow = vi.fn(async (options) => ({
      draftId: 'draft-1',
      status: options.status,
      finalSubmissionId: options.finalSubmissionId || ''
    }));
    mocks.createSubmission.mockResolvedValue({
      ok: true,
      submission: { id: 'submission-1' },
      usedFallback: false,
      receivedViaIntake: false,
      zapierSent: true
    });

    await submitProQuestionnaire(baseArguments(saveDraftNow));

    expect(saveDraftNow.mock.calls[0][0]).toEqual(expect.objectContaining({
      status: 'submit_attempted',
      required: true,
      source: 'final_submission_barrier'
    }));
    expect(saveDraftNow).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      finalSubmissionId: 'submission-1',
      required: true,
      source: 'durable_submission_link'
    }));
  });

  it('keeps a failed final submission as a recoverable submit_failed draft', async () => {
    const saveDraftNow = vi.fn(async (options) => ({ draftId: 'draft-1', status: options.status }));
    mocks.createSubmission.mockResolvedValue({
      ok: false,
      failureKind: 'server',
      usedFallback: true,
      error: { message: 'database unavailable', failureKind: 'server' }
    });

    await expect(submitProQuestionnaire(baseArguments(saveDraftNow))).rejects.toBeInstanceOf(SubmitFlowError);

    expect(saveDraftNow.mock.calls[0][0]).toEqual(expect.objectContaining({
      status: 'submit_attempted',
      required: true,
      source: 'final_submission_barrier'
    }));
    expect(saveDraftNow).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submit_failed'
    }));
    expect(saveDraftNow).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted'
    }));
  });
});
