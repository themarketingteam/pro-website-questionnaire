import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  value: null,
}));

vi.mock('@/contexts/ProDraftConflictContext', () => ({
  useProDraftConflict: () => state.value,
}));

import ProDraftConflictDialog from '@/components/pro-form/ProDraftConflictDialog';

const conflict = {
  conflictId: 'conflict_1',
  fieldPath: 'responses.12',
  localPreview: 'This browser answer',
  serverPreview: 'Other saved answer',
};

describe('Pro draft conflict dialog', () => {
  beforeEach(() => {
    state.value = {
      isOpen: true,
      conflicts: [conflict],
      applyChoices: vi.fn(async () => null),
      cancelAndKeepReviewing: vi.fn(),
    };
  });

  it('is an accessible modal with the required copy and initial focus', async () => {
    render(<ProDraftConflictDialog />);
    const dialog = screen.getByRole('dialog', {
      name: 'We found changes from another browser tab',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(/Some answers were changed in more than one place/u)).toBeVisible();
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  it('requires every conflict choice and applies the selected safe choice', async () => {
    render(<ProDraftConflictDialog />);
    const apply = screen.getByRole('button', { name: 'Apply my choices' });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /This browser/u }));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    await waitFor(() => expect(state.value.applyChoices).toHaveBeenCalledWith({
      conflict_1: 'keep_local',
    }));
  });

  it('cancels without applying or discarding either value', () => {
    render(<ProDraftConflictDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and keep reviewing' }));
    expect(state.value.cancelAndKeepReviewing).toHaveBeenCalledOnce();
    expect(state.value.applyChoices).not.toHaveBeenCalled();
  });
});
