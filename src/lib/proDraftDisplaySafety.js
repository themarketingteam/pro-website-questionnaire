import {
  formatRecoveryCode,
  normalizeRecoveryCodeInput,
} from './proDraftRecoveryCodeContract.js';

const SAFE_HINT = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/u;
const SAFE_STORAGE_MODES = new Set([
  'indexeddb',
  'localstorage',
  'memory_only',
  'unavailable',
  'unknown',
]);

export const maskRecoveryEmail = (value) => {
  if (typeof value !== 'string' || value.length > 320) return null;
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf('@');
  if (separator < 1 || separator !== trimmed.indexOf('@')) return null;
  const local = trimmed.slice(0, separator);
  const domain = trimmed.slice(separator + 1).toLowerCase();
  if (!domain || domain.length > 253 || !domain.includes('.')
    || !/^[a-z0-9.-]+$/u.test(domain)) return null;
  const safeLocal = local.length <= 2 ? '***' : `${local.slice(0, 1)}***`;
  return `${safeLocal}@${domain}`;
};

export const formatSafeDraftStatus = (status, { readOnly = false } = {}) => {
  if (readOnly === true || status === 'submitted') return 'Submitted — read-only';
  const labels = {
    active: 'Active — editable',
    submit_attempted: 'Submission pending — editable',
    submit_failed: 'Submission needs attention — editable',
  };
  return labels[status] || 'Draft status unavailable';
};

export const formatSafeSavedTime = (value, options = {}) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  try {
    return new Intl.DateTimeFormat(options.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(new Date(value));
  } catch {
    return null;
  }
};

/** @param {{ fullCode?: string | null, hint?: string | null }} [value] */
export const getRecoveryCodeDisplayState = ({ fullCode, hint } = {}) => {
  if (typeof fullCode === 'string' && fullCode) {
    const normalized = normalizeRecoveryCodeInput(fullCode);
    if (normalized.valid) {
      const formattedCode = formatRecoveryCode(normalized.normalizedCode);
      return Object.freeze({
        mode: 'full',
        fullCode: formattedCode,
        hint: formattedCode.replaceAll('-', '').slice(-4),
        canCopy: true,
      });
    }
  }
  const safeHint = typeof hint === 'string' && SAFE_HINT.test(hint) ? hint : null;
  return Object.freeze({
    mode: safeHint ? 'hint' : 'unavailable',
    fullCode: null,
    hint: safeHint,
    canCopy: false,
  });
};

export const getSafeRecoveryPanelDiagnostics = (value = {}) => {
  const codeState = value.codeDisplayState || getRecoveryCodeDisplayState();
  return Object.freeze({
    hasMaskedRecoveryEmail: Boolean(maskRecoveryEmail(value.recoveryEmail)),
    hasFullRecoveryCode: codeState.mode === 'full',
    hasRecoveryCodeHint: Boolean(codeState.hint),
    recoveryCodeDisplayMode: ['full', 'hint', 'unavailable'].includes(codeState.mode)
      ? codeState.mode
      : 'unavailable',
    draftStatus: formatSafeDraftStatus(value.draftStatus, {
      readOnly: value.readOnly === true,
    }),
    storageMode: SAFE_STORAGE_MODES.has(value.storageMode)
      ? value.storageMode
      : 'unknown',
    hasLastLocalSaveTime: Boolean(formatSafeSavedTime(value.lastLocalSavedAt)),
    hasLastServerSaveTime: Boolean(formatSafeSavedTime(value.lastServerSavedAt)),
  });
};
