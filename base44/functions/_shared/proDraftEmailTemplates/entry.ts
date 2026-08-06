/** Safe, dependency-free transactional email templates for draft recovery. */

import {
  formatRecoveryCode,
  normalizeRecoveryCodeInput,
} from '../proDraftIdentity/entry.ts';

export const EMAIL_TEMPLATE_VERSION = 1;

export const EMAIL_TEMPLATE_PURPOSES = Object.freeze([
  'clear_all_replacement',
  'start_new_after_submission',
  'staging_self_check',
  'future_otp',
  'future_magic_link',
] as const);

export type EmailTemplatePurpose = typeof EMAIL_TEMPLATE_PURPOSES[number];
export type EmailTemplateEnvironment = 'staging' | 'production';

export type RenderedEmail = Readonly<{
  version: number;
  purpose: EmailTemplatePurpose;
  subject: string;
  textBody: string;
  htmlBody: string;
}>;

const PRODUCTION_RECOVERY_SUBJECT =
  'Your MSP Success Websites questionnaire recovery code';
const STAGING_PREFIX = '[STAGING] ';
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 200_000;
const MAX_BUSINESS_NAME_LENGTH = 120;
const MAX_DISPLAY_VALUE_LENGTH = 160;
const HEADER_CONTROL_PATTERN = /[\r\n]/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/gu;

export class EmailTemplateContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('Email template input was rejected by the safe rendering contract.');
    this.name = 'EmailTemplateContractError';
    this.code = code;
  }
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeDisplayValue(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value
    .replace(CONTROL_CHARACTER_PATTERN, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return [...normalized].slice(0, maximum).join('');
}

function subjectFor(environment: EmailTemplateEnvironment, base: string): string {
  if (environment !== 'staging' && environment !== 'production') {
    throw new EmailTemplateContractError('EMAIL_TEMPLATE_ENVIRONMENT_INVALID');
  }
  const subject = environment === 'staging' ? `${STAGING_PREFIX}${base}` : base;
  if (subject.length > MAX_SUBJECT_LENGTH || HEADER_CONTROL_PATTERN.test(subject)) {
    throw new EmailTemplateContractError('EMAIL_TEMPLATE_SUBJECT_INVALID');
  }
  return subject;
}

function validateHttpsLink(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new EmailTemplateContractError('EMAIL_TEMPLATE_LINK_INVALID');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('invalid');
    }
    return url.toString();
  } catch {
    throw new EmailTemplateContractError('EMAIL_TEMPLATE_LINK_INVALID');
  }
}

function validateRecoverySiteLink(value: unknown, code: string): string {
  const link = validateHttpsLink(value);
  const url = new URL(link);
  if (url.search || link.includes(code) || link.includes(code.replaceAll('-', ''))) {
    throw new EmailTemplateContractError('EMAIL_TEMPLATE_RECOVERY_LINK_UNSAFE');
  }
  return link;
}

function finalize(rendered: RenderedEmail): RenderedEmail {
  const validation = validateRenderedEmail(rendered);
  if (!validation.valid) {
    throw new EmailTemplateContractError(validation.errorCode);
  }
  return Object.freeze(rendered);
}

