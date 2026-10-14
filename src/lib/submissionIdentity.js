const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
};

const normalizeBusinessName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeDomain = (value) => String(value || '')
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/^www\./i, '')
  .split(/[/?#]/)[0]
  .replace(/\.$/, '')
  .toLowerCase();

const toBase64Url = (bytes) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest));
};

export const createClientSubmissionFingerprint = async ({
  payload,
  rawResponses,
  draftId,
  businessName,
  domain
}) => sha256(JSON.stringify(stableValue({
  draftId: String(draftId || '').trim(),
  businessName: normalizeBusinessName(businessName),
  domain: normalizeDomain(domain),
  content: payload?.userdata && typeof payload.userdata === 'object'
    ? payload.userdata
    : rawResponses && typeof rawResponses === 'object'
      ? rawResponses
      : {}
})));

export const createSubmissionAttemptId = (contentFingerprint) => (
  `pro_submit_${String(contentFingerprint || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`
);
