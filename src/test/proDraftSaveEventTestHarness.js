import { vi } from 'vitest';
import {
  createBootstrapProFormDraftHandler,
} from '../../base44/functions/_shared/proDraftBootstrapLoad/entry.ts';
import {
  createAppendProFormDraftEventsHandler,
  createSaveProFormDraftHandler,
} from '../../base44/functions/_shared/proDraftSaveEvents/entry.ts';
import {
  NOW_ISO,
  CLIENT_BOOTSTRAP_TOKEN,
  bootstrapBody,
  createMemorySdk,
  dependencies,
  request,
  responseJson,
} from './proDraftFunctionTestHarness.js';

const entityApis = (memory) => memory.sdk.asServiceRole.entities;

function queryMatches(record, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.includes(record[key]);
    }
    return record[key] === expected;
  });
}

export async function createAuthoritativeHarness(options = {}) {
  const memory = createMemorySdk();
  const deps = dependencies(memory.sdk, options.dependencies);
  const bootstrap = createBootstrapProFormDraftHandler(deps);
  const boot = await responseJson(await bootstrap(request(bootstrapBody())));
  if (boot.response.status !== 200) throw new Error('Synthetic bootstrap failed.');
  const entities = entityApis(memory);
  entities.ProFormDraft.update.mockClear();
  const eventRecords = [];
  const controls = {
    conditionalMode: 'normal',
    eventMode: 'normal',
    beforeConditional: null,
  };

  entities.ProFormDraft.updateMany = vi.fn(async (query, operators) => {
    if (controls.beforeConditional) await controls.beforeConditional(memory.records, query);
    if (controls.conditionalMode === 'unsupported') return { updated: 2 };
    const index = memory.records.findIndex((record) => queryMatches(record, query));
    if (index < 0 || controls.conditionalMode === 'conflict') return { updated: 0 };
    const current = memory.records[index];
    memory.records[index] = {
      ...current,
      ...(operators.$set ?? {}),
      ...Object.fromEntries(Object.entries(operators.$inc ?? {}).map(
        ([key, amount]) => [key, Number(current[key] ?? 0) + Number(amount)],
      )),
      updated_date: NOW_ISO,
    };
    if (controls.conditionalMode === 'post-read-mismatch') {
      memory.records[index].state_hash = 'f'.repeat(64);
    }
    return { updated: 1 };
  });
  entities.ProFormDraftEvent.filter = vi.fn(async (query) => eventRecords
    .filter((record) => queryMatches(record, query)).map((record) => ({ ...record })));
  entities.ProFormDraftEvent.bulkCreate = vi.fn(async (rows) => {
    if (controls.eventMode === 'throw') throw new Error('synthetic event failure');
    const created = rows.map((row, index) => ({
      ...row,
      id: `event-synthetic-${eventRecords.length + index + 1}`,
      created_date: NOW_ISO,
    }));
    if (controls.eventMode === 'short') return created.slice(0, -1);
    eventRecords.push(...created);
    return created.map((record) => ({ ...record }));
  });
  const operationDeps = options.operationDependencies
    ? dependencies(memory.sdk, options.operationDependencies)
    : deps;

  return {
    memory,
    eventRecords,
    controls,
    draftId: boot.json.draft.draftId,
    authorization: { resumeToken: CLIENT_BOOTSTRAP_TOKEN },
    saveHandler: createSaveProFormDraftHandler(operationDeps),
    eventsHandler: createAppendProFormDraftEventsHandler(operationDeps),
  };
}

export const nextCanonicalState = (harness, overrides = {}) => {
  const current = harness.memory.records[0];
  const state = JSON.parse(current.draft_state_json);
  return {
    ...state,
    draftId: harness.draftId,
    sessionId: current.session_id,
    clientRevision: Number(current.client_revision) + 1,
    serverRevision: Number(current.server_revision),
    savedAtClient: NOW_ISO,
    responses: { ...state.responses, syntheticQuestion: 'synthetic-value' },
    ...overrides,
  };
};

export const saveBody = (harness, overrides = {}) => {
  const canonicalState = overrides.canonicalState ?? nextCanonicalState(harness);
  return {
    apiVersion: 1,
    authorization: harness.authorization,
    draftId: harness.draftId,
    expectedServerRevision: harness.memory.records[0].server_revision,
    idempotencyKey: 'save.synthetic.0001',
    canonicalState,
    mappedPayload: { metadata: {}, userdata: canonicalState.responses },
    syncReason: 'autosave',
    requestedStatus: canonicalState.draftStatus,
    ...overrides,
  };
};

export const event = (index = 1, overrides = {}) => ({
  eventId: `event.synthetic.${String(index).padStart(4, '0')}`,
  eventType: 'answer_changed',
  questionId: `question-${index}`,
  questionType: 'text',
  mutationId: `mutation.synthetic.${String(index).padStart(4, '0')}`,
  value: `value-${index}`,
  valueSummary: `value-${index}`,
  valueLength: 7,
  selectedOptionCount: 0,
  occurredAtClient: NOW_ISO,
  metadata: { source: 'synthetic-test' },
  ...overrides,
});

export const eventsBody = (harness, overrides = {}) => ({
  apiVersion: 1,
  authorization: harness.authorization,
  draftId: harness.draftId,
  idempotencyKey: 'events.synthetic.0001',
  clientRevision: harness.memory.records[0].client_revision,
  sourceTabId: 'tab-synthetic-1',
  events: [event()],
  ...overrides,
});

export async function call(handler, body) {
  return responseJson(await handler(request(body)));
}
