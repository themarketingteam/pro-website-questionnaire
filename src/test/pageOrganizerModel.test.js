import { describe, expect, it } from 'vitest';
import {
  addPage,
  countPageSelections,
  createPageNode,
  createPageStructure,
  flattenPageStructure,
  getPageCatalogId,
  movePage,
  normalizePageStructure,
  projectPageStructure,
  removePage,
  validatePageStructure
} from '../lib/pageOrganizerModel.js';

const groups = {
  'Managed IT Services': ['Managed IT', 'Remote Monitoring & Management (RMM)', 'On-Site Support'],
  'IT Support Services': ['IT Help Desk'],
  'Cloud Solutions': ['Cloud Services'],
  'Modern Workplace & Productivity Solutions': ['Microsoft 365', 'Internet Services'],
  'Network & Infrastructure Services': ['Structured Cabling']
};
const industries = ['Healthcare / Medical', 'Financial / Accounting / CPA'];
const byLabel = (structure, label) => flattenPageStructure(structure).find((node) => node.label === label);

describe('page organizer legacy conversion', () => {
  it('keeps CATEGORY all-children semantics, PARENT selective semantics, and child-only selections', () => {
    const structure = createPageStructure('3', [
      'CATEGORY:Managed IT Services',
      'PARENT:IT Support Services',
      'Cloud Services'
    ], [], groups);

    expect(structure.pages.map((node) => node.label)).toEqual(['Managed IT Services', 'IT Support Services', 'Cloud Solutions']);
    expect(structure.pages[0].children.map((node) => node.label)).toEqual(groups['Managed IT Services']);
    expect(structure.pages[1].children).toEqual([]);
    expect(structure.pages[2].children.map((node) => node.label)).toEqual(['Cloud Services']);
    expect(countPageSelections(structure, '3', groups)).toBe(4);
    expect(projectPageStructure(structure).selections.join('|')).not.toMatch(/PARENT:|CATEGORY:/);
  });

  it('preserves unknown main labels and custom strings with commas as individual custom pages', () => {
    const structure = createPageStructure('3', ['Retired Service', 'PARENT:Retired Category'], 'IT Compliance Consulting (HIPAA, SOC 2)', groups);
    expect(projectPageStructure(structure)).toEqual({
      selections: [],
      otherValues: ['Retired Service', 'Retired Category', 'IT Compliance Consulting (HIPAA, SOC 2)']
    });
    expect(countPageSelections(structure, '3', groups)).toBe(3);
  });

  it('converts both legacy Other representations without discarding duplicate custom values', () => {
    const stringOther = createPageStructure('4', ['Healthcare / Medical'], 'Finance, insurance and legal', {}, industries);
    const arrayOther = createPageStructure('4', ['Healthcare / Medical'], ['Finance, insurance and legal', 'Finance, insurance and legal', ''], {}, industries);
    expect(projectPageStructure(stringOther)).toEqual({ selections: ['Healthcare / Medical'], otherValues: ['Finance, insurance and legal'] });
    expect(projectPageStructure(arrayOther).otherValues).toHaveLength(2);
    expect(countPageSelections(arrayOther, '4')).toBe(3);
  });

  it('retains unknown industries as custom when the catalog is provided', () => {
    const structure = createPageStructure('4', ['Healthcare / Medical', 'Legacy Vertical'], [], {}, industries);
    expect(projectPageStructure(structure)).toEqual({ selections: ['Healthcare / Medical'], otherValues: ['Legacy Vertical'] });
  });

  it('produces deterministic IDs without mutating legacy inputs, and normalizes idempotently', () => {
    const selections = Object.freeze(['CATEGORY:Managed IT Services', 'Managed IT']);
    const other = Object.freeze(['Apple support']);
    const first = createPageStructure('3', selections, other, groups);
    expect(createPageStructure('3', selections, other, groups)).toEqual(first);
    expect(normalizePageStructure(normalizePageStructure(first))).toEqual(first);
    expect(createPageStructure('3', first)).toEqual(first);
    expect(new Set(flattenPageStructure(first).map((node) => node.id)).size).toBe(flattenPageStructure(first).length);
  });

  it('refuses unsupported legacy content rather than silently removing it', () => {
    expect(() => createPageStructure('3', ['Managed IT', { unsupported: 'important content' }], [], groups)).toThrow(/unsupported legacy value/);
  });
});

