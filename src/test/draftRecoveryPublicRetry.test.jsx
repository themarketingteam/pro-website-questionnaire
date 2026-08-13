import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach } from 'vitest';
import { base44 } from '@/api/base44Client';
import { DraftRecoveryAccessContext } from '@/components/admin/DraftRecoveryPasswordGate';
import ProFormDraftRecovery from '@/pages/ProFormDraftRecovery';

const recoveryGrant = 'signed-public-recovery-grant';

const renderRecoveryPage = () => render(
  <DraftRecoveryAccessContext.Provider value={{ recoveryGrant }}>
    <ProFormDraftRecovery />
  </DraftRecoveryAccessContext.Provider>
);

describe('public draft recovery actions', () => {
  beforeEach(() => {
    base44.entities.ProFormDraft.list.mockResolvedValue([]);
    base44.entities.ProFormSubmissionIntake.list.mockResolvedValue([]);
  });

  it('passes the verified recovery grant to Retry and AI Repair + Retry', async () => {
    base44.entities.ProFormDraft.list.mockResolvedValue([{
      id: 'draft-public-1',
      session_id: 'session-public-1',
      business_name: 'Public Recovery Client',
      domain: 'client.example',
      status: 'submit_failed',
      mapped_payload_json: JSON.stringify({
        metadata: {
          business_name: 'Public Recovery Client',
          businessDomain: 'client.example',
        },
        userdata: { question_1: 'answer' },
      }),
      responses_json: '{}',
    }]);

    renderRecoveryPage();
    fireEvent.click(await screen.findByText('Public Recovery Client'));
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /retry submission/i }));

    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'retryProQuestionnaireIntakeSubmission',
        expect.objectContaining({
          draftId: 'draft-public-1',
          recoveryGrant,
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /ai repair \+ retry/i }));

    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'repairProQuestionnaireIntakeSubmission',
        expect.objectContaining({
          draftId: 'draft-public-1',
          mode: 'repair_and_retry',
          recoveryGrant,
        }),
      );
    });
  });

  it('passes the verified recovery grant to intake Retry and AI Repair + Retry', async () => {
    base44.entities.ProFormSubmissionIntake.list.mockResolvedValue([{
      id: 'intake-public-1',
      questionnaire_session_id: 'session-public-2',
      business_name: 'Public Intake Client',
      business_domain: 'intake.example',
      status: 'received_intake',
    }]);

    renderRecoveryPage();
    fireEvent.click(await screen.findByText('Public Intake Client'));
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry submission/i }));

    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'retryProQuestionnaireIntakeSubmission',
        expect.objectContaining({
          intakeId: 'intake-public-1',
          recoveryGrant,
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /ai repair \+ retry/i }));

    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'repairProQuestionnaireIntakeSubmission',
        expect.objectContaining({
          intakeId: 'intake-public-1',
          mode: 'repair_and_retry',
          recoveryGrant,
        }),
      );
    });
  });
});
