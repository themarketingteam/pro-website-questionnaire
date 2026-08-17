import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import DocumentTitle, { getDocumentTitle } from '@/lib/DocumentTitle';

describe('document title convention', () => {
  it.each([
    ['/', 'Pro | Website Content Questionnaire'],
    ['/ThankYou', 'Pro | Thank You'],
    ['/admin/draft-recovery', 'Pro | Form Draft Recovery'],
    ['/admin/submit-intake', 'Pro | Admin Intake Submission'],
    ['/admin/questionnaire-intake-recovery', 'Pro | Questionnaire Intake Recovery'],
    ['/login', 'Pro | Log In'],
    ['/register', 'Pro | Register'],
    ['/forgot-password', 'Pro | Forgot Password'],
    ['/reset-password', 'Pro | Reset Password'],
    ['/oauth-consent', 'Pro | Authorize Access'],
    ['/test-zapier', 'Pro | Zapier Test'],
    ['/not-a-real-page', 'Pro | Page Not Found']
  ])('maps %s to %s', (pathname, expected) => {
    expect(getDocumentTitle(pathname)).toBe(expected);
  });

  it('updates the browser title from the active route', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/draft-recovery']}>
        <DocumentTitle />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(document.title).toBe('Pro | Form Draft Recovery');
    });
  });
});
