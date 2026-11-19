import React, { StrictMode, useReducer } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import formReducer from '@/components/store/formSlice';
import { useSecureQuestionnaireDraft } from '@/lib/useSecureQuestionnaireDraft';
import { getStoredResumeCredential, persistResumeCredential } from '@/lib/sessionId';
import { writeDraftFailureBackup } from '@/lib/draftPersistence';
import * as launch from '@/lib/clientIdentityLaunch';
import { hostedDraftIncidentBackend, INCIDENT_CREDENTIAL, INCIDENT_SESSION } from './utils/hostedDraftIncidentBackend';

const answers = { '6': 'Original completed client description', '4': ['Financial / Accounting / CPA'] };
const mount = (backend, { strict = false, newClientLaunch = { active: false, requestId: '' }, businessName = '', domain = '', oldState } = {}) => renderHook(() => {
  const [form, dispatch] = useReducer(formReducer, oldState, (state) => state || formReducer(undefined, { type: '@@init' }));
  const api = useSecureQuestionnaireDraft({ base44: backend, dispatch, ...form, businessNameParam: businessName, domainParam: domain,
    newClientLaunch, serviceOptionsGrouped: {}, totalQuestionCount: 25, isTestMode: true });
  return { form, api };
}, { wrapper: strict ? StrictMode : React.Fragment });

