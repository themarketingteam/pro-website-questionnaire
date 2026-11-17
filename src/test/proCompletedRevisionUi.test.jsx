import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { base44 } from '@/api/base44Client';
import { persistResumeCredential } from '@/lib/sessionId';
import * as persistence from '@/lib/draftPersistence';
import { writeDraftFailureBackup } from '@/lib/draftPersistence';
import { renderWithStore } from './utils/renderWithStore';
import { hostedDraftIncidentBackend, INCIDENT_CREDENTIAL, INCIDENT_SESSION } from './utils/hostedDraftIncidentBackend';

describe('completed Pro questionnaire UI', () => {
  beforeEach(() => { vi.spyOn(persistence, 'reloadForDraftRevision').mockImplementation(() => {}); localStorage.clear(); window.history.replaceState({}, '', '/'); persistResumeCredential(INCIDENT_CREDENTIAL); });
  it('shows submitted state instead of generic save failure and requires an explicit opted-in working revision', async () => {
    const backend = await hostedDraftIncidentBackend({ status: 'submitted', responses: { '6': 'Original submitted description' } });
    base44.functions.invoke.mockImplementation(backend.functions.invoke);
    writeDraftFailureBackup({ questionnaireSessionId: INCIDENT_SESSION, responses: { '6': 'Preserved browser description' }, changedKeys: ['6'], deletedKeys: [], baseRevision: 0 });
    const mounted = renderWithStore(<ProQuestionnaire />);
    const banner = await screen.findByRole('status', { name: 'Submitted questionnaire' });
    expect(within(banner).getByText('This questionnaire has been submitted')).toBeInTheDocument();
    expect(screen.queryByText('Unable to save')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Questionnaire' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear All Answers' })).toBeDisabled();
    const expand = screen.getByRole('button', { name: 'Expand All' });
    expect(expand).not.toBeDisabled(); fireEvent.click(expand);
    const answer = within(screen.getByTestId('question-wrapper-6')).getByRole('textbox');
    expect(answer).toHaveValue('Original submitted description'); expect(answer).toBeDisabled();
    const include = within(banner).getByRole('checkbox', { name: 'Include my preserved browser edits in the new revision' });
    expect(include).not.toBeChecked();
    expect(backend.calls.some(call => call.action === 'start_revision')).toBe(false);
    fireEvent.click(include);
    fireEvent.click(within(banner).getByRole('button', { name: 'Start a revision' }));
    await waitFor(() => expect(persistence.reloadForDraftRevision).toHaveBeenCalledTimes(1));
    mounted.unmount(); renderWithStore(<ProQuestionnaire />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear All Answers' })).not.toBeDisabled());
    expect(backend.calls.find(call => call.action === 'start_revision').responses['6']).toBe('Preserved browser description');
    expect(screen.getByRole('button', { name: 'Clear All Answers' })).not.toBeDisabled();
    expect(JSON.parse(backend.getOriginal().responses_json)['6']).toBe('Original submitted description');
  });
});
