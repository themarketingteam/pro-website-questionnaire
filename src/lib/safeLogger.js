/** Browser-safe structured logger. Never pass request bodies or arbitrary errors. */

export const SAFE_LOG_REDACTION = '[REDACTED]';
export const SAFE_LOG_METADATA_KEYS = Object.freeze(['eventType', 'severity', 'requestId', 'environment', 'operation', 'status', 'errorCode', 'latencyMs', 'retryCount', 'version']);
const SENSITIVE_KEY = /(answer|canonical|body|email|password|secret|credential|recoveryCode|captchaToken|adminGrant|(^|_)(token|code|grant|cookie|authorization)($|_)|zapier|bundle|aws)/iu;
const SENSITIVE_VALUE = /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:bearer\s+)?[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{10,})+\b|[?&](?:token|code|key|secret|password|signature)=[^&#\s]+)/iu;

export function redactSafeLogValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key) || depth > 5) return SAFE_LOG_REDACTION;
  if (typeof value === 'string') return SENSITIVE_VALUE.test(value) ? SAFE_LOG_REDACTION : value.slice(0, 256);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactSafeLogValue(item, '', depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSafeLogValue(item, name, depth + 1)]));
  return undefined;
}

export function buildSafeLogMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(input).filter(([key]) => SAFE_LOG_METADATA_KEYS.includes(key)).map(([key, value]) => [key, redactSafeLogValue(value, key)])));
}

export function createSafeLogger(sink = console) {
  const write = (level, event, metadata) => sink[level](JSON.stringify({event: redactSafeLogValue(event), ...buildSafeLogMetadata(metadata)}));
  return Object.freeze({debug: (event, metadata) => write('debug', event, metadata), info: (event, metadata) => write('info', event, metadata), warning: (event, metadata) => write('warn', event, metadata), error: (event, metadata) => write('error', event, metadata)});
}

export const safeLogger = createSafeLogger();
