import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { AdminAccessContext } from '@/components/admin/DraftRecoveryPasswordGate';
import AdminSubmitIntake from '@/pages/AdminSubmitIntake';

const renderPage = (adminGrant = 'verified-admin-grant') => render(
  <MemoryRouter initialEntries={['/admin/submit-intake']}>
    <AdminAccessContext.Provider value={{ adminGrant, recoveryGrant: adminGrant }}>
      <AdminSubmitIntake />
    </AdminAccessContext.Provider>
  </MemoryRouter>
);

describe('AdminSubmitIntake', () => {
  it('renders as a branded password-grant admin page without requiring Base44 sign-in', () => {
    const { container } = renderPage();

    expect(screen.getByRole('heading', { name: 'Pro | Admin Intake Submission' })).toBeInTheDocument();
    expect(screen.getByText('Pro', { selector: '.draft-recovery-brand__product-label' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kaseya MSP Success' })).toHaveAttribute('width', '411');
    expect(container.querySelector('main')).toHaveClass('draft-recovery-brand', 'draft-recovery-brand-page');
    expect(screen.getByRole('navigation', { name: 'Admin workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open admin navigation' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Draft Recovery' })).toHaveAttribute('href', '/admin/draft-recovery');
    expect(screen.getByRole('link', { name: 'Express Form Recovery' })).toHaveAttribute(
      'href',
      'https://expressform.tmtwebsiteresources.xyz/admin/draft-recovery',
    );
    expect(base44.auth.me).not.toHaveBeenCalled();
  });

  it('provides a readable edit workflow and prevents submission while editing', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Edit JSON' }));
    expect(screen.getByLabelText('Submission payload JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Submission payload JSON')).not.toBeInTheDocument();
  });

  it('refuses to submit if the component is mounted without a verified admin grant', async () => {
    renderPage('');

    fireEvent.click(screen.getByRole('button', { name: 'Submit Now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Admin access is required');
    expect(base44.entities.ProFormSubmission.create).not.toHaveBeenCalled();
  });
});
