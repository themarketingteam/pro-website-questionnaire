import { safeGetWindowLocationHref } from './browserSafety.js';
import {
  normalizeBusinessDomain,
  normalizeRecoveryEmail,
} from './proDraftIdentity.js';
import { readProQuestionnaireIdentityParams } from './proDraftClientIdentityContext.js';

export const QUESTIONNAIRE_STORAGE_KEY_VERSIONS = Object.freeze({
  CURRENT: 'v5',
  LEGACY_IDENTITY: 'v4',
  LEGACY_GLOBAL: 'v3-global',
});

export const QUESTIONNAIRE_STORAGE_PURPOSES = Object.freeze([
  'redux-state',
  'legacy-session',
  'draft-cache',
  'draft-credentials',
  'failure-backup',
  'migration-marker',
  'submitted-receipt',
]);

export const QUESTIONNAIRE_LEGACY_STORAGE_KEY_VERSIONS = Object.freeze([
  QUESTIONNAIRE_STORAGE_KEY_VERSIONS.LEGACY_IDENTITY,
]);

const PURPOSE_SET = new Set(QUESTIONNAIRE_STORAGE_PURPOSES);
const ANONYMOUS_SESSION_KEY = 'pro-questionnaire:anonymous-launch:v1';
let anonymousLaunchIdentifier = null;
let anonymousFallbackCounter = 0;

const normalizeText = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

const isSafeAnonymousIdentifier = (value) => /^[A-Za-z0-9_.:-]{8,160}$/u.test(
  String(value || ''),
);

const createFreshAnonymousIdentifier = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint32Array(4);
      crypto.getRandomValues(bytes);
      return [...bytes].map((value) => value.toString(16).padStart(8, '0')).join('');
    }
  } catch {
    // Continue with a non-authoritative launch-local identifier.
  }
  anonymousFallbackCounter += 1;
  const performanceNow = typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : 0;
  return `fallback:${Date.now()}:${performanceNow}:${anonymousFallbackCounter}`;
};

/** @param {{ sessionStorage?: Storage | null }} [options] */
export const getStableAnonymousLaunchIdentifier = (options = {}) => {
  const { sessionStorage } = options;
  if (anonymousLaunchIdentifier) return anonymousLaunchIdentifier;
  const storage = sessionStorage ?? globalThis.sessionStorage;
  try {
    const stored = storage?.getItem?.(ANONYMOUS_SESSION_KEY);
    if (isSafeAnonymousIdentifier(stored)) {
      anonymousLaunchIdentifier = stored;
      return anonymousLaunchIdentifier;
    }
  } catch {
    // Storage can be unavailable in private or constrained browsing modes.
  }
  anonymousLaunchIdentifier = createFreshAnonymousIdentifier();
  try { storage?.setItem?.(ANONYMOUS_SESSION_KEY, anonymousLaunchIdentifier); } catch {}
  return anonymousLaunchIdentifier;
};

export const resetAnonymousLaunchIdentifierForTests = () => {
  anonymousLaunchIdentifier = null;
  anonymousFallbackCounter = 0;
};

export const normalizeQuestionnaireDomain = (value) => {
  const result = normalizeBusinessDomain(String(value || ''), { allowEmpty: true });
  if (result.valid) return result.normalizedDomain;
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//iu.test(raw) ? raw : `https://${raw}`,
    );
    return parsed.hostname.toLowerCase().replace(/^www\./u, '').replace(/\.$/u, '');
  } catch {
    return '';
  }
};

export const normalizeQuestionnaireEmailForNamespace = (value) => {
  const result = normalizeRecoveryEmail(String(value || ''), { allowEmpty: true });
  return result.valid ? result.normalizedEmail : '';
};

export const readQuestionnaireIdentityFromUrl = ({
  href = safeGetWindowLocationHref(),
} = {}) => {
  const params = readProQuestionnaireIdentityParams({ href });
  return Object.freeze({
    userId: params.userId,
    userEmail: params.recoveryEmail,
    recoveryEmail: params.recoveryEmail,
    businessName: params.businessName,
    domainName: params.domainName,
    signedInvitationId: '',
    signedInvitationVerified: false,
    currentAuthorizedDraftId: '',
    signedInvitationEmailChanged: false,
  });
};

