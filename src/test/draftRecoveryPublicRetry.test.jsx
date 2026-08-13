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
  let draftRecords;
  let intakeRecords;

  beforeEach(() => {
    draftRecords = [];
    intakeRecords = [];
    base44.functions.invoke.mockImplementation(async (name, payload = {}) => {
      if (name === 'queryDraftRecoveryRecords') {
        const source = payload.recordType === 'intake' ? intakeRecords : draftRecords;
        if (payload.action === 'get') {
          return {
            data: {
              success: true,
              record: source.find((record) => record.id === payload.recordId),
            },
          };
        }
        return {
          data: {
            success: true,
            records: source,
            page: payload.page || 1,
            pageSize: payload.pageSize || 25,
            hasMore: false,
            hasAnyRecords: source.length > 0,
            duplicateSessionIds: [],
          },
        };
      }

      if (name === 'retryProQuestionnaireIntakeSubmission') {
        return { data: { success: true, linkedSubmissionId: 'retried-submission-id' } };
      }

      return { data: { success: true } };
    });
  });

  it('renders the branded recovery workspace shell', async () => {
    const { container } = renderRecoveryPage();

    expect(await screen.findByRole('heading', { name: 'Pro Form Draft Recovery' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kaseya MSP Success' })).toHaveAttribute('width', '411');
    expect(container.querySelector('main')).toHaveClass('draft-recovery-brand', 'draft-recovery-brand-page');
    expect(screen.getByText('Draft Filters')).toHaveClass('brand-heading');
  });

  it('hides fallback intake recovery when no intake records exist', async () => {
    renderRecoveryPage();

    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'queryDraftRecoveryRecords',
        expect.objectContaining({
          action: 'list',
          recordType: 'intake',
          pageSize: 25,
          recoveryGrant,
        }),
      );
    });
    expect(base44.entities.ProFormSubmissionIntake.list).not.toHaveBeenCalled();
    expect(screen.queryByText('Questionnaire Intake Recovery')).not.toBeInTheDocument();
  });

  it('uses explicit high-contrast styling for draft and submitted status badges', async () => {
    draftRecords = [
      {
        id: 'draft-status-1',
        business_name: 'Draft Status Client',
        status: 'draft',
      },
      {
        id: 'submitted-status-1',
        business_name: 'Submitted Status Client',
        status: 'submitted',
      },
    ];

    renderRecoveryPage();

    expect(await screen.findByText('Draft Status Client')).toBeInTheDocument();
    expect(screen.getByText('draft')).toHaveClass('brand-status-badge', 'brand-status-badge--neutral');
    expect(screen.getByText('submitted')).toHaveClass('brand-status-badge', 'brand-status-badge--success');
  });

  it('requests server-filtered draft pages without using direct entity list reads', async () => {
    base44.functions.invoke.mockImplementation(async (name, payload = {}) => {
      if (name !== 'queryDraftRecoveryRecords') return { data: { success: true } };
      if (payload.recordType === 'intake') {
        return { data: { success: true, records: [], hasMore: false, hasAnyRecords: false } };
      }

      const record = payload.page === 2
        ? { id: 'page-2', business_name: 'Second Page Client', status: 'submitted' }
        : { id: 'page-1', business_name: 'First Page Client', status: 'draft' };
      return {
        data: {
          success: true,
          records: [record],
          page: payload.page,
          pageSize: payload.pageSize,
          hasMore: payload.page === 1,
          hasAnyRecords: true,
          duplicateSessionIds: [],
        },
      };
    });

    renderRecoveryPage();

    expect(await screen.findByText('First Page Client')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Second Page Client')).toBeInTheDocument();
    expect(base44.functions.invoke).toHaveBeenCalledWith(
      'queryDraftRecoveryRecords',
      expect.objectContaining({
        action: 'list',
        recordType: 'draft',
        page: 2,
        pageSize: 25,
        status: 'all',
        archiveState: 'active',
        recoveryGrant,
      }),
    );

    fireEvent.change(
      screen.getByPlaceholderText('Search by business name, domain, user email, or session ID'),
      { target: { value: 'client.example' } },
    );
    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith(
        'queryDraftRecoveryRecords',
        expect.objectContaining({
          action: 'list',
          recordType: 'draft',
          page: 1,
          search: 'client.example',
        }),
      );
    });
    expect(base44.entities.ProFormDraft.list).not.toHaveBeenCalled();
  });

  it('passes the verified recovery grant to Retry and AI Repair + Retry', async () => {
    draftRecords = [{
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
    }];

    renderRecoveryPage();
    fireEvent.click(await screen.findByText('Public Recovery Client'));
    expect(await screen.findByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'AI Actions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data Copy Options (JSON)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diagnose' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repair Only' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repair + Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Endpoint Payload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raw Draft' })).toBeInTheDocument();
    expect(screen.getByText('Manually edited — mapped_payload_json')).toHaveClass('brand-payload-badge');
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

    fireEvent.click(screen.getByRole('button', { name: 'Repair + Retry' }));

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
    intakeRecords = [{
      id: 'intake-public-1',
      questionnaire_session_id: 'session-public-2',
      business_name: 'Public Intake Client',
      business_domain: 'intake.example',
      status: 'received_intake',
    }];

    renderRecoveryPage();
    fireEvent.click(await screen.findByText('Public Intake Client'));
    expect(screen.getByText('Questionnaire Intake Recovery')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /download pdf/i })).toBeInTheDocument();
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
