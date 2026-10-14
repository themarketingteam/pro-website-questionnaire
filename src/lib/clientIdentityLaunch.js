const TRUE_VALUES = new Set(['1', 'true', 'yes']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,200}$/;

const randomPart = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
};

export const createNewClientRequestId = () => `pro_client_${randomPart()}`;

export const normalizeClientDomain = (value) => String(value || '')
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/^www\./i, '')
  .split(/[/?#]/)[0]
  .replace(/\.$/, '')
  .toLowerCase();

export const readNewClientLaunch = (windowObject = typeof window !== 'undefined' ? window : null) => {
  if (!windowObject?.location) {
    return { active: false, requestId: '', generatedRequestId: false, promptForIdentity: false };
  }
  const params = new URLSearchParams(windowObject.location.search || '');
  const active = TRUE_VALUES.has(String(params.get('newClient') || '').trim().toLowerCase());
  if (!active) return { active: false, requestId: '', generatedRequestId: false, promptForIdentity: false };

  const supplied = String(
    params.get('newClientRequestId') || params.get('requestId') || ''
  ).trim();
  const requestId = REQUEST_ID_PATTERN.test(supplied) ? supplied : createNewClientRequestId();
  const generatedRequestId = requestId !== supplied;
  if (generatedRequestId) {
    params.set('newClientRequestId', requestId);
    params.delete('requestId');
    const next = `${windowObject.location.pathname}${params.toString() ? `?${params}` : ''}${windowObject.location.hash || ''}`;
    windowObject.history?.replaceState?.(windowObject.history.state, '', next);
  }
  const promptForIdentity = TRUE_VALUES.has(
    String(params.get('newClientIdentityPrompt') || '').trim().toLowerCase()
  );
  return { active: true, requestId, generatedRequestId, promptForIdentity };
};

export const removeNewClientLaunchParams = (windowObject = typeof window !== 'undefined' ? window : null) => {
  if (!windowObject?.location) return;
  const params = new URLSearchParams(windowObject.location.search || '');
  params.delete('newClient');
  params.delete('newClientRequestId');
  params.delete('requestId');
  params.delete('newClientIdentityPrompt');
  const next = `${windowObject.location.pathname}${params.toString() ? `?${params}` : ''}${windowObject.location.hash || ''}`;
  windowObject.history?.replaceState?.(windowObject.history.state, '', next);
};

export const removeIncomingIdentityParams = (windowObject = typeof window !== 'undefined' ? window : null) => {
  if (!windowObject?.location) return;
  const params = new URLSearchParams(windowObject.location.search || '');
  ['businessName', 'domainName', 'userId', 'userEmail', 'userName'].forEach((key) => params.delete(key));
  const next = `${windowObject.location.pathname}${params.toString() ? `?${params}` : ''}${windowObject.location.hash || ''}`;
  windowObject.history?.replaceState?.(windowObject.history.state, '', next);
};

export const buildNewClientLaunchUrl = ({
  windowObject = typeof window !== 'undefined' ? window : null,
  businessName = '',
  domain = '',
  promptForIdentity = false,
  requestId = createNewClientRequestId()
} = {}) => {
  const pathname = windowObject?.location?.pathname || '/';
  const params = new URLSearchParams();
  params.set('newClient', 'true');
  params.set('newClientRequestId', REQUEST_ID_PATTERN.test(requestId) ? requestId : createNewClientRequestId());
  if (promptForIdentity) params.set('newClientIdentityPrompt', 'true');
  if (String(businessName || '').trim()) params.set('businessName', String(businessName).trim());
  const normalizedDomain = normalizeClientDomain(domain);
  if (normalizedDomain) params.set('domainName', normalizedDomain);
  return `${pathname}?${params.toString()}`;
};

export const clearLocalQuestionnaireBrowserState = (
  windowObject = typeof window !== 'undefined' ? window : null
) => {
  const storage = windowObject?.localStorage;
  if (!storage) return false;
  try {
    const keysToRemove = [
      'pro_questionnaire_session_id',
      'pro_questionnaire_resume_credential_v1',
      'persist:pro-questionnaire-root'
    ];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith('pro_questionnaire_local_backup_')) keysToRemove.push(key);
    }
    [...new Set(keysToRemove)].forEach((key) => storage.removeItem(key));
    return true;
  } catch {
    // A secure new-client launch also ignores prior browser state, so blocked
    // storage must not prevent the server-first recovery workflow.
    return false;
  }
};

export const navigateToNewClientLaunch = (options = {}) => {
  const windowObject = options.windowObject || (typeof window !== 'undefined' ? window : null);
  if (!windowObject?.location) return false;
  const nextUrl = buildNewClientLaunchUrl({ ...options, windowObject });
  windowObject.location.assign(nextUrl);
  return true;
};