describe('bare Pro URL after a completed browser draft', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    persistResumeCredential(INCIDENT_CREDENTIAL);
    window.history.replaceState({}, '', '/');
  });

  it('confirms completion then opens one separate blank client, retaining the old answers, identity and browser outbox', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: answers, status: 'submitted' });
    const original = backend.getOriginal();
    writeDraftFailureBackup({ questionnaireSessionId: INCIDENT_SESSION, responses: { ...answers, '6': 'Unsubmitted browser edit' }, changedKeys: ['6'], error: '' });
    const backup = localStorage.getItem(`pro_questionnaire_local_backup_${INCIDENT_SESSION}`);
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    const previous = mount(backend, { strict: true });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(backend.calls.filter(call => call.action === 'bootstrap')).toHaveLength(1);
    expect(previous.result.current.api.isDraftReady).toBe(false);
    expect(previous.result.current.api.completedDraft).toBeNull();
    act(() => previous.result.current.api.retryDraftBootstrap());
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(getStoredResumeCredential()).toBe(INCIDENT_CREDENTIAL);
    expect(window.location.hash).toBe('');
    expect(backend.records.size).toBe(1);
    const options = navigate.mock.calls[0][0];
    expect(options).toMatchObject({ businessName: '', domain: '', promptForIdentity: true });
    expect(options.requestId).toMatch(/^pro_client_/);
    previous.unmount();

    window.history.replaceState({}, '', launch.buildNewClientLaunchUrl(options));
    const activeLaunch = launch.readNewClientLaunch();
    const staleRedux = { ...formReducer(undefined, { type: '@@init' }), responses: answers,
      credentials: { businessName: 'Previous browser client', domain: 'previous.example', userEmail: 'previous@example.test' } };
    const next = mount(backend, { strict: true, newClientLaunch: activeLaunch, oldState: staleRedux });
    await waitFor(() => expect(next.result.current.api.isDraftReady).toBe(true));
    expect(next.result.current.api.completedDraft).toBeNull();
    expect(next.result.current.api.questionnaireSessionId).not.toBe(INCIDENT_SESSION);
    expect(Object.values(next.result.current.form.responses).every(value => !value || Array.isArray(value) && value.length === 0)).toBe(true);
    expect(next.result.current.form.credentials.businessName || '').toBe('');
    expect(next.result.current.form.credentials.domain || '').toBe('');
    expect(next.result.current.form.credentials.userEmail || '').toBe('');
    expect(backend.calls.filter(call => call.newClient === true)).toHaveLength(1);
    expect(backend.calls.find(call => call.newClient === true).resumeCredential).toBe('');
    expect(backend.records.size).toBe(2);
    const retained = backend.getOriginal();
    for (const key of Object.keys(original)) expect(retained[key]).toEqual(original[key]);
    expect(localStorage.getItem(`pro_questionnaire_local_backup_${INCIDENT_SESSION}`)).toBe(backup);
    expect(window.location.search).not.toContain('newClient');
    next.unmount();

    const resumed = mount(backend);
    await waitFor(() => expect(resumed.result.current.api.isDraftReady).toBe(true));
    expect(backend.records.size).toBe(2);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicit completed draft link read-only and on the same record', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: answers, status: 'submitted' });
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    persistResumeCredential(INCIDENT_CREDENTIAL);
    const tab = mount(backend);
    await waitFor(() => expect(tab.result.current.api.completedDraft).not.toBeNull());
    expect(tab.result.current.api.questionnaireSessionId).toBe(INCIDENT_SESSION);
    expect(tab.result.current.form.responses['6']).toBe(answers['6']);
    expect(navigate).not.toHaveBeenCalled();
    expect(backend.records.size).toBe(1);
  });

  it('continues an unfinished cached draft from the bare URL', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: answers });
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    const tab = mount(backend);
    await waitFor(() => expect(tab.result.current.api.isDraftReady).toBe(true));
    expect(tab.result.current.api.questionnaireSessionId).toBe(INCIDENT_SESSION);
    expect(tab.result.current.form.responses['6']).toBe(answers['6']);
    expect(navigate).not.toHaveBeenCalled();
    expect(backend.records.size).toBe(1);
  });

  it('does not start a new client if an already-open unfinished draft is later completed on another device', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: answers });
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    const tab = mount(backend);
    await waitFor(() => expect(tab.result.current.api.isDraftReady).toBe(true));
    Object.assign(backend.records.get('incident-original-draft'), { status: 'submitted', final_submission_id: 'later-final-receipt' });
    act(() => tab.result.current.api.retryDraftBootstrap());
    await waitFor(() => expect(tab.result.current.api.completedDraft).not.toBeNull());
    expect(navigate).not.toHaveBeenCalled();
    expect(backend.records.size).toBe(1);
    expect(tab.result.current.form.responses['6']).toBe(answers['6']);
  });

  it('rotates a receipt-linked historical completed draft before showing an incoming identity conflict', async () => {
    window.history.replaceState({}, '', '/?businessName=New+URL+client&domainName=new-url.example&userId=new-user&userEmail=new%40example.test');
    const backend = await hostedDraftIncidentBackend({ responses: answers });
    Object.assign(backend.records.get('incident-original-draft'), { final_submission_id: 'linked-final-receipt' });
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    const tab = mount(backend, { businessName: 'New URL client', domain: 'new-url.example' });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ businessName: 'New URL client', domain: 'new-url.example', userId: 'new-user', userEmail: 'new@example.test', promptForIdentity: false }));
    const next = new URL(launch.buildNewClientLaunchUrl(navigate.mock.calls[0][0]), window.location.origin);
    expect(next.searchParams.get('userEmail')).toBe('new@example.test');
    expect(next.searchParams.get('userId')).toBe('new-user');
    expect(tab.result.current.api.identityConflict).toBeNull();
    expect(backend.records.size).toBe(1);
  });

  it('also leaves a confirmed completed legacy browser session without a stored secure credential', async () => {
    const backend = await hostedDraftIncidentBackend({ responses: answers, status: 'submitted' });
    backend.records.get('incident-original-draft').access_token_hash = '';
    localStorage.removeItem('pro_questionnaire_resume_credential_v1');
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    const tab = mount(backend);
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(tab.result.current.api.isDraftReady).toBe(false);
    expect(backend.records.size).toBe(1);
    expect(JSON.parse(backend.getOriginal().responses_json)).toEqual(answers);
    expect(backend.getOriginal().final_submission_id).toBe('incident-final-receipt');
  });

  it.each(['#draft=invalid-link', '#draft=', '?draft=invalid-link'])('never uses cached answers or creates a client for malformed explicit link %s', async (reference) => {
    const backend = await hostedDraftIncidentBackend({ responses: answers, status: 'submitted' });
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    window.history.replaceState({}, '', `/${reference}`);
    const tab = mount(backend);
    await waitFor(() => expect(tab.result.current.api.draftSaveState).toBe('error'));
    expect(tab.result.current.api.draftConnection.error).toMatch(/link is incomplete or invalid/);
    expect(backend.calls).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
    expect(localStorage.getItem('pro_questionnaire_resume_credential_v1')).toBe(INCIDENT_CREDENTIAL);
  });

  it.each([401, 403, 410])('retains the requested capability and never creates a new draft after access error %s', async (status) => {
    const backend = { functions: { invoke: vi.fn(async () => { throw Object.assign(new Error('Access denied'), { status }); }) } };
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    const tab = mount(backend);
    await waitFor(() => expect(tab.result.current.api.draftSaveState).toBe('error'));
    expect(tab.result.current.api.draftConnection.nextRetryAt).toBe('');
    expect(getStoredResumeCredential()).toBe(INCIDENT_CREDENTIAL);
    expect(backend.functions.invoke).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    act(() => tab.result.current.api.retryDraftBootstrap());
    await waitFor(() => expect(backend.functions.invoke).toHaveBeenCalledTimes(2));
    expect(backend.functions.invoke.mock.calls.every(([, value]) => value.resumeCredential === INCIDENT_CREDENTIAL && !value.newClient)).toBe(true);
  });

  it('does not rotate a draft while the server is offline', async () => {
    const backend = { functions: { invoke: vi.fn(async () => { throw new TypeError('Failed to fetch while offline'); }) } };
    const navigate = vi.spyOn(launch, 'navigateToNewClientLaunch').mockReturnValue(true);
    const tab = mount(backend);
    await waitFor(() => expect(tab.result.current.api.draftSaveState).toBe('error'));
    expect(getStoredResumeCredential()).toBe(INCIDENT_CREDENTIAL);
    expect(navigate).not.toHaveBeenCalled();
    expect(backend.functions.invoke.mock.calls.every(([, value]) => value.resumeCredential === INCIDENT_CREDENTIAL && !value.newClient)).toBe(true);
  });
});