export function renderRecoveryCodeEmail(input: Readonly<{
  recoveryCode: unknown;
  businessDisplayName?: unknown;
  recoveryBaseUrl: unknown;
  environment: EmailTemplateEnvironment;
  purpose: 'clear_all_replacement' | 'start_new_after_submission' | 'staging_self_check';
}>): RenderedEmail {
  if (!['clear_all_replacement', 'start_new_after_submission', 'staging_self_check']
    .includes(input.purpose)) {
    throw new EmailTemplateContractError('EMAIL_TEMPLATE_PURPOSE_INVALID');
  }
  const normalizedCode = normalizeRecoveryCodeInput(input.recoveryCode);
  if (!normalizedCode.valid) {
    throw new EmailTemplateContractError('EMAIL_TEMPLATE_RECOVERY_CODE_INVALID');
  }
  const formattedCode = formatRecoveryCode(normalizedCode.normalizedCode);
  const recoveryLink = validateRecoverySiteLink(input.recoveryBaseUrl, formattedCode);
  const businessName = normalizeDisplayValue(
    input.businessDisplayName,
    MAX_BUSINESS_NAME_LENGTH,
  );
  const businessContext = businessName
    ? ` for ${businessName}`
    : '';
  const escapedBusinessContext = businessName
    ? ` for <strong>${escapeHtml(businessName)}</strong>`
    : '';
  const subject = subjectFor(input.environment, PRODUCTION_RECOVERY_SUBJECT);
  const textBody = [
    'A new MSP Success Websites questionnaire draft was created' + businessContext + '.',
    '',
    'Recovery code:',
    formattedCode,
    '',
    'Save this code in a secure place.',
    'You can use this code to recover your questionnaire answers.',
    `Open the recovery site: ${recoveryLink}`,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');
  const htmlBody = [
    '<!doctype html>',
    '<html lang="en">',
    '<body style="margin:0;padding:24px;background:#f5f7fa;color:#122947;font-family:Arial,sans-serif;">',
    '<main style="max-width:640px;margin:0 auto;background:#ffffff;padding:24px;border:1px solid #d7dce2;border-radius:8px;">',
    '<h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">Questionnaire recovery code</h1>',
    `<p style="line-height:1.5;">A new MSP Success Websites questionnaire draft was created${escapedBusinessContext}.</p>`,
    '<p style="margin:24px 0 8px;font-weight:bold;">Recovery code</p>',
    `<p aria-label="Recovery code" style="font-family:monospace;font-size:24px;font-weight:bold;letter-spacing:1px;padding:16px;background:#eef4fb;border:1px solid #b7c9de;border-radius:6px;">${escapeHtml(formattedCode)}</p>`,
    '<p style="line-height:1.5;"><strong>Save this code in a secure place.</strong></p>',
    '<p style="line-height:1.5;">You can use this code to recover your questionnaire answers.</p>',
    `<p style="line-height:1.5;"><a href="${escapeHtml(recoveryLink)}" style="color:#245b96;">Open the questionnaire recovery site</a></p>`,
    '<p style="line-height:1.5;color:#4a5568;">If you did not request this, you can ignore this email.</p>',
    '</main>',
    '</body>',
    '</html>',
  ].join('');
  return finalize({
    version: EMAIL_TEMPLATE_VERSION,
    purpose: input.purpose,
    subject,
    textBody,
    htmlBody,
  });
}

export function renderFutureOtpEmail(input: Readonly<{
  oneTimeCode: unknown;
  environment: EmailTemplateEnvironment;
  businessDisplayName?: unknown;
}>): RenderedEmail {
  const code = normalizeDisplayValue(input.oneTimeCode, 32);
  if (!code || !/^[A-Za-z0-9 -]+$/u.test(code)) {
    throw new EmailTemplateContractError('EMAIL_TEMPLATE_OTP_INVALID');
  }
  const businessName = normalizeDisplayValue(
    input.businessDisplayName,
    MAX_BUSINESS_NAME_LENGTH,
  );
  const context = businessName ? ` for ${businessName}` : '';
  return finalize({
    version: EMAIL_TEMPLATE_VERSION,
    purpose: 'future_otp',
    subject: subjectFor(
      input.environment,
      'Your MSP Success Websites questionnaire verification code',
    ),
    textBody: `Use this one-time verification code${context}: ${code}\n\nIf you did not request this, you can ignore this email.`,
    htmlBody: `<!doctype html><html lang="en"><body><main><h1>Questionnaire verification code</h1><p>Use this one-time verification code${businessName ? ` for ${escapeHtml(businessName)}` : ''}:</p><p aria-label="One-time verification code" style="font-family:monospace;font-size:24px;font-weight:bold;">${escapeHtml(code)}</p><p>If you did not request this, you can ignore this email.</p></main></body></html>`,
  });
}

export function renderFutureMagicLinkEmail(input: Readonly<{
  magicLink: unknown;
  environment: EmailTemplateEnvironment;
  businessDisplayName?: unknown;
}>): RenderedEmail {
  const link = validateHttpsLink(input.magicLink);
  const businessName = normalizeDisplayValue(
    input.businessDisplayName,
    MAX_BUSINESS_NAME_LENGTH,
  );
  const context = businessName ? ` for ${businessName}` : '';
  return finalize({
    version: EMAIL_TEMPLATE_VERSION,
    purpose: 'future_magic_link',
    subject: subjectFor(
      input.environment,
      'Your MSP Success Websites questionnaire sign-in link',
    ),
    textBody: `Open this one-time questionnaire link${context}: ${link}\n\nIf you did not request this, you can ignore this email.`,
    htmlBody: `<!doctype html><html lang="en"><body><main><h1>Questionnaire sign-in link</h1><p><a href="${escapeHtml(link)}">Open your one-time questionnaire link</a>${businessName ? ` for ${escapeHtml(businessName)}` : ''}.</p><p>If you did not request this, you can ignore this email.</p></main></body></html>`,
  });
}

export function validateRenderedEmail(value: unknown): Readonly<{
  valid: boolean;
  errorCode: string;
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ valid: false, errorCode: 'EMAIL_TEMPLATE_INVALID' });
  }
  const rendered = value as Partial<RenderedEmail>;
  if (rendered.version !== EMAIL_TEMPLATE_VERSION
    || !EMAIL_TEMPLATE_PURPOSES.includes(rendered.purpose as EmailTemplatePurpose)) {
    return Object.freeze({ valid: false, errorCode: 'EMAIL_TEMPLATE_METADATA_INVALID' });
  }
  if (typeof rendered.subject !== 'string'
    || rendered.subject.length === 0
    || rendered.subject.length > MAX_SUBJECT_LENGTH
    || HEADER_CONTROL_PATTERN.test(rendered.subject)) {
    return Object.freeze({ valid: false, errorCode: 'EMAIL_TEMPLATE_SUBJECT_INVALID' });
  }
  if (typeof rendered.textBody !== 'string'
    || rendered.textBody.length === 0
    || rendered.textBody.length > MAX_BODY_LENGTH
    || typeof rendered.htmlBody !== 'string'
    || rendered.htmlBody.length === 0
    || rendered.htmlBody.length > MAX_BODY_LENGTH) {
    return Object.freeze({ valid: false, errorCode: 'EMAIL_TEMPLATE_BODY_INVALID' });
  }
  if (/<(?:script|style|iframe|object|embed|img)\b/iu.test(rendered.htmlBody)
    || /javascript:/iu.test(rendered.htmlBody)) {
    return Object.freeze({ valid: false, errorCode: 'EMAIL_TEMPLATE_HTML_UNSAFE' });
  }
  return Object.freeze({ valid: true, errorCode: '' });
}

