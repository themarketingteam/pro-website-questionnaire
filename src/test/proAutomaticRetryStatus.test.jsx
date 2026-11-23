import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { base44 } from '@/api/base44Client';
import ProAutomaticRetryStatus from '@/components/admin/ProAutomaticRetryStatus';

describe('protected automatic retry status', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('loads the displayed source only and shows a scheduled retry without exposing frozen answers', async () => {
    base44.functions.invoke.mockResolvedValue({ data: { jobs: [{ id: 'job-history', status: 'retry_waiting', stage: 'delivery', next_retry_at: '2026-11-23T23:00:00Z', attempt_count: 2, last_error_json: JSON.stringify({ message: 'Zapier returned HTTP 500.' }), raw_responses_json: '{"secret":"private answer"}' }] } });
    const view = render(<ProAutomaticRetryStatus recordId="selected-historical-draft" recoveryGrant="protected-grant" />);
    expect(await screen.findByText(/retry waiting/)).toBeInTheDocument();
    expect(base44.functions.invoke).toHaveBeenCalledWith('queryProQuestionnaireRecoveryRecords', { action: 'retry_jobs', recordType: 'draft', recordId: 'selected-historical-draft', recoveryGrant: 'protected-grant' });
    expect(screen.getByText(/Zapier returned HTTP 500/)).toBeInTheDocument();
    expect(screen.queryByText(/private answer/)).not.toBeInTheDocument();
    view.rerender(<ProAutomaticRetryStatus recordId="different-selected-draft" recoveryGrant="protected-grant" />);
    await waitFor(() => expect(base44.functions.invoke).toHaveBeenLastCalledWith('queryProQuestionnaireRecoveryRecords', expect.objectContaining({ recordId: 'different-selected-draft' })));
  });
  it('explains uncertain acceptance and does not load an unrelated source when a historical link is absent', async () => {
    base44.functions.invoke.mockResolvedValue({ data: { jobs: [{ id: 'unknown', status: 'delivery_unknown', stage: 'delivery', attempt_count: 1 }] } });
    const view = render(<ProAutomaticRetryStatus recordType="intake" recordId="intake-selected" />);
    expect(await screen.findByText(/Delivery may already have been accepted/)).toBeInTheDocument();
    base44.functions.invoke.mockClear();
    view.rerender(<ProAutomaticRetryStatus recordType="intake" recordId="" />);
    expect(await screen.findByText(/no linked retry source/)).toBeInTheDocument();
    expect(base44.functions.invoke).not.toHaveBeenCalled();
  });
});
