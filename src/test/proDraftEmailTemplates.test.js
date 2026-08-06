import { describe, expect, it } from 'vitest';
import {
  EMAIL_TEMPLATE_LIMITS,
  escapeHtml,
  getSafeEmailTemplateDiagnostics,
  renderFutureMagicLinkEmail,
  renderFutureOtpEmail,
  renderRecoveryCodeEmail,
  validateRenderedEmail,
} from '../../base44/functions/_shared/proDraftEmailTemplates/entry.ts';

const RECOVERY_CODE = '2345-6789-ABCD-EFGH-JKMN';
const RECOVERY_URL = 'https://questionnaire.example.test/recover';

const recoveryTemplate = (overrides = {}) => renderRecoveryCodeEmail({
  recoveryCode: RECOVERY_CODE,
  businessDisplayName: 'Synthetic Business',
  recoveryBaseUrl: RECOVERY_URL,
  environment: 'production',
  purpose: 'clear_all_replacement',
  ...overrides,
});

describe('recovery-code email template', () => {
  it('renders the exact production subject and safe recovery instructions', () => {
    const rendered = recoveryTemplate();
    expect(rendered.subject).toBe(
      'Your MSP Success Websites questionnaire recovery code',
    );
    expect(rendered.textBody).toContain('A new MSP Success Websites questionnaire draft was created');
    expect(rendered.textBody).toContain('Save this code in a secure place.');
    expect(rendered.textBody).toContain('recover your questionnaire answers');
    expect(rendered.textBody).toContain('If you did not request this, you can ignore this email.');
    expect(rendered.htmlBody).toContain('<html lang="en">');
    expect(validateRenderedEmail(rendered)).toEqual({ valid: true, errorCode: '' });
  });

  it('prefixes every staging recovery subject', () => {
    expect(recoveryTemplate({ environment: 'staging' }).subject).toBe(
      '[STAGING] Your MSP Success Websites questionnaire recovery code',
    );
  });

  it('displays the formatted recovery code prominently in text and HTML', () => {
    const rendered = recoveryTemplate({ recoveryCode: '23456789ABCDEFGHJKMN' });
    expect(rendered.textBody).toContain(RECOVERY_CODE);
    expect(rendered.htmlBody).toContain(RECOVERY_CODE);
    expect(rendered.htmlBody).toContain('aria-label="Recovery code"');
    expect(rendered.subject).not.toContain(RECOVERY_CODE);
  });

  it('keeps the recovery code out of the recovery URL and rejects query strings', () => {
    const rendered = recoveryTemplate();
    expect(rendered.textBody).toContain(RECOVERY_URL);
    expect(rendered.textBody).not.toContain(`${RECOVERY_URL}?`);
    expect(() => recoveryTemplate({
      recoveryBaseUrl: `${RECOVERY_URL}?code=${RECOVERY_CODE}`,
    })).toThrow('safe rendering contract');
  });

  it('HTML-escapes business names and strips header/control injection', () => {
    const rendered = recoveryTemplate({
      businessDisplayName: '<script>alert(1)</script>\r\nBcc: attacker@example.test',
    });
    expect(rendered.htmlBody).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered.htmlBody).not.toContain('<script>');
    expect(rendered.subject).not.toMatch(/[\r\n]/u);
    expect(rendered.subject).not.toContain('attacker');
  });

  it('bounds the safe business display name before rendering', () => {
    const rendered = recoveryTemplate({ businessDisplayName: 'A'.repeat(500) });
    expect(rendered.textBody).toContain('A'.repeat(EMAIL_TEMPLATE_LIMITS.businessDisplayName));
    expect(rendered.textBody).not.toContain('A'.repeat(
      EMAIL_TEMPLATE_LIMITS.businessDisplayName + 1,
    ));
  });

  it('ignores arbitrary answer data and renders no questionnaire answers', () => {
    const privateAnswer = 'PRIVATE_FULL_QUESTIONNAIRE_ANSWER';
    const rendered = recoveryTemplate({
      answers: { q1: privateAnswer },
      questionnaireState: privateAnswer,
    });
    expect(JSON.stringify(rendered)).not.toContain(privateAnswer);
  });

  it('contains no tracking pixel, image, external asset, marketing, or arbitrary HTML', () => {
    const rendered = recoveryTemplate();
    expect(rendered.htmlBody).not.toMatch(/<img\b|tracking|unsubscribe|buy now|<style\b/iu);
    expect(rendered.htmlBody).not.toMatch(/src=/iu);
    expect(rendered.htmlBody).not.toContain('<script');
  });

  it('rejects invalid recovery codes, environments, and non-HTTPS links', () => {
    expect(() => recoveryTemplate({ recoveryCode: 'bad-code' })).toThrow();
    expect(() => recoveryTemplate({ environment: 'test' })).toThrow();
    expect(() => recoveryTemplate({ recoveryBaseUrl: 'http://example.test/recover' }))
      .toThrow();
  });
});

describe('future verification templates remain source-only', () => {
  it('renders a safe future OTP template without enabling an OTP workflow', () => {
    const rendered = renderFutureOtpEmail({
      oneTimeCode: '123 456',
      environment: 'staging',
      businessDisplayName: '<Synthetic>',
    });
    expect(rendered.purpose).toBe('future_otp');
    expect(rendered.subject).toMatch(/^\[STAGING\]/u);
    expect(rendered.textBody).toContain('123 456');
    expect(rendered.htmlBody).toContain('&lt;Synthetic&gt;');
    expect(validateRenderedEmail(rendered).valid).toBe(true);
  });

  it('renders a safe future magic-link template with HTTPS only', () => {
    const rendered = renderFutureMagicLinkEmail({
      magicLink: 'https://questionnaire.example.test/future/opaque-token',
      environment: 'production',
    });
    expect(rendered.purpose).toBe('future_magic_link');
    expect(rendered.htmlBody).toContain('https://questionnaire.example.test/future/opaque-token');
    expect(() => renderFutureMagicLinkEmail({
      magicLink: 'javascript:alert(1)',
      environment: 'production',
    })).toThrow();
  });
});

describe('template validation and diagnostics', () => {
  it('escapes all HTML-sensitive characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('rejects header injection, executable HTML, images, and oversized bodies', () => {
    const base = recoveryTemplate();
    expect(validateRenderedEmail({ ...base, subject: 'safe\r\nBcc:x' }).valid).toBe(false);
    expect(validateRenderedEmail({ ...base, htmlBody: '<script>alert(1)</script>' }).valid)
      .toBe(false);
    expect(validateRenderedEmail({ ...base, htmlBody: '<img src="https://tracker.invalid/pixel">' }).valid)
      .toBe(false);
    expect(validateRenderedEmail({ ...base, textBody: 'A'.repeat(
      EMAIL_TEMPLATE_LIMITS.body + 1,
    ) }).valid).toBe(false);
  });

  it('returns diagnostics with sizes and booleans but no email or recovery code', () => {
    const diagnostics = getSafeEmailTemplateDiagnostics(recoveryTemplate({
      environment: 'staging',
    }));
    expect(diagnostics).toMatchObject({
      valid: true,
      purpose: 'clear_all_replacement',
      stagingPrefixed: true,
      hasTrackingPixel: false,
      containsQuestionnaireAnswers: false,
    });
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(RECOVERY_CODE);
    expect(serialized).not.toMatch(/@/u);
  });
});
