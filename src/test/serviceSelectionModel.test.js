import { describe, expect, it } from 'vitest';
import {
  analyzeServiceSelections,
  canonicalizeServiceSelectionState,
  countSelectedServiceChildren,
  getServiceParentsWithoutChildren,
  normalizeServiceSelectionsForPayload
} from '@/lib/serviceSelectionModel';

const groupedServices = {
  'Managed IT Services': ['Managed IT', 'Co-Managed IT'],
  'Cybersecurity Services': ['Managed Security Services', 'Security Assessments']
};

describe('serviceSelectionModel', () => {
  it('emits a selected parent and only its explicitly selected children', () => {
    const selections = [
      'PARENT:Managed IT Services',
      'Managed IT'
    ];

    expect(normalizeServiceSelectionsForPayload(selections, groupedServices)).toEqual([
      'Managed IT Services',
      'Managed IT'
    ]);
    expect(countSelectedServiceChildren(selections, groupedServices)).toBe(1);
    expect(getServiceParentsWithoutChildren(selections, groupedServices)).toEqual([]);
  });

  it('keeps a parent incomplete until at least one listed child is selected', () => {
    const selections = ['PARENT:Managed IT Services', 'Unlisted custom service'];

    expect(countSelectedServiceChildren(selections, groupedServices)).toBe(1);
    expect(getServiceParentsWithoutChildren(selections, groupedServices))
      .toEqual(['Managed IT Services']);
  });

  it('migrates a legacy category to the parent and every formerly implied child', () => {
    expect(canonicalizeServiceSelectionState(
      ['CATEGORY:Managed IT Services'],
      groupedServices
    )).toEqual([
      'PARENT:Managed IT Services',
      'Managed IT',
      'Co-Managed IT'
    ]);
  });

  it('automatically activates parents for legacy orphan child selections', () => {
    expect(canonicalizeServiceSelectionState(
      ['Security Assessments', 'Managed IT'],
      groupedServices
    )).toEqual([
      'PARENT:Managed IT Services',
      'Managed IT',
      'PARENT:Cybersecurity Services',
      'Security Assessments'
    ]);
  });

  it('never exposes internal markers in the payload', () => {
    const result = analyzeServiceSelections([
      'PARENT:Cybersecurity Services',
      'Managed Security Services'
    ], groupedServices);

    expect(result.payloadSelections).toEqual([
      'Cybersecurity Services',
      'Managed Security Services'
    ]);
    expect(result.payloadSelections.join('|')).not.toMatch(/PARENT:|CATEGORY:/);
  });
});
