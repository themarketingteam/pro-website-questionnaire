import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalApi } from '../../scripts/local-preview-api.mjs';
import { transformResponsesToPayload } from '../../base44/shared/proQuestionnairePayload.js';
import { SERVICE_OPTIONS_GROUPED } from '../../base44/shared/proServiceCatalog.js';

const directories = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('local submission tracking compatibility', () => {
  it('retains the explicit attempt on disk and completes the current browser transport without network delivery', () => {
    const network = vi.fn(() => { throw new Error('Local preview cannot contact a remote service.'); });
    vi.stubGlobal('fetch', network);
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-local-intent-'));
    directories.push(dataDirectory);
    const api = createLocalApi(process.cwd(), { dataDirectory });
    const credentials = { businessName: 'SYNTHETIC LOCAL ONLY', domain: 'intent.example.test' };
    const session = api.invoke('syncProQuestionnaireDraft', { action: 'bootstrap', newClient: true, credentials });
    const responses = {
      '3': ['Managed IT', 'Co-Managed IT', 'On-Site Support'],
      '4': ['Financial', 'Accounting', 'CPA'],
      '5': ['Chicago, IL', 'Madison, WI'],
      '6': 'The answers captured when Submit was pressed.'
    };
    const body = { resumeCredential: session.resumeCredential, responses, submitContext: credentials };
    const intent = api.invoke('registerProSubmissionIntent', body);
    expect(intent).toMatchObject({ success: true, intentConfirmed: true, localOnly: true, draftId: session.draft.id });
    expect(api.invoke('registerProSubmissionIntent', body).job.id).toBe(intent.job.id);
    responses['6'] = 'A later change in browser memory.';
    const restarted = createLocalApi(process.cwd(), { dataDirectory });
    const frozen = restarted.state.submissionIntents[0];
    expect(frozen.responses['6']).toBe('The answers captured when Submit was pressed.');
    expect(frozen.automaticEnabled).toBe(false);
    expect(restarted.state.drafts[session.draft.id].responses).toEqual({});

    const payload = transformResponsesToPayload(frozen.responses, credentials.businessName, credentials.domain, SERVICE_OPTIONS_GROUPED);
    restarted.invoke('syncProQuestionnaireDraft', {
      action: 'save', resumeCredential: session.resumeCredential, mutationId: 'local-final-save', clientInstanceId: 'local-intent-tab', clientSequence: 1,
      baseRevision: 0, responses: frozen.responses, changedKeys: Object.keys(frozen.responses), deletedKeys: [], mappedPayload: payload, status: 'submit_attempted'
    });
    const submitted = restarted.invoke('submitProQuestionnaireDurable', { draftId: session.draft.id, resumeCredential: session.resumeCredential, transformedPayload: payload });
    expect(submitted.success).toBe(true);
    expect(restarted.invoke('sendToZapier', { payload, draftId: session.draft.id, resumeCredential: session.resumeCredential, submissionId: submitted.submission.id }).localOnly).toBe(true);
    expect(restarted.state.captures.at(-1).payload).toEqual(payload);
    expect(JSON.stringify(restarted.state.captures)).not.toContain(session.resumeCredential);
    expect(() => restarted.invoke('registerProSubmissionIntent', body)).toThrow(/read-only/);
    expect(network).not.toHaveBeenCalled();
  });

  it('rejects a forged local capability before retaining an attempt', () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-local-intent-denied-'));
    directories.push(dataDirectory);
    const api = createLocalApi(process.cwd(), { dataDirectory });
    const before = fs.readFileSync(api.statePath, 'utf8');
    expect(() => api.invoke('registerProSubmissionIntent', { resumeCredential: 'wrong', responses: {} })).toThrow(/credential/);
    expect(fs.readFileSync(api.statePath, 'utf8')).toBe(before);
  });
});
