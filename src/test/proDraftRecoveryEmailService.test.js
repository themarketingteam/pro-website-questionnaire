import { describe, expect, it, vi } from 'vitest';
import {
  getSafeRecoveryEmailServiceDiagnostics,
} from '../../base44/functions/_shared/proDraftRecoveryEmailService/entry.ts';
import {
  invokeReplacement,
  replacementHarness,
} from './proDraftReplacementTestHarness.js';

describe('internal replacement recovery-email service', () => {
  it('delivers after commit using the retained email and records metadata', async () => {
    const harness = await replacementHarness({ recoveryEmail: true });
    const { json } = await invokeReplacement(harness);
    expect(json.emailDelivery).toMatchObject({
      attempted: true,
      delivered: true,
      redirected: true,
      failed: false,
    });
    expect(harness.sendEmail).toHaveBeenCalledTimes(1);
    expect(harness.records[1].recovery_email_delivery_status).toBe('sent');
  });

  it('does not roll back a committed replacement when transport fails', async () => {
    const sendEmail = vi.fn(async () => ({
      success: false,
      delivered: false,
      suppressed: false,
      redirected: true,
      mode: 'staging_redirect',
      destinationClass: 'staging_internal',
      providerMessageId: null,
      providerStatus: 503,
      errorCode: 'EMAIL_SES_PROVIDER_ERROR',
      requestId: `pdrq_${'Q'.repeat(43)}`,
    }));
    const harness = await replacementHarness({ recoveryEmail: true, sendEmail });
    const { json } = await invokeReplacement(harness);
    expect(json.success).toBe(true);
    expect(json.emailDelivery).toMatchObject({
      attempted: true, delivered: false, failed: true, canRetry: true,
    });
    expect(json.recoveryCode).toBeTruthy();
    expect(json.resumeToken).toBeTruthy();
    expect(harness.records[1].replacement_transaction_status).toBe('committed');
  });

  it('does not attempt delivery without a retained email', async () => {
    const harness = await replacementHarness();
    const { json } = await invokeReplacement(harness);
    expect(json.emailDelivery.attempted).toBe(false);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('accepts neither public authorization nor a recipient override', () => {
    expect(getSafeRecoveryEmailServiceDiagnostics()).toMatchObject({
      acceptsPublicAuthorization: false,
      acceptsRecipientOverride: false,
      storesRawCode: false,
      logsRawCode: false,
      requiresCommittedReplacement: true,
    });
  });
});
