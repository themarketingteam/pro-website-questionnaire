import { describe, expect, it } from 'vitest';
import {
  DRAFT_IDENTITY_ASSOCIATION_INTENTS,
  DRAFT_IDENTITY_ERROR_CODES,
  DRAFT_IDENTITY_SOURCE_VALUES,
  EMAIL_VERIFICATION_STATUS_VALUES,
  PRO_DRAFT_IDENTITY_VERSION,
  RECOVERY_EMAIL_NORMALIZATION_VERSION,
  DraftIdentityValidationError,
  compareDraftIdentityContexts,
  createDraftIdentityContext,
  getSafeDraftIdentityDiagnostics,
  isSignedInvitationEmailChanged,
  normalizeBusinessDomain,
  normalizeInvitationId,
  normalizeQuestionnaireBusinessName,
  normalizeQuestionnaireUserId,
  normalizeQuestionnaireUserName,
  normalizeRecoveryEmail,
  shouldCreateNewDraftAssociation,
  validateDraftIdentityContext,
} from '@/lib/proDraftIdentity';

const syntheticIdentityInput = (overrides = {}) => ({
  invitationId: ' invitation-synthetic-1 ',
  userId: ' user-synthetic-1 ',
  userName: ' Synthetic   User ',
  businessName: ' Synthetic   Business ',
  domain: 'https://www.synthetic.example.test/path',
  recoveryEmail: ' Synthetic.Person+Draft@Example.TEST ',
  recoveryEmailSource: 'client_entered',
  recoveryEmailVerificationStatus: 'unverified',
  associationIntent: 'new_invitation',
  anonymousRecoveryAcknowledged: false,
  ...overrides,
});

describe('draft identity constants', () => {
  it('uses independently versioned identity and email contracts', () => {
    expect(PRO_DRAFT_IDENTITY_VERSION).toBe(1);
    expect(RECOVERY_EMAIL_NORMALIZATION_VERSION).toBe(1);
  });

  it('exports the exact identity sources', () => {
    expect(DRAFT_IDENTITY_SOURCE_VALUES).toEqual([
      'signed_invitation',
      'client_entered',
      'recovered_by_email',
      'recovered_by_code',
      'admin_corrected',
      'migrated_legacy',
      'anonymous',
    ]);
  });

  it('exports the exact association intents', () => {
    expect(DRAFT_IDENTITY_ASSOCIATION_INTENTS).toEqual([
      'new_invitation',
      'resume_current_draft',
      'recover_by_email',
      'recover_by_code',
      'changed_signed_email',
      'clear_all_replacement',
      'start_new_after_submission',
      'legacy_migration',
      'anonymous_start',
    ]);
  });

  it('has explicit verification states and no ambiguous verified state', () => {
    expect(EMAIL_VERIFICATION_STATUS_VALUES).toEqual([
      'unverified',
      'verified_signed_invitation',
      'verified_otp',
      'verified_magic_link',
    ]);
    expect(EMAIL_VERIFICATION_STATUS_VALUES).not.toContain('verified');
  });
});

