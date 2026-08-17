import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export const PAGE_NAME_BY_PATH = Object.freeze({
  '/': 'Website Content Questionnaire',
  '/proquestionnaire': 'Website Content Questionnaire',
  '/thankyou': 'Thank You',
  '/thank-you': 'Thank You',
  '/admin/draft-recovery': 'Form Draft Recovery',
  '/admin/submit-intake': 'Admin Intake Submission',
  '/admin/questionnaire-intake-recovery': 'Questionnaire Intake Recovery',
  '/login': 'Log In',
  '/register': 'Register',
  '/forgot-password': 'Forgot Password',
  '/reset-password': 'Reset Password',
  '/oauth-consent': 'Authorize Access',
  '/test-zapier': 'Zapier Test'
});

const normalizePathname = (pathname = '/') => {
  const normalized = `/${String(pathname).split('?')[0].split('#')[0]}`
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
  return normalized || '/';
};

export const getDocumentTitle = (pathname) => {
  const pageName = PAGE_NAME_BY_PATH[normalizePathname(pathname)] || 'Page Not Found';
  return `Pro | ${pageName}`;
};

export default function DocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = getDocumentTitle(pathname);
  }, [pathname]);

  return null;
}
