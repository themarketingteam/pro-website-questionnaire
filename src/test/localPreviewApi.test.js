import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL, URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalApi, createLocalApiMiddleware } from '../../scripts/local-preview-api.mjs';
import { installLocalNetworkGuard } from '@/local/networkGuard';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { SERVICE_OPTIONS_GROUPED, SERVICE_OPTIONS, INDUSTRY_OPTIONS, ACCEPTED_INDUSTRY_OPTIONS } from '@/components/pro-form/questionData';
import { createPageStructure, projectPageStructure, movePage } from '@/lib/pageOrganizerModel';
import { serializePageStructure } from '../../base44/shared/pageOrganizerContract.js';

const repository = process.cwd();
// Inspect the actual configuration without starting Vite or importing esbuild
// into jsdom's realm. Configure-server callbacks are deliberately never invoked.
const configPath = path.join(repository, 'vite.local.config.js');
const configSource = fs.readFileSync(configPath, 'utf8')
  .replace(/^import .+;$/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(configPath).href))
  .replace('export default defineConfig(', 'globalThis.result = defineConfig(');
const localConfig = vm.runInNewContext(`${configSource}\n;result;`, {
  URL: NodeURL, fileURLToPath, defineConfig: (config) => config,
  react: () => ({ name: 'test-react-plugin' }),
  createLocalApiMiddleware: () => { throw new Error('Configuration inspection must not start the API.'); }
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const localUrl = (pathname) => new URL(pathname, 'http://localhost:5173');
const legacyResponses = {
  '3': ['Managed IT Services', 'Managed IT', 'Co-Managed IT', 'On-Site Support'],
  '4': INDUSTRY_OPTIONS.slice(0, 3),
  '5': [
    { name: 'Louisville, KY', label: 'Louisville, KY', place_id: 'local-louisville', source: 'manual' },
    { name: 'Lexington, KY', label: 'Lexington, KY', place_id: 'local-lexington', source: 'manual' }
  ],
  '6': 'A synthetic fixture used only by local preview tests.'
};
const fixturePayload = transformResponsesToPayload(legacyResponses, 'Local Fixture LLC', 'fixture.example', SERVICE_OPTIONS_GROUPED);

let directory;
let fixtureRoot;
let dataDirectory;
let sequence;
let originalFetch;
let originalXhrOpen;
let originalBeacon;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'questionnaire-local-api-test-'));
  fixtureRoot = path.join(directory, 'fixture-project');
  dataDirectory = path.join(directory, 'local-state');
  fs.mkdirSync(path.join(fixtureRoot, 'src/components/pro-form'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'fixtures'), { recursive: true });
  fs.copyFileSync(path.join(repository, 'src/components/pro-form/questionData.jsx'), path.join(fixtureRoot, 'src/components/pro-form/questionData.jsx'));
  fs.writeFileSync(path.join(fixtureRoot, 'fixtures/scout-networks-legacy.json'), JSON.stringify(fixturePayload));
  sequence = 0;
  originalFetch = window.fetch;
  originalXhrOpen = XMLHttpRequest.prototype.open;
  originalBeacon = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request from local API test.'); }));
});

afterEach(() => {
  window.fetch = originalFetch;
  XMLHttpRequest.prototype.open = originalXhrOpen;
  if (originalBeacon) Object.defineProperty(navigator, 'sendBeacon', originalBeacon);
  else delete navigator.sendBeacon;
  vi.unstubAllGlobals();
  fs.rmSync(directory, { recursive: true, force: true });
});