describe('recovery email normalization', () => {
  it('normalizes an ordinary email for association, not verification', () => {
    expect(normalizeRecoveryEmail('person@example.test')).toEqual({
      valid: true,
      displayEmail: 'person@example.test',
      normalizedEmail: 'person@example.test',
      normalizationVersion: 1,
      errorCode: null,
    });
  });

  it('lowercases the complete lookup representation', () => {
    const normalized = normalizeRecoveryEmail('Person@EXAMPLE.TEST');
    expect(normalized.displayEmail).toBe('Person@EXAMPLE.TEST');
    expect(normalized.normalizedEmail).toBe('person@example.test');
  });

  it('trims leading and trailing whitespace', () => {
    const normalized = normalizeRecoveryEmail('  person@example.test  ');
    expect(normalized.displayEmail).toBe('person@example.test');
    expect(normalized.normalizedEmail).toBe('person@example.test');
  });

  it('normalizes Unicode to NFC', () => {
    const decomposed = `use\u0301r@éxample.test`;
    const normalized = normalizeRecoveryEmail(decomposed);
    expect(normalized.valid).toBe(true);
    expect(normalized.displayEmail).toBe(decomposed.normalize('NFC'));
    expect(normalized.normalizedEmail).toContain('@xn--xample-9ua.test');
  });

  it('preserves plus tags and dots', () => {
    const normalized = normalizeRecoveryEmail('First.Last+Draft@Example.TEST');
    expect(normalized.normalizedEmail).toBe('first.last+draft@example.test');
  });

  it('rejects consecutive domain dots', () => {
    expect(normalizeRecoveryEmail('person@example..test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_CONSECUTIVE_DOTS);
  });

  it('rejects more than one at sign', () => {
    expect(normalizeRecoveryEmail('person@example@test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_INVALID_AT_COUNT);
  });

  it('rejects a missing local part', () => {
    expect(normalizeRecoveryEmail('@example.test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_MISSING_LOCAL_PART);
  });

  it('rejects a missing domain', () => {
    expect(normalizeRecoveryEmail('person@').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_MISSING_DOMAIN);
  });

  it('rejects ASCII controls and newline injection', () => {
    expect(normalizeRecoveryEmail('person\u0000@example.test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_CONTROL_CHARACTER);
    expect(normalizeRecoveryEmail('person@example.test\nBcc:other@example.test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_CONTROL_CHARACTER);
    expect(normalizeRecoveryEmail('person\t@example.test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_CONTROL_CHARACTER);
  });

  it('rejects embedded spaces', () => {
    expect(normalizeRecoveryEmail('first last@example.test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_EMBEDDED_WHITESPACE);
  });

  it('enforces the local-part limit', () => {
    expect(normalizeRecoveryEmail(`${'a'.repeat(65)}@example.test`).errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_LOCAL_PART_TOO_LONG);
  });

  it('enforces the total length limit', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`;
    expect(email.length).toBeGreaterThan(254);
    expect(normalizeRecoveryEmail(email).errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_TOO_LONG);
  });

  it('enforces the domain-label limit and hyphen boundary', () => {
    expect(normalizeRecoveryEmail(`person@${'a'.repeat(64)}.test`).errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_LABEL_TOO_LONG);
    expect(normalizeRecoveryEmail('person@-example.test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_LABEL_HYPHEN);
    expect(normalizeRecoveryEmail('person@example-.test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_LABEL_HYPHEN);
  });

  it('accepts blank input only in explicit optional mode', () => {
    expect(normalizeRecoveryEmail('', { allowEmpty: true })).toMatchObject({
      valid: true,
      displayEmail: '',
      normalizedEmail: '',
    });
    expect(normalizeRecoveryEmail('').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_REQUIRED);
  });

  it('accepts strings only, including in optional mode', () => {
    expect(normalizeRecoveryEmail(null, { allowEmpty: true }).errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.EMAIL_INVALID_TYPE);
  });
});

describe('business domain normalization', () => {
  it.each([
    ['https://example.com', 'example.com', 'example.com'],
    ['http://www.example.com/', 'example.com', 'www.example.com'],
    ['EXAMPLE.COM', 'example.com', 'example.com'],
    ['https://www.example.com/path/to/page', 'example.com', 'www.example.com'],
  ])('normalizes %s', (input, normalizedDomain, hostname) => {
    expect(normalizeBusinessDomain(input)).toMatchObject({
      valid: true,
      normalizedDomain,
      hostname,
      errorCode: null,
    });
  });

  it('preserves the trimmed display input separately', () => {
    const normalized = normalizeBusinessDomain('  HTTPS://WWW.Example.COM/Path  ');
    expect(normalized.displayDomain).toBe('HTTPS://WWW.Example.COM/Path');
    expect(normalized.normalizedDomain).toBe('example.com');
  });

  it('normalizes a Unicode domain through the runtime URL implementation', () => {
    expect(normalizeBusinessDomain('https://bücher.example')).toMatchObject({
      valid: true,
      normalizedDomain: 'xn--bcher-kva.example',
    });
  });

  it('rejects malformed URLs and invalid ports', () => {
    expect(normalizeBusinessDomain('https://[invalid').valid).toBe(false);
    expect(normalizeBusinessDomain('example.test:70000').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_PORT);
  });

  it('rejects URL credentials', () => {
    expect(normalizeBusinessDomain('https://user:pass@example.test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_CREDENTIALS_NOT_ALLOWED);
  });

  it('rejects query strings and fragments', () => {
    expect(normalizeBusinessDomain('https://example.test?source=test').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_QUERY_NOT_ALLOWED);
    expect(normalizeBusinessDomain('https://example.test#section').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_FRAGMENT_NOT_ALLOWED);
  });

  it('rejects IP addresses for the questionnaire business-domain contract', () => {
    expect(normalizeBusinessDomain('127.0.0.1').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_IP_NOT_ALLOWED);
    expect(normalizeBusinessDomain('https://[::1]').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_IP_NOT_ALLOWED);
  });

  it('allows blank input only when the caller explicitly makes it optional', () => {
    expect(normalizeBusinessDomain('', { allowEmpty: true }).valid).toBe(true);
    expect(normalizeBusinessDomain('').errorCode)
      .toBe(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_REQUIRED);
  });
});

describe('identity context and association decisions', () => {
  it('normalizes current field names into the complete context shape', () => {
    const context = createDraftIdentityContext(syntheticIdentityInput());
    expect(Object.keys(context)).toEqual([
      'identityVersion',
      'formType',
      'invitationId',
      'userId',
      'userName',
      'businessName',
      'normalizedDomain',
      'displayDomain',
      'recoveryEmail',
      'normalizedRecoveryEmail',
      'recoveryEmailSource',
      'recoveryEmailVerificationStatus',
      'associationIntent',
      'signedInvitationEmail',
      'normalizedSignedInvitationEmail',
      'signedInvitationEmailChanged',
      'anonymousRecoveryAcknowledged',
    ]);
    expect(context).toMatchObject({
      identityVersion: 1,
      formType: 'pro-questionnaire',
      invitationId: 'invitation-synthetic-1',
      userId: 'user-synthetic-1',
      userName: 'Synthetic User',
      businessName: 'Synthetic Business',
      normalizedDomain: 'synthetic.example.test',
      normalizedRecoveryEmail: 'synthetic.person+draft@example.test',
      recoveryEmailVerificationStatus: 'unverified',
    });
  });

  it('normalizes individual current questionnaire identity fields', () => {
    expect(normalizeQuestionnaireUserId(' user-1 ')).toBe('user-1');
    expect(normalizeQuestionnaireUserName(' Synthetic   User ')).toBe('Synthetic User');
    expect(normalizeQuestionnaireBusinessName(' Synthetic   Co ')).toBe('Synthetic Co');
    expect(normalizeInvitationId(' invite-1 ')).toBe('invite-1');
  });

  it('accepts the current nested Redux credential names as compatibility input', () => {
    const context = createDraftIdentityContext({
      credentials: {
        userId: 'user-credential',
        userName: 'Credential User',
        userEmail: 'credential@example.test',
        businessName: 'Credential Business',
        domain: 'www.credential.example.test',
      },
      recoveryEmailSource: 'client_entered',
      associationIntent: 'new_invitation',
    });
    expect(context).toMatchObject({
      userId: 'user-credential',
      normalizedRecoveryEmail: 'credential@example.test',
      businessName: 'Credential Business',
      normalizedDomain: 'credential.example.test',
    });
  });

  it('rejects unknown source and intent values with typed errors', () => {
    expect(() => createDraftIdentityContext(syntheticIdentityInput({
      recoveryEmailSource: 'query_parameter_verified',
    }))).toThrowError(DraftIdentityValidationError);
    try {
      createDraftIdentityContext(syntheticIdentityInput({ associationIntent: 'reuse_any_draft' }));
    } catch (error) {
      expect(error.code).toBe(DRAFT_IDENTITY_ERROR_CODES.UNSUPPORTED_ASSOCIATION_INTENT);
    }
  });

  it('prevents frontend promotion to a verified state', () => {
    expect(() => createDraftIdentityContext(syntheticIdentityInput({
      recoveryEmailSource: 'signed_invitation',
      signedInvitationEmail: 'person@example.test',
      recoveryEmail: 'person@example.test',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
    }))).toThrowError(DraftIdentityValidationError);
  });

  it('permits a verified signed-invitation state only through an explicit trusted adapter', () => {
    const context = createDraftIdentityContext(syntheticIdentityInput({
      recoveryEmailSource: 'signed_invitation',
      signedInvitationEmail: 'person@example.test',
      recoveryEmail: 'PERSON@example.test',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
    }), { trustedBackendResult: true });
    expect(context.recoveryEmailVerificationStatus).toBe('verified_signed_invitation');
  });

  it('detects equivalent signed email after normalization', () => {
    expect(isSignedInvitationEmailChanged(
      'Person@Example.TEST',
      ' person@example.test ',
    )).toBe(false);
    expect(isSignedInvitationEmailChanged(null, 'person@example.test')).toBe(false);
  });

  it('detects a changed signed email and returns typed invalid replacement results', () => {
    expect(isSignedInvitationEmailChanged(
      'first@example.test',
      'second@example.test',
    )).toBe(true);
    expect(isSignedInvitationEmailChanged(
      'first@example.test',
      'not-an-email',
    )).toEqual({
      valid: false,
      changed: null,
      errorCode: DRAFT_IDENTITY_ERROR_CODES.EMAIL_INVALID_AT_COUNT,
    });
  });

  it('forces changed signed email to a new unverified client association', () => {
    const context = createDraftIdentityContext(syntheticIdentityInput({
      signedInvitationEmail: 'signed@example.test',
      recoveryEmail: 'replacement@example.test',
      recoveryEmailSource: 'signed_invitation',
      recoveryEmailVerificationStatus: 'verified_signed_invitation',
    }));
    expect(context).toMatchObject({
      signedInvitationEmailChanged: true,
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
      associationIntent: 'changed_signed_email',
    });
    expect(shouldCreateNewDraftAssociation(context)).toBe(true);
  });

  it.each([
    'clear_all_replacement',
    'start_new_after_submission',
    'anonymous_start',
  ])('requires a new association for %s', (associationIntent) => {
    expect(shouldCreateNewDraftAssociation(associationIntent)).toBe(true);
  });

  it('creates a new invitation association only without a current authorized draft', () => {
    expect(shouldCreateNewDraftAssociation('new_invitation')).toBe(true);
    expect(shouldCreateNewDraftAssociation('new_invitation', {
      currentAuthorizedDraftExists: true,
    })).toBe(false);
  });

  it('does not decide authorization for email or code recovery', () => {
    expect(shouldCreateNewDraftAssociation('recover_by_email')).toBe(false);
    expect(shouldCreateNewDraftAssociation('recover_by_code')).toBe(false);
  });

  it('requires explicit acknowledgement for an anonymous start', () => {
    expect(() => createDraftIdentityContext({
      recoveryEmailSource: 'anonymous',
      associationIntent: 'anonymous_start',
    })).toThrowError(DraftIdentityValidationError);
    const context = createDraftIdentityContext({
      recoveryEmailSource: 'anonymous',
      associationIntent: 'anonymous_start',
      anonymousRecoveryAcknowledged: true,
    });
    expect(context.normalizedRecoveryEmail).toBeNull();
    expect(context.anonymousRecoveryAcknowledged).toBe(true);
  });

  it('does not accept tokens or recovery codes in an identity context', () => {
    expect(() => createDraftIdentityContext({
      ...syntheticIdentityInput(),
      recoveryCode: 'synthetic-code-must-not-enter-context',
    })).toThrowError(DraftIdentityValidationError);
    expect(() => createDraftIdentityContext({
      ...syntheticIdentityInput(),
      signedInvitationToken: 'synthetic-token-must-not-enter-context',
    })).toThrowError(DraftIdentityValidationError);
  });

  it('validates a complete context without returning PII in diagnostics', () => {
    const context = createDraftIdentityContext(syntheticIdentityInput());
    const validation = validateDraftIdentityContext(context);
    expect(validation.valid).toBe(true);
    expect(validation.context).toEqual(context);
    const serialized = JSON.stringify(validation.safeDiagnostics);
    expect(serialized).not.toContain('Synthetic.Person');
    expect(serialized).not.toContain('Synthetic Business');
    expect(serialized).not.toContain('synthetic.example.test');
    expect(serialized).not.toContain('user-synthetic-1');
    expect(serialized).not.toContain('invitation-synthetic-1');
  });

  it('safe diagnostics expose only presence, enums, booleans, versions, and errors', () => {
    const context = createDraftIdentityContext(syntheticIdentityInput());
    expect(getSafeDraftIdentityDiagnostics(context)).toEqual({
      identityVersion: 1,
      formType: 'pro-questionnaire',
      hasInvitationId: true,
      hasUserId: true,
      hasRecoveryEmail: true,
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
      associationIntent: 'new_invitation',
      signedInvitationEmailChanged: false,
      anonymousRecoveryAcknowledged: false,
      errorCode: null,
    });
  });

  it('does not mutate input and returns fresh contexts', () => {
    const input = syntheticIdentityInput();
    const snapshot = structuredClone(input);
    const first = createDraftIdentityContext(input);
    const second = createDraftIdentityContext(input);
    expect(input).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('compares normalized contexts without returning identity values', () => {
    const first = createDraftIdentityContext(syntheticIdentityInput());
    const second = createDraftIdentityContext(syntheticIdentityInput({
      recoveryEmail: 'synthetic.person+draft@example.test',
      domain: 'SYNTHETIC.EXAMPLE.TEST',
    }));
    const comparison = compareDraftIdentityContexts(first, second);
    expect(comparison).toMatchObject({
      equivalent: false,
      sameInvitation: true,
      sameUser: true,
      sameBusiness: true,
      sameRecoveryEmail: true,
      sameAssociation: true,
    });
    expect(JSON.stringify(comparison)).not.toContain('example.test');
  });
});
