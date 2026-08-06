import { describe, expect, it } from 'vitest';
import {
  getSafeDraftEventMappingDiagnostics,
  mapDraftMutationToEvent,
} from '@/lib/proDraftEventMapper';

const mutation = (overrides = {}) => ({
  mutationId: 'mutation-1',
  mutationType: 'response_set',
  reason: 'response_change',
  questionId: '6',
  changes: [{ fieldPath: 'responses.6', operation: 'set' }],
  ...overrides,
});

describe('proDraftEventMapper', () => {
  it('debounces text typing without including the raw answer', () => {
    const mapping = mapDraftMutationToEvent(mutation());
    expect(mapping.event.eventType).toBe('text_changed');
    expect(mapping.debounceMs).toBe(1_000);
    expect(mapping.event).not.toHaveProperty('value');
    expect(getSafeDraftEventMappingDiagnostics(mapping)).toMatchObject({
      includesRawValue: false,
      includesCredential: false,
      includesToken: false,
    });
  });

  it.each([
    ['question_reset', 'question_reset', 'question_reset'],
    ['conditional_cleanup', 'conditional_cleanup', 'conditional_cleanup'],
    ['location_remove', 'response_change', 'location_remove'],
  ])('maps %s immediately', (mutationType, reason, eventType) => {
    const mapping = mapDraftMutationToEvent(mutation({ mutationType, reason, questionId: '5' }));
    expect(mapping.event.eventType).toBe(eventType);
    expect(mapping.debounceMs).toBe(0);
  });
});