const bootstrap = (api, credential) => api.invoke('syncProQuestionnaireDraft', { action: 'bootstrap', ...(credential ? { resumeCredential: credential } : {}) });
const currentDraft = (api, session) => api.state.drafts[session.draft.id];
const mapped = (responses) => transformResponsesToPayload(responses, 'Local Fixture LLC', 'fixture.example', SERVICE_OPTIONS_GROUPED);
const organize = (responses, id = '3') => {
  const structure = createPageStructure(id, responses[id], responses[`${id}_other`], id === '3' ? SERVICE_OPTIONS_GROUPED : {}, id === '3' ? SERVICE_OPTIONS : INDUSTRY_OPTIONS);
  const projection = projectPageStructure(structure);
  return { [id]: projection.selections, [`${id}_other`]: projection.otherValues, [`${id}_structure`]: structure };
};
const save = (api, session, patch, overrides = {}) => {
  const draft = currentDraft(api, session);
  const responses = { ...clone(draft.responses), ...patch };
  for (const key of overrides.deletedKeys || []) delete responses[key];
  sequence += 1;
  return api.invoke('syncProQuestionnaireDraft', {
    action: 'save', resumeCredential: session.resumeCredential,
    mutationId: `mutation-${sequence}`, clientInstanceId: 'test-tab', clientSequence: sequence,
    baseRevision: draft.revision, changedKeys: Object.keys(patch), deletedKeys: [],
    responses, mappedPayload: mapped(responses), ...overrides
  });
};

