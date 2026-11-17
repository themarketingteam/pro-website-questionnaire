import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as contract from '../../base44/shared/pageOrganizerContract.js';
import { hydrateProSubmissionEntity } from './utils/base44SubmissionHydration.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const session = 'hosted_integrity_session_12345';
const secret = 'hosted_integrity_secret_abcdefghijklmnopqrstuvwxyz';
const credential = `${session}.${secret}`;
const node = (id, label) => ({ id, label, source: 'custom', catalogId: null, children: [] });
const tree = (...pages) => ({ format: 'page-tree-v1', pages });
const project = (value) => ({ '3_structure': value, '3': contract.projectOrganizedPages(value).selections, '3_other': contract.projectOrganizedPages(value).otherValues });
const payloadFor = (value, description = 'Original description') => ({ metadata: { business_name: 'Test', businessDomain: 'example.test', questionnaire_payload_version: 2 }, userdata: { service_offerings_structure: contract.serializePageStructure(value), service_offerings: contract.projectOrganizedPages(value).selections, service_offerings_other: contract.projectOrganizedPages(value).other, company_description: description } });
const request = (body) => new Request('http://localhost/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Actual deployed sources, including their authorization and CAS lease. The SDK
// is the only replaced boundary; this harness cannot make network requests.
const loadHosted = (relativePath, base44, fetchImpl = vi.fn(async () => { throw new Error('Network disabled in hosted tests.'); })) => {
  let handler;
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = (name) => {
      if (name.startsWith('npm:@base44/sdk')) return { createClientFromRequest: () => base44 };
      if (name.endsWith('pageOrganizerContract.js')) return contract;
      if (name.startsWith('.')) return load(resolve(dirname(file), name));
      throw new Error(`Unexpected hosted dependency ${name}`);
    };
    new Function('require', 'exports', 'Deno', 'crypto', 'console', 'fetch', source)(require, exports, { serve: (fn) => { handler = fn; }, env: { get: () => '' } }, webcrypto, { error: vi.fn(), warn: vi.fn(), info: vi.fn() }, fetchImpl);
    return exports;
  };
  const entry = load(resolve(process.cwd(), relativePath));
  handler ||= entry.default;
  return async (body) => {
    const response = await handler(request(body));
    return { status: response.status, body: await response.json() };
  };
};