describe('page organizer ordering and catalog provenance', () => {
  it('round-trips the Scout Cloud Services inversion while preserving identities and original count weights', () => {
    const original = createPageStructure('3', [
      'PARENT:Cloud Solutions', 'Cloud Services',
      'PARENT:Modern Workplace & Productivity Solutions', 'Microsoft 365', 'Internet Services',
      'PARENT:Network & Infrastructure Services', 'Structured Cabling'
    ], [], groups);
    const cloudSolutions = byLabel(original, 'Cloud Solutions');
    const cloudServices = byLabel(original, 'Cloud Services');
    const workplace = byLabel(original, 'Modern Workplace & Productivity Solutions');
    const microsoft = byLabel(original, 'Microsoft 365');
    const internet = byLabel(original, 'Internet Services');
    const network = byLabel(original, 'Network & Infrastructure Services');
    let next = movePage(original, cloudServices.id, null, 0);
    next = movePage(next, cloudSolutions.id, cloudServices.id, 0);
    next = movePage(next, microsoft.id, cloudServices.id, 1);
    next = movePage(next, internet.id, network.id, 0);
    next = movePage(next, workplace.id, cloudServices.id, 1);

    const restored = normalizePageStructure(JSON.parse(JSON.stringify(next)));
    expect(restored.pages[0].label).toBe('Cloud Services');
    expect(restored.pages[0].children.map((node) => node.label)).toEqual(['Cloud Solutions', 'Modern Workplace & Productivity Solutions', 'Microsoft 365']);
    expect(byLabel(restored, 'Cloud Solutions').id).toBe(cloudSolutions.id);
    expect(byLabel(restored, 'Cloud Services').catalogId).toBe(cloudServices.catalogId);
    expect(countPageSelections(restored, '3', groups)).toBe(4);
    expect(countPageSelections(original, '3', groups)).toBe(4);
    expect(projectPageStructure(restored).selections.slice(0, 4)).toEqual(['Cloud Services', 'Cloud Solutions', 'Modern Workplace & Productivity Solutions', 'Microsoft 365']);
    expect(original.pages[0].label).toBe('Cloud Solutions');
    expect(original.pages[0].children[0].label).toBe('Cloud Services');
  });

  it('counts catalog parents zero after rename and custom parents one regardless of children', () => {
    let structure = createPageStructure('3', ['Managed IT'], [], groups);
    structure.pages[0].label = 'IT Services';
    const custom = createPageNode('3', 'Special projects');
    structure = addPage(structure, custom);
    structure = movePage(structure, structure.pages[0].children[0].id, custom.id);
    expect(countPageSelections(structure, '3', groups)).toBe(2);
    expect(structure.pages[0].catalogId).toBe(getPageCatalogId('3', 'Managed IT Services', 'parent'));
    expect(countPageSelections(structure, '3')).toBe(2);
    expect(countPageSelections(structure, '3', { 'New catalog group': ['A new option'] })).toBe(2);
  });

  it('counts every industry node after custom grouping and emits source-separated priority projections', () => {
    let structure = createPageStructure('4', industries, ['Professional firms'], {}, industries);
    const custom = byLabel(structure, 'Professional firms');
    structure = movePage(structure, byLabel(structure, industries[1]).id, custom.id);
    expect(countPageSelections(structure, '4')).toBe(3);
    expect(projectPageStructure(structure)).toEqual({ selections: industries, otherValues: ['Professional firms'] });
  });

  it('removes parents while promoting their children at the same priority and keeping child IDs', () => {
    const original = createPageStructure('3', ['CATEGORY:Managed IT Services', 'Cloud Services'], [], groups);
    const parent = original.pages[0];
    const next = removePage(original, parent.id);
    expect(next.pages.slice(0, 3).map((node) => node.id)).toEqual(parent.children.map((node) => node.id));
    expect(countPageSelections(next, '3', groups)).toBe(countPageSelections(original, '3', groups));
    const removedChild = removePage(original, parent.children[0].id);
    expect(removedChild.pages[0].children.map((node) => node.label)).toEqual(['Remote Monitoring & Management (RMM)', 'On-Site Support']);
  });

  it('treats reorder indexes as final sibling positions and refuses destructive or deep moves', () => {
    const structure = createPageStructure('4', industries, ['Custom'], {}, industries);
    const firstId = structure.pages[0].id;
    const reordered = movePage(structure, firstId, null, 2);
    expect(reordered.pages.map((node) => node.label)).toEqual([industries[1], 'Custom', industries[0]]);
    const nested = movePage(structure, structure.pages[1].id, firstId);
    expect(() => movePage(nested, firstId, nested.pages[1].id)).toThrow(/Move child pages out/);
    expect(() => movePage(nested, nested.pages[1].id, nested.pages[0].children[0].id)).toThrow(/Only a top-level/);
    expect(() => movePage(structure, firstId, firstId)).toThrow(/own parent/);
    expect(() => movePage(structure, firstId, null, 100)).toThrow(/outside/);
    expect(structure.pages[0].id).toBe(firstId);
  });
});

