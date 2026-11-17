import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as contract from '../../base44/shared/pageOrganizerContract.js';
import { repairSubmissionPayloadServer } from '../lib/server/proSubmissionRepairHelpers.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const page = (id, label, source = 'predefined', children = []) => ({ id, label, source, catalogId: source === 'predefined' ? `q3:option:${encodeURIComponent(label)}` : null, children });
const structure = () => ({ format: 'page-tree-v1', pages: [page('network', 'Network Services', 'predefined', [page('internet', 'Internet Services'), page('custom', 'Custom service, with comma', 'custom')])] });
const responses = () => ({ '3_structure': structure(), '3': ['Network Services', 'Internet Services'], '3_other': ['Custom service, with comma'], '4': ['Healthcare/Medical'], '4_other': [] });
const payload = () => ({
  metadata: { business_name: 'Example', businessDomain: 'example.test', questionnaire_payload_version: 2 },
  userdata: {
    service_offerings_structure: contract.serializePageStructure(structure()), service_offerings: ['Network Services', 'Internet Services'], service_offerings_other: 'Custom service, with comma',
    target_industries: ['Healthcare/Medical'], target_industries_other: '',
    additional_pages_list: { meet_the_team_page: { team_photo_with_tags: {} } },
    geographic_areas: [], pricing_packaging: [], company_goals: [], certifications_partnerships: [], service_guarantee_items: [], website_objectives: [], client_challenges: [], client_outcomes: []
  }
});
const legacyPayload = () => {
  const value = payload();
  delete value.metadata.questionnaire_payload_version;
  delete value.userdata.service_offerings_structure;
  return value;
};

