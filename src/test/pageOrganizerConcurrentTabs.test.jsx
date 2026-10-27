import { useReducer } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import formReducer, { setMultipleResponses } from '@/components/store/formSlice';
import { addPage, createPageNode, createPageStructure, flattenPageStructure, movePage, projectPageStructure } from '@/lib/pageOrganizerModel';
import { persistResumeCredential } from '@/lib/sessionId';
import { readOrganizerRecoveryArchive, useSecureQuestionnaireDraft } from '@/lib/useSecureQuestionnaireDraft';
import { guardOrganizedDraftMutation } from '../../base44/shared/pageOrganizerContract.js';

const CREDENTIAL = 'organizer_concurrent_1234567890.abcdefghijklmnopqrstuvwxyzABCDEFGH';
const SESSION_ID = CREDENTIAL.split('.')[0];
const GROUPS = { 'Managed IT Services': ['Managed IT'] };
const projection = (tree) => ({ '3_structure': tree, '3': projectPageStructure(tree).selections, '3_other': projectPageStructure(tree).otherValues });
const clone = (value) => JSON.parse(JSON.stringify(value));

const createBackend = () => {
  const initialTree = createPageStructure('3', ['Managed IT'], ['Original standalone'], GROUPS);
  const draft = {
    sessionId: SESSION_ID, revision: 0, responses: { ...projection(initialTree), '6': 'Original description' },
    validationStatus: {}, touchedQuestions: {}, expandedQuestions: {}, credentials: { businessName: '', domain: '' }, lastSavedAt: new Date().toISOString()
  };
  let holdDescriptionResponse = false;
  let releaseDescription = null;
  const functions = {
    invoke: vi.fn(async (_name, payload) => {
      if (payload.action === 'bootstrap') return { data: { success: true, resumeCredential: CREDENTIAL, draft: clone(draft) } };
      if (payload.action !== 'save') return { data: { success: true } };
      const guard = guardOrganizedDraftMutation({
        currentResponses: draft.responses, incomingResponses: payload.responses,
        changedKeys: payload.changedKeys, deletedKeys: payload.deletedKeys,
        baseRevision: payload.baseRevision, currentRevision: draft.revision
      });
      if (!guard.ok) return { status: guard.status, data: { success: false, error: guard.errors.join(' ') } };
      payload.changedKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(payload.responses, key)) draft.responses[key] = clone(payload.responses[key]);
      });
      payload.deletedKeys.forEach((key) => delete draft.responses[key]);
      draft.revision += 1;
      const response = { data: { success: true, draft: clone(draft) } };
      if (holdDescriptionResponse && payload.source === 'tab-b-description') {
        await new Promise((resolve) => { releaseDescription = resolve; });
      }
      return response;
    })
  };
  return {
    draft, functions,
    holdDescription: () => { holdDescriptionResponse = true; },
    releaseDescription: () => releaseDescription?.(),
    isDescriptionHeld: () => Boolean(releaseDescription)
  };
};

const mountTab = (backend) => renderHook(() => {
  const [form, dispatch] = useReducer(formReducer, undefined, () => formReducer(undefined, { type: '@@init' }));
  const api = useSecureQuestionnaireDraft({
    base44: backend, dispatch, ...form, businessNameParam: '', domainParam: '',
    serviceOptionsGrouped: GROUPS, totalQuestionCount: 25, isTestMode: true
  });
  return { form, dispatch, api };
});

const queue = (tab, patch, keys, source) => {
  const responses = { ...tab.result.current.form.responses, ...patch };
  tab.result.current.dispatch(setMultipleResponses(patch));
  tab.result.current.api.queueDraftSave(keys, responses, { source });
};

