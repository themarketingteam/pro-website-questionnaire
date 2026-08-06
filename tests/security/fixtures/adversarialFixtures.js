export const SYNTHETIC_SECURITY_ENVIRONMENT = 'test';
export const SYNTHETIC_TEST_RUN_ID = 'security-local-20260806';

export const syntheticSecurityIdentity = Object.freeze({
  email: `${SYNTHETIC_TEST_RUN_ID}@example.test`,
  domain: 'security-fixture.example.test',
  draftId: 'security-draft-fixture',
  deviceId: 'security-device-fixture',
  sourceIp: '192.0.2.44',
});

export const safeTokenSecret = (name, marker = 's') => Object.freeze({
  name,
  value: String(marker).slice(0, 1).repeat(32),
});

export const ATTACK_CATEGORY_CASES = Object.freeze({
  publicRecovery: Object.freeze([
    'email-enumeration', 'equivalent-errors', 'timing-distribution',
    'malformed-code-equivalence', 'rate-limit', 'captcha', 'lockout',
    'device-manipulation', 'ip-body-spoof', 'draft-id-injection',
    'email-hash-injection', 'exact-draft-binding', 'associated-scope-binding',
    'cross-email-choice', 'terminal-draft-denial', 'hash-redaction',
    'no-answer-preview',
  ]),
  tokenAuthorization: Object.freeze([
    'tampered-payload', 'tampered-signature', 'wrong-type', 'wrong-scope',
    'wrong-environment', 'wrong-draft', 'wrong-device', 'expired-session',
    'grant-version-revocation', 'password-version-revocation', 'secret-rotation',
    'cross-purpose-signature', 'algorithm-confusion', 'extra-segments',
    'oversized-token', 'unicode-control', 'duplicate-json-key', 'replay',
    'browser-absence',
  ]),
  requestPayload: Object.freeze([
    'oversized-json', 'declared-size-mismatch', 'chunked-oversize', 'deep-nesting',
    'excessive-keys', 'circular-client-input', 'prototype-pollution',
    'content-type-confusion', 'method-confusion', 'duplicate-keys', 'invalid-utf8',
    'control-characters', 'header-injection', 'email-header-injection',
    'open-redirect', 'path-traversal', 'html-script-injection',
    'spreadsheet-formula-injection', 'log-injection',
  ]),
  concurrency: Object.freeze([
    'lower-revision-replay', 'same-revision-different-hash',
    'expected-revision-mismatch', 'status-regression', 'submitted-to-active',
    'superseded-to-active', 'duplicate-clear-all', 'partial-replacement-retry',
    'concurrent-clear-save', 'concurrent-submit-save', 'two-tab-same-field',
    'event-replay', 'event-batch-duplicate', 'bundle-replay',
    'opposite-direction-lease', 'destination-overwrite',
  ]),
  email: Object.freeze([
    'staging-redirect-required', 'missing-redirect-fail-closed',
    'production-mode-denied', 'recipient-override-denied', 'sender-override-denied',
    'subject-injection', 'html-escaping', 'code-not-in-url', 'log-redaction',
    'idempotent-delivery', 'delivery-uncertain', 'future-auth-disabled',
    'no-tracking-pixel', 'no-external-image',
  ]),
  migration: Object.freeze([
    'bundle-signature', 'destination-substitution', 'source-substitution',
    'environment-substitution', 'sequence-replay', 'count-hash-mismatch',
    'staging-production-denial', 'production-staging-denial', 'same-app-denial',
    'id-map-collision', 'origin-collision', 'unapproved-entity',
    'test-record-contamination', 'raw-bundle-prohibition', 'report-redaction',
    'reverse-conflict',
  ]),
});
