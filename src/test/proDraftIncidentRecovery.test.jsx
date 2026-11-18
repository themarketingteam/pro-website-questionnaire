import { useReducer } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import formReducer, { setMultipleResponses } from '@/components/store/formSlice';
import { useSecureQuestionnaireDraft, readOrganizerRecoveryArchive, mergeNewerLocalBackup, equivalentCompletedResponses } from '@/lib/useSecureQuestionnaireDraft';
import { createPageNode, addPage, createPageStructure, projectPageStructure } from '@/lib/pageOrganizerModel';
import { getDraftLocalBackup, writeDraftFailureBackup } from '@/lib/draftPersistence';
import { persistResumeCredential } from '@/lib/sessionId';
import { hostedDraftIncidentBackend, INCIDENT_CREDENTIAL, INCIDENT_SESSION } from './utils/hostedDraftIncidentBackend';
const groups = { 'Managed IT Services': ['Managed IT'] };
const tree = () => createPageStructure('3', ['Managed IT'], [], groups);
const projection = value => ({ '3_structure': value, '3': projectPageStructure(value).selections, '3_other': projectPageStructure(value).otherValues });
const initial = () => ({ ...projection(tree()), '6': 'Submitted company description', '7': 'Old delivery model' });
const mount = backend => renderHook(() => {
  const [form, dispatch] = useReducer(formReducer, undefined, () => formReducer(undefined, { type: '@@init' }));
  const api = useSecureQuestionnaireDraft({ base44: backend, dispatch, ...form, businessNameParam: '', domainParam: '', serviceOptionsGrouped: groups, totalQuestionCount: 25, isTestMode: true });
  return { form, dispatch, api };
});
const edit = (tab, patch, keys = Object.keys(patch), deletedKeys = []) => {
  const next = { ...tab.result.current.form.responses, ...patch }; deletedKeys.forEach(key => delete next[key]);
  tab.result.current.dispatch(setMultipleResponses(patch)); tab.result.current.api.queueDraftSave(keys, next, { deletedKeys });
};
describe('actual hosted draft incident recovery', () => {
  beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/'); persistResumeCredential(INCIDENT_CREDENTIAL); });
  it('does not call routine normalization browser edits on a fresh completed hydration with no outbox', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: initial(), status: 'submitted', groups });
    const tab = mount(backend);
    await waitFor(() => expect(tab.result.current.api.completedDraft).not.toBeNull());
    expect(tab.result.current.api.completedDraft.hasUnsavedChanges).toBe(false);
    expect(backend.calls.some(call => call.action === 'save')).toBe(false);
  });
  it('compares logical completed answers independently of object key order while retaining real value and priority differences', () => {
    const saved = initial();
    const reordered = Object.fromEntries(Object.entries(saved).reverse());
    reordered['3_structure'] = { pages: saved['3_structure'].pages.map(page => Object.fromEntries(Object.entries(page).reverse())), format: 'page-tree-v1' };
    expect(equivalentCompletedResponses(saved, reordered)).toBe(true);
    expect(equivalentCompletedResponses(saved, { ...reordered, '6': 'A genuine pending browser edit' })).toBe(false);
    const withStandalone = { ...saved, ...projection(addPage(saved['3_structure'], createPageNode('3', 'Standalone page'))) };
    expect(equivalentCompletedResponses(withStandalone, { ...withStandalone, '3_structure': { ...withStandalone['3_structure'], pages: [...withStandalone['3_structure'].pages].reverse() } })).toBe(false);
  });
  it('refreshes a direct stale organizer rejection and saves pending unrelated text/deletion', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: initial(), groups });
    const a = mount(backend), b = mount(backend);
    await waitFor(() => expect(a.result.current.api.isDraftReady && b.result.current.api.isDraftReady).toBe(true));
    const remote = addPage(tree(), createPageNode('3', 'Added on another device'));
    act(() => edit(a, projection(remote))); await waitFor(() => expect(a.result.current.api.lastConfirmedRevision).toBe(1));
    const local = addPage(tree(), createPageNode('3', 'Rejected local page'));
    act(() => edit(b, { ...projection(local), '6': 'Retain pending text' }, ['3', '3_other', '3_structure', '6'], ['7']));
    await waitFor(() => expect(b.result.current.api.lastConfirmedRevision).toBe(2));
    const saved = JSON.parse(backend.getOriginal().responses_json);
    expect(saved['3_structure']).toEqual(remote); expect(saved['6']).toBe('Retain pending text'); expect(saved).not.toHaveProperty('7');
    expect(readOrganizerRecoveryArchive(INCIDENT_SESSION).conflicts.some(copy => JSON.stringify(copy.backup.responses['3_structure']) === JSON.stringify(local))).toBe(true);
    expect(b.result.current.form.responses['3_structure']).toEqual(remote);
    act(() => edit(b, { '6': 'A later edit also saves' })); await waitFor(() => expect(b.result.current.api.lastConfirmedRevision).toBe(3));
    expect(JSON.parse(backend.getOriginal().responses_json)['6']).toBe('A later edit also saves');
  });
  it('replays an older pending ledger after bootstrap bumps lastSavedAt and retires its acknowledged keys', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: initial(), groups });
    writeDraftFailureBackup({ questionnaireSessionId: INCIDENT_SESSION, responses: { ...initial(), '6': '', '9': 'Unchanged stale snapshot' }, changedKeys: ['6'], deletedKeys: ['7'], baseRevision: 0 });
    const backup = getDraftLocalBackup(INCIDENT_SESSION); backup.savedAt = '2020-01-01T00:00:00Z'; localStorage.setItem(`pro_questionnaire_local_backup_${INCIDENT_SESSION}`, JSON.stringify(backup));
    const tab = mount(backend); await waitFor(() => expect(tab.result.current.api.lastConfirmedRevision).toBe(1));
    const responses = JSON.parse(backend.getOriginal().responses_json);
    expect(responses['6']).toBe(''); expect(responses).not.toHaveProperty('7'); expect(responses).not.toHaveProperty('9');
    expect(getDraftLocalBackup(INCIDENT_SESSION)).toMatchObject({ outboxVersion: 2, pending: false, changedKeys: [], deletedKeys: [] });
    const merged = mergeNewerLocalBackup({ serverDraft: { revision: 2, lastSavedAt: '2030-01-01T00:00:00Z', responses: { '6': 'Later device edit' } }, localBackup: getDraftLocalBackup(INCIDENT_SESSION), currentLocalState: {} });
    expect(merged.state.responses['6']).toBe('Later device edit');
  });
  it('preserves submitted browser edits separately without exposing client revision creation', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: initial(), status: 'submitted', groups });
    writeDraftFailureBackup({ questionnaireSessionId: INCIDENT_SESSION, responses: { ...initial(), '6': 'My unsaved browser edit' }, changedKeys: ['6'], deletedKeys: [], baseRevision: 0 });
    const tab = mount(backend); await waitFor(() => expect(tab.result.current.api.completedDraft?.hasUnsavedChanges).toBe(true));
    expect(tab.result.current.form.responses['6']).toBe('Submitted company description');
    expect(tab.result.current.api.startRevision).toBeUndefined();
    expect(getDraftLocalBackup(INCIDENT_SESSION).responses['6']).toBe('My unsaved browser edit');
    const original = backend.getOriginal();
    await expect(backend.functions.invoke('syncProQuestionnaireDraft', { action: 'start_revision', resumeCredential: INCIDENT_CREDENTIAL })).rejects.toMatchObject({ status: 403 });
    expect(backend.getOriginal()).toEqual(original);
    expect(backend.records.size).toBe(1);
  });

  it('recognizes an ignored save after another device submits, keeps the edit separately and never auto-clones', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: initial(), groups });
    const tab = mount(backend); await waitFor(() => expect(tab.result.current.api.isDraftReady).toBe(true));
    Object.assign(backend.records.get('incident-original-draft'), { status: 'submitted', final_submission_id: 'incident-final-receipt' });
    act(() => edit(tab, { '6': 'Edited while another device submitted' }));
    await waitFor(() => expect(tab.result.current.api.completedDraft?.hasUnsavedChanges).toBe(true));
    expect(tab.result.current.form.responses['6']).toBe('Submitted company description');
    expect(getDraftLocalBackup(INCIDENT_SESSION).responses['6']).toBe('Edited while another device submitted');
    expect(tab.result.current.api.draftSaveState).toBe('completed');
    expect(backend.records.size).toBe(1); expect(backend.calls.some(call => call.action === 'start_revision')).toBe(false);
  });
});
