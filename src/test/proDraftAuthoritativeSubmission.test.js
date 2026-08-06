import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';
import formReducer, { loadCanonicalDraftState, setDraftSubmitted } from '@/components/store/formSlice';
import { selectCanonicalDraftState } from '@/components/store/draftSelectors';
import {
  createEmptyCanonicalDraftState,
  hashCanonicalDraftState,
  normalizeCanonicalDraftState,
} from '@/lib/questionnaireDraftState';
import {
  PRO_DRAFT_SUBMISSION_VERSION,
  SUBMISSION_ERROR_CODES,
  SUBMISSION_PHASES,
  createProDraftSubmissionCoordinator,
  getSafeSubmissionDiagnostics,
  prepareFinalSubmissionSnapshot,
  recoverFailedSubmissionState,
} from '@/lib/proDraftSubmissionCoordinator';
import {
  SUBMITTED_PDF_ERROR_CODES,
  generateSubmittedQuestionnairePdf,
  getSafeSubmittedPdfDiagnostics,
  prepareSubmittedPdfSource,
} from '@/lib/proDraftSubmittedPdfService';

const NOW = '2026-08-06T12:00:00.000Z';
const NAMESPACE = `ns_${'a'.repeat(32)}`;

const activeCanonical = (overrides = {}) => normalizeCanonicalDraftState({
  ...createEmptyCanonicalDraftState(),
  draftId: 'draft-authoritative-1',
  sessionId: 'session-authoritative-1',
  responses: { '1': 'yes', '1.1': 'A durable answer', '3': ['Managed IT'] },
  credentials: { businessName: 'Example MSP', domain: 'example.test' },
  ...overrides,
});

const createStore = (canonical = activeCanonical()) => {
  const store = configureStore({ reducer: { form: formReducer } });
  store.dispatch(loadCanonicalDraftState(canonical, {
    source: 'server',
    completedAt: NOW,
    namespace: NAMESPACE,
    storageMode: 'indexeddb',
  }));
  return store;
};

const successfulHarness = () => {
  const store = createStore();
  const hash = 'b'.repeat(64);
  const syncManager = {
    flush: vi.fn(async () => ({ state: 'server_saved' })),
    cancelPendingOrdinaryWork: vi.fn(),
    markSubmitAttempted: vi.fn(async () => ({ state: 'server_saved' })),
    markSubmitFailed: vi.fn(async () => ({ state: 'server_saved' })),
    markSubmitted: vi.fn(async (finalSubmissionId) => {
      store.dispatch(setDraftSubmitted({
        draftId: 'draft-authoritative-1',
        finalSubmissionId,
        submittedAt: NOW,
        submittedStateHash: hash,
        pdfSourceStateHash: hash,
        pdfAvailable: true,
        submissionLockPending: false,
      }));
      return { state: 'submitted', confirmedStateHash: hash };
    }),
  };
  const externalSubmit = vi.fn(async () => ({ savedSubmission: { id: 'submission-1' } }));
  return { store, syncManager, externalSubmit };
};

