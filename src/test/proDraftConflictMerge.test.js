import { describe, expect, it } from 'vitest';
import { createEmptyCanonicalDraftState } from '@/lib/questionnaireDraftState';
import {
  DRAFT_CONFLICT_TYPES,
  DRAFT_MERGE_RESULTS,
  applyConflictChoices,
  collectChangedFieldPaths,
  compareFieldMetadata,
  getSafeMergeDiagnostics,
  mergeCanonicalDraftStates,
  validateConflictChoice,
} from '@/lib/proDraftConflictMerge';

const base = (overrides = {}) => ({
  ...createEmptyCanonicalDraftState(),
  draftId: 'draft-synthetic-merge',
  sessionId: 'session-synthetic-merge',
  clientRevision: 1,
  serverRevision: 1,
  responses: { q1: 'base one', q2: 'base two' },
  ...overrides,
});

const metadata = (operation, mutationId, serverRevision = 1) => ({
  operation,
  clientRevision: 2,
  serverRevision,
  changedAtClient: '2026-08-06T12:00:00.000Z',
  sourceTabId: `tab_${mutationId}`,
  mutationId,
});

describe('Pro draft conflict merge', () => {
  it('merges different response keys with a three-way base', async () => {
    const common = base();
    const result = await mergeCanonicalDraftStates({
      baseState: common,
      localState: base({ responses: { q1: 'local', q2: 'base two' } }),
      serverState: base({ responses: { q1: 'base one', q2: 'server' }, serverRevision: 2 }),
    });
    expect(result.result).toBe(DRAFT_MERGE_RESULTS.MERGED);
    expect(result.mergedState.responses).toEqual({ q1: 'local', q2: 'server' });
  });

  it('treats an identical same-field value as unchanged', async () => {
    const result = await mergeCanonicalDraftStates({
      baseState: base(), localState: base({ responses: { q1: 'same', q2: 'base two' } }),
      serverState: base({ responses: { q1: 'same', q2: 'base two' }, serverRevision: 2 }),
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.unchangedPaths).toContain('responses.q1');
  });

  it('requires a choice for different concurrent same-field values', async () => {
    const result = await mergeCanonicalDraftStates({
      baseState: base(),
      localState: base({ responses: { q1: 'local', q2: 'base two' } }),
      serverState: base({ responses: { q1: 'server', q2: 'base two' }, serverRevision: 2 }),
    });
    expect(result.result).toBe(DRAFT_MERGE_RESULTS.USER_CHOICE_REQUIRED);
    expect(result.conflicts[0]).toMatchObject({
      fieldPath: 'responses.q1', conflictType: DRAFT_CONFLICT_TYPES.CONCURRENT_SET,
    });
  });

  it('preserves a local delete when the server is unchanged', async () => {
    const common = base();
    const result = await mergeCanonicalDraftStates({
      baseState: common,
      localState: base({ responses: { q2: 'base two' } }),
      serverState: common,
    });
    expect(result.mergedState.responses).not.toHaveProperty('q1');
  });

  it('requires a choice for delete versus set', async () => {
    const result = await mergeCanonicalDraftStates({
      baseState: base(),
      localState: base({ responses: { q2: 'base two' } }),
      serverState: base({ responses: { q1: 'server', q2: 'base two' }, serverRevision: 2 }),
    });
    expect(result.conflicts[0].conflictType).toBe(DRAFT_CONFLICT_TYPES.DELETE_VERSUS_SET);
  });

  it('classifies reset versus set from metadata', async () => {
    const result = await mergeCanonicalDraftStates({
      baseState: base(),
      localState: base({
        responses: { q2: 'base two' },
        fieldChangeMetadata: { 'responses.q1': metadata('reset', 'local-reset') },
      }),
      serverState: base({
        responses: { q1: 'server', q2: 'base two' }, serverRevision: 2,
        fieldChangeMetadata: { 'responses.q1': metadata('set', 'server-set') },
      }),
    });
    expect(result.conflicts[0].conflictType).toBe(DRAFT_CONFLICT_TYPES.RESET_VERSUS_SET);
  });

  it('merges response-following validation from different questions', async () => {
    const common = base({ validationStatus: { q1: 'valid', q2: 'valid' } });
    const result = await mergeCanonicalDraftStates({
      baseState: common,
      localState: base({ validationStatus: { q1: 'invalid', q2: 'valid' } }),
      serverState: base({ validationStatus: { q1: 'valid', q2: 'pending' }, serverRevision: 2 }),
    });
    expect(result.mergedState.validationStatus).toEqual({ q1: 'invalid', q2: 'pending' });
  });

  it('preserves true touched flags from either tab', async () => {
    const result = await mergeCanonicalDraftStates({
      baseState: base({ touchedQuestions: { q1: false } }),
      localState: base({ touchedQuestions: { q1: true } }),
      serverState: base({ touchedQuestions: { q1: false }, serverRevision: 2 }),
    });
    expect(result.mergedState.touchedQuestions.q1).toBe(true);
  });

  it('prefers expanded state from the current local tab', async () => {
    const result = await mergeCanonicalDraftStates({
      baseState: base({ expandedQuestions: { q1: false } }),
      localState: base({ expandedQuestions: { q1: true } }),
      serverState: base({ expandedQuestions: { q1: false }, serverRevision: 2 }),
    });
    expect(result.mergedState.expandedQuestions.q1).toBe(true);
  });

  it('merges nested UI state in separate scopes', async () => {
    const commonUi = {
      scopeA: { kind: 'editor', version: 1, data: { panel: 'one' }, updatedAtClient: null, sourceTabId: null },
    };
    const result = await mergeCanonicalDraftStates({
      baseState: base({ uiDraftState: commonUi }),
      localState: base({ uiDraftState: {
        ...commonUi,
        scopeB: { kind: 'modal', version: 1, data: {}, updatedAtClient: null, sourceTabId: null },
      } }),
      serverState: base({ uiDraftState: {
        scopeA: { ...commonUi.scopeA, data: { panel: 'two' } },
      }, serverRevision: 2 }),
    });
    expect(result.mergedState.uiDraftState.scopeA.data.panel).toBe('two');
    expect(result.mergedState.uiDraftState).toHaveProperty('scopeB');
  });

  it('requires a user choice for credentials', async () => {
    const result = await mergeCanonicalDraftStates({
      baseState: base({ credentials: { businessName: 'Base' } }),
      localState: base({ credentials: { businessName: 'Local' } }),
      serverState: base({ credentials: { businessName: 'Server' }, serverRevision: 2 }),
    });
    expect(result.conflicts[0].conflictType).toBe(DRAFT_CONFLICT_TYPES.CREDENTIAL);
  });

  it.each(['submitted', 'cleared_superseded'])(
    'lets terminal %s server state win', async (draftStatus) => {
      const server = base({ draftStatus, responses: { q1: 'final' }, serverRevision: 9 });
      const result = await mergeCanonicalDraftStates({ localState: base(), serverState: server });
      expect(result.result).toBe(DRAFT_MERGE_RESULTS.SERVER_WINS);
      expect(result.mergedState).toEqual(server);
    },
  );

  it('rejects incompatible draft identities', async () => {
    const result = await mergeCanonicalDraftStates({
      localState: base(), serverState: base({ draftId: 'draft-other' }),
    });
    expect(result.result).toBe(DRAFT_MERGE_RESULTS.INCOMPATIBLE);
  });

  it('uses field metadata when no base exists', async () => {
    const result = await mergeCanonicalDraftStates({
      localState: base({
        responses: { q1: 'local' },
        fieldChangeMetadata: { 'responses.q1': metadata('set', 'local', 1) },
      }),
      serverState: base({
        responses: { q1: 'server' }, serverRevision: 3,
        fieldChangeMetadata: { 'responses.q1': metadata('set', 'server', 3) },
      }),
    });
    expect(result.result).toBe(DRAFT_MERGE_RESULTS.SERVER_WINS);
    expect(result.mergedState.responses.q1).toBe('server');
  });

  it('does not guess when base and decisive metadata are missing', async () => {
    const result = await mergeCanonicalDraftStates({
      localState: base({ responses: { q1: 'local' } }),
      serverState: base({ responses: { q1: 'server' }, serverRevision: 2 }),
    });
    expect(result.result).toBe(DRAFT_MERGE_RESULTS.USER_CHOICE_REQUIRED);
  });

  it('applies local and server conflict choices', async () => {
    const merge = await mergeCanonicalDraftStates({
      baseState: base(),
      localState: base({ responses: { q1: 'local', q2: 'local two' } }),
      serverState: base({ responses: { q1: 'server', q2: 'server two' }, serverRevision: 2 }),
    });
    const applied = await applyConflictChoices(merge, {
      'responses.q1': 'keep_local', 'responses.q2': 'keep_server',
    });
    expect(applied.mergedState.responses).toEqual({ q1: 'local', q2: 'server two' });
  });

  it('rejects an invalid choice', async () => {
    const merge = await mergeCanonicalDraftStates({
      baseState: base(),
      localState: base({ responses: { q1: 'local' } }),
      serverState: base({ responses: { q1: 'server' }, serverRevision: 2 }),
    });
    expect(validateConflictChoice(merge.conflicts[0], 'discard_both').valid).toBe(false);
    expect((await applyConflictChoices(merge, {})).result).toBe(DRAFT_MERGE_RESULTS.INVALID);
  });

  it('masks email and truncates text previews', async () => {
    const result = await mergeCanonicalDraftStates({
      baseState: base({ credentials: { userEmail: 'base@example.com' } }),
      localState: base({ credentials: { userEmail: 'local@example.com' } }),
      serverState: base({ credentials: { userEmail: 'server@example.com' }, serverRevision: 2 }),
    });
    expect(result.conflicts[0].localPreview).toMatch(/^l\*+@example\.com$/u);
    expect(result.conflicts[0].localPreview).not.toContain('local@example.com');
  });

  it('never accepts token-bearing canonical fields or diagnostics values', async () => {
    const unsafe = { ...base(), resumeToken: 'synthetic-secret' };
    const result = await mergeCanonicalDraftStates({ localState: unsafe, serverState: base() });
    expect(result.result).toBe(DRAFT_MERGE_RESULTS.INVALID);
    expect(JSON.stringify(getSafeMergeDiagnostics(result))).not.toContain('synthetic-secret');
  });

  it('only descends into structured answers when nested metadata exists', () => {
    const local = base({ responses: { q1: { first: 'local', second: 'base' } } });
    const server = base({ responses: { q1: { first: 'base', second: 'server' } } });
    expect(collectChangedFieldPaths(local, server)).toEqual(['responses.q1']);
    local.fieldChangeMetadata = { 'responses.q1.first': metadata('set', 'nested') };
    expect(collectChangedFieldPaths(local, server)).toEqual([
      'responses.q1.first', 'responses.q1.second',
    ]);
  });

  it('treats client timestamps as advisory during metadata comparison', () => {
    const local = metadata('set', 'local', 1);
    const server = { ...metadata('set', 'server', 1), changedAtClient: '2020-01-01T00:00:00.000Z' };
    expect(compareFieldMetadata(local, server)).toMatchObject({ result: 'concurrent' });
  });
});
