import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppInitializationError from '@/components/common/AppInitializationError';

describe('application initialization recovery UI', () => {
  it('offers safe retry actions without destructive or sensitive wording', () => {
    const onRetry = vi.fn();
    render(<AppInitializationError onRetry={onRetry} />);

    expect(screen.getByRole('heading', {
      name: 'We could not initialize the questionnaire',
    })).toBeInTheDocument();
    expect(screen.getByText(/has not been intentionally deleted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/corrupt|clear storage|access_token|synthetic-secret/i);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
