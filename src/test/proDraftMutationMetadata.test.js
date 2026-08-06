import { describe, expect, it } from 'vitest';
import {
  coalesceProDraftMutations,
  mapProDraftActionToMutation,
} from '@/lib/proDraftMutationMetadata';

describe('proDraftMutationMetadata', () => {
  it('maps validation, touched, expanded, text metadata, and UI drafts to canonical paths', () => {
    const cases = [
      [{ type: 'form/setValidationStatus', payload: { questionId: '6' } }, 'validationStatus.6'],
      [{ type: 'form/setTouchedQuestion', payload: { questionId: '6' } }, 'touchedQuestions.6'],
      [{ type: 'form/setExpandedQuestion', payload: { questionId: '6' } }, 'expandedQuestions.6'],
      [{ type: 'form/setTextareaDirtyMeta', payload: { questionId: '6' } }, 'textValidationMeta.6'],
      [{ type: 'form/setUiDraftState', payload: { scopeKey: 'question:6:editor' } }, 'uiDraftState.question:6:editor'],
    ];
    for (const [action, path] of cases) {
      expect(mapProDraftActionToMutation(action).changes[0].fieldPath).toBe(path);
    }
  });

  it('coalesces related post-reducer actions into one mutation ID and revision capture', () => {
    const entries = [
      mapProDraftActionToMutation({ type: 'form/setResponse', payload: { questionId: '6' } }),
      mapProDraftActionToMutation({ type: 'form/setTouchedQuestion', payload: { questionId: '6' } }),
    ];
    const result = coalesceProDraftMutations(entries, {
      now: () => Date.parse('2026-08-06T12:00:00.000Z'),
      crypto: null,
      random: () => 0.5,
    });
    expect(result.reason).toBe('response_change');
    expect(result.questionId).toBe('6');
    expect(result.changes).toHaveLength(2);
    expect(result.mutationId).toHaveLength(32);
  });

  it('captures initialized expanded-question state as a bulk canonical change', () => {
    const result = mapProDraftActionToMutation({
      type: 'form/initializeExpandedQuestions',
      payload: { 1: true, 2: false },
    });

    expect(result.mutationType).toBe('expanded_initialize');
    expect(result.changes).toEqual([
      { fieldPath: 'expandedQuestions.1', operation: 'set' },
      { fieldPath: 'expandedQuestions.2', operation: 'set' },
    ]);
  });
});