export function getSafeEmailTemplateDiagnostics(
  value: unknown,
): Readonly<Record<string, unknown>> {
  const validation = validateRenderedEmail(value);
  const rendered = validation.valid ? value as RenderedEmail : null;
  return Object.freeze({
    version: EMAIL_TEMPLATE_VERSION,
    valid: validation.valid,
    errorCode: validation.errorCode,
    purpose: rendered?.purpose ?? 'invalid',
    subjectLength: rendered?.subject.length ?? 0,
    textLength: rendered?.textBody.length ?? 0,
    htmlLength: rendered?.htmlBody.length ?? 0,
    stagingPrefixed: rendered?.subject.startsWith(STAGING_PREFIX) ?? false,
    hasTrackingPixel: rendered ? /<img\b/iu.test(rendered.htmlBody) : false,
    hasExternalImage: rendered ? /<img\b[^>]+src=/iu.test(rendered.htmlBody) : false,
    containsQuestionnaireAnswers: false,
  });
}

export const EMAIL_TEMPLATE_LIMITS = Object.freeze({
  subject: MAX_SUBJECT_LENGTH,
  body: MAX_BODY_LENGTH,
  businessDisplayName: MAX_BUSINESS_NAME_LENGTH,
  displayValue: MAX_DISPLAY_VALUE_LENGTH,
});