describe('authoritative submission coordinator', () => {
  it('exports the complete ten-phase contract', () => {
    expect(PRO_DRAFT_SUBMISSION_VERSION).toBe(1);
    expect(SUBMISSION_PHASES).toHaveLength(10);
    expect(SUBMISSION_PHASES).toEqual([
      'idle', 'validating', 'saving_validation_state', 'flushing_draft',
      'locking_submit_attempted', 'submitting', 'saving_submitted',
      'saving_submit_failed', 'completed', 'failed',
    ]);
  });

  it('creates an immutable canonical and mapped snapshot', async () => {
    const snapshot = await prepareFinalSubmissionSnapshot({ canonicalState: activeCanonical() });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.canonicalState)).toBe(true);
    expect(Object.isFrozen(snapshot.mappedPayload)).toBe(true);
  });

  it('stamps draft, session, environment, and state hashes on the mapped payload', async () => {
    const snapshot = await prepareFinalSubmissionSnapshot({
      canonicalState: activeCanonical(), environment: 'staging', testRunId: 'run-1',
    });
    expect(snapshot.mappedPayload).toMatchObject({
      source_draft_id: 'draft-authoritative-1',
      questionnaire_session_id: 'session-authoritative-1',
      environment: 'staging',
      test_run_id: 'run-1',
      submitted_state_hash: snapshot.canonicalSnapshotHash,
      pdf_source_state_hash: snapshot.canonicalSnapshotHash,
    });
  });

  it('does not change a prepared snapshot after Redux changes', async () => {
    const canonical = activeCanonical();
    const snapshot = await prepareFinalSubmissionSnapshot({ canonicalState: canonical });
    canonical.responses['1.1'] = 'changed later';
    expect(snapshot.responseSnapshot['1.1']).toBe('A durable answer');
  });

  it('persists final validation before submit-attempt locking', async () => {
    const h = successfulHarness();
    const order = [];
    h.syncManager.flush.mockImplementation(async ({ reason }) => {
      order.push(reason); return { state: 'server_saved' };
    });
    h.syncManager.markSubmitAttempted.mockImplementation(async () => {
      order.push('attempt'); return { state: 'server_saved' };
    });
    const coordinator = createProDraftSubmissionCoordinator(h);
    await coordinator.execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    expect(order).toEqual(['final_validation', 'pre_submit_flush', 'attempt', 'submitted_cache']);
  });

  it('blocks external submission when final validation is invalid', async () => {
    const h = successfulHarness();
    const coordinator = createProDraftSubmissionCoordinator(h);
    const result = await coordinator.execute({
      validateFinal: async () => ({ valid: false, firstInvalidQuestionId: '6' }),
      externalSubmit: h.externalSubmit,
    });
    expect(result).toMatchObject({ ok: false, invalid: true, firstInvalidQuestionId: '6' });
    expect(h.externalSubmit).not.toHaveBeenCalled();
  });

  it('focuses the first invalid question', async () => {
    const h = successfulHarness();
    const focus = vi.fn();
    await createProDraftSubmissionCoordinator(h).execute({
      validateFinal: async () => ({ valid: false, firstInvalidQuestionId: '9' }),
      focusInvalidQuestion: focus,
    });
    expect(focus).toHaveBeenCalledWith('9');
  });

  it('blocks external submission when validation state is not server accepted', async () => {
    const h = successfulHarness();
    h.syncManager.flush.mockResolvedValueOnce({ state: 'retrying' });
    const result = await createProDraftSubmissionCoordinator(h).execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    expect(result.errorCode).toBe(SUBMISSION_ERROR_CODES.VALIDATION_SAVE_FAILED);
    expect(h.externalSubmit).not.toHaveBeenCalled();
  });

  it('blocks external submission when submit_attempted is not accepted', async () => {
    const h = successfulHarness();
    h.syncManager.markSubmitAttempted.mockResolvedValue({ state: 'retrying' });
    const result = await createProDraftSubmissionCoordinator(h).execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    expect(result.errorCode).toBe(SUBMISSION_ERROR_CODES.SUBMIT_ATTEMPT_NOT_CONFIRMED);
  });

  it('calls the external boundary exactly once with the immutable snapshot', async () => {
    const h = successfulHarness();
    const result = await createProDraftSubmissionCoordinator(h).execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    expect(result.ok).toBe(true);
    expect(h.externalSubmit).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(h.externalSubmit.mock.calls[0][0])).toBe(true);
  });

  it('accepts durable intake as a final submission identity', async () => {
    const h = successfulHarness();
    h.externalSubmit.mockResolvedValue({ receivedViaIntake: true, intakeId: 'intake-1' });
    const result = await createProDraftSubmissionCoordinator(h).execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    expect(result.finalSubmissionId).toBe('intake:intake-1');
  });

  it('writes submit_failed when the external boundary rejects', async () => {
    const h = successfulHarness();
    h.externalSubmit.mockRejectedValue(Object.assign(new Error('failed'), { code: 'UPSTREAM_FAILED' }));
    const result = await createProDraftSubmissionCoordinator(h).execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    expect(result.ok).toBe(false);
    expect(h.syncManager.markSubmitFailed).toHaveBeenCalledWith('UPSTREAM_FAILED');
  });

  it('does not retry the external boundary when final lock remains pending', async () => {
    const h = successfulHarness();
    h.syncManager.markSubmitted.mockResolvedValue({ state: 'retrying' });
    const result = await createProDraftSubmissionCoordinator(h).execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    expect(result).toMatchObject({ ok: true, submissionLockPending: true });
    expect(h.externalSubmit).toHaveBeenCalledTimes(1);
  });

  it('retains answers when the final lock remains pending', async () => {
    const h = successfulHarness();
    h.syncManager.markSubmitted.mockImplementation(async (id) => {
      h.store.dispatch(setDraftSubmitted({
        draftId: 'draft-authoritative-1', finalSubmissionId: id, submittedAt: NOW,
        pdfAvailable: true, submissionLockPending: true,
      }));
      return { state: 'retrying' };
    });
    await createProDraftSubmissionCoordinator(h).execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    expect(selectCanonicalDraftState(h.store.getState()).state.responses['1.1'])
      .toBe('A durable answer');
  });

  it('persists only a safe submitted receipt in the receipt key', async () => {
    const h = successfulHarness();
    const storage = { setItem: vi.fn(async () => {}) };
    await createProDraftSubmissionCoordinator({ ...h, storage, namespace: NAMESPACE }).execute({
      validateFinal: async () => ({ valid: true }), externalSubmit: h.externalSubmit,
    });
    const serialized = storage.setItem.mock.calls[0][1];
    expect(serialized).toContain('submission-1');
    expect(serialized).not.toContain('A durable answer');
  });

  it('reports safe diagnostics without answers or credentials', () => {
    expect(getSafeSubmissionDiagnostics({ phase: 'submitting', running: true })).toEqual(
      expect.objectContaining({ phase: 'submitting', exposesAnswers: false, exposesCredentials: false }),
    );
  });

  it('recovers a failed submission through the submit_failed lifecycle only', async () => {
    const markSubmitFailed = vi.fn(async () => ({ state: 'server_saved', errorCode: null }));
    const result = await recoverFailedSubmissionState({ syncManager: { markSubmitFailed } });
    expect(result.recovered).toBe(true);
    expect(markSubmitFailed).toHaveBeenCalledTimes(1);
  });
});

