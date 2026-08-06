import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ProDraftRecoveryChoiceList from '@/components/pro-form/ProDraftRecoveryChoiceList';

const choices = [{
  draftId: 'draft-active',
  businessNameDisplay: 'Synthetic Active Business',
  createdAt: '2026-08-01T12:00:00.000Z',
  lastSavedAt: '2026-08-06T12:00:00.000Z',
  status: 'active',
  readOnly: false,
  isCurrentSelection: false,
}, {
  draftId: 'draft-submitted',
  businessNameDisplay: 'Synthetic Submitted Business',
  createdAt: '2026-07-01T12:00:00.000Z',
  lastSavedAt: '2026-07-02T12:00:00.000Z',
  status: 'submitted',
  readOnly: true,
  isCurrentSelection: true,
}];

describe('ProDraftRecoveryChoiceList', () => {
  it('renders only approved summary fields and current selection', () => {
    render(<ProDraftRecoveryChoiceList choices={choices} />);
    expect(screen.getByRole('heading', { name: 'Recover a different questionnaire' })).toBeVisible();
    expect(screen.getByText('Synthetic Active Business')).toBeVisible();
    expect(screen.getByText('Submitted — read-only')).toBeVisible();
    expect(screen.getByText('Current selection')).toBeVisible();
    expect(document.body.textContent).not.toMatch(/@|example\.com|domain|answer|recovery code/i);
  });

  it('opens an exact active choice from the accessible action', async () => {
    const onSelect = vi.fn();
    render(<ProDraftRecoveryChoiceList choices={choices} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open this questionnaire' }));
    expect(onSelect).toHaveBeenCalledWith('draft-active');
  });

  it('reports loading and generic error states accessibly', () => {
    const { rerender } = render(<ProDraftRecoveryChoiceList loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading authorized');
    rerender(<ProDraftRecoveryChoiceList error="Choices are unavailable." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Choices are unavailable.');
  });
});
