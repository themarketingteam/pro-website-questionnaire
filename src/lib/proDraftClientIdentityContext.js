import { safeGetWindowLocationHref } from './browserSafety.js';
import {
  DRAFT_IDENTITY_ERROR_CODES,
  createDraftIdentityContext,
  getSafeDraftIdentityDiagnostics,
  isSignedInvitationEmailChanged,
  normalizeRecoveryEmail,
  shouldCreateNewDraftAssociation,
} from './proDraftIdentity.js';

const emptyParams = () => ({
  userId: '',
  userName: '',
  businessName: '',
  domainName: '',
  recoveryEmail: '',
  signedInvitationEmail: '',
  signedInvitationId: '',
  currentAuthorizedDraftId: '',
  sourceTrust: 'untrusted_url',
});

export const readProQuestionnaireIdentityParams = ({
  href = safeGetWindowLocationHref(),
} = {}) => {
  try {
    const url = new URL(href || '/', 'https://questionnaire.invalid');
    return Object.freeze({
      userId: String(url.searchParams.get('userId') || '').trim(),
      userName: String(url.searchParams.get('userName') || '').trim(),
      businessName: String(url.searchParams.get('businessName') || '').trim(),
      domainName: String(url.searchParams.get('domainName') || '').trim(),
      recoveryEmail: String(
        url.searchParams.get('recoveryEmail') || url.searchParams.get('userEmail') || '',
      ).trim(),
      signedInvitationEmail: String(
        url.searchParams.get('signedInvitationEmail') || '',
      ).trim(),
      // URL values are claims only. A backend-verified caller must explicitly
      // promote these values before they can select a signed namespace.
      signedInvitationId: String(url.searchParams.get('signedInvitationId') || '').trim(),
      currentAuthorizedDraftId: '',
      sourceTrust: 'untrusted_url',
    });
  } catch {
    return Object.freeze(emptyParams());
  }
};

export const compareSignedAndEnteredEmail = (signedEmail, enteredEmail) => {
  const signed = normalizeRecoveryEmail(signedEmail ?? '', { allowEmpty: true });
  const entered = normalizeRecoveryEmail(enteredEmail ?? '', { allowEmpty: true });
  if (!signed.valid || !entered.valid) {
    return Object.freeze({
      valid: false,
      changed: null,
      signedEmailPresent: Boolean(signed.displayEmail),
      enteredEmailPresent: Boolean(entered.displayEmail),
      errorCode: signed.valid ? entered.errorCode : signed.errorCode,
    });
  }
  const changed = signed.normalizedEmail && entered.normalizedEmail
    ? isSignedInvitationEmailChanged(signed.displayEmail, entered.displayEmail)
    : false;
  return Object.freeze({
    valid: true,
    changed: changed === true,
    signedEmailPresent: Boolean(signed.normalizedEmail),
    enteredEmailPresent: Boolean(entered.normalizedEmail),
    errorCode: null,
  });
};

export const createClientDraftIdentityContext = (input = {}, options = {}) => {
  const trustedBackendResult = options.trustedBackendResult === true;
  const recoveryEmail = input.recoveryEmail ?? input.userEmail ?? '';
  const comparison = compareSignedAndEnteredEmail(
    input.signedInvitationEmail,
    recoveryEmail,
  );
  if (!comparison.valid) {
    const error = Object.assign(
      new TypeError(`Invalid client draft identity (${comparison.errorCode})`),
      { code: comparison.errorCode },
    );
    throw error;
  }

  let source = input.recoveryEmailSource;
  let intent = input.associationIntent;
  let verificationStatus = input.recoveryEmailVerificationStatus || 'unverified';
  let invitationId = input.invitationId ?? input.signedInvitationId;
  if (!trustedBackendResult) {
    invitationId = null;
    verificationStatus = 'unverified';
    if (source === 'signed_invitation' || input.signedInvitationEmail) source = 'client_entered';
  }
  if (comparison.changed) {
    source = 'client_entered';
    intent = 'changed_signed_email';
    verificationStatus = 'unverified';
  }
  if (!source) source = recoveryEmail ? 'client_entered' : 'migrated_legacy';
  if (!intent) {
    intent = source === 'anonymous'
      ? 'anonymous_start'
      : (source === 'migrated_legacy' ? 'legacy_migration' : 'new_invitation');
  }

  return createDraftIdentityContext({
    ...input,
    invitationId,
    recoveryEmail,
    recoveryEmailSource: source,
    recoveryEmailVerificationStatus: verificationStatus,
    associationIntent: intent,
  }, { trustedBackendResult });
};

export const deriveClientDraftAssociationDecision = (identityContext) => {
  if (!identityContext || typeof identityContext !== 'object') {
    return Object.freeze({
      valid: false,
      requiresNewDraftAssociation: false,
      requiresNewAssociation: false,
      mayReuseSignedInvitationNamespace: false,
      mustNotSearchReplacementEmail: false,
      errorCode: DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT,
    });
  }
  try {
    const requiresNewAssociation = shouldCreateNewDraftAssociation(identityContext);
    return Object.freeze({
      valid: true,
      requiresNewDraftAssociation: requiresNewAssociation,
      requiresNewAssociation,
      mayReuseSignedInvitationNamespace: Boolean(
        identityContext.invitationId
        && identityContext.recoveryEmailVerificationStatus === 'verified_signed_invitation'
        && !identityContext.signedInvitationEmailChanged
        && !requiresNewAssociation,
      ),
      mustNotSearchReplacementEmail:
        identityContext.associationIntent === 'changed_signed_email',
      errorCode: null,
    });
  } catch (error) {
    return Object.freeze({
      valid: false,
      requiresNewDraftAssociation: false,
      requiresNewAssociation: false,
      mayReuseSignedInvitationNamespace: false,
      mustNotSearchReplacementEmail: false,
      errorCode: error?.code || DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT,
    });
  }
};

export const getSafeClientIdentityContextDiagnostics = (identityContext, errorCode = null) => {
  const diagnostics = getSafeDraftIdentityDiagnostics(identityContext, errorCode);
  return Object.freeze({
    identityVersion: diagnostics.identityVersion,
    identitySource: diagnostics.recoveryEmailSource,
    associationIntent: diagnostics.associationIntent,
    hasRecoveryEmail: diagnostics.hasRecoveryEmail,
    verificationState: diagnostics.recoveryEmailVerificationStatus,
    signedInvitationEmailChanged: diagnostics.signedInvitationEmailChanged,
    anonymousRecoveryAcknowledged: diagnostics.anonymousRecoveryAcknowledged,
    errorCode: diagnostics.errorCode,
  });
};
