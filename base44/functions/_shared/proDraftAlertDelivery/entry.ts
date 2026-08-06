import { sendTransactionalEmail } from '../proDraftEmailTransport/entry.ts';
import type { AlertDecision } from '../proDraftAlertPolicy/entry.ts';

export const PRO_DRAFT_ALERT_DELIVERY_VERSION = 1;
export const ALERT_DELIVERY_MODES = Object.freeze(['disabled', 'staging_redirect', 'production_email', 'webhook', 'sms'] as const);
export const ALERT_DELIVERY_SECRET_NAMES = Object.freeze({MODE: 'PRO_DRAFT_ALERT_MODE', EMAIL_TO: 'PRO_DRAFT_ALERT_EMAIL_TO', STAGING_REDIRECT_TO: 'STAGING_ALERT_EMAIL_REDIRECT_TO', COOLDOWN_SECONDS: 'PRO_DRAFT_ALERT_COOLDOWN_SECONDS'} as const);
export type AlertDeliveryMode = typeof ALERT_DELIVERY_MODES[number];
type Env = (name: string) => string | undefined;
type Store = {get: (key: string) => Promise<number | null> | number | null; set: (key: string, expiresAt: number) => Promise<void> | void};
const memory = new Map<string, number>();
const defaultStore: Store = {get: (key) => memory.get(key) ?? null, set: (key, value) => { memory.set(key, value); }};
const SAFE = /^[A-Za-z0-9_.:-]{1,128}$/u;

function config(env: Env) {
  const rawMode = env(ALERT_DELIVERY_SECRET_NAMES.MODE) ?? 'disabled';
  const mode: AlertDeliveryMode = ALERT_DELIVERY_MODES.includes(rawMode as AlertDeliveryMode) ? rawMode as AlertDeliveryMode : 'disabled';
  const parsed = Number(env(ALERT_DELIVERY_SECRET_NAMES.COOLDOWN_SECONDS) ?? '900');
  return Object.freeze({mode, recipient: env(mode === 'staging_redirect' ? ALERT_DELIVERY_SECRET_NAMES.STAGING_REDIRECT_TO : ALERT_DELIVERY_SECRET_NAMES.EMAIL_TO) ?? '', cooldownSeconds: Number.isSafeInteger(parsed) && parsed >= 60 && parsed <= 86400 ? parsed : 900});
}

export function buildSafeAlertMessage(input: Readonly<{decision: AlertDecision; environment: string; requestId: string; draftFingerprint?: string; dashboardUrl?: string}>) {
  if (!SAFE.test(input.environment) || !SAFE.test(input.requestId) || (input.draftFingerprint && !/^[a-f0-9]{12,16}$/u.test(input.draftFingerprint))) throw new Error('ALERT_MESSAGE_INVALID');
  const dashboardUrl = input.dashboardUrl && /^https:\/\/[^?#\s]+\/admin\/draft-operations$/u.test(input.dashboardUrl) ? input.dashboardUrl : '';
  const lines = [`Event: ${input.decision.type}`, `Severity: ${input.decision.severity}`, `Environment: ${input.environment}`, `Request ID: ${input.requestId}`];
  if (input.draftFingerprint) lines.push(`Draft fingerprint: ${input.draftFingerprint}`);
  if (dashboardUrl) lines.push(`Dashboard: ${dashboardUrl}`);
  return Object.freeze({subject: `[${input.decision.severity.toUpperCase()}] Durable draft ${input.decision.type}`, text: lines.join('\n')});
}

export async function deliverOperationalAlert(input: Readonly<{decision: AlertDecision; environment: 'local' | 'test' | 'staging' | 'production'; requestId: string; draftFingerprint?: string; dashboardUrl?: string}>, options: Readonly<{env: Env; store?: Store; now?: () => number; sendEmail?: typeof sendTransactionalEmail; recordDeliveryFailure?: (event: Readonly<Record<string, unknown>>) => Promise<void>}>): Promise<Readonly<Record<string, unknown>>> {
  const resolved = config(options.env); const now = options.now?.() ?? Date.now(); const store = options.store ?? defaultStore;
  if (resolved.mode === 'disabled') return Object.freeze({delivered: false, suppressed: true, mode: 'disabled', reasonCode: 'ALERT_DELIVERY_DISABLED'});
  if (resolved.mode === 'webhook' || resolved.mode === 'sms') return Object.freeze({delivered: false, suppressed: true, mode: resolved.mode, reasonCode: 'ALERT_DELIVERY_FUTURE_MODE'});
  if ((resolved.mode === 'staging_redirect' && input.environment !== 'staging') || (resolved.mode === 'production_email' && input.environment !== 'production')) throw new Error('ALERT_DELIVERY_ENVIRONMENT_MISMATCH');
  if (!resolved.recipient || !resolved.recipient.includes('@')) throw new Error('ALERT_DELIVERY_RECIPIENT_MISSING');
  const key = `${input.environment}:${input.decision.type}:${input.decision.severity}`; const existing = await store.get(key);
  if (existing !== null && existing > now) return Object.freeze({delivered: false, suppressed: true, mode: resolved.mode, reasonCode: 'ALERT_DELIVERY_COOLDOWN'});
  const message = buildSafeAlertMessage(input);
  try {
    const emailEnv = (name: string) => name === 'PRO_DRAFT_EMAIL_MODE' ? (resolved.mode === 'production_email' ? 'production' : 'staging_redirect') : name === 'STAGING_EMAIL_REDIRECT_TO' ? resolved.recipient : options.env(name);
    const result = await (options.sendEmail ?? sendTransactionalEmail)({intendedRecipient: resolved.recipient, recipientAuthorized: true, subject: message.subject, textBody: message.text, htmlBody: '<p>Durable draft operational alert. See the text body for safe details.</p>', requestId: input.requestId, environment: input.environment, envSource: emailEnv});
    if (!result.success || !result.delivered) throw new Error(result.errorCode ?? 'ALERT_DELIVERY_FAILED');
    await store.set(key, now + resolved.cooldownSeconds * 1000);
    return Object.freeze({delivered: true, suppressed: false, redirected: resolved.mode === 'staging_redirect', mode: resolved.mode, reasonCode: null});
  } catch {
    await options.recordDeliveryFailure?.({event_type: 'health_check', status: 'failed', error_code: 'ALERT_DELIVERY_FAILED', operation: 'alert_delivery'});
    return Object.freeze({delivered: false, suppressed: false, mode: resolved.mode, reasonCode: 'ALERT_DELIVERY_FAILED'});
  }
}

export function getSafeAlertDeliveryDiagnostics(env: Env) { const resolved = config(env); return Object.freeze({version: PRO_DRAFT_ALERT_DELIVERY_VERSION, mode: resolved.mode, recipientConfigured: resolved.recipient !== '', cooldownSeconds: resolved.cooldownSeconds, futureModesEnabled: false, containsRecipient: false}); }