export const deriveNamespaceSeed = (
  identity = {},
  { anonymousLaunchId = getStableAnonymousLaunchIdentifier() } = {},
) => {
  const signedInvitationChanged = identity.signedInvitationEmailChanged === true
    || identity.associationIntent === 'changed_signed_email'
    || identity.identityAssociationIntent === 'changed_signed_email';
  const signedInvitationVerified = identity.signedInvitationVerified === true
    || identity.recoveryEmailVerificationStatus === 'verified_signed_invitation';
  const invitationId = String(
    identity.verifiedSignedInvitationId || identity.invitationId || identity.signedInvitationId || '',
  ).trim();
  if (signedInvitationVerified && invitationId && !signedInvitationChanged) {
    return `invitation:${invitationId}`;
  }

  const authorizedDraftId = String(
    identity.currentAuthorizedDraftId || identity.authorizedDraftId || '',
  ).trim();
  if (authorizedDraftId) return `draft:${authorizedDraftId}`;

  const userId = String(identity.userId || '').trim();
  if (userId) return `user:${userId}`;

  const domain = normalizeQuestionnaireDomain(identity.normalizedDomain || identity.domainName);
  const businessName = normalizeText(identity.businessName);
  if (domain && businessName) return `business:${domain}|${businessName}`;

  const email = normalizeQuestionnaireEmailForNamespace(
    identity.normalizedRecoveryEmail || identity.recoveryEmail || identity.userEmail,
  );
  if (email) return `email:${email}`;

  return `anonymous:${String(anonymousLaunchId || getStableAnonymousLaunchIdentifier())}`;
};

// This non-cryptographic hash keeps raw identity components out of browser keys.
// It is namespace isolation only and never proof of authorization or ownership.
export const hashNamespaceSeed = (seed) => {
  const input = String(seed || '');
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
    .map((value) => (value >>> 0).toString(16).padStart(8, '0'))
    .join('');
};

export const deriveQuestionnaireBrowserNamespace = (
  identity = readQuestionnaireIdentityFromUrl(),
  options,
) => `ns_${hashNamespaceSeed(deriveNamespaceSeed(identity, options))}`;

const assertStorageKeyInput = (namespace, purpose) => {
  if (!/^ns_[a-f\d]{32}$/.test(String(namespace || ''))) {
    throw new TypeError('INVALID_QUESTIONNAIRE_BROWSER_NAMESPACE');
  }
  if (!PURPOSE_SET.has(purpose)) {
    throw new TypeError('INVALID_QUESTIONNAIRE_STORAGE_PURPOSE');
  }
};

export const buildQuestionnaireStorageKey = ({
  namespace,
  purpose,
  version = QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT,
}) => {
  assertStorageKeyInput(namespace, purpose);
  if (version !== QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT) {
    throw new TypeError('INVALID_QUESTIONNAIRE_STORAGE_KEY_VERSION');
  }
  return `pro-questionnaire:${version}:${namespace}:${purpose}`;
};

export const buildLegacyQuestionnaireStorageKey = ({ namespace, purpose, version }) => {
  assertStorageKeyInput(namespace, purpose);
  if (!QUESTIONNAIRE_LEGACY_STORAGE_KEY_VERSIONS.includes(version)) {
    throw new TypeError('INVALID_QUESTIONNAIRE_LEGACY_STORAGE_KEY_VERSION');
  }
  return `pro-questionnaire:${version}:${namespace}:${purpose}`;
};

export const getLegacyQuestionnaireStorageKeyCandidates = ({ namespace, purpose }) => (
  QUESTIONNAIRE_LEGACY_STORAGE_KEY_VERSIONS.map((version) => Object.freeze({
    version,
    key: buildLegacyQuestionnaireStorageKey({ namespace, purpose, version }),
  }))
);
