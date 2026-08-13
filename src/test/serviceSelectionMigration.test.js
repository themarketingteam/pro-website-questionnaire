import { describe, expect, it } from 'vitest';
import { SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import { normalizePersistedState } from '@/components/store/normalization';

describe('Question 3 persisted-state migration', () => {
  it('preserves the original all-services meaning of a legacy CATEGORY selection', () => {
    const normalized = normalizePersistedState({
      responses: { '3': ['CATEGORY:Managed IT Services'] }
    });

    expect(normalized.responses['3']).toEqual([
      'PARENT:Managed IT Services',
      ...SERVICE_OPTIONS_GROUPED['Managed IT Services']
    ]);
  });

  it('automatically activates the parent of an existing child-only selection', () => {
    const normalized = normalizePersistedState({
      responses: { '3': ['Cybersecurity'] }
    });

    expect(normalized.responses['3']).toEqual([
      'PARENT:Cybersecurity Services',
      'Cybersecurity'
    ]);
  });
});
