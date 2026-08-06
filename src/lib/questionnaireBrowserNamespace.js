import { safeGetWindowLocationHref } from '@/lib/browserSafety';

export const QUESTIONNAIRE_STORAGE_KEY_VERSIONS = Object.freeze({
  CURRENT: 'v4',
  LEGACY_GLOBAL: 'v3-global',
});

export const QUESTIONNAIRE_STORAGE_PURPOSES = Object.freeze([
  'redux-state',
  'legacy-session',
  'draft-cache',
  'failure-backup',
  'migration-marker',
  'submitted-receipt',
]);

const PURPOSE_SET = new Set(QUESTIONNAIRE_STORAGE_PURPOSES);
let anonymousLaunchIdentifier = null;

/**
 * @typedef {{
 *   userId?: string,
 *   userEmail?: string,
 *   businessName?: string,
 *   domainName?: string,
 *   signedInvitationId?: string,
 * }} QuestionnaireIdentity
 */

const normalizeText = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

const createAnonymousLaunchIdentifier = () => {
  if (anonymousLaunchIdentifier) return anonymousLaunchIdentifier;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      anonymousLaunchIdentifier = crypto.randomUUID();
      return anonymousLaunchIdentifier;
    }
  } catch {
    // Continue with a launch-local identifier.
  }
  anonymousLaunchIdentifier = [Date.now(), Math.random(), Math.random()].join(':');
  return anonymousLaunchIdentifier;
};

export const normalizeQuestionnaireDomain = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return raw
      .toLowerCase()
      .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
      .replace(/^www\./, '')
      .split(/[/?#]/, 1)[0]
      .replace(/:\d+$/, '')
      .replace(/\.$/, '');
  }
};

export const normalizeQuestionnaireEmailForNamespace = (value) => normalizeText(value);

export const readQuestionnaireIdentityFromUrl = ({
  href = safeGetWindowLocationHref(),
} = {}) => {
  try {
    const url = new URL(href || '/', 'https://questionnaire.invalid');
    return Object.freeze({
      userId: String(url.searchParams.get('userId') || '').trim(),
      userEmail: String(url.searchParams.get('userEmail') || '').trim(),
      businessName: String(url.searchParams.get('businessName') || '').trim(),
      domainName: String(url.searchParams.get('domainName') || '').trim(),
      signedInvitationId: '',
    });
  } catch {
    return Object.freeze({
      userId: '',
      userEmail: '',
      businessName: '',
      domainName: '',
      signedInvitationId: '',
    });
  }
};

/**
 * @param {QuestionnaireIdentity} [identity]
 * @param {{ anonymousLaunchId?: string }} [options]
 */
export const deriveNamespaceSeed = (
  identity = {},
  { anonymousLaunchId = createAnonymousLaunchIdentifier() } = {},
) => {
  const invitationId = String(identity?.signedInvitationId || '').trim();
  if (invitationId) return `invitation:${invitationId}`;

  const userId = String(identity?.userId || '').trim();
  if (userId) return `user:${userId}`;

  const domain = normalizeQuestionnaireDomain(identity?.domainName);
  const businessName = normalizeText(identity?.businessName);
  if (domain && businessName) return `business:${domain}|${businessName}`;

  const email = normalizeQuestionnaireEmailForNamespace(identity?.userEmail);
  if (email) return `email:${email}`;

  return `anonymous:${String(anonymousLaunchId || createAnonymousLaunchIdentifier())}`;
};

// cyrb128 is a deterministic 128-bit non-cryptographic hash. It is used only
// to keep raw identity components out of browser keys. The result is not a
// secret, authorization decision, invitation proof, or recovery credential.
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

  const values = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1];
  return values.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
};

/**
 * @param {QuestionnaireIdentity} [identity]
 * @param {{ anonymousLaunchId?: string }} [options]
 */
export const deriveQuestionnaireBrowserNamespace = (
  identity = readQuestionnaireIdentityFromUrl(),
  options,
) => `ns_${hashNamespaceSeed(deriveNamespaceSeed(identity, options))}`;

/** @param {{ namespace?: string, purpose?: string, version?: string }} options */
export const buildQuestionnaireStorageKey = ({
  namespace,
  purpose,
  version = QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT,
}) => {
  if (!/^ns_[a-f\d]{32}$/.test(String(namespace || ''))) {
    throw new TypeError('INVALID_QUESTIONNAIRE_BROWSER_NAMESPACE');
  }
  if (!PURPOSE_SET.has(purpose)) {
    throw new TypeError('INVALID_QUESTIONNAIRE_STORAGE_PURPOSE');
  }
  if (version !== QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT) {
    throw new TypeError('INVALID_QUESTIONNAIRE_STORAGE_KEY_VERSION');
  }
  return `pro-questionnaire:${version}:${namespace}:${purpose}`;
};
