import { describe, expect, it } from 'vitest';
import scoutLegacy from '../../fixtures/scout-networks-legacy.json';
import { ACCEPTED_INDUSTRY_OPTIONS, SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import { normalizePersistedStateV3 } from '@/components/store/normalization';
import formReducer, { deleteResponse, loadInitialState, resetForm, setResponse } from '@/components/store/formSlice';
import { transformResponsesToPayload, validateSubmissionPayload } from '@/components/pro-form/submissionPayload';
import { formatAnswerForDisplay } from '@/components/pro-form/answerFormatting';
import { formatAnswerForPdf } from '@/components/pro-form/pdf/pdfAnswerFormatting';
import { buildQuestionnaireAiFormContext } from '@/components/pro-form/AIContentModal';
import { buildQuestionnairePdfSnapshot, questionnaireResponsesFromSubmissionPayload } from '@/lib/questionnairePdfVersions';
import { repairSubmissionPayloadServer, validateSubmissionPayloadServer } from '@/lib/server/proSubmissionRepairHelpers';
import { addPage, countPageSelections, createPageNode, createPageStructure, flattenPageStructure, movePage, projectPageStructure } from '@/lib/pageOrganizerModel';
import { preserveOrganizedMappedPayload, serializePageStructure, validateOrganizedPayload, validateOrganizedSubmission } from '../../base44/shared/pageOrganizerContract.js';

const legacyResponses = () => questionnaireResponsesFromSubmissionPayload(scoutLegacy);
const payloadFor = (responses) => transformResponsesToPayload(responses, 'Scout Networks', 'scoutnetworks.net', SERVICE_OPTIONS_GROUPED);
const roundTrip = (responses) => normalizePersistedStateV3(JSON.parse(JSON.stringify({ responses })));

const scoutStructure = () => {
  const initial = createPageStructure('3', scoutLegacy.userdata.service_offerings, scoutLegacy.userdata.service_offerings_other, SERVICE_OPTIONS_GROUPED);
  const byLabel = new Map(flattenPageStructure(initial).map((node) => [node.label, node]));
  const desired = [
    ['Managed IT Services', ['Managed IT', 'Remote Monitoring & Management (RMM)', 'IT Support Services', 'IT Help Desk', 'On-Site Support']],
    ['Cloud Services', ['Cloud Solutions', 'Modern Workplace & Productivity Solutions', 'Microsoft 365']],
    ['Cybersecurity Services', ['EDR (Endpoint Detection & Response)', 'Email Security']],
    ['Network & Infrastructure Services', ['Network Design & Implementation', 'Structured Cabling', 'Internet Services']],
    ['Business Continuity Services', ['Data Backup & Disaster Recovery Services', 'Data Backup & Recovery', 'Backup Monitoring & Management']],
    ['Physical Security Solutions', ['Video Surveillance Solutions', 'Access Control Systems']]
  ];
  return {
    format: 'page-tree-v1',
    pages: desired.map(([parent, children]) => ({
      ...byLabel.get(parent),
      children: children.map((label) => ({ ...byLabel.get(label), children: [] }))
    }))
  };
};

describe('page organizer persistence and submission compatibility', () => {
  it('keeps the supplied Scout legacy values and legacy payload version unchanged until adoption', () => {
    const responses = legacyResponses();
    const before = structuredClone(responses);
    const normalized = roundTrip(responses);
    const payload = payloadFor(normalized.responses);
    expect(payload.userdata.service_offerings).toEqual(scoutLegacy.userdata.service_offerings);
    expect(payload.userdata.target_industries).toEqual(scoutLegacy.userdata.target_industries);
    expect(payload.userdata.service_offerings_other).toBe('');
    expect(payload.metadata).not.toHaveProperty('questionnaire_payload_version');
    expect(payload.userdata).not.toHaveProperty('service_offerings_structure');
    expect(normalized.responses).not.toHaveProperty('3_structure');
    expect(normalized.responses).not.toHaveProperty('4_structure');
    expect(responses).toEqual(before);
    expect(validateSubmissionPayload(payload).ok).toBe(true);
  });

  it('preserves every Scout page, ID, new parent and sibling priority through JSON, Redux, frontend mapping and server repair', () => {
    const structure = scoutStructure();
    const initial = createPageStructure('3', scoutLegacy.userdata.service_offerings, '', SERVICE_OPTIONS_GROUPED);
    expect(flattenPageStructure(structure).map((node) => node.id).sort()).toEqual(flattenPageStructure(initial).map((node) => node.id).sort());
    const restored = roundTrip({ ...legacyResponses(), '3_structure': structure });
    const state = formReducer(undefined, loadInitialState(restored));
    expect(state.responses['3_structure']).toEqual(structure);
    expect(countPageSelections(state.responses['3_structure'], '3', SERVICE_OPTIONS_GROUPED)).toBe(15);
    const payload = payloadFor(state.responses);
    expect(payload.metadata.questionnaire_payload_version).toBe(2);
    expect(payload.userdata.service_offerings.slice(6, 10)).toEqual(['Cloud Services', 'Cloud Solutions', 'Modern Workplace & Productivity Solutions', 'Microsoft 365']);
    const repaired = repairSubmissionPayloadServer(JSON.parse(JSON.stringify(payload)));
    expect(repaired.ok).toBe(true);
    expect(repaired.payload.userdata.service_offerings_structure).toEqual(serializePageStructure(structure));
    expect(repaired.payload.userdata.service_offerings).toEqual(projectPageStructure(structure).selections);
    expect(validateSubmissionPayload(repaired.payload).ok).toBe(true);
    expect(validateSubmissionPayloadServer(repaired.payload).ok).toBe(true);
    expect(validateOrganizedSubmission({ payload: repaired.payload, responses: state.responses }).ok).toBe(true);
    expect(payload.userdata.target_industries).toEqual(scoutLegacy.userdata.target_industries);
    expect(payload.userdata).not.toHaveProperty('target_industries_structure');
  });

  it('supports adopting only Q4 and keeps a custom parent and comma-containing custom child as separate pages', () => {
    let structure = createPageStructure('4', ['Healthcare / Medical', 'Legal Firms'], [], {}, ACCEPTED_INDUSTRY_OPTIONS);
    const customParent = createPageNode('4', 'Professional organizations');
    const customChild = createPageNode('4', 'Finance, insurance and legal');
    structure = addPage(structure, customParent, null, 0);
    structure = addPage(structure, customChild, customParent.id);
    structure = movePage(structure, structure.pages[2].id, customParent.id, 0);
    const restored = roundTrip({ ...legacyResponses(), '4_structure': structure, '4_other': 'STALE CUSTOM FIELD' });
    expect(restored.responses['4_other']).toEqual(['Professional organizations', 'Finance, insurance and legal']);
    const payload = payloadFor(restored.responses);
    expect(payload.metadata.questionnaire_payload_version).toBe(2);
    expect(payload.userdata.service_offerings).toEqual(scoutLegacy.userdata.service_offerings);
    expect(payload.userdata).not.toHaveProperty('service_offerings_structure');
    expect(payload.userdata.target_industries).toEqual(['Legal Firms', 'Healthcare / Medical']);
    expect(payload.userdata.target_industries_other).toBe('Professional organizations, Finance, insurance and legal');
    expect(payload.userdata.target_industries_structure.pages[0].children[1].label).toBe('Finance, insurance and legal');
    expect(countPageSelections(restored.responses['4_structure'], '4')).toBe(4);
    expect(validateOrganizedPayload(payload).ok).toBe(true);
  });

  it('exports only page labels, sources and nonempty root children while retaining the editor identities', () => {
    let structure = createPageStructure('4', ['Financial', 'CPA', 'Accounting'], [], {}, ACCEPTED_INDUSTRY_OPTIONS);
    const financial = structure.pages[0];
    structure = movePage(structure, structure.pages[1].id, financial.id);
    structure = movePage(structure, structure.pages[1].id, financial.id);
    structure = addPage(structure, createPageNode('4', 'Independent Clinics, Local'));
    const responses = { ...legacyResponses(), '4_structure': structure };
    const before = structuredClone(responses);
    const payload = payloadFor(responses);
    expect(payload.userdata.target_industries_structure).toEqual({
      format: 'page-tree-v1',
      pages: [
        { label: 'Financial', source: 'predefined', children: [
          { label: 'CPA', source: 'predefined' },
          { label: 'Accounting', source: 'predefined' }
        ] },
        { label: 'Independent Clinics, Local', source: 'custom' }
      ]
    });
    expect(payload.userdata.target_industries).toEqual(['Financial', 'CPA', 'Accounting']);
    expect(payload.userdata.target_industries_other).toBe('Independent Clinics, Local');
    expect(responses).toEqual(before);
    expect(responses['4_structure'].pages[0].children[0]).toHaveProperty('id');
    expect(responses['4_structure'].pages[0].children[0]).toHaveProperty('catalogId');
    expect(validateOrganizedSubmission({ payload, responses }).ok).toBe(true);
  });

  it('treats explicit organized emptiness as empty instead of restoring stale flat answers', () => {
    const empty = { format: 'page-tree-v1', pages: [] };
    const restored = roundTrip({ ...legacyResponses(), '3_structure': empty, '3_other': ['Stale custom page'] });
    expect(restored.responses['3']).toEqual([]);
    expect(restored.responses['3_other']).toEqual([]);
    const payload = payloadFor(restored.responses);
    expect(payload.userdata.service_offerings).toEqual([]);
    expect(payload.userdata.service_offerings_other).toBe('');
    expect(payload.userdata.service_offerings_structure).toEqual(empty);
    expect(payload.metadata.questionnaire_payload_version).toBe(2);
  });

  it.each([
    null,
    { format: 'unknown-future-format', pages: [] },
    { format: 'page-tree-v1', pages: [{ id: 'important', label: 'Preserve for review', source: 'custom', catalogId: null }] }
  ])('retains malformed adopted content for recovery and refuses submission instead of downgrading: %o', (structure) => {
    const responses = { ...legacyResponses(), '3_structure': structure };
    const restored = roundTrip(responses);
    expect(restored.responses['3_structure']).toEqual(structure);
    expect(restored.responses['3']).toEqual(responses['3']);
    expect(() => payloadFor(restored.responses)).toThrow();
  });

  it('preserves organized responses during unrelated edits and clears their structure with the question or entire form', () => {
    const structure = scoutStructure();
    let state = formReducer(undefined, loadInitialState(roundTrip({ ...legacyResponses(), '3_structure': structure })));
    state = formReducer(state, setResponse({ questionId: '6', value: 'An unrelated company description edit.' }));
    expect(state.responses['3_structure']).toEqual(structure);
    const questionCleared = formReducer(state, deleteResponse('3'));
    expect(questionCleared.responses).not.toHaveProperty('3_structure');
    expect(questionCleared.responses).not.toHaveProperty('3');
    expect(questionCleared.responses).not.toHaveProperty('3_other');
    expect(questionCleared.responses['4']).toEqual(state.responses['4']);
    expect(formReducer(state, resetForm()).responses).toEqual({});
  });

  it('rebuilds only the adopted compatibility projection from a saved tree and blocks contradictory repair inputs', () => {
    const structure = scoutStructure();
    const responses = { ...legacyResponses(), '3_structure': structure };
    const legacyPayload = payloadFor(legacyResponses());
    const mapped = preserveOrganizedMappedPayload(legacyPayload, responses);
    expect(mapped.userdata.service_offerings_structure).toEqual(serializePageStructure(structure));
    expect(mapped.userdata.service_offerings).toEqual(projectPageStructure(structure).selections);
    expect(mapped.userdata.target_industries).toEqual(legacyPayload.userdata.target_industries);
    expect(legacyPayload.userdata).not.toHaveProperty('service_offerings_structure');
    const corrupted = structuredClone(mapped);
    corrupted.userdata.service_offerings = ['Cloud Solutions'];
    expect(repairSubmissionPayloadServer(corrupted).ok).toBe(false);
    expect(validateSubmissionPayloadServer(corrupted).ok).toBe(false);
  });
});

describe('page organizer review and PDF display', () => {
  const organizedResponses = () => {
    const structure = scoutStructure();
    const custom = createPageNode('3', 'Compliance Consulting (HIPAA, SOC 2)');
    return { ...legacyResponses(), '3_structure': addPage(structure, custom, structure.pages[2].id), '3_other': [custom.label] };
  };

  it('shows parent and sibling priority with indentation, custom pages once, and no stale Other append', () => {
    const responses = organizedResponses();
    const displayed = formatAnswerForDisplay('3', responses['3'], responses['3_other'], responses);
    const pdf = formatAnswerForPdf('3', responses['3'], responses['3_other'], responses);
    expect(displayed).toBe(pdf);
    expect(displayed).toContain('2. Cloud Services\n    1. Cloud Solutions\n    2. Modern Workplace & Productivity Solutions\n    3. Microsoft 365');
    expect(displayed).toContain('3. Cybersecurity Services\n    1. EDR (Endpoint Detection & Response)\n    2. Email Security\n    3. Compliance Consulting (HIPAA, SOC 2)');
    expect(displayed.match(/Compliance Consulting \(HIPAA, SOC 2\)/g)).toHaveLength(1);
    expect(displayed).not.toContain('Other:');
  });

  it('reconstructs the hierarchy for a PDF downloaded from a saved structured submission', () => {
    const responses = organizedResponses();
    const payload = payloadFor(responses);
    const snapshot = buildQuestionnairePdfSnapshot({ payload });
    expect(serializePageStructure(snapshot.formData['3_structure'])).toEqual(serializePageStructure(responses['3_structure']));
    expect(formatAnswerForPdf('3', snapshot.formData['3'], snapshot.formData['3_other'], snapshot.formData)).toBe(formatAnswerForPdf('3', responses['3'], responses['3_other'], responses));
  });

  it('distinguishes explicit empty structures and invalid structures without displaying stale fallback answers', () => {
    const empty = { '3_structure': { format: 'page-tree-v1', pages: [] } };
    expect(formatAnswerForDisplay('3', ['Stale selection'], 'Stale Other', empty)).toBe('Not answered');
    expect(formatAnswerForPdf('3', ['Stale selection'], 'Stale Other', empty)).toBe('');
    const invalid = { '3_structure': { format: 'future', pages: [] } };
    expect(formatAnswerForDisplay('3', ['Stale selection'], '', invalid)).toMatch(/needs review/);
    expect(formatAnswerForPdf('3', ['Stale selection'], '', invalid)).toMatch(/needs review/);
  });

  it('includes the authoritative structure and comma-preserving custom values in AI context', () => {
    const responses = organizedResponses();
    const context = buildQuestionnaireAiFormContext(responses, { businessName: 'Scout Networks' });
    const projected = projectPageStructure(responses['3_structure']);
    expect(context.businessName).toBe('Scout Networks');
    expect(context.responses.service_offerings_structure).toEqual(serializePageStructure(responses['3_structure']));
    expect(context.responses.service_offerings).toEqual(projected.selections);
    expect(context.responses.service_offerings_other).toBe('Compliance Consulting (HIPAA, SOC 2)');
    expect(context.responses).not.toHaveProperty('target_industries_structure');
  });
});
