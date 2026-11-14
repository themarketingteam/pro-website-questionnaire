import { describe, expect, it } from 'vitest';
import {
  normalizeStoredOrganizedRecord,
  serializeStoredPageStructure,
  serializePageStructure,
  validateMappedPageStructure,
  validatePageStructure
} from '../../base44/shared/pageOrganizerContract.js';
import { buildQuestionnairePdfSnapshot } from '@/lib/questionnairePdfVersions';
import { formatAnswerForPdf } from '@/components/pro-form/pdf/pdfAnswerFormatting';
import { validateSubmissionReceipt } from '@/lib/proSubmissionResilience';

const compact = () => ({ format: 'page-tree-v1', pages: [
  { label: 'Cloud Services', source: 'predefined', children: [{ label: 'Custom cloud, with comma', source: 'custom' }] },
  { label: 'Standalone', source: 'custom' }
] });
const hydrate = () => ({ format: 'page-tree-v1', pages: [
  { label: 'Cloud Services', source: 'predefined', id: null, catalogId: null, children: [{ label: 'Custom cloud, with comma', source: 'custom', id: null, catalogId: null, children: [] }] },
  { label: 'Standalone', source: 'custom', id: null, catalogId: null, children: [] }
] });
const record = () => ({ id: 'persisted-receipt', metadata: { questionnaire_payload_version: 2 }, userdata: {
  service_offerings_structure: hydrate(), target_industries_structure: null,
  service_offerings: ['Cloud Services'], service_offerings_other: 'Custom cloud, with comma, Standalone',
  target_industries: ['Financial / Accounting / CPA'], target_industries_other: ''
} });

describe('persisted Pro organizer DTO compatibility', () => {
  it('removes only entity padding without relaxing strict wire or raw validation', () => {
    const stored = hydrate(); const before = structuredClone(stored);
    expect(validateMappedPageStructure(stored).ok).toBe(false);
    expect(validatePageStructure(stored).ok).toBe(false);
    expect(() => serializePageStructure(stored)).toThrow();
    expect(serializeStoredPageStructure(stored)).toEqual(compact());
    expect(stored).toEqual(before);
  });

  it('preserves partial adoption, projections, and old combined industry values on entity reads', () => {
    const dto = record(); const before = structuredClone(dto);
    const normalized = normalizeStoredOrganizedRecord(dto);
    expect(normalized.userdata.service_offerings_structure).toEqual(compact());
    expect(normalized.userdata).not.toHaveProperty('target_industries_structure');
    expect(normalized.userdata.target_industries).toEqual(['Financial / Accounting / CPA']);
    expect(normalized.metadata.questionnaire_payload_version).toBe(2);
    expect(validateSubmissionReceipt(dto, normalized)).toEqual(normalized);
    expect(dto).toEqual(before);
  });

  it('treats absent optional entity fields as legacy without inventing adoption or editor IDs', () => {
    const dto = { metadata: { questionnaire_payload_version: null }, userdata: { service_offerings_structure: null, target_industries_structure: null, service_offerings: ['Managed IT'], service_offerings_other: 'Custom, with comma' } };
    expect(normalizeStoredOrganizedRecord(dto)).toEqual({ metadata: {}, userdata: { service_offerings: ['Managed IT'], service_offerings_other: 'Custom, with comma' } });
    const snapshot = buildQuestionnairePdfSnapshot({ payload: record() });
    expect(snapshot.formData['3_structure']).toEqual(compact());
    expect(snapshot.formData).not.toHaveProperty('4_structure');
    const displayed = formatAnswerForPdf('3', snapshot.formData['3'], snapshot.formData['3_other'], snapshot.formData);
    expect(displayed).toBe('1. Cloud Services\n    1. Custom cloud, with comma\n2. Standalone');
    expect(snapshot.formData['3_structure'].pages.every((page) => !Object.hasOwn(page, 'id'))).toBe(true);
  });

  it('aligns only extra optional DTO padding to the submitted shape and rejects marker-only adoption', () => {
    const submitted = normalizeStoredOrganizedRecord(record());
    const dto = record();
    dto.userdata.optional_scalar = null;
    dto.userdata.optional_array = [];
    dto.userdata.meaningful_extra = 'Preserve this for fingerprint rejection';
    const aligned = normalizeStoredOrganizedRecord(dto, submitted);
    expect(aligned.userdata).not.toHaveProperty('optional_scalar');
    expect(aligned.userdata).not.toHaveProperty('optional_array');
    expect(aligned.userdata.meaningful_extra).toBe('Preserve this for fingerprint rejection');
    expect(() => normalizeStoredOrganizedRecord({ metadata: { questionnaire_payload_version: 2 }, userdata: { service_offerings_structure: null, target_industries_structure: null } })).toThrow();
  });

  it.each([
    (value) => { value.pages[0].id = 'partial-real-id'; },
    (value) => { value.pages[0].catalogId = 'partial-catalog-id'; },
    (value) => { value.pages[0].children[0].children = [{ label: 'Grandchild', source: 'custom' }]; },
    (value) => { value.pages[0].children[0].unknown = null; },
    (value) => { value.pages[0].label = null; },
    (value) => { value.pages[1].children = null; },
    (value) => { value.format = 'page-tree-v99'; }
  ])('rejects meaningful malformed stored data rather than stripping it (%#)', (mutate) => {
    const dto = hydrate(); mutate(dto);
    const before = structuredClone(dto);
    expect(() => serializeStoredPageStructure(dto)).toThrow();
    expect(dto).toEqual(before);
  });
});
