const safeJsonStringify = (value) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
};

export const getValueSummary = (value) => {
  if (typeof value === 'string') {
    return value.trim()
      ? `Text answer, ${value.length} characters`
      : 'Empty text answer';
  }

  if (Array.isArray(value)) {
    return `Array answer, ${value.length} selected/value item(s)`;
  }

  if (value && typeof value === 'object') {
    return 'Object answer';
  }

  if (value == null) {
    return 'Empty value';
  }

  return `${typeof value} value`;
};

export const getValueLength = (value) => {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
  return 0;
};

export const getSelectedOptionCount = (value) => {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string' && value.trim()) return 1;
  if (value && typeof value === 'object') return 1;
  return 0;
};

// Pure compatibility fixture only. Production event persistence is owned by
// proFormDraftSyncManager -> proDraftApiClient.appendProFormDraftEvents.
export const buildLegacyDraftEventFixture = ({
  sessionId,
  eventType,
  questionId,
  questionType,
  value,
  businessName,
  domain,
  userId
}) => ({
  session_id: sessionId,
  event_type: eventType,
  question_id: questionId || '',
  question_type: questionType || '',
  value_json: safeJsonStringify(value),
  value_summary: getValueSummary(value),
  value_length: getValueLength(value),
  selected_option_count: getSelectedOptionCount(value),
  business_name: businessName || '',
  domain: domain || '',
  user_id: userId || '',
  created_at_iso: new Date().toISOString()
});
