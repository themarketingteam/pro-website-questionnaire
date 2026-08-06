import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DraftEditPanel from '@/components/admin/DraftEditPanel';
import ProDraftEventHistory from '@/components/admin/ProDraftEventHistory';
import ProDraftLineagePanel from '@/components/admin/ProDraftLineagePanel';
import { ProDraftAdminRecoveryShellContext } from '@/components/admin/ProDraftAdminRecoveryShell';

const renderWithApi = (element, api) => render(
  <ProDraftAdminRecoveryShellContext.Provider value={{ api, editDirty: false, setEditDirty: vi.fn(), clearAdminCaches: vi.fn() }}>
    {element}
  </ProDraftAdminRecoveryShellContext.Provider>,
);
const draft = { id: 'draft-1', status: 'active', server_revision: 4, business_name: 'Before', domain: 'before.test', mapped_payload_json: '{"metadata":{}}' };

describe('DraftEditPanel', () => {
  it('validates JSON and a required edit reason before saving', () => {
    const api = { updateDraft: vi.fn() };
    renderWithApi(<DraftEditPanel draft={draft} onCancel={vi.fn()} />, api);
    fireEvent.change(screen.getByLabelText('Mapped Payload JSON'), { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(screen.getByText('Mapped payload must be valid JSON.')).toBeInTheDocument();
    expect(screen.getByText('An edit reason is required.')).toBeInTheDocument();
    expect(api.updateDraft).not.toHaveBeenCalled();
  });

  it('saves an allowlisted change with revision, reason, and idempotency key', async () => {
    const updated = { ...draft, business_name: 'After', server_revision: 5 };
    const api = { updateDraft: vi.fn(async () => ({ draft: updated })) };
    renderWithApi(<DraftEditPanel draft={draft} onSaved={vi.fn()} onCancel={vi.fn()} />, api);
    fireEvent.change(screen.getByLabelText('Business Name'), { target: { value: 'After' } });
    fireEvent.change(screen.getByLabelText('Edit reason'), { target: { value: 'Support correction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Saved and audit event recorded.');
    expect(api.updateDraft).toHaveBeenCalledWith(expect.objectContaining({
      draftId: 'draft-1', expectedServerRevision: 4, reason: 'Support correction',
      idempotencyKey: expect.stringMatching(/^admin-edit-/u), changes: expect.objectContaining({ business_name: 'After' }),
    }));
  });

  it('reloads latest revision on conflict while preserving entered values', async () => {
    const conflict = Object.assign(new Error('conflict'), { response: { data: { errorCode: 'ADMIN_API_CONFLICT' } } });
    const api = { updateDraft: vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ draft: { ...draft, business_name: 'Unsaved value', server_revision: 10 } }), getDraft: vi.fn(async () => ({ draft: { ...draft, server_revision: 9 } })) };
    renderWithApi(<DraftEditPanel draft={draft} onCancel={vi.fn()} />, api);
    fireEvent.change(screen.getByLabelText('Business Name'), { target: { value: 'Unsaved value' } });
    fireEvent.change(screen.getByLabelText('Edit reason'), { target: { value: 'Correction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Latest revision: 9');
    expect(screen.getByLabelText('Business Name')).toHaveValue('Unsaved value');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.updateDraft).toHaveBeenLastCalledWith(expect.objectContaining({ expectedServerRevision: 9 })));
  });

  it('locks submitted content but permits approved retention controls', () => {
    renderWithApi(<DraftEditPanel draft={{ ...draft, status: 'submitted' }} onCancel={vi.fn()} />, { updateDraft: vi.fn() });
    expect(screen.getByLabelText('Business Name')).toBeDisabled();
    expect(screen.getByLabelText('Mapped Payload JSON')).toBeDisabled();
    expect(screen.getByLabelText('Retention hold')).not.toBeDisabled();
  });
});

describe('event history and lineage', () => {
  it('loads safe event summaries and fetches stored values only after explicit opt-in', async () => {
    const api = { listDraftEvents: vi.fn(async (payload) => ({ items: [{ id: 'event-1', event_type: 'answer_changed', value_summary: 'updated', redaction_level: 'summary' }], nextCursor: null, payload })) };
    renderWithApi(<ProDraftEventHistory draftId="draft-1" sessionId="session-1" />, api);
    expect(await screen.findByText('answer_changed')).toBeInTheDocument();
    expect(api.listDraftEvents).toHaveBeenLastCalledWith(expect.objectContaining({ includeValueJson: false }));
    fireEvent.click(screen.getByLabelText('Show stored event value'));
    await waitFor(() => expect(api.listDraftEvents).toHaveBeenLastCalledWith(expect.objectContaining({ includeValueJson: true })));
    expect(screen.getByText(/client-entered questionnaire content/)).toBeInTheDocument();
  });

  it('shows lineage links, supersession reason, duplicates, and submitted/active partition warning', async () => {
    const onNavigate = vi.fn();
    const api = { getDraftLineage: vi.fn(async () => ({
      current: { id: 'draft-1', status: 'submitted', generation: 2, superseded_reason: 'start_new' },
      previous: { id: 'draft-0', status: 'active', business_name: 'Previous' }, replacement: null,
      related: [{ id: 'draft-0', status: 'active' }], transactionStatus: 'committed',
      diagnostic: { recommendation: 'review_records_individually_no_automatic_merge' },
    })) };
    renderWithApi(<ProDraftLineagePanel draftId="draft-1" onNavigate={onNavigate} />, api);
    expect(await screen.findByText(/Supersession reason: start_new/)).toBeInTheDocument();
    expect(screen.getByText(/must not be merged/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /draft-0|Open exact draft/ })[0]);
    expect(onNavigate).toHaveBeenCalledWith('draft-0');
  });
});
