import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  guardOrganizedDraftMutation, preserveOrganizedMappedPayload, validateOrganizedPayload, validateOrganizedSubmission
} from '../base44/shared/pageOrganizerContract.js';
import { countPageSelections, flattenPageStructure, getPageCatalogId } from '../src/lib/pageOrganizerModel.js';
import { loadCatalog, loadScoutFixture } from './local-preview-fixtures.mjs';
const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const randomId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const fail = (message, status = 400, code = 'LOCAL_REQUEST_REJECTED') => { throw Object.assign(new Error(message), { status, code }); };
const assertResult = (result) => { if (!result.ok) fail(result.errors.join(' '), result.status || 400, result.code); };
const countLegacyOther = (value) => Array.isArray(value) ? value.filter((item) => String(item || '').trim()).length : value ? 1 : 0;

export const createLocalApi = (root, { dataDirectory = path.join(root, '.local-preview') } = {}) => {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const statePath = path.join(dataDirectory, 'state.json');
  const catalog = loadCatalog(root);
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { version: 1, drafts: {}, submissions: [], captures: [], records: {}, events: [], activeDraftId: null };
  let inTransaction = false;
  let persistencePending = false;
  const writeState = () => {
    try {
      fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2));
      fs.renameSync(statePath + '.tmp', statePath);
    } catch (error) {
      try { fs.unlinkSync(statePath + '.tmp'); } catch {}
      throw error;
    }
  };
  const persist = () => {
    if (inTransaction) persistencePending = true;
    else writeState();
  };
  // Each request is synchronous once its JSON has been read. Commit all its
  // mutations with one atomic rename, or restore the entire in-memory snapshot
  // so a retry cannot mistake an uncommitted mutation for a durable success.
  const transact = (operation) => {
    if (inTransaction) return operation();
    const previous = clone(state);
    inTransaction = true;
    persistencePending = false;
    try {
      const result = operation();
      if (persistencePending) writeState();
      return result;
    } catch (error) {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, previous);
      throw error;
    } finally {
      inTransaction = false;
      persistencePending = false;
    }
  };
  const publicDraft = (draft) => ({ ...Object.fromEntries(Object.entries(draft).filter(([key]) => !['resumeCredential', 'revisions', 'mutations', 'clientSequences', 'revisionRequestHash'].includes(key))), draftId: draft.id });
  const createDraft = (fixture = 'blank', credentials = {}) => {
    const seed = fixture === 'scout' ? loadScoutFixture(root) : { responses: {}, credentials, mappedPayload: null };
    const id = randomId('localdraft');
    const sessionId = randomId('local');
    const draft = { id, sessionId, resumeCredential: `${sessionId}.${crypto.randomBytes(32).toString('base64url')}`, revision: 0,
      responses: seed.responses, credentials: seed.credentials, validationStatus: {}, touchedQuestions: {}, expandedQuestions: { '3': true, '4': true },
      mappedPayload: seed.mappedPayload, status: 'draft', lastSavedAt: now(), currentQuestionId: '', revisions: [], mutations: {}, clientSequences: {} };
    state.drafts[id] = draft; state.activeDraftId = id; persist(); return draft;
  };
  if (!state.activeDraftId) createDraft('scout');
  const findDraft = (credential) => Object.values(state.drafts).find((item) => item.resumeCredential === credential);
  const requireDraft = (credential) => findDraft(credential) || fail('This recovery credential does not identify a local preview draft. Load a local sample to continue.', 401);
  const capture = (payload, route, submissionId = null) => {
    assertResult(validateOrganizedPayload(payload));
    const record = { id: randomId('capture'), route, capturedAt: now(), submissionId, payload: clone(payload), destination: 'LOCAL DISK ONLY — no webhook sent' };
    state.captures.push(record); persist(); return record;
  };
  const validateCounts = (payload, responses) => {
    const catalogIds = {
      '3': new Set(Object.entries(catalog.services).flatMap(([parent, children]) => [getPageCatalogId('3', parent, 'parent'), ...children.map((label) => getPageCatalogId('3', label))])),
      '4': new Set([...catalog.industries, ...catalog.legacyIndustries].map((label) => getPageCatalogId('4', label)))
    };
    // Catalog provenance and counting belong to the saved editor state. The
    // outbound page trees intentionally contain no editor or catalog IDs.
    for (const id of ['3', '4']) {
      if (responses[`${id}_structure`]) {
        for (const page of flattenPageStructure(responses[`${id}_structure`])) {
          if (page.source === 'predefined' && !catalogIds[id].has(page.catalogId)) fail('A page has an unknown catalog identity; review it before submitting.');
        }
      }
    }

    let serviceCount;
    if (responses['3_structure']) serviceCount = countPageSelections(responses['3_structure'], '3', catalog.services);
    else serviceCount = payload.userdata.service_offerings.filter((label) => !Object.hasOwn(catalog.services, label)).length + countLegacyOther(payload.userdata.service_offerings_other);
    const industryCount = responses['4_structure'] ? countPageSelections(responses['4_structure'], '4') : payload.userdata.target_industries.length + countLegacyOther(payload.userdata.target_industries_other);
    const locationCount = payload.userdata.geographic_areas?.length || 0;
    if (serviceCount < 3 || serviceCount > 15 || industryCount < 1 || industryCount > 10 || locationCount < 1 || locationCount > 5 || serviceCount + industryCount + locationCount > 25) fail('Selection limits are not met (3–15 services, 1–10 industries, 1–5 locations, at most 25 combined).');
  };
  const submit = (body, name) => {
    const payload = body.transformedPayload;
    if (!payload?.metadata?.business_name || !payload?.metadata?.businessDomain || !payload?.userdata) fail('A complete transformed payload and business identity are required.');
    const draft = requireDraft(body.resumeCredential);
    if (body.draftId && body.draftId !== draft.id) fail('Local draft identity mismatch.', 409);
    assertResult(validateOrganizedSubmission({ payload, responses: draft.responses }));
    validateCounts(payload, draft.responses);
    const fingerprint = body.submissionContentFingerprint || JSON.stringify(payload.userdata);
    const previous = state.submissions.find((item) => item.local_fingerprint === fingerprint && item.local_draft_id === draft.id);
    if (previous) {
      persist();
      return { success: true, submission: previous, zapierSent: false, localOnly: true, duplicate: true };
    }
    if (draft.status === 'submitted' || draft.finalSubmissionId) fail('Start a revision before changing a completed questionnaire.', 409, 'DRAFT_ALREADY_SUBMITTED');
    const submission = { ...clone(payload), id: randomId('localsubmission'), created_date: now(), local_fingerprint: fingerprint, local_draft_id: draft.id, raw_responses: clone(draft.responses) };
    state.submissions.push(submission);
    draft.status = 'submitted'; draft.finalSubmissionId = submission.id;
    capture(payload, name, submission.id);
    return { success: true, submission, zapierSent: false, localOnly: true };
  };
  const invokeOperation = (name, body = {}) => {
    if (name === 'syncProQuestionnaireDraft') {
      if (body.action === 'start_revision') fail('Submitted questionnaires are read-only. Your team can create a separate revision in recovery.', 403, 'REVISION_REQUIRES_TEAM');
      if (body.action === 'bootstrap') {
        let draft;
        if (body.newClient) draft = createDraft('blank', body.credentials || {});
        else if (body.resumeCredential) draft = requireDraft(body.resumeCredential);
        else draft = state.drafts[state.activeDraftId];
        return { success: true, resumeCredential: draft.resumeCredential, draft: publicDraft(draft), newClientRequestConfirmed: Boolean(body.newClient) };
      }
      const draft = requireDraft(body.resumeCredential);
      if (body.action === 'event') { state.events.push({ ...body.event, id: randomId('event'), created_date: now(), draft_id: draft.id }); persist(); return { success: true }; }
      if (body.action !== 'save') fail(`Unsupported local draft action: ${body.action}`, 400);
      if (draft.status === 'submitted') return { success: true, finalized: true, ignored: true, draft: publicDraft(draft) };
      if (!body.mutationId || !body.clientInstanceId || !Number.isInteger(body.clientSequence)) fail('A local draft save requires mutation and client sequence identifiers.');
      if (draft.mutations[body.mutationId]) {
        persist();
        return { success: true, draft: publicDraft(draft), duplicate: true };
      }
      if (body.clientSequence <= (draft.clientSequences[body.clientInstanceId] || 0)) fail('An older save from this tab was rejected.', 409, 'STALE_CLIENT_SEQUENCE');
      assertResult(guardOrganizedDraftMutation({ currentResponses: draft.responses, incomingResponses: body.responses, changedKeys: body.changedKeys || [], deletedKeys: body.deletedKeys || [], baseRevision: body.baseRevision, currentRevision: draft.revision }));
      const next = { ...draft.responses };
      for (const key of body.changedKeys || []) {
        if (!/^\d+(?:\.\d+)?(?:_(?:other|primary))?$/.test(key) && !['3_structure', '4_structure'].includes(key)) fail('Unsupported answer key.');
        if (Object.hasOwn(body.responses || {}, key)) next[key] = body.responses[key];
      }
      for (const key of body.deletedKeys || []) delete next[key];
      const mapped = preserveOrganizedMappedPayload(body.mappedPayload || draft.mappedPayload, next);
      if (mapped) assertResult(validateOrganizedPayload(mapped));
      draft.revisions.push({ revision: draft.revision, savedAt: draft.lastSavedAt, responses: clone(draft.responses), mappedPayload: clone(draft.mappedPayload), credentials: clone(draft.credentials) });
      draft.responses = next; draft.mappedPayload = mapped;
      draft.credentials = { ...draft.credentials, ...(body.credentials || {}) };
      for (const key of ['validationStatus', 'touchedQuestions', 'expandedQuestions']) if (body[key]) draft[key] = body[key];
      draft.currentQuestionId = body.currentQuestionId || draft.currentQuestionId;
      draft.lastSavedAt = now(); draft.revision += 1; draft.status = body.status || draft.status;
      draft.clientSequences[body.clientInstanceId] = body.clientSequence;
      draft.mutations[body.mutationId] = draft.revision;
      persist(); return { success: true, draft: publicDraft(draft) };
    }
    if (name === 'submitProQuestionnaireDurable' || name === 'submitProQuestionnaireFallback') return submit(body, name);
    if (name === 'sendToZapier') { const record = capture(body, name); return { success: true, localOnly: true, captureId: record.id, message: 'Captured locally; no Zapier request sent.' }; }
    if (name === 'validateQuestionText') return { status: 'complete', localOnly: true, feedback: 'Local preview: remote AI validation is disconnected.' };
    if (/generateAI|repairProQuestionnaire/.test(name)) fail('AI services are disabled in this isolated local preview.', 503, 'LOCAL_AI_DISABLED');
    fail(`Function ${name} is unavailable locally; no remote fallback exists.`, 501, 'LOCAL_FUNCTION_UNAVAILABLE');
  };
  const invoke = (name, body) => transact(() => invokeOperation(name, body));
  const entity = (name, action, body) => {
    const allowed = ['ProFormDraftEvent', 'ProFormSubmission', 'ProFormSubmissionIntake', 'QuestionnairePdfVersion', 'ProFormDraft'];
    if (!allowed.includes(name)) fail('Entity is unavailable locally.', 501);
    const records = state.records[name] ||= [];
    if (action === 'filter') {
      let results = name === 'ProFormSubmission' ? state.submissions : records;
      results = results.filter((item) => Object.entries(body.query || {}).every(([key, value]) => item[key] === value));
      return results.slice(body.skip || 0, (body.skip || 0) + (body.limit || results.length));
    }
    if (action === 'get') return records.find((item) => item.id === body.id) || fail('Local record not found.', 404);
    if (action === 'create') {
      if (name === 'ProFormSubmission') fail('Use the durable local submission endpoint.', 400);
      const record = { ...body.data, id: randomId('localrecord'), created_date: now() }; records.push(record); persist(); return record;
    }
    if (action === 'update') { const item = records.find((record) => record.id === body.id) || fail('Local record not found.', 404); Object.assign(item, body.data); persist(); return item; }
    fail('Unsupported local entity operation.', 400);
  };
  const handleOperation = (url, body, method) => {
    const pathname = url.pathname;
    if (pathname === '/_local/api/health') return { localOnly: true, storage: statePath, draftCount: Object.keys(state.drafts).length };
    if (pathname === '/_local/api/state') return { localOnly: true, drafts: Object.values(state.drafts).map(publicDraft), submissions: state.submissions, captures: state.captures };
    if (pathname === '/_local/api/fixture' && method === 'POST') { const draft = createDraft(body.fixture === 'scout' ? 'scout' : 'blank'); return { success: true, resumeCredential: draft.resumeCredential }; }
    if (pathname === '/_local/api/history') { const draft = requireDraft(body.resumeCredential); return { revisions: [...draft.revisions].reverse().map(({ revision, savedAt }) => ({ revision, savedAt })) }; }
    if (pathname === '/_local/api/restore' && method === 'POST') {
      const draft = requireDraft(body.resumeCredential); const saved = draft.revisions.find((item) => item.revision === body.revision) || fail('Local revision not found.', 404);
      // Restore into a separate local draft; the existing history is never overwritten.
      const restored = createDraft('blank', saved.credentials); restored.responses = clone(saved.responses); restored.mappedPayload = clone(saved.mappedPayload); persist();
      return { success: true, resumeCredential: restored.resumeCredential };
    }
    if (pathname === '/_local/api/upload') {
      if (typeof body.data !== 'string' || !/^data:[\w/+.-]+;base64,/.test(body.data)) fail('Invalid local upload.');
      const [, mime, content] = body.data.match(/^data:([\w/+.-]+);base64,(.*)$/s);
      const id = randomId('upload'); const directory = path.join(dataDirectory, 'uploads'); fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, id), Buffer.from(content, 'base64')); fs.writeFileSync(path.join(directory, id + '.json'), JSON.stringify({ mime, name: body.name }));
      return { file_url: `/_local/uploads/${id}`, localOnly: true };
    }
    const functionMatch = pathname.match(/^\/_local\/api\/functions\/([A-Za-z0-9_-]+)$/) || pathname.match(/^\/api\/apps\/local-questionnaire\/functions\/([A-Za-z0-9_-]+)$/);
    if (functionMatch) return invoke(functionMatch[1], body);
    const entityMatch = pathname.match(/^\/_local\/api\/entities\/([A-Za-z0-9]+)\/(create|update|get|filter)$/);
    if (entityMatch) return entity(entityMatch[1], entityMatch[2], body);
    fail('No local endpoint exists; remote forwarding is disabled.', 404);
  };
  const handle = async (url, body, method) => transact(() => handleOperation(url, body, method));
  return { handle, invoke, state, statePath, dataDirectory };
};

export const createLocalApiMiddleware = (root) => {
  const api = createLocalApi(root);
  return async (request, response, next) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/_local/') && !url.pathname.startsWith('/api/')) return next();
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) fail('Cross-origin preview writes are blocked.', 403);
      const uploadMatch = url.pathname.match(/^\/_local\/uploads\/(upload_[A-Za-z0-9]+)$/);
      if (uploadMatch) {
        const file = path.join(api.dataDirectory, 'uploads', uploadMatch[1]);
        if (!fs.existsSync(file)) fail('Local upload not found.', 404);
        const metadata = JSON.parse(fs.readFileSync(file + '.json', 'utf8'));
        response.setHeader('Content-Type', metadata.mime); response.end(fs.readFileSync(file)); return;
      }
      let body = '';
      for await (const chunk of request) { body += chunk; if (body.length > 20_000_000) fail('Local request exceeds 20 MB.', 413); }
      const result = await api.handle(url, body ? JSON.parse(body) : {}, request.method);
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = error.status || 400; response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ success: false, error: error.message, code: error.code || 'LOCAL_REQUEST_REJECTED' }));
    }
  };
};
