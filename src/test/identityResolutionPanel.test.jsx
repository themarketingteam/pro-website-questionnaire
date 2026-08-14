// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://example.test/" }

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { base44 } from '@/api/base44Client';
import IdentityResolutionPanel from '@/components/admin/IdentityResolutionPanel';

vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: vi.fn() } }
}));

const resolution = {
  resolver_version: 'pro-identity-v1',
  attempt_id: 'attempt-1',
  payload_fingerprint: 'fingerprint-1',
  status: 'needs_review',
  applied_fields: [],
  business_name: {
    current: '',
    candidate: 'Nexus Consulting LLC',
    confidence: 0.89,
    threshold: 0.9,
    state: 'needs_review',
    evidence: [{ path: 'userdata.company_description', excerpt: 'Nexus Consulting helps contractors.' }]
  },
  domain: {
    current: '',
    candidate: 'nexusmsp.us',
    confidence: 0.91,
    threshold: 0.92,
    state: 'needs_review',
    evidence: [{ url: 'https://nexusmsp.us', title: 'Nexus Consulting LLC' }]
  },
  errors: []
};

describe('IdentityResolutionPanel', () => {
  it('shows evidence and allows an administrator to apply a name candidate', async () => {
    const onReviewed = vi.fn();
    base44.functions.invoke.mockResolvedValueOnce({ data: { success: true, decision: 'applied' } });
    render(
      <IdentityResolutionPanel
        resolution={resolution}
        recoveryGrant="signed-grant"
        onReviewed={onReviewed}
      />
    );

    expect(screen.getByText('Nexus Consulting LLC')).toBeInTheDocument();
    expect(screen.getByText('89%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review source/i })).toHaveAttribute('rel', expect.stringContaining('noopener'));
    const applyButtons = screen.getAllByRole('button', { name: 'Apply' });
    expect(applyButtons[0]).toBeEnabled();
    expect(applyButtons[1]).toBeDisabled();
    fireEvent.click(applyButtons[0]);

    await waitFor(() => {
      expect(base44.functions.invoke).toHaveBeenCalledWith('reviewProQuestionnaireIdentityCandidate', {
        recoveryGrant: 'signed-grant',
        attemptId: 'attempt-1',
        field: 'business_name',
        decision: 'apply',
        expectedFingerprint: 'fingerprint-1'
      });
      expect(onReviewed).toHaveBeenCalled();
    });
  });
});
