import { describe, expect, it, vi } from 'vitest';
import { ALERT_TYPES, evaluateProDraftAlertPolicy } from '../../base44/functions/_shared/proDraftAlertPolicy/entry.ts';
import { buildSafeAlertMessage, deliverOperationalAlert, getSafeAlertDeliveryDiagnostics } from '../../base44/functions/_shared/proDraftAlertDelivery/entry.ts';

const decision = {type: 'save_error_rate', severity: 'urgent', threshold: .01, observed: .02, windowMinutes: 5, reasonCode: 'ALERT_SAVE_ERROR_RATE'};
const alertInput = {decision, environment: 'staging', requestId: 'request_synthetic'};
const envValues = {PRO_DRAFT_ALERT_MODE: 'staging_redirect', STAGING_ALERT_EMAIL_REDIRECT_TO: 'synthetic-ops@example.test', PRO_DRAFT_ALERT_COOLDOWN_SECONDS: '900'};

describe('alert policy and delivery', () => {
  it('applies required warning/urgent thresholds', () => {
    const alerts = evaluateProDraftAlertPolicy({saveErrorRate: .011, saveP95Ms: 5001, saveP99Ms: 10001, sesFailureRate: .051, submissionFailureRate: .021, consecutiveSyntheticProbeFailures: 2, cleanupFailureCount: 1, operationalIngestUnavailable: true, adminLockoutCount: 11});
    expect(alerts.map((alert) => alert.type)).toEqual(expect.arrayContaining([ALERT_TYPES.SAVE_ERROR_RATE, ALERT_TYPES.SAVE_P95_LATENCY, ALERT_TYPES.SAVE_P99_LATENCY, ALERT_TYPES.SES_FAILURE_RATE, ALERT_TYPES.SUBMISSION_FAILURE_RATE, ALERT_TYPES.SYNTHETIC_PROBE_FAILURE, ALERT_TYPES.CLEANUP_FAILURE, ALERT_TYPES.OPERATIONAL_INGEST_UNAVAILABLE, ALERT_TYPES.ADMIN_LOCKOUT_SPIKE]));
  });
  it('classifies every boundary/integrity indicator as critical', () => {
    const alerts = evaluateProDraftAlertPolicy({crossClientLeakageCount: 1, rlsBoundaryFailureCount: 1, submittedRegressionCount: 1, lostAcknowledgedStateCount: 1, migrationIntegrityFailureCount: 1});
    expect(alerts).toHaveLength(5); expect(alerts.every((alert) => alert.severity === 'critical')).toBe(true);
  });
  it('builds a safe credential-free alert message', () => {
    const message = buildSafeAlertMessage({...alertInput, draftFingerprint: 'abcdef123456', dashboardUrl: 'https://ops.example.test/admin/draft-operations'});
    expect(message.text).toContain('abcdef123456'); expect(message.text).not.toMatch(/token=|adminGrant|answer/i);
  });
  it('redirects staging delivery and deduplicates during cooldown', async () => {
    let expires = null; const store = {get: vi.fn(async () => expires), set: vi.fn(async (_key, value) => { expires = value; })}; const sendEmail = vi.fn(async () => ({success: true, delivered: true})); const options = {env: (name) => envValues[name], store, now: () => 1000, sendEmail};
    await expect(deliverOperationalAlert(alertInput, options)).resolves.toMatchObject({delivered: true, redirected: true});
    await expect(deliverOperationalAlert(alertInput, options)).resolves.toMatchObject({delivered: false, suppressed: true, reasonCode: 'ALERT_DELIVERY_COOLDOWN'}); expect(sendEmail).toHaveBeenCalledOnce();
  });
  it('records alert delivery failure as an operational failure event', async () => {
    const recordDeliveryFailure = vi.fn(async () => {}); const result = await deliverOperationalAlert(alertInput, {env: (name) => envValues[name], store: {get: () => null, set: () => {}}, sendEmail: vi.fn(async () => { throw new Error('synthetic failure'); }), recordDeliveryFailure});
    expect(result).toMatchObject({delivered: false, reasonCode: 'ALERT_DELIVERY_FAILED'}); expect(recordDeliveryFailure).toHaveBeenCalledWith(expect.objectContaining({error_code: 'ALERT_DELIVERY_FAILED'}));
    expect(getSafeAlertDeliveryDiagnostics((name) => envValues[name])).toMatchObject({mode: 'staging_redirect', recipientConfigured: true, containsRecipient: false});
  });
  it('never permits a production email mode outside production', async () => {
    const productionEnv = (name) => ({PRO_DRAFT_ALERT_MODE: 'production_email', PRO_DRAFT_ALERT_EMAIL_TO: 'synthetic-ops@example.test'}[name]);
    await expect(deliverOperationalAlert({...alertInput, environment: 'test'}, {env: productionEnv})).rejects.toThrow('ALERT_DELIVERY_ENVIRONMENT_MISMATCH');
  });
});
