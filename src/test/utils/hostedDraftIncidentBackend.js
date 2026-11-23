import { memoryEntity } from './memoryEntities';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { vi } from 'vitest';
import * as contract from '../../../base44/shared/pageOrganizerContract.js';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
const clone = value => structuredClone(value);
export const INCIDENT_SESSION = 'incident_recovery_session_1234567';
const secret = 'incident_recovery_secret_abcdefghijklmnopqrstuvwxyz';
export const INCIDENT_CREDENTIAL = `${INCIDENT_SESSION}.${secret}`;
export async function hostedDraftIncidentBackend({ responses = {}, status = 'draft', groups = {} } = {}) {
  const records = new Map(), revisions = [], calls = [];
  const credentials = { businessName: 'Synthetic incident client', domain: 'example.test' };
  const mapped = transformResponsesToPayload(responses, credentials.businessName, credentials.domain, groups);
  const access = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))).toString('base64url');
  const original = { id: 'incident-original-draft', session_id: INCIDENT_SESSION, access_token_hash: access, status, save_revision: 0, business_name: credentials.businessName, domain: credentials.domain, responses_json: JSON.stringify(responses), mapped_payload_json: JSON.stringify(mapped), final_submission_id: status === 'submitted' ? 'incident-final-receipt' : '' };
  records.set(original.id, original);
  const matches = (record, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? record[key] > value.$gt : value == null ? record[key] == null : record[key] === value);
  const sdk = { asServiceRole: { entities: {
    ProSubmissionRetryJob: memoryEntity('retryJob'),
    ProFormDraft: {
      get: async id => clone(records.get(id)),
      filter: async (query, _sort, limit = 500, skip = 0) => [...records.values()].filter(record => matches(record, query)).slice(skip, skip + limit).map(clone),
      create: async value => { const record = { ...clone(value), id: `incident-child-${records.size}` }; records.set(record.id, record); return clone(record); },
      update: async (id, value) => { Object.assign(records.get(id), clone(value)); return clone(records.get(id)); },
      updateMany: async (query, update) => { let updated = 0; for (const record of records.values()) if (matches(record, query)) { Object.assign(record, clone(update.$set)); updated += 1; } return { updated }; }
    },
    ProFormDraftRevision: {
      filter: async (query, _sort, limit = 500, skip = 0) => revisions.filter(record => matches(record, query)).slice(skip, skip + limit).map(clone),
      create: async value => { const record = { ...clone(value), id: `incident-revision-${revisions.length}` }; revisions.push(record); return clone(record); }
    },
    ProFormSubmission: { get: async () => ({ id: 'incident-final-receipt', ...clone(mapped), metadata: { ...mapped.metadata, source_draft_id: original.id } }) },
    ProFormDraftEvent: { create: async () => ({ id: 'event' }) }, ProFormRecoveryLifecycleEvent: { create: async () => ({ id: 'lifecycle' }) }
  } } };
  let handler; const cache = new Map();
  const load = file => {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const require = name => {
      if (name.startsWith('npm:@base44/sdk')) return { createClientFromRequest: () => sdk };
      if (name.endsWith('pageOrganizerContract.js')) return contract;
      if (name.startsWith('.')) return load(resolve(dirname(file), name));
      throw new Error(`Unmocked hosted IO: ${name}`);
    };
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'exports', 'Deno', 'crypto', 'console', 'fetch', compiled)(require, exports, { serve(fn) { handler = fn; }, env: { get: () => '' } }, webcrypto, { error: vi.fn(), warn: vi.fn(), info: vi.fn() }, () => { throw new Error('Network disabled'); });
    if (typeof exports.default === 'function') handler = exports.default;
    return exports;
  };
  load(resolve(process.cwd(), 'base44/functions/syncProQuestionnaireDraft/entry.ts'));
  let intercept = null, responseTransform = value => value;
  const functions = { invoke: vi.fn(async (name, payload) => {
    calls.push(clone(payload));
    if (name !== 'syncProQuestionnaireDraft') throw new Error(`Unexpected function ${name}`);
    if (intercept) await intercept(payload);
    const response = await handler(new Request('http://localhost/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }));
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status, response: { status: response.status, data } });
    return { status: response.status, data: responseTransform(data, payload) };
  }) };
  return { functions, calls, revisions, records, getOriginal: () => clone(records.get(original.id)), intercept: fn => { intercept = fn; }, transformResponse: fn => { responseTransform = fn; } };
}
