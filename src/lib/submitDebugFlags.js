const ALLOWED_DEBUG_MODES = new Set([
  'primary_create',
  'fallback_create',
  'transform',
  'validation',
  'network_timeout'
]);

export const getSubmitDebugFailureMode = () => {
  if (!import.meta.env.DEV) return null;

  try {
    if (typeof window === 'undefined' || !window.location?.search || typeof URLSearchParams === 'undefined') {
      return null;
    }

    const params = new URLSearchParams(window.location.search);
    const mode = params.get('debugSubmitFailure');
    return ALLOWED_DEBUG_MODES.has(mode) ? mode : null;
  } catch {
    return null;
  }
};

export const shouldSimulateSubmitFailure = (mode) => getSubmitDebugFailureMode() === mode;