import { memoryEntity } from './utils/memoryEntities';
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
const payloadFor = (value, description = 'Original description') => ({ metadata: { business_name: 'Test', businessDomain: 'unit-client.net', questionnaire_payload_version: 2 }, userdata: { additional_pages_list: { meet_the_team_page: { team_photo_with_tags: {} } }, geographic_areas: [], pricing_packaging: [], company_goals: [], certifications_partnerships: [], service_guarantee_items: [], website_objectives: [], client_challenges: [], client_outcomes: [], target_industries: [], service_offerings_structure: contract.serializePageStructure(value), service_offerings: contract.projectOrganizedPages(value).selections, service_offerings_other: contract.projectOrganizedPages(value).other, company_description: description } });
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
  let draft = { id: 'draft-hosted', session_id: session, access_token_hash: accessHash, status: 'draft', save_revision: 0, business_name: 'Test', domain: 'unit-client.net', responses_json: JSON.stringify({ ...project(original), '6': 'Original description' }), mapped_payload_json: JSON.stringify(payloadFor(original)) };
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
    if (expected && typeof expected === 'object' && '$in' in expected) return expected.$in.includes(pathValue(value, key));
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
    ProSubmissionRetryJob: memoryEntity('retryJob'),
    ProFormDraftEvent: memoryEntity('event'),
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
      update: vi.fn(async (id, update) => { const row = submissions.find(value => value.id === id); Object.assign(row, clone(update)); return clone(row); }),
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
      expect(rejected.status).toBe(502);
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

  it('keeps submitted original links readable and rejects client revision creation, including concurrent attempts', async () => {
    const f = await fixture();
    expect((await f.submit(f.submission(f.original))).status).toBe(200);
    const original = f.getDraft();
    const body = { action: 'start_revision', resumeCredential: credential, newRevisionRequestId: 'blocked_public_revision_12345', responses: project(f.original), mappedPayload: payloadFor(f.original) };
    const attempts = await Promise.all([f.save(body), f.save(body), f.save({ ...body, resumeCredential: '' })]);
    attempts.forEach(result => expect(result).toMatchObject({ status: 403, body: { code: 'REVISION_REQUIRES_TEAM' } }));
    const loaded = await f.save({ action: 'bootstrap', resumeCredential: credential });
    expect(loaded).toMatchObject({ status: 200, body: { draft: { status: 'submitted', responses: JSON.parse(original.responses_json) } } });
    expect(f.getDraft().responses_json).toBe(original.responses_json);
    expect(f.workingDrafts).toHaveLength(0);
    expect(f.submissions).toHaveLength(1);
  });

  it('rejects fallback intake-only changes after submission while preserving idempotent receipt retries', async () => {
    const f = await fixture();
    expect((await f.submit(f.submission(f.original))).status).toBe(200);
    const original = f.getDraft();
    const blocked = await f.fallback({ ...f.submission(f.original), questionnaireSessionId: session, rawResponses: { ...project(f.original), '6': 'Changed submitted text' }, validationFailed: true });
    expect(blocked).toMatchObject({ status: 409, body: { code: 'DRAFT_ALREADY_SUBMITTED', received: false } });
    const absentPayload = await f.fallback({ ...f.submission(f.original), transformedPayload: { metadata: {}, userdata: {} }, questionnaireSessionId: session, rawResponses: { ...project(f.original), '6': 'Changed submitted text' } });
    expect(absentPayload.status).toBeGreaterThanOrEqual(400);
    expect(f.intakes).toHaveLength(0);
    expect(f.getDraft().responses_json).toBe(original.responses_json);
    expect((await f.submit(f.submission(f.original))).body.duplicate).toBe(true);
  });

  it('preserves all existing client links when submitted share links are issued concurrently', async () => {
    const f = await fixture();
    const oldHashes = Array.from({ length: 24 }, (_, index) => Buffer.from(`old-token-hash-${index}`.padEnd(32, 'x')).toString('base64url'));
    f.setDraft({ status: 'submitted', final_submission_id: 'original-receipt', shared_access_token_hashes_json: JSON.stringify(oldHashes) });
    const original = f.getDraft();
    f.base44.auth = { me: async () => ({ role: 'admin', email: 'synthetic@example.test' }) };
    f.base44.asServiceRole.entities.ProFormDraftEvent = { create: async () => ({ id: 'audit' }) };
    const query = loadHosted('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts', f.base44);
    const issued = await Promise.all([query({ action: 'create_share_link', recordType: 'draft', recordId: original.id }), query({ action: 'create_share_link', recordType: 'draft', recordId: original.id })]);
    issued.forEach(result => expect(result.status).toBe(200));
    const retained = JSON.parse(f.getDraft().shared_access_token_hashes_json);
    expect(retained).toHaveLength(26);
    oldHashes.forEach(hash => expect(retained).toContain(hash));
    for (const result of issued) {
      const opened = await f.save({ action: 'bootstrap', resumeCredential: result.body.resumeCredential });
      expect(opened).toMatchObject({ status: 200, body: { draft: { status: 'submitted', responses: JSON.parse(original.responses_json) } } });
    }
    expect((await f.save({ action: 'bootstrap', resumeCredential: credential })).status).toBe(200);
    expect(f.getDraft().responses_json).toBe(original.responses_json);
    expect(f.getDraft().final_submission_id).toBe(original.final_submission_id);
    expect(f.workingDrafts).toHaveLength(0);
  });

  it('creates a protected team copy from the default completed receipt using its verified exact raw source', async () => {
    const f = await fixture();
    expect((await f.submit(f.submission(f.original))).status).toBe(200);
    const original = f.getDraft(), receipt = clone(f.submissions[0]);
    f.base44.auth = { me: async () => ({ role: 'admin' }) };
    f.base44.asServiceRole.entities.ProFormDraftEvent = { create: async () => ({ id: 'audit-copy' }) };
    const recovery = loadHosted('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts', f.base44);
    const catalog = await recovery({ action: 'list_versions', recordType: 'draft', recordId: original.id });
    expect(catalog.status).toBe(200);
    expect(catalog.body.defaultVersionId).toBe(`submission:${receipt.id}`);
    const copied = await recovery({ action: 'create_version_copy', recordType: 'draft', recordId: original.id, versionId: catalog.body.defaultVersionId });
    expect(copied).toMatchObject({ status: 200, body: { success: true, rawSourceVersionId: `current:${original.id}` } });
    expect(f.workingDrafts).toHaveLength(1);
    expect(f.workingDrafts[0].status).toBe('draft');
    expect(f.workingDrafts[0].responses_json).toBe(original.responses_json);
    expect(f.workingDrafts[0].session_id).not.toBe(original.session_id);
    expect(JSON.parse(f.workingDrafts[0].draft_metadata_json)).toMatchObject({ source_draft_id: original.id, source_version_id: `submission:${receipt.id}`, source_submission_id: receipt.id });
    expect(f.getDraft().responses_json).toBe(original.responses_json);
    expect(f.getDraft().final_submission_id).toBe(original.final_submission_id);
    expect(f.submissions).toEqual([receipt]);
    expect((await f.save({ action: 'bootstrap', resumeCredential: copied.body.resumeCredential })).status).toBe(200);
  });

  it('verifies padded Base44 receipt DTOs against the exact saved shape before team copying', async () => {
    const f = await fixture();
    expect((await f.submit(f.submission(f.original))).status).toBe(200);
    const original = f.getDraft(), receipt = clone(f.submissions[0]);
    f.hydrateSubmissionReads(hydrateProSubmissionEntity);
    const padded = hydrateProSubmissionEntity(receipt);
    expect(padded.userdata).toHaveProperty('target_industries_structure', null);
    expect(padded.userdata.service_offerings_structure.pages[0]).toHaveProperty('id', null);
    f.base44.auth = { me: async () => ({ role: 'admin' }) };
    f.base44.asServiceRole.entities.ProFormDraftEvent = { create: async () => ({ id: 'audit-padded-copy' }) };
    const recovery = loadHosted('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts', f.base44);
    const catalog = await recovery({ action: 'list_versions', recordType: 'draft', recordId: original.id });
    const copied = await recovery({ action: 'create_version_copy', recordType: 'draft', recordId: original.id, versionId: catalog.body.defaultVersionId });
    expect(copied).toMatchObject({ status: 200, body: { success: true } });
    expect(f.workingDrafts).toHaveLength(1);
    expect(f.workingDrafts[0].responses_json).toBe(original.responses_json);
    expect(f.getDraft().responses_json).toBe(original.responses_json);
    expect(f.submissions).toEqual([receipt]);
  });

  it('refuses completed team copies without privilege or exact receipt, session and mapped-answer agreement', async () => {
    for (const fault of ['public', 'missing_source', 'wrong_source', 'wrong_session', 'wrong_receipt', 'changed_payload', 'meaningful_padding', 'deleted_source']) {
      const f = await fixture();
      expect((await f.submit(f.submission(f.original))).status).toBe(200);
      const original = f.getDraft(), receipt = clone(f.submissions[0]);
      if (fault !== 'public') f.base44.auth = { me: async () => ({ role: 'admin' }) };
      if (fault === 'missing_source') delete f.submissions[0].metadata.source_draft_id;
      if (fault === 'wrong_source') f.submissions[0].metadata.source_draft_id = 'unrelated-draft';
      if (fault === 'deleted_source') f.setDraft({ soft_deleted_at: new Date().toISOString() });
      if (fault === 'wrong_session') f.submissions[0].metadata.questionnaire_session_id = 'unrelated_session_1234567890';
      if (fault === 'wrong_receipt') f.setDraft({ final_submission_id: 'another-receipt' });
      if (fault === 'changed_payload') f.setDraft({ mapped_payload_json: JSON.stringify(payloadFor(f.original, 'An unrelated newer description')) });
      if (fault === 'meaningful_padding') { f.submissions[0].userdata.target_industries = ['Unexpected industry value']; f.hydrateSubmissionReads(hydrateProSubmissionEntity); }
      const recovery = loadHosted('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts', f.base44);
      const result = await recovery({ action: 'create_version_copy', recordType: 'draft', recordId: original.id, versionId: `submission:${receipt.id}` });
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(f.workingDrafts).toHaveLength(0);
      expect(f.getDraft().responses_json).toBe(original.responses_json);
      expect(f.submissions).toHaveLength(1);
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
