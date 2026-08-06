const SPREADSHEET_FORMULA_PREFIX = /^(?:[\t\r]|\s*[=+\-@])/u;
const LOG_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/gu;
const LOG_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export const sanitizeSpreadsheetCell = (value) => {
  const text = String(value ?? '').replaceAll('\u0000', '');
  return SPREADSHEET_FORMULA_PREFIX.test(text) ? `'${text}` : text;
};

export const sanitizeLogText = (value, { maxLength = 500 } = {}) => String(value ?? '')
  .replace(LOG_CONTROL_CHARACTERS, ' ')
  .slice(0, maxLength);

export const assertSafeRelativeRedirect = (value) => {
  const candidate = String(value ?? '');
  let decoded;

  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    throw new Error('SECURITY_REDIRECT_INVALID_ENCODING');
  }

  if (
    !decoded.startsWith('/')
    || decoded.startsWith('//')
    || decoded.includes('\\')
    || decoded.split(/[?#]/u, 1)[0].split('/').includes('..')
    || LOG_CONTROL_CHARACTER.test(decoded)
  ) {
    throw new Error('SECURITY_REDIRECT_TARGET_DENIED');
  }

  return decoded;
};
