import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProFormDraftRecovery from '@/pages/ProFormDraftRecovery';
import QuestionnaireIntakeRecovery from '@/components/admin/QuestionnaireIntakeRecovery';
import { ProDraftAdminRecoveryShellContext } from '@/components/admin/ProDraftAdminRecoveryShell';

const shell = (api) => ({ api, editDirty: false, setEditDirty: vi.fn(), clearAdminCaches: vi.fn() });
const wrap = (element, api) => render(<ProDraftAdminRecoveryShellContext.Provider value={shell(api)}>{element}</ProDraftAdminRecoveryShellContext.Provider>);
const baseApi = (overrides = {}) => ({
  listDrafts: vi.fn(async () => ({ items: [], nextCursor: null })),
  getDraft: vi.fn(), listDraftEvents: vi.fn(), getDraftLineage: vi.fn(), updateDraft: vi.fn(),
  listIntakes: vi.fn(async () => ({ items: [], nextCursor: null })), getIntake: vi.fn(),
  retrySubmission: vi.fn(async () => ({ success: true, zapierSuppressed: true })),
  repairSubmission: vi.fn(async () => ({ success: true, zapierRedirected: true })),
  ...overrides,
});

describe('backend-only draft and intake recovery actions', () => {
  it('submits only a settled exact search and carries it through server cursor pagination', async () => {
    const api = baseApi({ listDrafts: vi.fn(async ({ cursor }) => ({ items: [], nextCursor: cursor ? null : 'draft-next' })) });
    wrap(<ProFormDraftRecovery />, api);
    await screen.findByText('No matching drafts found.');
    const input = screen.getByLabelText('Exact search value');
    fireEvent.change(input, { target: { value: 'draft-exact-1' } });
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled(), { timeout: 1000 });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.listDrafts).toHaveBeenCalledWith(expect.objectContaining({ search: { mode: 'draft_id', value: 'draft-exact-1' } })));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.listDrafts).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'draft-next', search: { mode: 'draft_id', value: 'draft-exact-1' } })));
  });

  it('lazy-loads a draft then invokes retry and repair through the API client', async () => {
    const summary = { id: 'draft-1', session_id: 'session-1', business_name: 'Draft Client', status: 'submit_failed' };
    const api = baseApi({
      listDrafts: vi.fn(async () => ({ items: [summary], nextCursor: 'next' })),
      getDraft: vi.fn(async () => ({ draft: { ...summary, server_revision: 2, mapped_payload_json: '{}' } })),
    });
    wrap(<ProFormDraftRecovery />, api);
    expect(await screen.findByText('Draft Client')).toBeInTheDocument();
    expect(api.getDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Draft Client'));
    await screen.findByText(/Server revision:/);
    expect(api.getDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'draft-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Submission' }));
    await waitFor(() => expect(api.retrySubmission).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'draft-1', forceRetry: false })));
    fireEvent.click(screen.getByRole('button', { name: 'AI Repair + Retry' }));
    await waitFor(() => expect(api.repairSubmission).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'draft-1', mode: 'repair_and_retry' })));
  });

  it('paginates and invokes intake retry/repair without direct entity access', async () => {
    const summary = { id: 'intake-1', questionnaire_session_id: 'session-2', business_name: 'Intake Client', status: 'received_intake' };
    const api = baseApi({
      listIntakes: vi.fn(async ({ cursor }) => ({ items: [summary], nextCursor: cursor ? null : 'intake-next' })),
      getIntake: vi.fn(async () => ({ intake: { ...summary, jsonDiagnostics: {} } })),
    });
    wrap(<QuestionnaireIntakeRecovery />, api);
    fireEvent.click(await screen.findByText('Intake Client'));
    await screen.findByText('Diagnostics summary');
    fireEvent.click(screen.getByRole('button', { name: 'Retry Submission' }));
    await waitFor(() => expect(api.retrySubmission).toHaveBeenCalledWith(expect.objectContaining({ intakeId: 'intake-1' })));
    fireEvent.click(screen.getByRole('button', { name: 'AI Repair + Retry' }));
    await waitFor(() => expect(api.repairSubmission).toHaveBeenCalledWith(expect.objectContaining({ intakeId: 'intake-1', mode: 'repair_and_retry' })));
    fireEvent.click(screen.getByRole('button', { name: 'Next intake page' }));
    await waitFor(() => expect(api.listIntakes).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'intake-next' })));
  });
});
