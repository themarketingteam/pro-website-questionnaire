const DEFAULT_PUBLIC_QUESTIONNAIRE_ORIGIN = 'https://proform.tmtwebsiteresources.xyz';

const isResumeCredential = (value) => (
  typeof value === 'string'
  && /^[A-Za-z0-9_-]{20,120}\.[A-Za-z0-9_-]{32,160}$/.test(value)
);

export const buildDraftShareUrl = (
  resumeCredential,
  publicOrigin = import.meta.env.VITE_PRO_QUESTIONNAIRE_PUBLIC_ORIGIN || DEFAULT_PUBLIC_QUESTIONNAIRE_ORIGIN
) => {
  if (!isResumeCredential(resumeCredential)) {
    throw new Error('The server did not return a valid draft link credential.');
  }

  let url;
  try {
    url = new URL('/', publicOrigin);
  } catch {
    throw new Error('The public questionnaire URL is not configured correctly.');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('The public questionnaire URL must use HTTPS.');
  }

  url.hash = new URLSearchParams({ draft: resumeCredential }).toString();
  return url.toString();
};

export const copyTextToClipboard = async (value) => {
  const text = String(value || '');
  if (!text) throw new Error('There is no link to copy.');

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through for browsers that expose Clipboard API but deny the call.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    if (!document.execCommand?.('copy')) throw new Error('Copy was not supported by this browser.');
  } finally {
    textarea.remove();
  }
};