const submittedFixture = async (overrides = {}) => {
  let canonical = activeCanonical({
    draftStatus: 'submitted',
    submission: {
      finalSubmissionId: 'submission-1', submittedAt: NOW,
      submittedStateHash: null, pdfSourceStateHash: null, lastSubmissionErrorCode: null,
    },
    ...overrides,
  });
  const hash = await hashCanonicalDraftState(canonical);
  canonical = normalizeCanonicalDraftState({
    ...canonical,
    submission: { ...canonical.submission, submittedStateHash: hash, pdfSourceStateHash: hash },
  });
  return {
    canonical,
    receipt: {
      draftId: canonical.draftId, finalSubmissionId: 'submission-1', submittedAt: NOW,
      submittedStateHash: hash, pdfSourceStateHash: hash, pdfAvailable: true,
      submissionLockPending: false,
    },
    hash,
  };
};

describe('submitted read-only PDF service', () => {
  it('builds PDF input only from a verified submitted canonical state', async () => {
    const fixture = await submittedFixture();
    const source = await prepareSubmittedPdfSource({ canonicalState: fixture.canonical, receipt: fixture.receipt });
    expect(source.sourceStateHash).toBe(fixture.hash);
    expect(source.formData['1.1']).toBe('A durable answer');
  });

  it('uses the authoritative submitted timestamp', async () => {
    const fixture = await submittedFixture();
    const source = await prepareSubmittedPdfSource({ canonicalState: fixture.canonical, receipt: fixture.receipt });
    expect(source.submissionDate).toBe(NOW);
  });

  it('does not expose recovery credentials in the PDF source', async () => {
    const fixture = await submittedFixture({
      credentials: { businessName: 'Example MSP', domain: 'example.test', recoveryEmail: 'owner@example.test' },
    });
    const source = await prepareSubmittedPdfSource({ canonicalState: fixture.canonical, receipt: fixture.receipt });
    expect(JSON.stringify(source)).not.toContain('owner@example.test');
  });

  it('rejects an active draft', async () => {
    const fixture = await submittedFixture();
    await expect(prepareSubmittedPdfSource({
      canonicalState: activeCanonical(), receipt: fixture.receipt,
    })).rejects.toMatchObject({ code: SUBMITTED_PDF_ERROR_CODES.NOT_SUBMITTED });
  });

  it('rejects a mismatched draft receipt', async () => {
    const fixture = await submittedFixture();
    await expect(prepareSubmittedPdfSource({
      canonicalState: fixture.canonical, receipt: { ...fixture.receipt, draftId: 'other' },
    })).rejects.toMatchObject({ code: SUBMITTED_PDF_ERROR_CODES.RECEIPT_MISMATCH });
  });

  it('rejects a mismatched final submission receipt', async () => {
    const fixture = await submittedFixture();
    await expect(prepareSubmittedPdfSource({
      canonicalState: fixture.canonical,
      receipt: { ...fixture.receipt, finalSubmissionId: 'submission-other' },
    })).rejects.toMatchObject({ code: SUBMITTED_PDF_ERROR_CODES.RECEIPT_MISMATCH });
  });

  it('rejects a mismatched submitted timestamp', async () => {
    const fixture = await submittedFixture();
    await expect(prepareSubmittedPdfSource({
      canonicalState: fixture.canonical,
      receipt: { ...fixture.receipt, submittedAt: '2026-08-06T13:00:00.000Z' },
    })).rejects.toMatchObject({ code: SUBMITTED_PDF_ERROR_CODES.RECEIPT_MISMATCH });
  });

  it('rejects a changed answer after submission', async () => {
    const fixture = await submittedFixture();
    const changed = normalizeCanonicalDraftState({
      ...fixture.canonical, responses: { ...fixture.canonical.responses, '1.1': 'tampered' },
    });
    await expect(prepareSubmittedPdfSource({
      canonicalState: changed, receipt: fixture.receipt,
    })).rejects.toMatchObject({ code: SUBMITTED_PDF_ERROR_CODES.HASH_MISMATCH });
  });

  it('passes exact submitted inputs to the PDF generator', async () => {
    const fixture = await submittedFixture();
    const generate = vi.fn(async () => ({ success: true, filename: 'answers.pdf' }));
    await generateSubmittedQuestionnairePdf({
      canonicalState: fixture.canonical, receipt: fixture.receipt, generate,
    });
    expect(generate).toHaveBeenCalledWith(
      fixture.canonical.responses, 'Example MSP', 'example.test', NOW,
    );
  });

  it('produces the same PDF source hash after recovery', async () => {
    const fixture = await submittedFixture();
    const original = await prepareSubmittedPdfSource({ canonicalState: fixture.canonical, receipt: fixture.receipt });
    const recovered = await prepareSubmittedPdfSource({
      canonicalState: JSON.parse(JSON.stringify(fixture.canonical)), receipt: { ...fixture.receipt },
    });
    expect(recovered.sourceStateHash).toBe(original.sourceStateHash);
    expect(recovered.model).toEqual(original.model);
  });

  it('reports PDF diagnostics without answers or credentials', () => {
    expect(getSafeSubmittedPdfDiagnostics({ valid: true, sourceStateHash: 'a'.repeat(64) }))
      .toEqual(expect.objectContaining({ valid: true, exposesAnswers: false, exposesCredentials: false }));
  });
});
