import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '@/components/common/ErrorBoundary';

const BrokenChild = () => {
  throw new Error('synthetic-secret-token');
};

describe('render error recovery UI', () => {
  it('does not blame saved data and labels deletion as destructive', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/previously saved information has not been intentionally deleted/i))
      .toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Delete browser-saved questionnaire state & Reload',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload without clearing' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/corrupt|synthetic-secret-token/i);
  });
});
