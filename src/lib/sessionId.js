const SESSION_STORAGE_KEY = 'pro_questionnaire_session_id';
const RESUME_STORAGE_KEY = 'pro_questionnaire_resume_credential_v1';
const FRAGMENT_KEY = 'draft';

const createRandomId = (prefix = '') => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
};

const readStorage = (key) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Browser storage is only an optimization. The capability also remains in the URL fragment.
  }
};

const isResumeCredential = (value) => (
  typeof value === 'string'
  && /^[A-Za-z0-9_-]{20,120}\.[A-Za-z0-9_-]{32,160}$/.test(value)
);

const readFragmentCredential = () => {
  try {
    const raw = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(raw);
    const value = params.get(FRAGMENT_KEY) || '';
    return isResumeCredential(value) ? value : '';
  } catch {
    return '';
  }
};

export const getFragmentResumeCredential = () => readFragmentCredential();

export const getStoredResumeCredential = () => {
  const fragmentValue = readFragmentCredential();
  if (fragmentValue) return fragmentValue;
  const storedValue = readStorage(RESUME_STORAGE_KEY);
  return isResumeCredential(storedValue) ? storedValue : '';
};

export const persistResumeCredential = (credential) => {
  if (!isResumeCredential(credential)) return '';
  writeStorage(RESUME_STORAGE_KEY, credential);
  const sessionId = credential.split('.')[0];
  writeStorage(SESSION_STORAGE_KEY, sessionId);

  try {
    const raw = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(raw);
    params.set(FRAGMENT_KEY, credential);
    const nextHash = params.toString();
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  } catch {
    // The local copy still allows normal same-browser recovery.
  }

  return credential;
};

export const getOrCreateQuestionnaireSessionId = () => {
  const credential = getStoredResumeCredential();
  if (credential) return credential.split('.')[0];
  const existing = readStorage(SESSION_STORAGE_KEY);
  if (/^[A-Za-z0-9_-]{20,120}$/.test(existing)) return existing;
  const next = createRandomId('pro_');
  writeStorage(SESSION_STORAGE_KEY, next);
  return next;
};

export const getOrCreateDraftClientInstanceId = () => {
  // This identifies one mounted questionnaire client, not the durable draft.
  // Keeping it page-scoped prevents two tabs from sharing a sequence counter
  // and causing one tab's valid mutations to be rejected as stale.
  return createRandomId('client_');
};

export const getDraftReturnUrl = () => {
  try {
    return window.location.href;
  } catch {
    return '';
  }
};

export const clearQuestionnaireSessionId = () => {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    // no-op
  }
  try {
    const raw = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(raw);
    params.delete(FRAGMENT_KEY);
    const nextHash = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`
    );
  } catch {
    // no-op
  }
};
