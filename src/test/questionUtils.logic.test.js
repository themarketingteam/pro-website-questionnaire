import { describe, it, expect } from 'vitest';
import { QUESTIONS } from '@/components/pro-form/questionData';
import { computeParentValidationStatus } from '@/components/pro-form/questionUtils';

function q(id) { return QUESTIONS.find(q => q.id === id); }

describe('computeParentValidationStatus — optional child safety', () => {
  it('Q23: optional child 23.1 never blocks parent when parent is yes', () => {
    const parent = q('23');
    expect(computeParentValidationStatus(parent, 'yes', {})).toBe('complete');
    expect(computeParentValidationStatus(parent, 'yes', { '23.1': 'incomplete' })).toBe('complete');
    expect(computeParentValidationStatus(parent, 'yes', { '23.1': 'needs_work' })).toBe('complete');
    expect(computeParentValidationStatus(parent, 'yes', { '23.1': 'complete' })).toBe('complete');
  });

  it('Q25: optional child 25.1 never blocks parent when parent is yes', () => {
    const parent = q('25');
    expect(computeParentValidationStatus(parent, 'yes', {})).toBe('complete');
    expect(computeParentValidationStatus(parent, 'yes', { '25.1': 'incomplete' })).toBe('complete');
    expect(computeParentValidationStatus(parent, 'yes', { '25.1': 'needs_work' })).toBe('complete');
    expect(computeParentValidationStatus(parent, 'yes', { '25.1': 'complete' })).toBe('complete');
  });
});