const fixture = async () => {
  const original = tree(node('original', 'Original service'));
  const accessHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))).toString('base64url');
  let draft = { id: 'draft-hosted', session_id: session, access_token_hash: accessHash, status: 'draft', save_revision: 0, business_name: 'Test', domain: 'example.test', responses_json: JSON.stringify({ ...project(original), '6': 'Original description' }), mapped_payload_json: JSON.stringify(payloadFor(original)) };
  const workingDrafts = [];
  const revisions = [];
  const submissions = [];
  let beforeRevision = async () => {};
  let beforeSubmission = async () => {};
  let storedSubmission = (value) => value;
  let hydrateSubmission = (value) => value;
  let beforeDraftMutation = async () => {};
  const pathValue = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);
  const matches = (value, query) => Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$gt' in expected) return pathValue(value, key) > expected.$gt;
    return expected == null ? pathValue(value, key) == null : pathValue(value, key) === expected;
  });
  const draftEntity = {
    get: vi.fn(async (id) => clone([draft, ...workingDrafts].find((value) => value.id === id) || null)),
    filter: vi.fn(async (query) => [draft, ...workingDrafts].filter((value) => matches(value, query)).map(clone)),
    create: vi.fn(async (value) => { const record = { ...clone(value), id: `draft-working-${workingDrafts.length + 1}` }; workingDrafts.push(record); return clone(record); }),
    updateMany: vi.fn(async (query, update) => {
      await beforeDraftMutation(query, update);
      const selected = [draft, ...workingDrafts].find((value) => matches(value, query));
      if (!selected) return { updated: 0 };
      if (selected.id === draft.id) draft = { ...draft, ...update.$set };
      else Object.assign(selected, clone(update.$set));
      return { updated: 1 };
    }),
    update: vi.fn(async (id, update) => { if (id === draft.id) { draft = { ...draft, ...update }; return clone(draft); } const selected = workingDrafts.find((value) => value.id === id); Object.assign(selected, clone(update)); return clone(selected); })
  };
  const base44 = { asServiceRole: { entities: {
    ProFormDraft: draftEntity,
    ProFormDraftRevision: {
      filter: vi.fn(async (query, order, limit = 500, skip = 0) => {
        const found = revisions.filter((value) => matches(value, query));
        if (order === '-server_revision') found.sort((a, b) => (b.server_revision || 0) - (a.server_revision || 0));
        return clone(found.slice(skip, skip + limit));
      }),
      create: vi.fn(async (value) => { await beforeRevision(); const record = { ...clone(value), id: `revision-${revisions.length + 1}` }; revisions.push(record); return clone(record); })
    },
    ProFormSubmission: {
      filter: vi.fn(async (query) => submissions.filter((value) => matches(value, query)).map((value) => hydrateSubmission(clone(value)))),
      get: vi.fn(async (id) => hydrateSubmission(clone(submissions.find((value) => value.id === id)))),
      create: vi.fn(async (value) => { await beforeSubmission(); const record = storedSubmission({ ...clone(value), id: `submission-${submissions.length + 1}` }); submissions.push(record); return hydrateSubmission(clone(record)); })
    }
  } } };
  const save = loadHosted('base44/functions/syncProQuestionnaireDraft/entry.ts', base44);
  const submit = loadHosted('base44/functions/submitProQuestionnaireDurable/entry.ts', base44);
  const intakes = [];
  base44.asServiceRole.entities.ProFormSubmissionIntake = {
    filter: async (query) => clone(intakes.filter((value) => matches(value, query))),
    create: async (value) => { const stored = { ...clone(value), id: `intake-${intakes.length + 1}` }; intakes.push(stored); return clone(stored); },
    update: async (id, value) => { const index = intakes.findIndex((item) => item.id === id); intakes[index] = { ...intakes[index], ...clone(value) }; return clone(intakes[index]); }
  };
  base44.asServiceRole.functions = { invoke: async (name, body) => {
    if (name !== 'submitProQuestionnaireDurable') throw new Error(`Unexpected function ${name}`);
    const result = await submit(body);
    if (result.status >= 400) throw Object.assign(new Error(result.body.error), { status: result.status, response: { status: result.status, data: result.body } });
    return { status: result.status, data: result.body };
  } };
  const fallback = loadHosted('base44/functions/submitProQuestionnaireFallback/entry.ts', base44);
  return {
    fallback, intakes,
    original, revisions, submissions, workingDrafts, base44, save, submit, getDraft: () => clone(draft), setDraft: (patch) => { draft = { ...draft, ...patch }; },
    beforeDraftMutation: (fn) => { beforeDraftMutation = fn; },
    holdRevision: (fn) => { beforeRevision = fn; }, holdSubmission: (fn) => { beforeSubmission = fn; },
    hydrateSubmissionReads: (fn) => { hydrateSubmission = fn; },
    transformStoredSubmission: (fn) => { storedSubmission = fn; },
    mutation: (value, overrides = {}) => ({ action: 'save', resumeCredential: credential, clientInstanceId: 'hosted_test_client_1234567', mutationId: 'hosted_mutation_12345678901', clientSequence: 1, baseRevision: 0, responses: project(value), changedKeys: ['3', '3_other', '3_structure'], deletedKeys: [], mappedPayload: payloadFor(value), ...overrides }),
    submission: (value, overrides = {}) => ({ draftId: 'draft-hosted', resumeCredential: credential, submissionAttemptId: 'hosted_submission_attempt_123456', transformedPayload: payloadFor(value), ...overrides })
  };
};

const gate = () => {
  let entered;
  let release;
  const ready = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  return { ready, release, hold: async () => { entered(); await held; } };
};

