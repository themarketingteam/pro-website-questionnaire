import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapServerDraft,
  createServerDraftMutationPayload,
  flushDraftMutationKeepalive,
  getDraftLocalBackup,
  saveServerDraftMutation,
  writeDraftFailureBackup
} from '@/lib/draftPersistence';
import {
  clearQuestionnaireSessionId,
  getOrCreateDraftClientInstanceId,
  getStoredResumeCredential,
  persistResumeCredential
} from '@/lib/sessionId';

const CREDENTIAL = 'secure_session_1234567890.abcdefghijklmnopqrstuvwxyzABCDEFGH';

describe('secure draft persistence client contract', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('uses a distinct mutation client for every mounted questionnaire instance', () => {
    expect(getOrCreateDraftClientInstanceId()).not.toBe(getOrCreateDraftClientInstanceId());
  });

  it('keeps the anonymous recovery capability in the URL so storage removal does not lose access', () => {
    persistResumeCredential(CREDENTIAL);
    expect(window.location.hash).toContain('draft=');
    localStorage.clear();
    expect(getStoredResumeCredential()).toBe(CREDENTIAL);

    clearQuestionnaireSessionId();
    expect(getStoredResumeCredential()).toBe('');
  });

  it('bootstraps through the backend rather than reading the draft entity publicly', async () => {
    const functions = {
      invoke: vi.fn(async () => ({
        status: 200,
        data: { success: true, resumeCredential: CREDENTIAL, draft: { draftId: 'draft-1' } }
      }))
    };

    await bootstrapServerDraft({
      functions,
      resumeCredential: CREDENTIAL,
      legacySessionId: 'legacy_session_1234567890',
      credentials: { businessName: 'Example' }
    });

    expect(functions.invoke).toHaveBeenCalledWith('syncProQuestionnaireDraft', expect.objectContaining({
      action: 'bootstrap',
      resumeCredential: CREDENTIAL
    }));
  });

  it('retries transient failures with the same idempotent mutation and preserves explicit deletions', async () => {
    const functions = {
      invoke: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 503 }))
        .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
        .mockResolvedValue({
          status: 200,
          data: {
            success: true,
            draft: { draftId: 'draft-1', revision: 9, responses: { '6': 'newest' } }
          }
        })
    };

    const result = await saveServerDraftMutation({
      functions,
      resumeCredential: CREDENTIAL,
      clientInstanceId: 'client_1234567890',
      mutationId: 'mutation_1234567890',
      clientSequence: 9,
      baseRevision: 8,
      responses: { '6': 'newest' },
      changedKeys: ['6'],
      deletedKeys: ['6_other'],
      validationStatus: { '6': 'complete' },
      touchedQuestions: { '6': true },
      expandedQuestions: { '6': true },
      credentials: {},
      currentQuestionId: '6',
      lastChangedQuestionId: '6',
      progressPercent: 20,
      mappedPayload: {},
      source: 'autosave'
    });

    expect(functions.invoke).toHaveBeenCalledTimes(3);
    expect(functions.invoke.mock.calls.map(([, payload]) => payload.mutationId)).toEqual([
      'mutation_1234567890',
      'mutation_1234567890',
      'mutation_1234567890'
    ]);
    expect(functions.invoke.mock.calls[2][1].deletedKeys).toEqual(['6_other']);
    expect(result.draft.responses['6']).toBe('newest');
  });

  it('records an explicit local deletion ledger for recovery without treating unloaded fields as deletes', () => {
    writeDraftFailureBackup({
      questionnaireSessionId: 'secure_session_1234567890',
      responses: { '6': 'kept' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      changedKeys: ['6'],
      deletedKeys: ['7'],
      baseRevision: 4,
      error: 'pending_server_save'
    });

    const backup = getDraftLocalBackup('secure_session_1234567890');
    expect(backup.responses).toEqual({ '6': 'kept' });
    expect(backup.changedKeys).toEqual(['6']);
    expect(backup.deletedKeys).toEqual(['7']);
    expect(backup.baseRevision).toBe(4);
  });

  it('queues an unload-safe save through the configured Base44 endpoint', () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true }));
    const payload = createServerDraftMutationPayload({
      resumeCredential: CREDENTIAL,
      clientInstanceId: 'client_1234567890',
      mutationId: 'mutation_1234567890',
      clientSequence: 3,
      baseRevision: 2,
      responses: { '6': 'Latest unsent answer' },
      changedKeys: ['6'],
      deletedKeys: [],
      credentials: {},
      source: 'pagehide_flush'
    });

    expect(flushDraftMutationKeepalive({ payload, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://base44.app/api/apps/6925fec3678942d22522b010/functions/syncProQuestionnaireDraft',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        credentials: 'omit',
        headers: expect.objectContaining({ 'X-App-Id': '6925fec3678942d22522b010' }),
        body: expect.stringContaining('Latest unsent answer')
      })
    );
  });

  it('declines an unload request that exceeds the browser keepalive limit', () => {
    const fetchImpl = vi.fn();
    expect(flushDraftMutationKeepalive({
      payload: { oversized: 'x'.repeat(61_000) },
      fetchImpl
    })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
