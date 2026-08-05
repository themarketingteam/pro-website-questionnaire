const REDACTED = '[REDACTED]';
const SENSITIVE_QUERY_KEYS = new Set([
  'accesstoken',
  'recoverycode',
  'draftaccesstoken',
  'useremail',
]);

const normalizeKey = (value) => String(value || '').replace(/[-_]/g, '').toLowerCase();

export const isSensitiveQueryKey = (key) => (
  SENSITIVE_QUERY_KEYS.has(normalizeKey(key))
);

export const redactUrl = (value) => {
  try {
    const url = new URL(String(value));

    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) url.searchParams.set(key, REDACTED);
    }

    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return '<invalid-url>';
  }
};

export const redactText = (value, maxLength = 500) => {
  const text = String(value ?? '');
  const redacted = text
    .replace(
      /([?&](?:access_token|recoveryCode|draftAccessToken|userEmail)=)[^&#\s]*/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /(\b(?:access_token|recoveryCode|draftAccessToken|userEmail)\b\s*[:=]\s*)[^,;\s}]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /\b(?:authorization|cookie|set-cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,;}\n]+)/gi,
      `${REDACTED}`,
    );

  return redacted.length > maxLength
    ? `${redacted.slice(0, maxLength)}…`
    : redacted;
};

export const safeUrlSummary = (value) => {
  try {
    const url = new URL(redactUrl(value));
    return `${url.origin}${url.pathname}`;
  } catch {
    return '<invalid-url>';
  }
};
