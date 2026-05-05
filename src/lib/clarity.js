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

    if (!key || safe === '' || key.length > 255) return;

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

  if (import.meta.env.DEV) {
    console.debug('[Clarity Event]', eventName, tags);
  }

  window.clarity('event', String(eventName).slice(0, 255));
};

export const getSafeAnswerMetadata = (answer, otherValue) => {
  const metadata = {
    has_answer: 'false',
    answer_type: typeof answer,
    answer_length: 0,
    selected_option_count: 0,
    has_other_text: 'false'
  };

  if (typeof answer === 'string') {
    metadata.has_answer = answer.trim() ? 'true' : 'false';
    metadata.answer_length = answer.length;
  } else if (Array.isArray(answer)) {
    metadata.has_answer = answer.length > 0 ? 'true' : 'false';
    metadata.answer_type = 'array';
    metadata.selected_option_count = answer.length;
  } else if (answer && typeof answer === 'object') {
    metadata.has_answer = 'true';
    metadata.answer_type = 'object';
  } else if (answer != null) {
    metadata.has_answer = 'true';
  }

  if (typeof otherValue === 'string' && otherValue.trim()) {
    metadata.has_other_text = 'true';
  }

  return metadata;
};