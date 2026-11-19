import { describe, expect, it } from 'vitest';
import { countProRecoverySeoAnswers, proRecoverySeoCountsForVersion } from '@/lib/proRecoverySeoCounts';
import { createPageNode, getPageCatalogId } from '@/lib/pageOrganizerModel';
const groups = { 'Managed IT Services': ['Managed IT', 'IT Help Desk'], 'Cloud Solutions': ['Cloud Services'] };
const count = values => countProRecoverySeoAnswers(values, groups);
const raw = responses => count({ responses });
const mapped = userdata => count({ payload: { userdata } });
const custom = (id, label, key) => createPageNode(id, label, { id: key });
const predefined = (label, kind, key) => createPageNode('3', label, { id: key, source: 'predefined', catalogId: getPageCatalogId('3', label, kind) });
const tree = (...pages) => ({ format: 'page-tree-v1', pages });

describe('Pro recovery SEO counts', () => {
  it('shows the requested 11 services, 9 industries, 5 locations and 25 total using existing legacy counters', () => {
    expect(raw({ '3': ['Managed IT Services', ...Array.from({ length: 10 }, (_, index) => `Service ${index}`)], '3_other': ['Custom service', ' '], '4': Array.from({ length: 8 }, (_, index) => `Industry ${index}`), '4_other': ['Custom industry'], '5': Array.from({ length: 5 }, (_, index) => ({ label: `Location ${index}` })) })).toEqual({ services: 11, industries: 9, locations: 5, total: 25 });
  });
  it('counts a valid fresh raw map as zero and partially answered raw maps as the form does', () => {
    expect(raw({})).toEqual({ services: 0, industries: 0, locations: 0, total: 0 });
    expect(raw({ '3': ['Managed IT'] })).toEqual({ services: 1, industries: 0, locations: 0, total: 1 });
    expect(raw({ '3': [], '4': [], '5': [] })).toEqual({ services: 0, industries: 0, locations: 0, total: 0 });
  });
  it('preserves original catalog-parent exemptions after nesting/moving and counts custom pages with the same label', () => {
    const parent = predefined('Renamed historical category', 'parent', 'old-parent');
    parent.catalogId = getPageCatalogId('3', 'Managed IT Services', 'parent');
    const service = predefined('Managed IT', 'option', 'service');
    const customPage = custom('3', 'Managed IT Services', 'custom');
    expect(raw({ '3_structure': tree(parent, service, customPage) }).services).toBe(2);
    service.children = [parent];
    expect(raw({ '3_structure': tree(service, customPage) }).services).toBe(2);
  });
  it('uses authoritative rich mapped catalog identities instead of a page label or depth', () => {
    const oldParent = predefined('Renamed category', 'parent', 'mapped-parent');
    expect(mapped({ service_offerings_structure: tree(oldParent) }).services).toBe(0);
    const optionNamedCategory = predefined('Managed IT Services', 'option', 'mapped-option');
    expect(mapped({ service_offerings_structure: tree(optionNamedCategory) }).services).toBe(1);
  });
  it('counts compact mapped predefined parents and custom entries without double counting flattened answers', () => {
    expect(mapped({ service_offerings_structure: tree({ label: 'Managed IT Services', source: 'predefined', children: [{ label: 'Managed IT', source: 'predefined' }] }, { label: 'Managed IT Services', source: 'custom' }), service_offerings: ['Managed IT Services', 'Managed IT'], service_offerings_other: 'Managed IT Services', target_industries_structure: tree({ label: 'Custom industry', source: 'custom' }), geographic_areas: [{ geographic_area_meta: { label: 'Chicago, IL' } }] })).toEqual({ services: 2, industries: 1, locations: 1, total: 4 });
  });
  it('reads optional Base44 DTO padding on mapped trees and ignores a null unused organizer field', () => {
    expect(mapped({ service_offerings_structure: { format: 'page-tree-v1', pages: [{ label: 'Managed IT', source: 'predefined', id: null, catalogId: null, children: [] }] }, target_industries_structure: null, target_industries: ['Financial / Accounting / CPA'], target_industries_other: '', geographic_areas: [{ geographic_area_meta: { name: 'Austin, TX' } }] })).toEqual({ services: 1, industries: 1, locations: 1, total: 3 });
  });
  it('keeps a malformed adopted raw tree unknown rather than falling back to flat lists or another source', () => {
    expect(raw({ '3_structure': null, '3': ['Managed IT'], '4': ['Healthcare'], '5': [] })).toEqual({ services: null, industries: 1, locations: 0, total: null });
    expect(raw({ '3_structure': { format: 'unknown', pages: [] } }).services).toBeNull();
  });
  it('does not invent zero when the answer source is missing, unreadable or only mapped DTO padding', () => {
    expect(count({})).toEqual({ services: null, industries: null, locations: null, total: null });
    expect(count({ responses: '{broken', payload: { userdata: { service_offerings: ['Managed IT'] } } })).toEqual({ services: null, industries: null, locations: null, total: null });
    expect(mapped({ service_offerings: [], service_offerings_other: null, service_offerings_structure: null, target_industries: [], target_industries_other: null, geographic_areas: [] })).toEqual({ services: null, industries: null, locations: null, total: null });
    expect(mapped({ service_offerings: [], service_offerings_other: '', target_industries: [], target_industries_other: [] })).toMatchObject({ services: 0, industries: 0, total: null });
  });
  it('does not guess-split commas in legacy Other strings and preserves historical category markers', () => {
    expect(raw({ '3': ['CATEGORY:Managed IT Services'], '3_other': 'Design, Branding & Support', '4': ['Financial / Accounting / CPA'], '4_other': ['Custom one', '', 'Custom two'] })).toEqual({ services: 3, industries: 3, locations: 0, total: 6 });
    expect(mapped({ service_offerings: ['Managed IT Services', 'Managed IT'], service_offerings_other: 'Design, Branding & Support' }).services).toBe(2);
    expect(raw({ '3': 'Managed IT', '3_other': 'Custom service' }).services).toBe(2);
  });
  it('never clamps over-limit persisted counts', () => {
    expect(raw({ '3': Array.from({ length: 17 }, (_, index) => `Service ${index}`), '4': Array.from({ length: 11 }, (_, index) => `Industry ${index}`), '5': Array.from({ length: 6 }, (_, index) => ({ label: `Place ${index}` })) })).toEqual({ services: 17, industries: 11, locations: 6, total: 34 });
  });
  it('counts selected history exclusively, including a final receipt without a raw map', () => {
    const draft = { responses_json: JSON.stringify({ '3': ['Managed IT'], '4': ['Healthcare'], '5': ['Current place'] }) };
    const selectedVersion = { sourceType: 'submission', snapshot: { responses: {} }, payload: { userdata: { service_offerings: ['Managed IT', 'IT Help Desk'], service_offerings_other: '', target_industries: ['Financial', 'CPA', 'Accounting'], target_industries_other: '', geographic_areas: ['Saved one', 'Saved two'] } } };
    expect(proRecoverySeoCountsForVersion({ selectedVersion, draft }, groups)).toEqual({ services: 2, industries: 3, locations: 2, total: 7 });
    expect(proRecoverySeoCountsForVersion({ selectedVersion: { snapshot: { responses: {} } }, draft }, groups)).toEqual({ services: 0, industries: 0, locations: 0, total: 0 });
    expect(proRecoverySeoCountsForVersion({ selectedVersion: {}, draft }, groups)).toEqual({ services: null, industries: null, locations: null, total: null });
  });
});