describe('live organized draft reconciliation across two mounted tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    persistResumeCredential(CREDENTIAL);
  });

  it('adopts another tab’s new page before using the returned revision for a later reorder', async () => {
    const backend = createBackend();
    const tabA = mountTab(backend);
    const tabB = mountTab(backend);
    await waitFor(() => expect(tabA.result.current.api.isDraftReady && tabB.result.current.api.isDraftReady).toBe(true));
    const newTree = addPage(tabA.result.current.form.responses['3_structure'], createPageNode('3', 'Added in tab A'));
    act(() => queue(tabA, projection(newTree), ['3', '3_other', '3_structure'], 'tab-a-page'));
    await waitFor(() => expect(backend.draft.revision).toBe(1));
    act(() => queue(tabB, { '6': 'An unrelated edit in tab B' }, ['6'], 'tab-b-description'));
    await waitFor(() => expect(tabB.result.current.api.lastConfirmedRevision).toBe(2));
    expect(tabB.result.current.form.responses['3_structure']).toEqual(newTree);
    const reordered = movePage(tabB.result.current.form.responses['3_structure'], newTree.pages[2].id, null, 0);
    act(() => queue(tabB, projection(reordered), ['3', '3_other', '3_structure'], 'tab-b-reorder'));
    await waitFor(() => expect(backend.draft.revision).toBe(3));
    expect(backend.draft.responses['3_structure']).toEqual(reordered);
    expect(flattenPageStructure(backend.draft.responses['3_structure']).some((page) => page.label === 'Added in tab A')).toBe(true);
  });

  it('archives and invalidates a stale reorder already queued behind an unrelated save response', async () => {
    const backend = createBackend();
    const tabA = mountTab(backend);
    const tabB = mountTab(backend);
    await waitFor(() => expect(tabA.result.current.api.isDraftReady && tabB.result.current.api.isDraftReady).toBe(true));
    const initialB = clone(tabB.result.current.form.responses['3_structure']);
    const newTree = addPage(tabA.result.current.form.responses['3_structure'], createPageNode('3', 'Added in tab A'));
    act(() => queue(tabA, projection(newTree), ['3', '3_other', '3_structure'], 'tab-a-page'));
    await waitFor(() => expect(backend.draft.revision).toBe(1));
    backend.holdDescription();
    act(() => queue(tabB, { '6': 'Description while tab A changed pages' }, ['6'], 'tab-b-description'));
    await waitFor(() => expect(backend.isDescriptionHeld()).toBe(true));
    const staleReorder = movePage(initialB, initialB.pages[1].id, null, 0);
    act(() => queue(tabB, projection(staleReorder), ['3', '3_other', '3_structure'], 'tab-b-stale-reorder'));
    await waitFor(() => expect(tabB.result.current.api.draftSaveState).toBe('saving'));
    await act(async () => backend.releaseDescription());
    await waitFor(() => expect(tabB.result.current.api.lastConfirmedRevision).toBe(3));
    expect(backend.draft.responses['3_structure']).toEqual(newTree);
    expect(tabB.result.current.form.responses['3_structure']).toEqual(newTree);
    expect(tabB.result.current.api.organizerRecoveryConflict.questionIds).toContain('3');
    const archive = readOrganizerRecoveryArchive(SESSION_ID);
    expect(archive.conflicts.some((conflict) => JSON.stringify(conflict.backup.responses['3_structure']) === JSON.stringify(staleReorder))).toBe(true);
    const queuedPayload = backend.functions.invoke.mock.calls.map(([, payload]) => payload).find((payload) => payload.source === 'tab-b-stale-reorder');
    expect(queuedPayload.changedKeys).not.toContain('3_structure');
    expect(queuedPayload.responses['3_structure']).toEqual(newTree);
  });

  it('rejects a required final save whose captured organization was invalidated before it could execute', async () => {
    const backend = createBackend();
    const tabA = mountTab(backend);
    const tabB = mountTab(backend);
    await waitFor(() => expect(tabA.result.current.api.isDraftReady && tabB.result.current.api.isDraftReady).toBe(true));
    const initialB = clone(tabB.result.current.form.responses['3_structure']);
    const newTree = addPage(tabA.result.current.form.responses['3_structure'], createPageNode('3', 'Added in tab A'));
    act(() => queue(tabA, projection(newTree), ['3', '3_other', '3_structure'], 'tab-a-page'));
    await waitFor(() => expect(backend.draft.revision).toBe(1));
    backend.holdDescription();
    act(() => queue(tabB, { '6': 'Final description' }, ['6'], 'tab-b-description'));
    await waitFor(() => expect(backend.isDescriptionHeld()).toBe(true));
    const staleReorder = movePage(initialB, initialB.pages[1].id, null, 0);
    let finalSave;
    act(() => {
      const responses = { ...tabB.result.current.form.responses, ...projection(staleReorder) };
      tabB.result.current.dispatch(setMultipleResponses(projection(staleReorder)));
      finalSave = tabB.result.current.api.saveDraftNow({ responsesSnapshot: responses, required: true, source: 'tab-b-final' });
      finalSave.catch(() => null);
    });
    await act(async () => {
      backend.releaseDescription();
      await expect(finalSave).rejects.toMatchObject({ status: 409, code: 'ORGANIZER_SNAPSHOT_CHANGED' });
    });
    expect(backend.draft.revision).toBe(2);
    expect(backend.draft.responses['3_structure']).toEqual(newTree);
    expect(tabB.result.current.form.responses['3_structure']).toEqual(newTree);
    expect(backend.functions.invoke.mock.calls.some(([, payload]) => payload.source === 'tab-b-final')).toBe(false);
    expect(readOrganizerRecoveryArchive(SESSION_ID).conflicts.some((conflict) => JSON.stringify(conflict.backup.responses['3_structure']) === JSON.stringify(staleReorder))).toBe(true);
  });
});
