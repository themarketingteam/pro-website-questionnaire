import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageStructure, movePage, projectPageStructure } from '@/lib/pageOrganizerModel';
import { mergeNewerLocalBackup, preserveOrganizerRecoveryConflict, readOrganizerRecoveryArchive } from '@/lib/useSecureQuestionnaireDraft';

const industryOptions = ['Healthcare / Medical', 'Legal Firms'];
const serverTree = () => createPageStructure('4', industryOptions, [], {}, industryOptions);
const changedTree = () => {
  const tree = serverTree();
  return movePage(tree, tree.pages[0].id, null, 1);
};
const questionResponses = (tree) => ({
  '4': projectPageStructure(tree).selections,
  '4_other': projectPageStructure(tree).otherValues,
  '4_structure': tree
});
const server = () => ({
  revision: 8,
  lastSavedAt: '2026-10-27T12:00:00Z',
  responses: { ...questionResponses(serverTree()), '6': 'Current company description', '7': 'A delivery model' },
  validationStatus: { '4': 'complete', '6': 'complete' },
  touchedQuestions: { '4': true },
  expandedQuestions: { '4': false }
});
const backup = (overrides = {}) => ({
  session_id: 'local-session',
  baseRevision: 7,
  savedAt: '2026-10-27T13:00:00Z',
  responses: { ...questionResponses(changedTree()), '6': 'New offline company description' },
  changedKeys: ['4', '4_other', '4_structure', '6'],
  deletedKeys: ['7'],
  validationStatus: { '4': 'incomplete', '6': 'needs_work' },
  touchedQuestions: { '4': false },
  expandedQuestions: { '4': true },
  ...overrides
});
const merge = (localBackup, serverDraft = server()) => mergeNewerLocalBackup({ serverDraft, localBackup, currentLocalState: {} });