describe('page organizer strict validation', () => {
  const node = () => createPageNode('4', 'Example');

  it('accepts explicitly adopted empty structures without reviving legacy values', () => {
    const structure = { format: 'page-tree-v1', pages: [] };
    expect(validatePageStructure(structure)).toEqual({ ok: true, errors: [] });
    expect(createPageStructure('4', structure, ['Old Other'], {}, industries)).toEqual(structure);
  });

  it.each([
    ['unsupported format', () => ({ format: 'page-tree-v2', pages: [] })],
    ['missing pages', () => ({ format: 'page-tree-v1' })],
    ['missing children', () => { const value = node(); delete value.children; return { format: 'page-tree-v1', pages: [value] }; }],
    ['duplicate IDs', () => { const value = node(); return { format: 'page-tree-v1', pages: [value, { ...value }] }; }],
    ['duplicate catalog identity', () => { const a = createPageNode('4', industries[0], { source: 'predefined', catalogId: getPageCatalogId('4', industries[0]) }); return { format: 'page-tree-v1', pages: [a, { ...a, id: 'different' }] }; }],
    ['more than two levels', () => ({ format: 'page-tree-v1', pages: [{ ...node(), children: [{ ...node(), children: [node()] }] }] })],
    ['blank labels', () => ({ format: 'page-tree-v1', pages: [{ ...node(), label: '   ' }] })],
    ['long labels', () => ({ format: 'page-tree-v1', pages: [{ ...node(), label: 'x'.repeat(501) }] })],
    ['long IDs', () => ({ format: 'page-tree-v1', pages: [{ ...node(), id: 'x'.repeat(161) }] })],
    ['bad source', () => ({ format: 'page-tree-v1', pages: [{ ...node(), source: 'imported' }] })],
    ['missing catalog provenance', () => ({ format: 'page-tree-v1', pages: [{ ...node(), source: 'predefined' }] })],
    ['custom catalog provenance', () => ({ format: 'page-tree-v1', pages: [{ ...node(), catalogId: 'unexpected' }] })],
    ['extra properties', () => ({ format: 'page-tree-v1', pages: [{ ...node(), important: 'must not disappear' }] })],
    ['more than 100 pages', () => ({ format: 'page-tree-v1', pages: Array.from({ length: 101 }, node) })]
  ])('rejects %s without silently normalizing away content', (_name, makeStructure) => {
    const structure = makeStructure();
    const before = JSON.stringify(structure);
    expect(validatePageStructure(structure).ok).toBe(false);
    expect(() => normalizePageStructure(structure)).toThrow();
    expect(JSON.stringify(structure)).toBe(before);
  });

  it('rejects duplicate additions and preserves the original structure', () => {
    const structure = createPageStructure('4', [industries[0]], [], {}, industries);
    expect(() => addPage(structure, structure.pages[0])).toThrow(/Duplicate/);
    expect(structure.pages).toHaveLength(1);
  });
});
