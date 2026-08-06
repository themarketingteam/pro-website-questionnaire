import { vi } from 'vitest';

export const NOW_SECONDS = 2_000_000_000;
export const NOW_ISO = new Date(NOW_SECONDS * 1000).toISOString();
export const RESUME_TOKEN = 'R'.repeat(43);
export const CLIENT_BOOTSTRAP_TOKEN = 'C'.repeat(43);
export const SECRETS = Object.freeze({
  PRO_DRAFT_ENVIRONMENT: 'staging',
  PRO_DRAFT_V2_SERVER_ENABLED: 'true',
  PRO_DRAFT_V2_KILL_SWITCH: 'false',
  PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
  PRO_FORM_DRAFT_TOKEN_SECRET: 't'.repeat(32),
  PRO_FORM_RECOVERY_CODE_SECRET: 'c'.repeat(32),
  PRO_FORM_EMAIL_LOOKUP_SECRET: 'e'.repeat(32),
  PRO_FORM_DRAFT_LINK_SECRET: 'l'.repeat(32),
  PRO_FORM_RECOVERY_SESSION_SECRET: 's'.repeat(32),
  PRO_FORM_IDEMPOTENCY_SECRET: 'i'.repeat(32),
});

export const clientContext = (overrides = {}) => ({
  formType: 'pro-questionnaire',
  identityContextVersion: 1,
  associationIntent: 'anonymous_start',
  anonymousRecoveryAcknowledged: true,
  sourceTabId: 'tab-synthetic-1',
  environment: 'staging',
  ...overrides,
});

export const bootstrapBody = (overrides = {}) => ({
  apiVersion: 1,
  idempotencyKey: 'bootstrap.synthetic.0001',
  authorization: {},
  clientContext: clientContext(),
  clientBootstrapToken: CLIENT_BOOTSTRAP_TOKEN,
  ...overrides,
});

export const loadBody = (draftId, authorization, overrides = {}) => ({
  apiVersion: 1,
  authorization,
  requestedDraftId: draftId,
  includeCanonicalState: true,
  upgradeLegacyOnLoad: false,
  clientContext: clientContext({ associationIntent: 'resume_current_draft' }),
  ...overrides,
});

export const request = (body, overrides = {}) => new Request(
  'https://synthetic.invalid/functions/test',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...overrides,
  },
);

const matches = (record, query) => Object.entries(query)
  .every(([key, value]) => record[key] === value);

export function createMemorySdk(seed = []) {
  const records = seed.map((record) => ({ ...record }));
  let nextId = records.length + 1;
  const drafts = {
    filter: vi.fn(async (query) => records.filter((record) => matches(record, query))),
    get: vi.fn(async (id) => {
      const record = records.find((candidate) => candidate.id === id);
      if (!record) throw new Error('synthetic not found');
      return { ...record };
    }),
    create: vi.fn(async (data) => {
      const record = {
        ...data,
        id: `draft-synthetic-${nextId++}`,
        created_date: NOW_ISO,
        updated_date: NOW_ISO,
      };
      records.push(record);
      return { ...record };
    }),
    update: vi.fn(async (id, data) => {
      const index = records.findIndex((candidate) => candidate.id === id);
      if (index < 0) throw new Error('synthetic not found');
      records[index] = { ...records[index], ...data, updated_date: NOW_ISO };
      return { ...records[index] };
    }),
    updateMany: vi.fn(async () => ({ updated: 0 })),
    bulkCreate: vi.fn(async (data) => data),
  };
  const events = {
    filter: vi.fn(async () => []),
    get: vi.fn(), create: vi.fn(), update: vi.fn(),
    updateMany: vi.fn(), bulkCreate: vi.fn(),
  };
  return {
    records,
    drafts,
    sdk: { asServiceRole: { entities: { ProFormDraft: drafts, ProFormDraftEvent: events } } },
  };
}

export function dependencies(sdk, overrides = {}) {
  const environment = { ...SECRETS, ...(overrides.environment ?? {}) };
  return {
    createClientFromRequest: vi.fn(() => sdk),
    getEnvironmentValue: vi.fn((name) => environment[name]),
    createRequestId: () => `pdrq_${'Q'.repeat(43)}`,
    now: () => new Date(NOW_SECONDS * 1000),
    generateSessionId: () => `pds_${'S'.repeat(43)}`,
    generateResumeToken: () => RESUME_TOKEN,
    ...overrides,
    environment: undefined,
  };
}

export async function responseJson(response) {
  return { response, json: await response.json() };
}
