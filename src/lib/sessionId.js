const SESSION_STORAGE_KEY = 'pro_questionnaire_session_id';

const createSessionId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `pro_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

export const getOrCreateQuestionnaireSessionId = () => {
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);

    if (existing) return existing;

    const next = createSessionId();
    localStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return createSessionId();
  }
};

export const clearQuestionnaireSessionId = () => {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // no-op
  }
};