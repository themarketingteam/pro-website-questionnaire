import { describe, expect, it } from 'vitest';
import { normalizePersistedStateV3 } from '@/components/store/normalization';
import { createPageNode, createPageStructure, flattenPageStructure } from '@/lib/pageOrganizerModel';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { repairProSubmissionPayload } from '@/lib/proPayloadRepair';
import { SERVICE_OPTIONS_GROUPED, INDUSTRY_OPTIONS } from '@/components/pro-form/questionData';

describe('organizer preservation at legacy and repair boundaries', () => {
  it('retains retired and custom main-array labels through rehydrate before adoption', () => {
    const normalized = normalizePersistedStateV3({ responses: {
      '3': ['PARENT:Managed IT Services', 'Managed IT', 'Retired Service Name'],
      '4': ['Healthcare / Medical', 'Specialist Clinics'], '3_other': 'Compliance, Risk and Assurance'
    } });
    expect(normalized.responses['3']).toContain('Retired Service Name');
    expect(normalized.responses['4']).toContain('Specialist Clinics');
    const services = createPageStructure('3', normalized.responses['3'], normalized.responses['3_other'], SERVICE_OPTIONS_GROUPED);
    const industries = createPageStructure('4', normalized.responses['4'], '', {}, INDUSTRY_OPTIONS);
    expect(flattenPageStructure(services).map((page) => page.label)).toContain('Retired Service Name');
    expect(flattenPageStructure(services).map((page) => page.label)).toContain('Compliance, Risk and Assurance');
    expect(flattenPageStructure(industries).find((page) => page.label === 'Specialist Clinics').source).toBe('custom');
  });

  it('does not repair an unsupported envelope version into an accepted organized submission', () => {
    const structure = { format: 'page-tree-v1', pages: [createPageNode('3', 'Custom page')] };
    const payload = transformResponsesToPayload({ '3_structure': structure }, 'Local Test', 'example.test', SERVICE_OPTIONS_GROUPED);
    payload.metadata.questionnaire_payload_version = 99;
    const repaired = repairProSubmissionPayload(payload);
    expect(repaired.ok).toBe(false);
    expect(repaired.payload.metadata.questionnaire_payload_version).toBe(99);
    expect(repaired.errors.some((message) => message.includes('version'))).toBe(true);
  });

  it('preserves all custom page labels in the compatibility projection beyond 5000 characters', () => {
    const structure = { format: 'page-tree-v1', pages: Array.from({ length: 15 }, (_, index) => createPageNode('3', `${index}: ${'x'.repeat(495)}`)) };
    const payload = transformResponsesToPayload({ '3_structure': structure }, 'Local Test', 'example.test', SERVICE_OPTIONS_GROUPED);
    expect(payload.userdata.service_offerings_other.length).toBeGreaterThan(5000);
    const repaired = repairProSubmissionPayload(payload);
    expect(repaired.ok).toBe(true);
    expect(repaired.payload.userdata.service_offerings_other).toBe(payload.userdata.service_offerings_other);
    expect(repaired.payload.userdata.service_offerings_structure).toEqual(structure);
  });
});
