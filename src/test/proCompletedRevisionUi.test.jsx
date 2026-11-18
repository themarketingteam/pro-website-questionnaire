import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { base44 } from '@/api/base44Client';
import { persistResumeCredential } from '@/lib/sessionId';
import { writeDraftFailureBackup } from '@/lib/draftPersistence';
import { renderWithStore } from './utils/renderWithStore';
import { hostedDraftIncidentBackend, INCIDENT_CREDENTIAL, INCIDENT_SESSION } from './utils/hostedDraftIncidentBackend';

describe('completed Pro questionnaire UI', () => {
  beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/'); persistResumeCredential(INCIDENT_CREDENTIAL); });
  it('shows accessible submitted answers and preserves browser edits without offering client revisions', async () => {
    const backend = await hostedDraftIncidentBackend({ status: 'submitted', responses: { '6': 'Original submitted description' } });
    base44.functions.invoke.mockImplementation(backend.functions.invoke);
    writeDraftFailureBackup({ questionnaireSessionId: INCIDENT_SESSION, responses: { '6': 'Preserved browser description' }, changedKeys: ['6'], deletedKeys: [], baseRevision: 0 });
    renderWithStore(<ProQuestionnaire />);
    const banner = await screen.findByRole('status', { name: 'Submitted questionnaire' });
    expect(within(banner).getByText('This questionnaire has been submitted')).toBeInTheDocument();
    expect(screen.queryByText('Unable to save')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Questionnaire' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear All Answers' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Having trouble? Reset saved browser data' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Expand All' }));
    const question = screen.getByTestId('question-wrapper-6');
    expect(within(question).getByText('Original submitted description')).toBeVisible();
    expect(within(question).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a revision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset question' })).not.toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Copy questionnaire link' })).toBeEnabled();
    expect(within(banner).getByRole('button', { name: 'Download responses (PDF)' })).toBeEnabled();
    expect(backend.calls.some(call => call.action === 'start_revision' || call.action === 'save')).toBe(false);
    expect(JSON.parse(backend.getOriginal().responses_json)['6']).toBe('Original submitted description');
  });
});