describe('hosted Pro save and submission integrity', () => {
  it('serializes genuinely simultaneous same-base page edits and rejects the stale writer', async () => {
    const f = await fixture();
    const a = tree(...f.original.pages, node('a', 'Tab A'));
    const b = tree(...f.original.pages, node('b', 'Tab B'));
    const results = await Promise.all([
      f.save(f.mutation(a)),
      f.save(f.mutation(b, { clientInstanceId: 'other_hosted_client_1234567', mutationId: 'other_hosted_mutation_123456' }))
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(f.revisions).toHaveLength(1);
    const winner = results.find((result) => result.status === 200).body.draft.responses['3_structure'];
    expect(JSON.parse(f.getDraft().responses_json)['3_structure']).toEqual(winner);
  });

  it('replays future saves in server order despite opposing client clocks and preserves base revision zero', async () => {
    const f = await fixture();
    const a = tree(...f.original.pages, node('a', 'First accepted'));
    const b = tree(...a.pages, node('b', 'Second accepted'));
    expect((await f.save(f.mutation(a, { clientChangedAt: new Date(Date.now() + 36000000).toISOString() }))).status).toBe(200);
    const saved = await f.save(f.mutation(b, { clientInstanceId: 'other_hosted_client_1234567', mutationId: 'other_hosted_mutation_123456', baseRevision: 1, clientChangedAt: new Date(Date.now() - 36000000).toISOString() }));
    expect(saved.body.draft.responses['3_structure']).toEqual(b);
    expect(f.revisions.map((value) => value.server_revision)).toEqual([1, 2]);
    expect(f.revisions[0].base_revision).toBe(0);
    const reloaded = await f.save({ action: 'bootstrap', resumeCredential: credential });
    expect(reloaded.body.draft.responses['3_structure']).toEqual(b);
  });

  it('waits for an in-flight save before bootstrap materialization and duplicate retries', async () => {
    const f = await fixture();
    const held = gate(); f.holdRevision(held.hold);
    const changed = tree(...f.original.pages, node('new', 'Saved during reload'));
    const pending = f.save(f.mutation(changed));
    await held.ready;
    const bootstrap = f.save({ action: 'bootstrap', resumeCredential: credential });
    held.release();
    await pending;
    expect((await bootstrap).body.draft.responses['3_structure']).toEqual(changed);
    expect((await f.save(f.mutation(f.original))).body.duplicate).toBe(true);
    expect(JSON.parse(f.getDraft().responses_json)['3_structure']).toEqual(changed);
    expect(f.revisions).toHaveLength(1);
  });

  it('deduplicates concurrent final submissions and freezes subsequent saves even with submitted status', async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.submit(f.submission(f.original)),
      f.submit(f.submission(f.original, { submissionAttemptId: 'other_submission_attempt_1234567' }))
    ]);
    expect(results.map((value) => value.status)).toEqual([200, 200]);
    expect(results[0].body.submission.id).toBe(results[1].body.submission.id);
    expect(f.submissions).toHaveLength(1);
    expect(f.getDraft()).toMatchObject({ status: 'submitted', final_submission_id: f.submissions[0].id });
    const ignored = await f.save(f.mutation(tree(), { status: 'submitted', finalSubmissionId: f.submissions[0].id }));
    expect(ignored.body).toMatchObject({ success: true, finalized: true, ignored: true });
    expect(f.revisions).toHaveLength(0);
    expect(JSON.parse(f.getDraft().responses_json)['3_structure']).toEqual(f.original);
    const changedPayload = f.submission(f.original, { submissionAttemptId: 'changed_submission_attempt_123456', transformedPayload: payloadFor(f.original, 'Changed after submission') });
    expect((await f.submit(changedPayload)).status).toBe(409);
    expect(f.submissions).toHaveLength(1);
  });

  it('normalizes Base44 optional DTO padding on create and duplicate reads without changing stored wire or raw identities', async () => {
    const f = await fixture();
    const selected = tree({ ...node('cloud', 'Cloud Services'), source: 'predefined', catalogId: 'q3:option:Cloud%20Services', children: [node('child', 'Custom cloud, with comma')] }, node('standalone', 'Standalone'));
    f.setDraft({ responses_json: JSON.stringify({ ...project(selected), '6': 'Original description' }), mapped_payload_json: JSON.stringify(payloadFor(selected)) });
    f.hydrateSubmissionReads(hydrateProSubmissionEntity);
    const submitted = await f.submit(f.submission(selected));
    expect(submitted.status).toBe(200);
    expect(submitted.body.submission.userdata.service_offerings_structure).toEqual(contract.serializePageStructure(selected));
    expect(submitted.body.submission.userdata).not.toHaveProperty('target_industries_structure');
    const duplicate = await f.submit(f.submission(selected));
    expect(duplicate).toMatchObject({ status: 200, body: { success: true, duplicate: true } });
    expect(duplicate.body.submission.id).toBe(submitted.body.submission.id);
    expect(f.submissions).toHaveLength(1);
    expect(f.submissions[0].userdata.service_offerings_structure).toEqual(contract.serializePageStructure(selected));
    expect(JSON.parse(f.getDraft().responses_json)['3_structure']).toEqual(selected);
  });

  it('does not accept entity-padded structures as incoming submissions or discard meaningful DTO corruption', async () => {
    const incoming = await fixture();
    const hydratedPayload = hydrateProSubmissionEntity(payloadFor(incoming.original));
    expect((await incoming.submit(incoming.submission(incoming.original, { transformedPayload: hydratedPayload }))).status).toBe(400);
    expect(incoming.submissions).toHaveLength(0);
    for (const mutate of [
      (value) => { value.userdata.company_description = 'Changed stored answer'; },
      (value) => { value.userdata.meaningful_extra = 'Unexpected content must remain visible'; }
    ]) {
      const f = await fixture();
      f.hydrateSubmissionReads((record) => { const dto = hydrateProSubmissionEntity(record); mutate(dto); return dto; });
      const rejected = await f.submit(f.submission(f.original));
      expect(rejected.status).toBe(500);
      expect(rejected.body.success).toBe(false);
      expect(f.getDraft().status).toBe('draft');
    }
  });

  it('holds concurrent saves until the durable receipt is linked', async () => {
    const f = await fixture();
    const held = gate(); f.holdSubmission(held.hold);
    const pending = f.submit(f.submission(f.original));
    await held.ready;
    const lateSave = f.save(f.mutation(tree(...f.original.pages, node('late', 'Too late'))));
    held.release();
    expect((await pending).status).toBe(200);
    expect((await lateSave).body.ignored).toBe(true);
    expect(JSON.parse(f.getDraft().responses_json)['3_structure']).toEqual(f.original);
  });

  it('never reports success if the storage schema drops the compact tree or v2 marker', async () => {
    for (const field of ['tree', 'version']) {
      const f = await fixture();
      f.transformStoredSubmission((value) => {
        if (field === 'tree') delete value.userdata.service_offerings_structure;
        else delete value.metadata.questionnaire_payload_version;
        return value;
      });
      expect(await f.submit(f.submission(f.original))).toMatchObject({ status: 502, body: { success: false } });
      expect(f.getDraft().status).toBe('draft');
    }
  });

  it('requires recovery of an appended but not yet materialized save before submission', async () => {
    const f = await fixture();
    f.revisions.push({ draft_id: 'draft-hosted', server_revision: 1 });
    expect((await f.submit(f.submission(f.original))).body.code).toBe('DRAFT_SAVE_PENDING');
    expect(f.submissions).toHaveLength(0);
  });

  it('refuses a write after lease ownership changes during a slow history read', async () => {
    const f = await fixture();
    const revisionEntity = f.base44.asServiceRole.entities.ProFormDraftRevision;
    const originalFilter = revisionEntity.filter.getMockImplementation();
    let takeover = true;
    revisionEntity.filter.mockImplementation(async (...args) => {
      const result = await originalFilter(...args);
      if (takeover && args[0]?.draft_id && !args[0]?.mutation_id) {
        takeover = false;
        f.setDraft({ idempotency_lock_token: 'newer-owner', idempotency_lock_expires_at: new Date(Date.now() + 120000).toISOString() });
      }
      return result;
    });
    const result = await f.save(f.mutation(tree(...f.original.pages, node('stale-worker', 'Do not save'))));
    expect(result.status).toBe(409);
    expect(f.revisions).toHaveLength(0);
    expect(f.getDraft().idempotency_lock_token).toBe('newer-owner');
    expect(JSON.parse(f.getDraft().responses_json)['3_structure']).toEqual(f.original);
  });

  it('fences materialization when another save takes over after the ownership check but before the database write', async () => {
    const f = await fixture();
    const changed = tree(...f.original.pages, node('first', 'First append survives recovery'));
    let takeover = true;
    f.beforeDraftMutation(async (_query, update) => {
      if (!takeover || !Object.prototype.hasOwnProperty.call(update.$set, 'responses_json')) return;
      takeover = false;
      f.setDraft({ idempotency_lock_expires_at: new Date(0).toISOString() });
      const recovered = await f.save(f.mutation(changed, {
        clientInstanceId: 'takeover_client_123456789', mutationId: 'takeover_mutation_123456789',
        responses: { '6': 'Saved by the newer owner' }, changedKeys: ['6'], mappedPayload: undefined
      }));
      expect(recovered.status).toBe(200);
    });
    const obsolete = await f.save(f.mutation(changed));
    expect(obsolete).toMatchObject({ status: 409, body: { code: 'DRAFT_LEASE_LOST' } });
    expect(f.getDraft().save_revision).toBe(2);
    expect(JSON.parse(f.getDraft().responses_json)).toMatchObject({ ...project(changed), '6': 'Saved by the newer owner' });
    const reload = await f.save({ action: 'bootstrap', resumeCredential: credential });
    expect(reload.body.draft.responses).toMatchObject({ ...project(changed), '6': 'Saved by the newer owner' });
  });

  it('fails closed on damaged stored snapshots instead of materializing an empty draft', async () => {
    for (const patch of [{ responses_json: '{broken' }, { responses_json: 'null' }, { history_baseline_json: '{broken' }, { history_baseline_json: '{}' }]) {
      const f = await fixture(); f.setDraft(patch);
      const before = f.getDraft();
      expect((await f.save({ action: 'bootstrap', resumeCredential: credential })).status).toBe(409);
      expect((await f.save(f.mutation(tree()))).status).toBe(409);
      expect(f.revisions).toHaveLength(0);
      expect(f.getDraft().responses_json).toBe(before.responses_json);
      expect(f.getDraft().mapped_payload_json).toBe(before.mapped_payload_json);
    }
    const f = await fixture(); f.setDraft({ responses_json: '{broken' });
    expect((await f.submit(f.submission(f.original))).body.code).toBe('DRAFT_SNAPSHOT_INVALID');
    expect(f.submissions).toHaveLength(0);
  });

  it('projects a tree-only save into both raw and compact compatibility fields', async () => {
    const f = await fixture();
    const changed = tree(node('custom-comma', 'Custom service, with comma'));
    const result = await f.save(f.mutation(changed, { responses: { '3_structure': changed }, changedKeys: ['3_structure'], mappedPayload: undefined }));
    expect(result.status).toBe(200);
    expect(result.body.draft.responses).toMatchObject(project(changed));
    expect(JSON.parse(f.getDraft().mapped_payload_json).userdata).toMatchObject(payloadFor(changed).userdata);
  });

  it('preserves the adopted rich snapshot in a raw-only fallback and rejects an old flat fallback', async () => {
    const f = await fixture();
    const body = { questionnaireSessionId: session, draftId: 'draft-hosted', resumeCredential: credential, submissionAttemptId: 'fallback_attempt_1234567890123', transformFailed: true };
    const old = await f.fallback({ ...body, rawResponses: { '3': ['Older service'] } });
    expect(old.status).toBe(409);
    expect(f.intakes).toHaveLength(0);
    const accepted = await f.fallback(body);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ success: true, received: true, submissionCreated: false });
    expect(JSON.parse(f.intakes[0].raw_responses_json)).toMatchObject({ ...project(f.original), '6': 'Original description' });
  });

  it('refuses to deliver a different session-matched recovery receipt', async () => {
    const f = await fixture();
    f.base44.auth = { me: async () => ({ role: 'admin' }) };
    f.submissions.push({ ...payloadFor(tree(node('different', 'Different retained page'))), id: 'old-submission', metadata: { ...payloadFor(f.original).metadata, questionnaire_session_id: session } });
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const retry = loadHosted('base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts', f.base44, fetchImpl);
    expect((await retry({ draftId: 'draft-hosted' })).status).toBe(409);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(f.getDraft().status).toBe('draft');
  });

  it('redelivers a finalized draft using the normalized schema-padded linked receipt', async () => {
    const f = await fixture();
    const selected = tree({ ...node('parent', 'Managed Services'), children: [node('child', 'Help Desk')] }, node('standalone', 'Cloud Services'));
    f.setDraft({ responses_json: JSON.stringify({ ...project(selected), '6': 'Original description' }), mapped_payload_json: JSON.stringify(payloadFor(selected)) });
    f.hydrateSubmissionReads(hydrateProSubmissionEntity);
    const submitted = await f.submit(f.submission(selected));
    expect(submitted.status).toBe(200);
    expect(f.getDraft()).toMatchObject({ status: 'submitted', final_submission_id: submitted.body.submission.id });
    const entityDto = await f.base44.asServiceRole.entities.ProFormSubmission.get(submitted.body.submission.id);
    expect(entityDto.userdata.service_offerings_structure.pages[0].children[0]).toMatchObject({ id: null, catalogId: null, children: [] });
    expect(contract.validateMappedPageStructure(entityDto.userdata.service_offerings_structure).ok).toBe(false);
    f.base44.auth = { me: async () => ({ role: 'admin' }) };
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const retry = loadHosted('base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts', f.base44, fetchImpl);
    const result = await retry({ draftId: 'draft-hosted' });
    expect(result).toMatchObject({ status: 200, body: { success: true, alreadySubmitted: true, zapierSent: true, linkedSubmissionId: submitted.body.submission.id } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const outbound = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(outbound.userdata.service_offerings_structure).toEqual(contract.serializePageStructure(selected));
    expect(outbound.userdata).not.toHaveProperty('target_industries_structure');
    expect(contract.validateOrganizedPayload(outbound).ok).toBe(true);
    expect(f.submissions).toHaveLength(1);
    expect(JSON.parse(f.getDraft().responses_json)['3_structure']).toEqual(selected);
  });

  it('starts a durably seeded editable revision while retaining the completed draft and receipt', async () => {
    const f = await fixture();
    f.setDraft({ client_identity_id: 'same-client-identity' });
    expect((await f.submit(f.submission(f.original))).status).toBe(200);
    const original = f.getDraft();
    const oldReceipt = clone(f.submissions[0]);
    const visible = tree(...f.original.pages, node('unsaved', 'Unsaved service'));
    const seed = { ...project(visible), '6': 'Unsaved description' };
    const requestBody = { action: 'start_revision', resumeCredential: credential, newRevisionRequestId: 'explicit_revision_request_12345', responses: seed, mappedPayload: payloadFor(visible, 'Unsaved description'), validationStatus: { '6': 'complete' }, touchedQuestions: { '3': true }, expandedQuestions: { '3': true }, credentials: { businessName: 'Test', domain: 'example.test' }, progressPercent: 75 };
    const started = await f.save(requestBody);
    expect(started).toMatchObject({ status: 200, body: { success: true, revisionStarted: true, sourceDraftId: original.id, sourceSubmissionId: oldReceipt.id, draft: { status: 'draft', revision: 1, responses: seed } } });
    expect(started.body.draft.draftId).not.toBe(original.id);
    expect(started.body.draft.sessionId).not.toBe(original.session_id);
    expect(started.body.resumeCredential).not.toBe(credential);
    expect(f.workingDrafts).toHaveLength(1);
    expect(f.workingDrafts[0]).toMatchObject({ client_identity_id: 'same-client-identity', source_draft_id: original.id, source_submission_id: oldReceipt.id, status: 'draft', final_submission_id: '', intake_id: '', save_revision: 1 });
    expect(JSON.parse(f.workingDrafts[0].mapped_payload_json).userdata).toEqual(payloadFor(visible, 'Unsaved description').userdata);
    expect(f.revisions.filter((value) => value.draft_id === started.body.draft.draftId)).toMatchObject([{ source: 'client_revision_seed', result_snapshot_json: expect.any(String) }]);
    expect(f.getDraft().responses_json).toBe(original.responses_json);
    expect(f.getDraft().mapped_payload_json).toBe(original.mapped_payload_json);
    expect(f.getDraft().final_submission_id).toBe(oldReceipt.id);
    expect(f.submissions).toEqual([oldReceipt]);
    const again = await f.save(requestBody);
    expect(again).toMatchObject({ status: 200, body: { reused: true, draft: { draftId: started.body.draft.draftId, responses: seed } } });
    expect(f.workingDrafts).toHaveLength(1);
    expect(f.revisions.filter((value) => value.draft_id === started.body.draft.draftId)).toHaveLength(1);
    const edited = tree(...visible.pages, node('later', 'Later working edit'));
    const saved = await f.save(f.mutation(edited, { resumeCredential: again.body.resumeCredential, baseRevision: 1, mappedPayload: payloadFor(edited, 'Unsaved description') }));
    expect(saved.status).toBe(200);
    expect(saved.body.draft.responses).toMatchObject({ ...project(edited), '6': 'Unsaved description' });
    const reopened = await f.save(requestBody);
    expect(reopened.body.draft.responses).toMatchObject({ ...project(edited), '6': 'Unsaved description' });
    const final = await f.submit(f.submission(edited, { draftId: started.body.draft.draftId, resumeCredential: reopened.body.resumeCredential, submissionAttemptId: 'working_revision_submit_12345678', transformedPayload: payloadFor(edited, 'Unsaved description') }));
    expect(final.status).toBe(200);
    expect(f.submissions).toHaveLength(2);
    expect(f.submissions[0]).toEqual(oldReceipt);
    expect((await f.save(f.mutation(edited))).body).toMatchObject({ finalized: true, ignored: true });
  });

  it('requires a submitted authorized source and explicit valid full seed without changing damaged receipts', async () => {
    const f = await fixture();
    const body = { action: 'start_revision', resumeCredential: credential, newRevisionRequestId: 'explicit_revision_validation_123', responses: project(f.original), mappedPayload: payloadFor(f.original) };
    expect((await f.save(body)).body.code).toBe('REVISION_SOURCE_NOT_SUBMITTED');
    expect((await f.submit(f.submission(f.original))).status).toBe(200);
    expect((await f.save({ ...body, resumeCredential: '' })).status).toBe(401);
    expect((await f.save({ ...body, newRevisionRequestId: '' })).status).toBe(400);
    expect((await f.save({ ...body, responses: null })).status).toBe(400);
    expect((await f.save({ ...body, mappedPayload: null })).status).toBe(400);
    expect((await f.save({ ...body, credentials: { businessName: 'Different client', domain: 'different.test' } })).body.code).toBe('REVISION_IDENTITY_CONFLICT');
    expect((await f.save({ ...body, responses: { '3': ['Old flat service'] } })).status).toBe(409);
    f.submissions[0].userdata.company_description = 'Damaged receipt';
    const copied = await f.save(body);
    expect(copied).toMatchObject({ status: 200, body: { sourceSubmissionId: '', sourceSubmissionVerified: false, draft: { sourceReceiptStatus: 'mismatch' } } });
    expect(f.submissions[0].userdata.company_description).toBe('Damaged receipt');
    expect(f.workingDrafts).toHaveLength(1);
  });

  it('allows incomplete answers in a revision seed and verifies checkpoints before acknowledging', async () => {
    const f = await fixture();
    expect((await f.submit(f.submission(f.original))).status).toBe(200);
    const empty = tree();
    const body = { action: 'start_revision', resumeCredential: credential, newRevisionRequestId: 'explicit_revision_retry_123456', responses: { ...project(empty), '6': '' }, mappedPayload: payloadFor(empty, '') };
    let failed = false;
    f.holdRevision(async () => { if (!failed) { failed = true; throw new Error('Synthetic checkpoint outage'); } });
    const rejected = await f.save(body);
    expect(rejected.status).toBe(500);
    expect(rejected.body.success).toBe(false);
    expect(f.workingDrafts).toHaveLength(1);
    expect(f.revisions).toHaveLength(0);
    const retained = f.workingDrafts[0].responses_json;
    const recovered = await f.save(body);
    expect(recovered).toMatchObject({ status: 200, body: { success: true, reused: true, draft: { status: 'draft', revision: 1, responses: { ...project(empty), '6': '' } } } });
    expect(f.workingDrafts).toHaveLength(1);
    expect(f.workingDrafts[0].responses_json).toBe(retained);
    expect(f.getDraft().status).toBe('submitted');
  });

  it('serializes duplicate revision clicks into one working copy and does not acknowledge dropped seed data', async () => {
    const f = await fixture();
    expect((await f.submit(f.submission(f.original))).status).toBe(200);
    const body = { action: 'start_revision', resumeCredential: credential, newRevisionRequestId: 'explicit_revision_parallel_123', responses: project(f.original), mappedPayload: payloadFor(f.original) };
    const [first, second] = await Promise.all([f.save(body), f.save(body)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.draft.draftId).toBe(second.body.draft.draftId);
    expect(f.workingDrafts).toHaveLength(1);
    const broken = await fixture();
    expect((await broken.submit(broken.submission(broken.original))).status).toBe(200);
    const create = broken.base44.asServiceRole.entities.ProFormDraft.create;
    broken.base44.asServiceRole.entities.ProFormDraft.create = vi.fn(async (value) => { const record = await create(value); broken.workingDrafts[0].responses_json = '{}'; return record; });
    const rejected = await broken.save({ ...body, newRevisionRequestId: 'explicit_revision_corrupt_12345' });
    expect(rejected.status).toBe(502);
    expect(rejected.body.code).toBe('REVISION_SEED_UNVERIFIED');
    expect(broken.getDraft().status).toBe('submitted');
  });


  it('copies authenticated historical submitted answers even when the original receipt cannot be verified', async () => {
    for (const historical of ['missing_link', 'unavailable', 'unreadable_mapping']) {
      const f = await fixture();
      expect((await f.submit(f.submission(f.original))).status).toBe(200);
      if (historical === 'missing_link') f.setDraft({ final_submission_id: '' });
      if (historical === 'unavailable') f.base44.asServiceRole.entities.ProFormSubmission.get = vi.fn(async () => null);
      if (historical === 'unreadable_mapping') f.setDraft({ mapped_payload_json: '{bad mapping' });
      const originalRaw = f.getDraft().responses_json;
      const copied = await f.save({ action: 'start_revision', resumeCredential: credential, newRevisionRequestId: `historical_revision_${historical}_12345`, responses: { ...project(f.original), '6': 'Visible unsaved answer' }, mappedPayload: payloadFor(f.original, 'Visible unsaved answer') });
      expect(copied).toMatchObject({ status: 200, body: { success: true, sourceSubmissionId: '', sourceSubmissionVerified: false, draft: { status: 'draft', responses: { ...project(f.original), '6': 'Visible unsaved answer' } } } });
      expect(f.getDraft().responses_json).toBe(originalRaw);
      expect(f.getDraft().status).toBe('submitted');
      expect(f.submissions).toHaveLength(1);
      expect(f.workingDrafts[0].source_receipt_status).toBe(historical === 'missing_link' ? 'missing_link' : 'unavailable');
    }
  });

  it('reports an unverified revision echo without acknowledging or discarding its retained changes', async () => {
    const f = await fixture();
    const create = f.base44.asServiceRole.entities.ProFormDraftRevision.create;
    f.base44.asServiceRole.entities.ProFormDraftRevision.create = vi.fn(async (value) => { const record = await create(value); delete record.server_revision; return record; });
    const changed = tree(...f.original.pages, node('diagnostic', 'Retained pending answer'));
    const rejected = await f.save(f.mutation(changed));
    expect(rejected).toMatchObject({ status: 502, body: { success: false, code: 'DRAFT_REVISION_UNVERIFIED' } });
    expect(JSON.parse(f.getDraft().responses_json)['3_structure']).toEqual(f.original);
    expect(f.revisions).toHaveLength(1);
    const recovered = await f.save(f.mutation(changed));
    expect(recovered.status).toBe(200);
    expect(recovered.body.draft.responses['3_structure']).toEqual(changed);
    expect(f.revisions).toHaveLength(1);
  });

});