describe('isolated local preview API persistence', () => {
  it('loads a legacy fixture without adopting or changing it, then resumes the same disk draft after restart', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const diskBefore = fs.readFileSync(api.statePath, 'utf8');
    expect(session.draft.responses).not.toHaveProperty('3_structure');
    expect(session.draft.responses).not.toHaveProperty('4_structure');
    expect(session.draft.mappedPayload).toEqual(fixturePayload);

    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    const resumed = bootstrap(restarted, session.resumeCredential);
    expect(resumed).toEqual(session);
    expect(fs.readFileSync(api.statePath, 'utf8')).toBe(diskBefore);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves reordered trees and compatibility projections together, then restores the same identities from disk', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const patch = organize(session.draft.responses);
    const parent = patch['3_structure'].pages[0];
    const reordered = movePage(patch['3_structure'], parent.children[2].id, parent.id, 0);
    const projection = projectPageStructure(reordered);
    save(api, session, { ...patch, '3_structure': reordered, '3': projection.selections });

    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    const resumed = bootstrap(restarted, session.resumeCredential).draft;
    expect(resumed.revision).toBe(1);
    expect(resumed.responses['3_structure']).toEqual(reordered);
    expect(resumed.responses['3_structure'].pages[0].children.map((page) => page.label)).toEqual(['On-Site Support', 'Managed IT', 'Co-Managed IT']);
    expect(resumed.mappedPayload.metadata.questionnaire_payload_version).toBe(2);
    expect(resumed.mappedPayload.userdata.service_offerings).toEqual(projection.selections);
    expect(resumed.mappedPayload.userdata.service_offerings_structure).toEqual(serializePageStructure(reordered));
    expect(resumed.responses['4']).toEqual(session.draft.responses['4']);
  });

  it('rejects unknown structures and outdated tab edits without modifying disk or the accepted tree', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const legacy = clone(session.draft.responses);
    const patch = organize(legacy);
    save(api, session, patch);
    const acceptedDisk = fs.readFileSync(api.statePath, 'utf8');

    expect(() => api.invoke('syncProQuestionnaireDraft', {
      action: 'save', resumeCredential: session.resumeCredential, mutationId: 'unknown', clientInstanceId: 'future-tab', clientSequence: 1,
      baseRevision: 1, changedKeys: ['3_structure'], responses: { '3_structure': { format: 'future-page-tree', pages: [] } }
    })).toThrow(/page-tree-v1/);
    expect(() => save(api, session, { '3': ['Managed IT'] }, {
      responses: { ...legacy, '3': ['Managed IT'] }, mappedPayload: fixturePayload, baseRevision: 0, clientInstanceId: 'old-tab'
    })).toThrow(/Reload before changing/);
    const differentTree = clone(patch['3_structure']);
    differentTree.pages[0].children.reverse();
    expect(() => save(api, session, { ...patch, '3_structure': differentTree }, { baseRevision: 0, clientInstanceId: 'stale-organizer-tab' })).toThrow(/another tab/);

    expect(fs.readFileSync(api.statePath, 'utf8')).toBe(acceptedDisk);
    expect(currentDraft(api, session).responses['3_structure']).toEqual(patch['3_structure']);
  });

  it('preserves an adopted tree through an unrelated legacy-tab save and regenerates its mapped projection', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const legacy = clone(session.draft.responses);
    const patch = organize(legacy);
    save(api, session, patch);
    save(api, session, { '6': 'An unrelated text edit from an older tab.' }, {
      responses: { ...legacy, '6': 'An unrelated text edit from an older tab.' },
      mappedPayload: mapped({ ...legacy, '6': 'An unrelated text edit from an older tab.' }),
      baseRevision: 0, clientInstanceId: 'legacy-unrelated-tab'
    });

    const draft = currentDraft(api, session);
    expect(draft.responses['6']).toBe('An unrelated text edit from an older tab.');
    expect(draft.responses['3_structure']).toEqual(patch['3_structure']);
    expect(draft.mappedPayload.userdata.service_offerings_structure).toEqual(serializePageStructure(patch['3_structure']));
    expect(draft.mappedPayload.userdata.service_offerings).toEqual(patch['3']);
    expect(draft.mappedPayload.metadata.questionnaire_payload_version).toBe(2);
  });

  it('retries disk persistence before acknowledging a mutation whose previous disk write failed', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const responses = { ...session.draft.responses, '6': 'This answer must survive the restart after a retry.' };
    const mutation = {
      action: 'save', resumeCredential: session.resumeCredential,
      mutationId: 'retry-after-disk-failure', clientInstanceId: 'disk-test-tab', clientSequence: 1,
      baseRevision: 0, changedKeys: ['6'], deletedKeys: [], responses, mappedPayload: mapped(responses)
    };
    const originalWrite = fs.writeFileSync;
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((filename, ...args) => {
      if (filename === `${api.statePath}.tmp`) throw Object.assign(new Error('Simulated temporary disk write failure.'), { code: 'EIO' });
      return originalWrite(filename, ...args);
    });
    try {
      expect(() => api.invoke('syncProQuestionnaireDraft', mutation)).toThrow(/disk write failure/);
    } finally {
      write.mockRestore();
    }
    const retry = api.invoke('syncProQuestionnaireDraft', mutation);

    expect(retry.success).toBe(true);
    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    expect(bootstrap(restarted, session.resumeCredential).draft.responses['6']).toBe(responses['6']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rolls back a failed atomic rename and leaves the previous disk draft readable', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const before = fs.readFileSync(api.statePath, 'utf8');
    const patch = organize(session.draft.responses);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Simulated atomic rename failure.'); });
    try {
      expect(() => save(api, session, patch)).toThrow(/atomic rename failure/);
    } finally {
      rename.mockRestore();
    }

    expect(JSON.parse(JSON.stringify(api.state))).toEqual(JSON.parse(before));
    expect(fs.readFileSync(api.statePath, 'utf8')).toBe(before);
    expect(fs.existsSync(`${api.statePath}.tmp`)).toBe(false);
    save(api, session, patch);
    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    expect(bootstrap(restarted, session.resumeCredential).draft.responses['3_structure']).toEqual(patch['3_structure']);
  });

  it('persists an explicit empty organized reset and refuses a downgrade that could resurrect prior selections', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const legacyIndustry = clone(session.draft.responses['4']);
    save(api, session, organize(session.draft.responses));
    const empty = { format: 'page-tree-v1', pages: [] };
    save(api, session, { '3': [], '3_other': [], '3_structure': empty });

    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    const resumed = bootstrap(restarted, session.resumeCredential);
    expect(resumed.draft.responses['3_structure']).toEqual(empty);
    expect(resumed.draft.responses['3']).toEqual([]);
    expect(resumed.draft.mappedPayload.userdata.service_offerings).toEqual([]);
    expect(resumed.draft.mappedPayload.userdata.service_offerings_structure).toEqual(empty);
    expect(resumed.draft.responses['4']).toEqual(legacyIndustry);
    expect(resumed.draft.responses).not.toHaveProperty('4_structure');
    expect(() => save(restarted, resumed, {}, { deletedKeys: ['3_structure'] })).toThrow(/cannot be downgraded/);
  });

  it('accepts already-organized historical industry IDs after the picker separates their labels', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const labels = ['Financial / Accounting / CPA', 'Healthcare / Medical', 'Legal Firms'];
    const original = createPageStructure('4', labels, [], {}, labels);
    const recognized = createPageStructure('4', labels, [], {}, ACCEPTED_INDUSTRY_OPTIONS);
    expect(recognized).toEqual(original);
    save(api, session, { '4': labels, '4_other': [], '4_structure': original });
    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    const resumed = bootstrap(restarted, session.resumeCredential);
    const result = restarted.invoke('submitProQuestionnaireDurable', {
      resumeCredential: resumed.resumeCredential, draftId: resumed.draft.id,
      transformedPayload: mapped(resumed.draft.responses)
    });
    expect(result.success).toBe(true);
    expect(result.submission.userdata.target_industries).toEqual(labels);
    expect(result.submission.userdata.target_industries_other).toBe('');
    expect(result.submission.userdata.target_industries_structure).toEqual(serializePageStructure(original));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('captures submissions locally, deduplicates retries, and never calls fetch', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    save(api, session, { ...organize(session.draft.responses), ...organize(session.draft.responses, '4') });
    const draft = currentDraft(api, session);
    const body = { resumeCredential: session.resumeCredential, draftId: draft.id, transformedPayload: mapped(draft.responses) };
    const result = api.invoke('submitProQuestionnaireDurable', body);
    const duplicate = api.invoke('submitProQuestionnaireFallback', body);

    expect(result).toMatchObject({ success: true, zapierSent: false, localOnly: true });
    expect(duplicate).toMatchObject({ success: true, duplicate: true });
    expect(api.state.submissions).toHaveLength(1);
    expect(api.state.captures).toHaveLength(1);
    expect(api.state.captures[0]).toMatchObject({ destination: 'LOCAL DISK ONLY — no webhook sent', payload: body.transformedPayload });
    expect(api.state.submissions[0].raw_responses['3_structure']).toEqual(draft.responses['3_structure']);
    expect(api.state.captures[0].payload.userdata.service_offerings_structure.pages[0]).toEqual({
      label: 'Managed IT Services', source: 'predefined', children: [
        { label: 'Managed IT', source: 'predefined' },
        { label: 'Co-Managed IT', source: 'predefined' },
        { label: 'On-Site Support', source: 'predefined' }
      ]
    });
    expect(api.state.submissions[0].raw_responses['3_structure'].pages[0]).toHaveProperty('id');
    expect(api.state.submissions[0].raw_responses['3_structure'].pages[0]).toHaveProperty('catalogId');
    expect(fetch).not.toHaveBeenCalled();
    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    expect(restarted.state.captures).toEqual(api.state.captures);
    expect(restarted.state.submissions).toEqual(api.state.submissions);
  });

  it('durably commits a captured submission before reporting success on a retry after disk failure', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const body = { resumeCredential: session.resumeCredential, transformedPayload: mapped(session.draft.responses) };
    const originalWrite = fs.writeFileSync;
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((filename, ...args) => {
      if (filename === `${api.statePath}.tmp`) throw Object.assign(new Error('Simulated submission disk failure.'), { code: 'EIO' });
      return originalWrite(filename, ...args);
    });
    try {
      expect(() => api.invoke('submitProQuestionnaireDurable', body)).toThrow(/submission disk failure/);
    } finally {
      write.mockRestore();
    }
    expect(api.invoke('submitProQuestionnaireFallback', body).success).toBe(true);

    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    expect(restarted.state.submissions).toHaveLength(1);
    expect(restarted.state.captures).toHaveLength(1);
    expect(restarted.state.captures[0].payload).toEqual(body.transformedPayload);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not create captures when the submitted tree differs from the saved draft', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    save(api, session, organize(session.draft.responses));
    const draft = currentDraft(api, session);
    const changed = clone(draft.responses['3_structure']);
    changed.pages[0].children.reverse();
    const payload = mapped({ ...draft.responses, '3_structure': changed });

    expect(() => api.invoke('submitProQuestionnaireDurable', { resumeCredential: session.resumeCredential, transformedPayload: payload })).toThrow(/does not match the saved draft/);
    expect(api.state.captures).toEqual([]);
    expect(api.state.submissions).toEqual([]);
  });

  it('rejects a forged predefined catalog identity before creating a local submission', () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    const patch = organize(session.draft.responses);
    patch['3_structure'].pages[0].children[0].catalogId = 'q3:parent:Unlisted%20catalog%20entry';
    save(api, session, patch);
    const draft = currentDraft(api, session);

    expect(() => api.invoke('submitProQuestionnaireDurable', { resumeCredential: session.resumeCredential, transformedPayload: mapped(draft.responses) })).toThrow(/unknown catalog identity/);
    expect(api.state.captures).toEqual([]);
    expect(api.state.submissions).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('restores a historical revision into a new draft while retaining the original and its history', async () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    save(api, session, organize(session.draft.responses));
    const original = clone(currentDraft(api, session));
    const restored = await api.handle(localUrl('/_local/api/restore'), { resumeCredential: session.resumeCredential, revision: 0 }, 'POST');
    const resumed = bootstrap(api, restored.resumeCredential);

    expect(resumed.draft.id).not.toBe(original.id);
    expect(resumed.draft.responses).not.toHaveProperty('3_structure');
    expect(currentDraft(api, session)).toEqual(original);
    expect(Object.keys(api.state.drafts)).toHaveLength(2);
  });

  it('does not leave a partial new draft when restoring history fails to commit to disk', async () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    save(api, session, organize(session.draft.responses));
    const before = fs.readFileSync(api.statePath, 'utf8');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Simulated restore commit failure.'); });
    try {
      await expect(api.handle(localUrl('/_local/api/restore'), { resumeCredential: session.resumeCredential, revision: 0 }, 'POST')).rejects.toThrow(/restore commit failure/);
    } finally {
      rename.mockRestore();
    }

    expect(JSON.parse(JSON.stringify(api.state))).toEqual(JSON.parse(before));
    expect(Object.keys(api.state.drafts)).toHaveLength(1);
    expect(api.state.activeDraftId).toBe(session.draft.id);
    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    expect(bootstrap(restarted, session.resumeCredential).draft.responses['3_structure']).toEqual(currentDraft(api, session).responses['3_structure']);
  });

  it('never modifies source resources or its legacy input fixture, and rejects unknown endpoints and functions', async () => {
    const fixturePath = path.join(fixtureRoot, 'fixtures/scout-networks-legacy.json');
    const sourcePath = path.join(fixtureRoot, 'src/components/pro-form/questionData.jsx');
    const fixtureBefore = fs.readFileSync(fixturePath, 'utf8');
    const sourceBefore = fs.readFileSync(sourcePath, 'utf8');
    const backendPath = path.join(fixtureRoot, 'base44/entities/ProFormSubmission.jsonc');
    fs.mkdirSync(path.dirname(backendPath), { recursive: true });
    fs.writeFileSync(backendPath, '{ "sentinel": "backend resource must remain untouched" }');
    const backendBefore = fs.readFileSync(backendPath, 'utf8');
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    save(api, session, organize(session.draft.responses));

    expect(() => api.invoke('unknownProductionFunction', {})).toThrow(/no remote fallback/);
    expect(() => api.invoke('generateAIContentOpenAI', {})).toThrow(/AI services are disabled/);
    await expect(api.handle(localUrl('/api/apps/6925fec3678942d22522b010/functions/sendToZapier'), fixturePayload, 'POST')).rejects.toThrow(/remote forwarding is disabled/);
    await expect(api.handle(localUrl('/_local/api/entities/ProFormSubmission/create'), { data: fixturePayload }, 'POST')).rejects.toThrow(/durable local submission endpoint/);
    await expect(api.handle(localUrl('/api/base44/entities/ProFormSubmission.jsonc'), { data: 'overwrite' }, 'POST')).rejects.toThrow(/remote forwarding is disabled/);
    expect(() => bootstrap(api, 'production-session.production-recovery-credential')).toThrow(/does not identify a local preview draft/);
    expect(fs.readFileSync(fixturePath, 'utf8')).toBe(fixtureBefore);
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe(sourceBefore);
    expect(fs.readFileSync(backendPath, 'utf8')).toBe(backendBefore);
    expect(fs.existsSync(path.join(fixtureRoot, '.local-preview'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('isolated local preview network boundaries', () => {
  it('rejects a cross-origin middleware write before it can alter the local draft', async () => {
    const middleware = createLocalApiMiddleware(fixtureRoot);
    const statePath = path.join(fixtureRoot, '.local-preview/state.json');
    const before = fs.readFileSync(statePath, 'utf8');
    const request = {
      url: '/_local/api/fixture', method: 'POST',
      headers: { host: 'localhost:5173', origin: 'https://external.example' },
      async *[Symbol.asyncIterator]() { yield JSON.stringify({ fixture: 'blank' }); }
    };
    const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    await middleware(request, response, next);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.end.mock.lastCall[0])).toMatchObject({ success: false, error: 'Cross-origin preview writes are blocked.' });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
    expect(next).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serves a tracker-free local entry with local SDK aliases, a strict loopback server, and no API proxy', () => {
    const isolation = localConfig.plugins.find((plugin) => plugin?.name === 'isolated-local-questionnaire');
    const html = isolation.transformIndexHtml.handler('<script src="https://production.example/tracker.js"></script>');
    expect(html).toContain('/src/local/main.jsx');
    expect(html).not.toMatch(/https?:\/\/|clarity|hotjar|googleapis/);
    expect(localConfig.plugins.some((plugin) => plugin?.name === 'base44')).toBe(false);
    expect(localConfig.server).toMatchObject({ host: '127.0.0.1', strictPort: true });
    expect(localConfig.server.proxy).toBeUndefined();
    const aliases = new Map(localConfig.resolve.alias.map((entry) => [entry.find, entry.replacement]));
    expect(aliases.get('@/api/base44Client')).toMatch(/src\/local\/base44Client\.js$/);
    expect(aliases.get('@/lib/app-params')).toMatch(/src\/local\/app-params\.js$/);
    const csp = localConfig.server.headers['Content-Security-Policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173;");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-src 'self' blob:");
    expect(csp).not.toMatch(/https?:\/\/|base44|\*/);
    expect(localConfig.build.outDir).toBe('dist-local');
  });

  it('blocks external fetch, XHR, and beacons before they reach their original transports', async () => {
    const transport = vi.fn(async () => ({ ok: true }));
    window.fetch = transport;
    const xhrTransport = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {});
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, writable: true, value: vi.fn() });
    installLocalNetworkGuard();

    expect(() => window.fetch('https://base44.app/api/apps/live/entities')).toThrow(/blocked external request/);
    expect(() => window.fetch(new URL('https://webhook.example/submit'))).toThrow(/blocked external request/);
    expect(() => window.fetch({ url: 'https://example.com/remote' })).toThrow(/blocked external request/);
    expect(() => new XMLHttpRequest().open('POST', 'https://webhook.example/submit')).toThrow(/blocked external request/);
    expect(() => navigator.sendBeacon('https://analytics.example/event', 'sample')).toThrow(/blocked external request/);
    expect(transport).not.toHaveBeenCalled();
    expect(xhrTransport).not.toHaveBeenCalled();

    await window.fetch('/_local/api/health');
    await window.fetch(new URL('/_local/api/state', window.location.href));
    expect(transport).toHaveBeenCalledTimes(2);
    expect(navigator.sendBeacon('/_local/analytics', 'sample')).toBe(false);
  });
});

describe('local completed questionnaire revisions', () => {
  const completed = () => {
    const api = createLocalApi(fixtureRoot, { dataDirectory });
    const session = bootstrap(api);
    save(api, session, { ...organize(session.draft.responses), ...organize(session.draft.responses, '4') });
    const draft = currentDraft(api, session);
    const result = api.invoke('submitProQuestionnaireDurable', { resumeCredential: session.resumeCredential, draftId: draft.id, transformedPayload: mapped(draft.responses) });
    return { api, session, submission: clone(result.submission), source: clone(currentDraft(api, session)) };
  };
  const revisionBody = (f) => {
    const responses = { ...clone(f.source.responses), '6': 'Preserved edits for the new revision.' };
    return { action: 'start_revision', resumeCredential: f.session.resumeCredential, newRevisionRequestId: 'local_revision_request_12345', responses, mappedPayload: mapped(responses) };
  };
  it('returns hosted draft identity and holds edits to completed copies', () => {
    const f = completed();
    expect(bootstrap(f.api, f.session.resumeCredential).draft.draftId).toBe(f.source.id);
    const held = save(f.api, f.session, { '6': 'This must not replace the submitted copy.' });
    expect(held).toMatchObject({ finalized: true, ignored: true });
    expect(currentDraft(f.api, f.session)).toEqual(f.source);
  });
  it('retains the copied seed before ACK and reuses the same revision after restart', () => {
    const f = completed();
    const body = revisionBody(f);
    const first = f.api.invoke('syncProQuestionnaireDraft', body);
    expect(first).toMatchObject({ revisionStarted: true, reused: false, sourceDraftId: f.source.id, sourceSubmissionId: f.submission.id });
    expect(first.draft).toMatchObject({ status: 'draft', revision: 1, responses: body.responses });
    expect(first.draft.draftId).not.toBe(f.source.id);
    const restarted = createLocalApi(fixtureRoot, { dataDirectory });
    const retry = restarted.invoke('syncProQuestionnaireDraft', { ...body, responses: { ...body.responses, '6': 'Changed retry must not overwrite the retained seed.' } });
    expect(retry.reused).toBe(true);
    expect(retry.resumeCredential).toBe(first.resumeCredential);
    expect(retry.draft.responses).toEqual(body.responses);
    expect(restarted.state.drafts[f.source.id]).toEqual(f.source);
    expect(restarted.state.submissions).toEqual([f.submission]);
    expect(restarted.state.captures).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the source and disk state intact when copying cannot be committed', () => {
    const f = completed();
    const before = fs.readFileSync(f.api.statePath, 'utf8');
    const originalWrite = fs.writeFileSync;
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((filename, ...args) => {
      if (filename === `${f.api.statePath}.tmp`) throw new Error('Simulated revision disk failure.');
      return originalWrite(filename, ...args);
    });
    try { expect(() => f.api.invoke('syncProQuestionnaireDraft', revisionBody(f))).toThrow(/revision disk failure/); }
    finally { write.mockRestore(); }
    expect(fs.readFileSync(f.api.statePath, 'utf8')).toBe(before);
    expect(Object.keys(f.api.state.drafts)).toEqual([f.source.id]);
    expect(f.api.invoke('syncProQuestionnaireDraft', revisionBody(f)).revisionStarted).toBe(true);
  });
  it('copies authenticated answers even when a historical receipt link is absent', () => {
    const f = completed();
    f.api.state.drafts[f.source.id].finalSubmissionId = '';
    const result = f.api.invoke('syncProQuestionnaireDraft', revisionBody(f));
    expect(result).toMatchObject({ revisionStarted: true, sourceDraftId: f.source.id, sourceSubmissionId: '', sourceReceiptStatus: 'missing_link' });
    expect(result.draft.responses['6']).toBe('Preserved edits for the new revision.');
    expect(f.api.state.submissions).toEqual([f.submission]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires a completed authorized source and keeps identity fixed', () => {
    const f = completed();
    const body = revisionBody(f);
    expect(() => f.api.invoke('syncProQuestionnaireDraft', { ...body, resumeCredential: 'invalid' })).toThrow(/credential/);
    const wrong = clone(body); wrong.mappedPayload.metadata.businessDomain = 'other-client.invalid';
    expect(() => f.api.invoke('syncProQuestionnaireDraft', wrong)).toThrow(/same client/);
    expect(Object.keys(f.api.state.drafts)).toEqual([f.source.id]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