// Execute the actual Deno function source locally with all SDK/network boundaries
// supplied as fakes. Transpilation resolves no packages and makes no live calls.
const loadFunction = (relativePath, { base44 = {}, modules = {}, expose = '', fetch = vi.fn() } = {}) => {
  const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  const compiled = ts.transpileModule(`${source}\n${expose ? `export const organizerTest = { ${expose} };` : ''}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let handler;
  const exports = {};
  const require = (name) => {
    if (modules[name]) return modules[name];
    if (name.startsWith('npm:@base44/sdk')) return { createClientFromRequest: () => base44 };
    if (name.endsWith('pageOrganizerContract.js')) return contract;
    if (name.endsWith('/proDraftSubmissionAuthorization.ts')) {
      const authExports = {};
      const authSource = ts.transpileModule(readFileSync(resolve(process.cwd(), 'base44/shared/proDraftSubmissionAuthorization.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
      new Function('require', 'exports', 'crypto', authSource)(require, authExports, webcrypto);
      return authExports;
    }
    if (name.endsWith('entityLease.ts')) {
      const leaseExports = {};
      const leaseSource = ts.transpileModule(readFileSync(resolve(process.cwd(), 'base44/shared/entityLease.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
      new Function('exports', 'crypto', leaseSource)(leaseExports, webcrypto);
      return leaseExports;
    }
    if (modules[name]) return modules[name];
    throw new Error(`Unexpected function dependency: ${name}`);
  };
  const deno = { serve: (fn) => { handler = fn; }, env: { get: () => '' } };
  new Function('require', 'exports', 'Deno', 'crypto', 'fetch', 'console', compiled)(require, exports, deno, webcrypto, fetch, { warn: vi.fn(), info: vi.fn(), error: vi.fn() });
  return { handler: handler || exports.default, exposed: exports.organizerTest, fetch };
};
const request = (body) => new Request('http://localhost/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('page organizer backend contract', () => {
  it('keeps a legacy payload untouched and permits each partial-adoption combination', () => {
    const legacy = legacyPayload();
    expect(contract.validateOrganizedPayload(legacy)).toMatchObject({ ok: true, organizedQuestions: [] });
    expect(contract.preserveOrganizedMappedPayload(legacy, {})).toEqual(legacy);
    expect(contract.validateOrganizedPayload(payload())).toMatchObject({ ok: true, organizedQuestions: ['3'] });
    const q4Only = legacyPayload();
    q4Only.metadata.questionnaire_payload_version = 2;
    q4Only.userdata.target_industries_structure = { format: 'page-tree-v1', pages: [page('industry', 'Healthcare/Medical')] };
    expect(contract.validateOrganizedPayload(q4Only)).toMatchObject({ ok: true, organizedQuestions: ['4'] });
    q4Only.userdata.service_offerings_structure = structure();
    expect(contract.validateOrganizedPayload(q4Only)).toMatchObject({ ok: true, organizedQuestions: ['3', '4'] });
  });

  it('preserves custom commas and arbitrary reparenting without inserting catalog parents', () => {
    expect(contract.projectOrganizedPages(structure())).toEqual({ selections: ['Network Services', 'Internet Services'], otherValues: ['Custom service, with comma'], other: 'Custom service, with comma' });
  });

  it('serializes compact pages without mutating rich editor state or accepting compact trees as raw draft answers', () => {
    const raw = structure();
    const before = clone(raw);
    const compact = contract.serializePageStructure(raw);
    expect(compact).toEqual({ format: 'page-tree-v1', pages: [{
      label: 'Network Services', source: 'predefined', children: [
        { label: 'Internet Services', source: 'predefined' },
        { label: 'Custom service, with comma', source: 'custom' }
      ]
    }] });
    expect(raw).toEqual(before);
    expect(contract.validateMappedPageStructure(compact).ok).toBe(true);
    expect(contract.validatePageStructure(compact).ok).toBe(false);
    expect(contract.validateOrganizedResponses({ '3_structure': compact }).ok).toBe(false);
    expect(contract.validateOrganizedSubmission({ payload: payload(), responses: responses() }).ok).toBe(true);
  });

  it('accepts historical rich mapped trees and re-exports their logical content without identities', () => {
    const historical = payload();
    historical.userdata.service_offerings_structure = structure();
    const before = clone(historical);
    expect(contract.validateOrganizedPayload(historical).ok).toBe(true);
    expect(contract.validateOrganizedSubmission({ payload: historical, responses: responses() }).ok).toBe(true);
    expect(contract.restoreOrganizedProjections(historical)).toEqual(payload());
    expect(historical).toEqual(before);
    historical.userdata.service_offerings_structure.pages[0].children[0].id = 'network';
    expect(contract.validateOrganizedPayload(historical).ok).toBe(false);
  });

  it.each([
    (tree) => { tree.pages[0].children[0].children = []; },
    (tree) => { tree.pages[0].children[0].children = [{ label: 'Grandchild', source: 'custom' }]; },
    (tree) => { tree.pages[0].children = []; },
    (tree) => { delete tree.pages[0].label; },
    (tree) => { tree.pages[0].source = 'folder'; },
    (tree) => { tree.pages[0].id = 'partially-stripped-identity'; },
    (tree) => { tree.pages[0].unrecognized = true; }
  ])('rejects malformed compact mapped trees instead of silently discarding fields (%#)', (mutate) => {
    const value = payload();
    mutate(value.userdata.service_offerings_structure);
    const before = clone(value);
    expect(contract.validateOrganizedPayload(value).ok).toBe(false);
    expect(() => contract.serializePageStructure(value.userdata.service_offerings_structure)).toThrow();
    expect(value).toEqual(before);
  });

  it.each([
    (value) => { value.format = 'page-tree-v99'; },
    (value) => { value.pages[0].children[0].id = 'network'; },
    (value) => { value.pages[0].children[0].catalogId = value.pages[0].catalogId; },
    (value) => { value.pages[0].children[0].children = [page('too-deep', 'Grandchild')]; },
    (value) => { value.pages[0].label = ' '; },
    (value) => { value.pages[0].source = 'folder'; },
    (value) => { value.pages[0].extraProperty = 'must not disappear'; },
    (value) => { value.extraProperty = true; },
    (value) => { value.pages[0].children[1].catalogId = 'custom-cannot-claim-catalog'; }
  ])('rejects malformed or unsupported structures without mutation (%#)', (mutate) => {
    const value = structure(); mutate(value);
    const before = clone(value);
    expect(contract.validatePageStructure(value).ok).toBe(false);
    expect(value).toEqual(before);
  });

  it('rejects more than 100 nodes even when spread across valid sibling arrays', () => {
    const value = { format: 'page-tree-v1', pages: Array.from({ length: 51 }, (_, index) => page(`p${index}`, `Page ${index}`, 'custom', [page(`c${index}`, `Child ${index}`, 'custom')])) };
    expect(contract.validatePageStructure(value).ok).toBe(false);
  });

  it('requires version 2 exactly when a supported question structure is present', () => {
    const missingVersion = payload(); delete missingVersion.metadata.questionnaire_payload_version;
    expect(contract.validateOrganizedPayload(missingVersion).ok).toBe(false);
    const future = payload(); future.metadata.questionnaire_payload_version = 3;
    expect(contract.validateOrganizedPayload(future).ok).toBe(false);
    const markerOnly = legacyPayload(); markerOnly.metadata.questionnaire_payload_version = 2;
    expect(contract.validateOrganizedPayload(markerOnly).ok).toBe(false);
  });

  it('rejects stale or inconsistent legacy projections', () => {
    const value = payload(); value.userdata.service_offerings.push('Original Catalog Parent');
    expect(contract.validateOrganizedPayload(value).ok).toBe(false);
    value.userdata.service_offerings.pop(); value.userdata.service_offerings_other = '';
    expect(contract.validateOrganizedPayload(value).ok).toBe(false);
  });

  it('guards adoption and reordering by revision while allowing unrelated legacy edits', () => {
    const current = responses();
    const reordered = clone(current); reordered['3_structure'].pages[0].children.reverse();
    expect(contract.guardOrganizedDraftMutation({ currentResponses: current, incomingResponses: reordered, changedKeys: ['3_structure'], baseRevision: 3, currentRevision: 4 })).toMatchObject({ ok: false, code: 'ORGANIZER_REVISION_CONFLICT' });
    expect(contract.guardOrganizedDraftMutation({ currentResponses: current, incomingResponses: reordered, changedKeys: ['3_structure'], baseRevision: 4, currentRevision: 4 }).ok).toBe(true);
    expect(contract.guardOrganizedDraftMutation({ currentResponses: {}, incomingResponses: current, changedKeys: ['3_structure'], baseRevision: 3, currentRevision: 4 }).ok).toBe(false);
    expect(contract.guardOrganizedDraftMutation({ currentResponses: current, incomingResponses: { '6': 'Other question' }, changedKeys: ['6'], baseRevision: 1, currentRevision: 4 }).ok).toBe(true);
  });

  it('rejects old-tab selection edits and explicit structure deletion', () => {
    expect(contract.guardOrganizedDraftMutation({ currentResponses: responses(), incomingResponses: { '3': [] }, changedKeys: ['3'], baseRevision: 4, currentRevision: 4 })).toMatchObject({ ok: false, code: 'ORGANIZER_CLIENT_UPGRADE_REQUIRED' });
    expect(contract.guardOrganizedDraftMutation({ currentResponses: responses(), deletedKeys: ['3_structure'], baseRevision: 4, currentRevision: 4 })).toMatchObject({ ok: false, code: 'ORGANIZER_DOWNGRADE_REJECTED' });
  });

  it('restores a missing mapped tree only from saved raw responses and refuses conflicting sources', () => {
    const source = responses();
    const result = contract.reconcileOrganizedRepairPayload(legacyPayload(), source);
    expect(result).toMatchObject({ ok: true });
    expect(result.payload).toEqual(payload());
    const conflicting = payload(); conflicting.userdata.service_offerings_structure.pages[0].children.reverse();
    expect(contract.reconcileOrganizedRepairPayload(conflicting, source)).toMatchObject({ ok: false, code: 'ORGANIZER_REPAIR_CONFLICT', payload: null });
  });

  it('does not permit missing, changed, or not-yet-saved structures on final submission', () => {
    expect(contract.validateOrganizedSubmission({ payload: payload(), responses: responses() }).ok).toBe(true);
    expect(contract.validateOrganizedSubmission({ payload: legacyPayload(), responses: responses() })).toMatchObject({ ok: false, code: 'ORGANIZER_SUBMISSION_CONFLICT' });
    expect(contract.validateOrganizedSubmission({ payload: payload(), responses: {} }).ok).toBe(false);
  });

  it('preserves trees through deterministic backend repair and rejects unsupported formats', () => {
    const value = payload(); const before = clone(value);
    const repaired = repairSubmissionPayloadServer(value);
    expect(repaired.ok).toBe(true);
    expect(repaired.payload.userdata.service_offerings_structure).toEqual(contract.serializePageStructure(value.userdata.service_offerings_structure));
    expect(value).toEqual(before);
    value.userdata.service_offerings_structure.format = 'future';
    expect(repairSubmissionPayloadServer(value).ok).toBe(false);
  });

  it('preserves a valid custom projection longer than the legacy 5000-character cleanup limit', () => {
    const value = payload();
    value.userdata.service_offerings_structure.pages = Array.from({ length: 15 }, (_, index) => page(`custom-${index}`, `${index}-${'x'.repeat(495)}`, 'custom'));
    const projection = contract.projectOrganizedPages(value.userdata.service_offerings_structure);
    value.userdata.service_offerings = projection.selections;
    value.userdata.service_offerings_other = projection.other;
    expect(projection.other.length).toBeGreaterThan(5000);
    const repaired = repairSubmissionPayloadServer(value);
    expect(repaired.ok).toBe(true);
    expect(repaired.payload.userdata.service_offerings_other).toBe(projection.other);
    expect(contract.validateOrganizedPayload(repaired.payload).ok).toBe(true);
  });
});

describe('actual Base44 handlers with local SDK fakes', () => {
  const draftFixture = async (initialResponses = responses()) => {
    const session = 'test_organizer_session_123456'; const secret = 'test_secret_abcdefghijklmnopqrstuvwxyz123456';
    let draft = { id: 'draft-1', session_id: session, access_token_hash: Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))).toString('base64url'), responses_json: JSON.stringify(initialResponses), mapped_payload_json: JSON.stringify(payload()), status: 'draft', business_name: 'Example', domain: 'example.test' };
    const revisions = [];
    const entities = {
      ProFormDraft: { filter: vi.fn(async () => [clone(draft)]), get: vi.fn(async () => clone(draft)), updateMany: vi.fn(async (query, update) => { if (Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? draft[key] > value.$gt : value == null ? draft[key] == null : draft[key] === value)) { draft = { ...draft, ...update.$set }; return { updated: 1 }; } return { updated: 0 }; }), update: vi.fn(async (_, update) => { draft = { ...draft, ...update }; return clone(draft); }) },
      ProFormDraftRevision: { filter: vi.fn(async (query) => revisions.filter((item) => Object.entries(query).every(([key, value]) => item[key] === value))), create: vi.fn(async (data) => { const record = { ...data, id: `revision-${revisions.length + 1}` }; revisions.push(record); return record; }) }
    };
    const base44 = { asServiceRole: { entities } };
    const body = { action: 'save', resumeCredential: `${session}.${secret}`, clientInstanceId: 'local_test_client_12345', mutationId: 'local_test_mutation_12345', clientSequence: 1, baseRevision: 0, responses: { '6': 'Updated description' }, changedKeys: ['6'], deletedKeys: [], mappedPayload: legacyPayload() };
    return { base44, body, entities, getDraft: () => draft };
  };

  it('preserves an adopted structure when an old tab saves another question and survives reload', async () => {
    const fixture = await draftFixture();
    const { handler } = loadFunction('base44/functions/syncProQuestionnaireDraft/entry.ts', fixture);
    const result = await handler(request(fixture.body));
    expect(result.status).toBe(200);
    expect(JSON.parse(fixture.getDraft().mapped_payload_json).userdata.service_offerings_structure).toEqual(contract.serializePageStructure(structure()));
    expect(JSON.parse(fixture.getDraft().responses_json)['3_structure']).toEqual(structure());
    const second = await handler(request({ ...fixture.body, mutationId: 'local_test_mutation_12346', clientSequence: 2, baseRevision: 1 }));
    expect(second.status).toBe(200);
    expect((await second.json()).draft.responses['3_structure']).toEqual(structure());
  });

  it('rejects an old-tab organized selection overwrite before writing a revision', async () => {
    const fixture = await draftFixture();
    const { handler } = loadFunction('base44/functions/syncProQuestionnaireDraft/entry.ts', fixture);
    const result = await handler(request({ ...fixture.body, responses: { '3': [] }, changedKeys: ['3'] }));
    expect(result.status).toBe(409);
    expect((await result.json()).code).toBe('ORGANIZER_CLIENT_UPGRADE_REQUIRED');
    expect(fixture.entities.ProFormDraftRevision.create).not.toHaveBeenCalled();
  });

  it('accepts an explicit empty tree and rejects an older-tab reordering revision', async () => {
    const fixture = await draftFixture();
    const { handler } = loadFunction('base44/functions/syncProQuestionnaireDraft/entry.ts', fixture);
    const empty = { format: 'page-tree-v1', pages: [] };
    const result = await handler(request({ ...fixture.body, responses: { '3_structure': empty, '3': [], '3_other': [] }, changedKeys: ['3_structure', '3', '3_other'], mappedPayload: undefined }));
    expect(result.status).toBe(200);
    expect(JSON.parse(fixture.getDraft().mapped_payload_json).userdata).toMatchObject({ service_offerings_structure: empty, service_offerings: [], service_offerings_other: '' });
    const stale = await handler(request({ ...fixture.body, clientInstanceId: 'second_tab_client_12345', mutationId: 'second_tab_mutation_12345', responses: responses(), changedKeys: ['3_structure', '3', '3_other'] }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('ORGANIZER_REVISION_CONFLICT');
  });

  it('durably creates the exact supported tree and rejects legacy-only final payloads', async () => {
    const submissionEntity = { filter: vi.fn(async () => []), create: vi.fn(async (value) => ({ id: 'submission-local', ...value })) };
    let draft = { id: 'draft-1', session_id: 'local-session', responses_json: JSON.stringify(responses()), status: 'draft' };
    const draftEntity = { get: async () => clone(draft), updateMany: async (query, update) => { if (Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? draft[key] > value.$gt : value == null ? draft[key] == null : draft[key] === value)) { draft = { ...draft, ...update.$set }; return { updated: 1 }; } return { updated: 0 }; }, update: async (_, update) => { draft = { ...draft, ...update }; return clone(draft); } };
    const authorization = { authorizeDraftSubmission: async () => ({ authorized: true, draft: clone(draft), identity: {} }), createSubmissionContentFingerprint: async () => 'fingerprint', createSubmissionIdentityFingerprint: async () => 'identity', getSubmissionIdentity: () => ({}) };
    const { handler } = loadFunction('base44/functions/submitProQuestionnaireDurable/entry.ts', { base44: { asServiceRole: { entities: { ProFormSubmission: submissionEntity, ProFormDraft: draftEntity, ProFormDraftRevision: { filter: async () => [] } } } }, modules: { './proDraftSubmissionAuthorization.ts': authorization } });
    const body = { draftId: 'draft-1', submissionAttemptId: 'local_submission_attempt_12345', transformedPayload: payload() };
    const result = await handler(request(body));
    expect(result.status).toBe(200);
    expect(submissionEntity.create.mock.calls[0][0].userdata.service_offerings_structure).toEqual(contract.serializePageStructure(structure()));
    const old = await handler(request({ ...body, transformedPayload: legacyPayload() }));
    expect(old.status).toBe(409);
    expect((await old.json()).code).toBe('ORGANIZER_SUBMISSION_CONFLICT');
    expect(submissionEntity.create).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported fallback and direct delivery payloads before SDK or webhook calls', async () => {
    const invalid = payload(); invalid.metadata.questionnaire_payload_version = 99;
    const invoke = vi.fn(); const fakeFetch = vi.fn();
    const { handler } = loadFunction('base44/functions/submitProQuestionnaireFallback/entry.ts', { base44: { asServiceRole: { functions: { invoke } } } });
    const result = await handler(request({ transformedPayload: invalid, questionnaireSessionId: 'session', draftId: 'draft', resumeCredential: 'credential', submissionAttemptId: 'attempt' }));
    expect(result.status).toBe(400);
    expect(invoke).not.toHaveBeenCalled();
    const delivery = loadFunction('base44/functions/sendToZapier/entry.ts', { fetch: fakeFetch });
    expect((await delivery.handler(request(invalid))).status).toBe(400);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('never sends an unsupported retry payload to an external webhook', async () => {
    const fakeFetch = vi.fn();
    const { exposed } = loadFunction('base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts', { expose: 'sendToZapierSafe', fetch: fakeFetch });
    const value = payload(); value.userdata.service_offerings_structure.format = 'future-format';
    expect(await exposed.sendToZapierSafe(value)).toMatchObject({ ok: false });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('prevents AI repair from changing valid structure and does not invoke AI for unknown formats', async () => {
    const { exposed } = loadFunction('base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts', { expose: 'runRepairPipeline', modules: { '../../shared/proIdentityResolution.ts': { isMissingIdentityValue: (value) => !value }, '../../shared/draftRecoveryAuthorization.ts': {} } });
    const base44 = { asServiceRole: { entities: {} }, agents: { createConversation: vi.fn() } };
    const valid = await exposed.runRepairPipeline({ base44, rawPayload: payload(), rawResponsesRawString: JSON.stringify(responses()), context: {}, mode: 'repair_only' });
    expect(valid.ok).toBe(true);
    expect(valid.payload.userdata.service_offerings_structure).toEqual(contract.serializePageStructure(structure()));
    const invalid = payload(); invalid.userdata.service_offerings_structure.format = 'future-format';
    expect(await exposed.runRepairPipeline({ base44, rawPayload: invalid, rawResponsesRawString: '{}', context: {}, mode: 'repair_and_retry' })).toMatchObject({ ok: false, source: 'organizer_validation' });
    expect(base44.agents.createConversation).not.toHaveBeenCalled();
  });

  it('compares compact mapped AI repair trees without treating them as identity-bearing raw responses', () => {
    const { exposed } = loadFunction('base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts', { expose: 'validateRepairedPageStructures', modules: { '../../shared/proIdentityResolution.ts': { isMissingIdentityValue: (value) => !value }, '../../shared/draftRecoveryAuthorization.ts': {} } });
    const original = payload();
    expect(exposed.validateRepairedPageStructures(original, clone(original)).ok).toBe(true);
    expect(exposed.validateRepairedPageStructures(legacyPayload(), legacyPayload()).ok).toBe(true);
    expect(exposed.validateRepairedPageStructures(original, legacyPayload()).ok).toBe(false);
    expect(exposed.validateRepairedPageStructures(legacyPayload(), original).ok).toBe(false);
    for (const mutate of [
      (tree) => { tree.pages[0].label = 'Changed page'; },
      (tree) => { tree.pages[0].children.reverse(); },
      (tree) => { tree.pages.push(tree.pages[0].children.pop()); },
      (tree) => { tree.pages[0].children[0].source = 'custom'; }
    ]) {
      const changed = clone(original);
      const tree = changed.userdata.service_offerings_structure;
      mutate(tree);
      const projection = contract.projectOrganizedPages(tree);
      changed.userdata.service_offerings = projection.selections;
      changed.userdata.service_offerings_other = projection.other;
      expect(contract.validateOrganizedPayload(changed).ok).toBe(true);
      expect(exposed.validateRepairedPageStructures(original, changed).ok).toBe(false);
    }
  });
});
