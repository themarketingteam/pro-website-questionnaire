const hasClarity = () =>
  typeof window !== 'undefined' && typeof window.clarity === 'function';

const safeValue = (value) => {
  if (value == null) return '';

  if (Array.isArray(value)) {
    return value.map((item) => String(item).slice(0, 255)).slice(0, 20);
  }

  return String(value).slice(0, 255);
};

export const setClarityTags = (tags = {}) => {
  if (!hasClarity()) return;

  Object.entries(tags).forEach(([key, value]) => {
    const safe = safeValue(value);

    if (safe === '' || key.length > 255) return;

    window.clarity('set', key.slice(0, 255), safe);
  });
};

export const identifyClarityUser = ({
  userId,
  sessionId,
  pageId,
  friendlyName
} = {}) => {
  if (!hasClarity() || !userId) return;

  window.clarity(
    'identify',
    String(userId).slice(0, 255),
    sessionId ? String(sessionId).slice(0, 255) : undefined,
    pageId ? String(pageId).slice(0, 255) : undefined,
    friendlyName ? String(friendlyName).slice(0, 255) : undefined
  );
};

export const trackClarityEvent = (eventName, tags = {}) => {
  if (!hasClarity()) return;

  setClarityTags(tags);
  window.clarity('event', String(eventName).slice(0, 255));
};