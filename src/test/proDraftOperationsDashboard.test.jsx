import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProDraftOperationsDashboard from '@/components/admin/ProDraftOperationsDashboard';

vi.mock('@/hooks/useProDraftAdminAuthorization', () => ({useProDraftAdminAuthorization: () => ({getAdminGrantForAuthorizedRequest: vi.fn()})}));
const health = {success: true, status: 'degraded', environment: 'staging', buildSha: 'build-synthetic', components: [{component: 'draft_save', status: 'healthy', errorCode: null, details: {}}, {component: 'ses', status: 'degraded', errorCode: 'SES_CONFIG', details: {}}], metrics: {saveP95LatencyMs: 120, saveP99LatencyMs: 240, saveFailureRate: .005, recoveryFailureRate: .01, conflictRate: .002, submissionFailureRate: 0, sesFailureRate: .02, cleanupFailureCount: 0}, lastSyntheticProbe: {status: 'healthy', checkedAt: '2026-08-06T00:00:00Z'}, criticalEvents: [{eventType: 'rls_boundary_failure', status: 'failed', checkedAt: '2026-08-06T00:00:00Z', requestId: 'request-synthetic'}], criticalPagination: {offset: 0, limit: 20, hasMore: false}, featureFlags: {durableDraftV2Enabled: true}, requiredSecretsPresent: {PRO_FORM_SYNTHETIC_PROBE_SECRET: true}};

describe('Draft Operations dashboard', () => {
  it('renders accessible aggregate health, component table, metrics, flags, and paginated critical list', async () => {
    const client = {getAdminHealth: vi.fn(async () => health), runSyntheticProbe: vi.fn(async () => ({success: true}))}; render(<ProDraftOperationsDashboard client={client} />);
    expect(await screen.findByRole('heading', {name: 'Draft Operations'})).toBeInTheDocument(); expect(screen.getByRole('heading', {name: 'Overall health'})).toBeInTheDocument();
    const tables = screen.getAllByRole('table'); expect(within(tables[0]).getByText('draft_save')).toBeInTheDocument(); expect(within(tables[1]).getByText('rls_boundary_failure')).toBeInTheDocument(); expect(screen.getByRole('navigation', {name: 'Critical event pages'})).toBeInTheDocument(); expect(screen.getByText('0.50%')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/answer|synthetic-health@example|recovery code/i);
  });
  it('runs a manual probe then refreshes health without exposing credentials', async () => {
    const client = {getAdminHealth: vi.fn(async () => health), runSyntheticProbe: vi.fn(async () => ({success: true}))}; render(<ProDraftOperationsDashboard client={client} />); await screen.findByRole('heading', {name: 'Draft Operations'});
    fireEvent.click(screen.getByRole('button', {name: 'Run synthetic probe'})); await waitFor(() => expect(client.runSyntheticProbe).toHaveBeenCalledWith({includeSubmittedStep: false})); await waitFor(() => expect(client.getAdminHealth).toHaveBeenCalledTimes(2));
  });
});
