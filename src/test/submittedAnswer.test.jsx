import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SubmittedAnswer from '@/components/pro-form/SubmittedAnswer';
import ThankYouModal from '@/components/pro-form/ThankYouModal';
vi.mock('@/components/pro-form/pdf/useQuestionnairePdfDownload', () => ({ useQuestionnairePdfDownload: () => ({ isGeneratingPDF: false, downloadPDF: vi.fn() }) }));
describe('submitted questionnaire review', () => {
  it('renders saved navigation priority and parent-child order as copyable text without editing controls', () => {
    render(<SubmittedAnswer question={{ id: '3' }} responses={{ '3_structure': { pages: [{ id: 'p1', label: 'First parent', children: [{ id: 'c1', label: 'First child' }, { id: 'c2', label: 'Second child' }] }, { id: 'p2', label: 'Second parent', children: [] }] } }} />);
    const parents = screen.getAllByRole('listitem');
    expect(parents.map(item => item.textContent)).toEqual(['First parentFirst childSecond child', 'First child', 'Second child', 'Second parent']);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('shows saved attachments and additional answers as text and safe links', () => {
    render(<SubmittedAnswer question={{ id: '12.1' }} responses={{ '12.1': [{ name: 'certificate.pdf', url: 'https://example.test/certificate.pdf' }], '12.1_other': ['Custom saved note'] }} />);
    expect(screen.getByText('certificate.pdf')).toBeVisible();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.test/certificate.pdf');
    expect(screen.getByText('Custom saved note')).toBeVisible();
  });
  it('offers immediate review and copying the same questionnaire link after submission', () => {
    const onViewAnswers = vi.fn(), onCopyLink = vi.fn();
    render(<ThankYouModal businessName="Synthetic completed client" formData={{ '6': 'Submitted answer' }} onViewAnswers={onViewAnswers} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole('button', { name: 'View submitted answers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy questionnaire link' }));
    expect(onViewAnswers).toHaveBeenCalledOnce(); expect(onCopyLink).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Start a revision' })).not.toBeInTheDocument();
  });
});
