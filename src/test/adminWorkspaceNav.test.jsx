import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminWorkspaceNav from '@/components/admin/AdminWorkspaceNav';

const renderNav = (path) => render(
  <main className="draft-recovery-brand">
    <MemoryRouter initialEntries={[path]}>
      <AdminWorkspaceNav />
    </MemoryRouter>
  </main>
);

describe('AdminWorkspaceNav', () => {
  it('shows the external recovery tool and contextual intake link on draft recovery', () => {
    renderNav('/admin/draft-recovery');

    const trigger = screen.getByRole('button', { name: 'Open admin navigation' });
    fireEvent.click(trigger);

    expect(screen.getByRole('button', { name: 'Close admin navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Express Form Recovery' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getByRole('link', { name: 'Submit Intake (JSON)' })).toHaveAttribute(
      'href',
      '/admin/submit-intake',
    );
  });

  it('replaces the intake link with Draft Recovery on submit intake', () => {
    renderNav('/admin/submit-intake');

    expect(screen.getByRole('link', { name: 'Draft Recovery' })).toHaveAttribute(
      'href',
      '/admin/draft-recovery',
    );
    expect(screen.queryByRole('link', { name: 'Submit Intake (JSON)' })).not.toBeInTheDocument();
  });

  it('closes from the keyboard without navigating', () => {
    renderNav('/admin/draft-recovery');

    fireEvent.click(screen.getByRole('button', { name: 'Open admin navigation' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('button', { name: 'Open admin navigation' })).toHaveAttribute('aria-expanded', 'false');
  });
});