describe('organized offline backup revision safety', () => {
  beforeEach(() => localStorage.clear());

  it('retains earlier memory-only conflict copies when browser storage is unavailable', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    const first = preserveOrganizerRecoveryConflict('local-session', merge(backup()).recoveryConflict);
    const another = backup({ responses: { ...backup().responses, '6': 'A second distinct browser answer' } });
    const second = preserveOrganizerRecoveryConflict('local-session', merge(another).recoveryConflict, first.archive);
    expect(first.storageSaved).toBe(false); expect(second.storageSaved).toBe(false);
    expect(second.archive.conflicts).toHaveLength(2);
    expect(second.archive.conflicts[0].backup.responses['6']).toBe('New offline company description');
  });

  it('keeps a newer server tree and its UI status while recovering unrelated legacy changes', () => {
    const localBackup = backup();
    const before = structuredClone(localBackup);
    const result = merge(localBackup);
    expect(result.state.responses['4_structure']).toEqual(server().responses['4_structure']);
    expect(result.state.responses['4']).toEqual(industryOptions);
    expect(result.state.responses['4_other']).toEqual([]);
    expect(result.state.validationStatus['4']).toBe('complete');
    expect(result.state.expandedQuestions['4']).toBe(false);
    expect(result.state.touchedQuestions['4']).toBe(true);
    expect(result.state.responses['6']).toBe('New offline company description');
    expect(result.state.responses).not.toHaveProperty('7');
    expect(result.changedKeys).toEqual(['6', '7']);
    expect(result.deletedKeys).toEqual(['7']);
    expect(result.recoveryConflict).toMatchObject({ questionIds: ['4'], baseRevision: 7, serverRevision: 8, backup: before });
    expect(localBackup).toEqual(before);
  });

  it('merges an organized backup based on the exact current revision with its IDs and priorities intact', () => {
    const localBackup = backup({ baseRevision: 8 });
    const result = merge(localBackup);
    expect(result.recoveryConflict).toBeNull();
    expect(result.state.responses['4_structure']).toEqual(changedTree());
    expect(result.state.responses['4']).toEqual([...industryOptions].reverse());
    expect(result.changedKeys).toEqual(['4', '4_structure', '6', '7']);
    expect(result.state.validationStatus['4']).toBe('incomplete');
  });

  it('blocks stale structure deletion and associated flat-value deletion together', () => {
    const result = merge(backup({ responses: {}, changedKeys: [], deletedKeys: ['4_structure', '4', '4_other'] }));
    expect(result.state.responses['4_structure']).toEqual(serverTree());
    expect(result.state.responses['4']).toEqual(industryOptions);
    expect(result.deletedKeys).toEqual([]);
    expect(result.changedKeys).toEqual([]);
    expect(result.recoveryConflict.questionIds).toEqual(['4']);
  });

  it('never treats a matching revision as permission to downgrade or replay a flat-only organized edit', () => {
    const deletion = merge(backup({ baseRevision: 8, responses: {}, changedKeys: [], deletedKeys: ['4_structure', '4', '4_other'] }));
    expect(deletion.recoveryConflict.questionIds).toEqual(['4']);
    expect(deletion.state.responses['4_structure']).toEqual(serverTree());
    const oldTab = merge(backup({ baseRevision: 8, responses: { '4': ['Old custom choice'] }, changedKeys: ['4'], deletedKeys: [] }));
    expect(oldTab.recoveryConflict.questionIds).toEqual(['4']);
    expect(oldTab.recoveryConflict.backup.responses['4']).toEqual(['Old custom choice']);
    expect(oldTab.state.responses['4_structure']).toEqual(serverTree());
  });

  it('blocks stale local adoption and does not add it to an unorganized server question', () => {
    const serverDraft = server();
    delete serverDraft.responses['4_structure'];
    const result = merge(backup(), serverDraft);
    expect(result.state.responses).not.toHaveProperty('4_structure');
    expect(result.state.responses['4']).toEqual(industryOptions);
    expect(result.recoveryConflict.questionIds).toEqual(['4']);
  });

  it('preserves a stale backup for review even when its timestamp is older than the server', () => {
    const result = merge(backup({ savedAt: '2026-10-27T11:00:00Z' }));
    expect(result.state.responses).toEqual(server().responses);
    expect(result.changedKeys).toEqual([]);
    expect(result.recoveryConflict.backup.responses['4_structure']).toEqual(changedTree());
  });

  it('requires review for unknown backup revisions and malformed null local structures', () => {
    const localBackup = backup({ baseRevision: undefined, responses: { '4_structure': null }, changedKeys: ['4_structure'], deletedKeys: [] });
    const result = merge(localBackup);
    expect(result.state.responses['4_structure']).toEqual(serverTree());
    expect(result.recoveryConflict.baseRevision).toBeNull();
    expect(result.recoveryConflict.backup.responses['4_structure']).toBeNull();
  });

  it('does not flag a stale snapshot of an organized question that has no pending changes to that question', () => {
    const result = merge(backup({ changedKeys: ['6'], deletedKeys: [] }));
    expect(result.recoveryConflict).toBeNull();
    expect(result.state.responses['4_structure']).toEqual(serverTree());
    expect(result.state.responses['6']).toBe('New offline company description');
  });

  it('retains the existing legacy-only merge behavior across differing revisions', () => {
    const result = mergeNewerLocalBackup({
      serverDraft: { revision: 9, lastSavedAt: '2026-10-27T12:00:00Z', responses: { '6': 'Server description' } },
      localBackup: { baseRevision: 1, savedAt: '2026-10-27T13:00:00Z', responses: { '6': 'Offline description' }, changedKeys: ['6'] },
      currentLocalState: {}
    });
    expect(result.recoveryConflict).toBeNull();
    expect(result.state.responses['6']).toBe('Offline description');
    expect(result.changedKeys).toEqual(['6']);
  });

  it('allows first local-state migration into an empty new server draft', () => {
    const result = mergeNewerLocalBackup({
      serverDraft: { revision: 0, responses: {} },
      currentLocalState: { responses: questionResponses(changedTree()) },
      allowLegacyCurrentStateMigration: true
    });
    expect(result.recoveryConflict).toBeNull();
    expect(result.state.responses['4_structure']).toEqual(changedTree());
  });

  it('archives conflicts separately from replaceable outbox snapshots and keeps multiple recovery copies across refreshes', () => {
    const conflict = merge(backup()).recoveryConflict;
    expect(preserveOrganizerRecoveryConflict('local-session', conflict).storageSaved).toBe(true);
    localStorage.setItem('pro_questionnaire_local_backup_local-session', JSON.stringify({ responses: { '6': 'New safe edits' } }));
    expect(readOrganizerRecoveryArchive('local-session').conflicts[0].backup).toEqual(conflict.backup);
    preserveOrganizerRecoveryConflict('local-session', conflict);
    expect(readOrganizerRecoveryArchive('local-session').conflicts).toHaveLength(1);
    const another = structuredClone(conflict);
    another.backup.savedAt = '2026-10-27T14:00:00Z';
    another.backup.responses['6'] = 'Another offline version';
    preserveOrganizerRecoveryConflict('local-session', another);
    const persisted = readOrganizerRecoveryArchive('local-session');
    expect(persisted.conflicts).toHaveLength(2);
    expect(persisted.conflicts[0].backup).toEqual(conflict.backup);
    expect(persisted.conflicts[1].backup).toEqual(another.backup);
    expect(readOrganizerRecoveryArchive('another-session')).toBeNull();
  });
});
