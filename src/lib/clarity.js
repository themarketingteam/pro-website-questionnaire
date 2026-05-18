const MAX_CLARITY_KEY_LENGTH = 100;
const MAX_CLARITY_VALUE_LENGTH = 255;
const MAX_CLARITY_EVENT_LENGTH = 255;
const MAX_JSON_LENGTH = 255;

export const safeClarityCall = (label, callback) => {
  try {
    return callback();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[Clarity] Non-fatal Clarity failure:', label, error);
    }
    return undefined;
  }
};

const trimToLength = (value, maxLength) => String(value ?? '').trim().slice(0, maxLength);

const sanitizeClarityKey = (key) => {
  if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'boolean') {
    return '';
  }

  return trimToLength(key, MAX_CLARITY_KEY_LENGTH);
};

export const sanitizeClarityValue = (value) => {
  if (value == null) return '';

  if (value instanceof Date) {
    return safeClarityCall('sanitize-date', () => trimToLength(value.toISOString(), MAX_CLARITY_VALUE_LENGTH)) || '';
  }

  if (typeof value === 'string') {
    return trimToLength(value, MAX_CLARITY_VALUE_LENGTH);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return trimToLength(String(value), MAX_CLARITY_VALUE_LENGTH);
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return '';
  }

  if (Array.isArray(value) || typeof value === 'object') {
    const serialized = safeClarityCall('sanitize-object', () => JSON.stringify(value));

    if (!serialized) return '[object]';
    if (serialized.length > MAX_JSON_LENGTH) return '[object]';

    return trimToLength(serialized, MAX_CLARITY_VALUE_LENGTH);
  }

  return trimToLength(String(value), MAX_CLARITY_VALUE_LENGTH);
};

export const hasClarity = () => {
  try {
    return typeof window !== 'undefined' && typeof window.clarity === 'function';
  } catch {
    return false;
  }
};

export const setClarityTags = (tags = {}) => {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return;
  if (!hasClarity()) return;

  Object.entries(tags).forEach(([rawKey, rawValue]) => {
    const key = sanitizeClarityKey(rawKey);
    const value = sanitizeClarityValue(rawValue);

    if (!key || !value) return;

    safeClarityCall(`set:${key}`, () => {
      window.clarity('set', key, value);
    });
  });
};

export const identifyClarityUser = ({
  userId,
  sessionId,
  pageId,
  friendlyName
} = {}) => {
  if (!hasClarity()) return;

  const safeUserId = sanitizeClarityValue(userId);
  if (!safeUserId) return;

  const safeSessionId = sanitizeClarityValue(sessionId) || undefined;
  const safePageId = sanitizeClarityValue(pageId) || undefined;
  const safeFriendlyName = sanitizeClarityValue(friendlyName) || undefined;

  safeClarityCall('identify', () => {
    window.clarity('identify', safeUserId, safeSessionId, safePageId, safeFriendlyName);
  });
};

export const trackClarityEvent = (eventName, tags = {}) => {
  const safeEventName = sanitizeClarityValue(eventName).slice(0, MAX_CLARITY_EVENT_LENGTH);
  if (!safeEventName) return;

  safeClarityCall(`event-tags:${safeEventName}`, () => {
    setClarityTags(tags);
  });

  if (!hasClarity()) return;

  safeClarityCall(`event:${safeEventName}`, () => {
    window.clarity('event', safeEventName);
  });
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