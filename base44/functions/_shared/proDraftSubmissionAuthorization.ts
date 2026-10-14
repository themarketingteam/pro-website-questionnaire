const encoder = new TextEncoder();

const cleanText = (value: unknown, maxLength = 500) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export const hashDraftSubmissionValue = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
};

const constantTimeEqual = (left: string, right: string) => {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const safeParse = (value: unknown, fallback: unknown) => {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const parseSharedHashes = (value: unknown) => {
  const parsed = safeParse(value, []);
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
};

const parseCredential = (value: unknown) => {
  const text = cleanText(value, 400);
  const separator = text.indexOf('.');
  if (separator < 1) return null;
  const sessionId = text.slice(0, separator);
  const secret = text.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(sessionId) || !/^[A-Za-z0-9_-]{32,160}$/.test(secret)) return null;
  return { sessionId, secret };
};

export const normalizeSubmissionDomain = (value: unknown) => cleanText(value, 500)
  .replace(/^https?:\/\//i, '')
  .replace(/^www\./i, '')
  .split(/[/?#]/)[0]
  .replace(/\.$/, '')
  .toLowerCase();

export const normalizeSubmissionBusinessName = (value: unknown) => cleanText(value, 300)
  .toLowerCase()
  .replace(/\s+/g, ' ');

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue((value as Record<string, unknown>)[key]);
        return result;
      }, {} as Record<string, unknown>);
  }
  return value;
};

export const getSubmissionIdentity = (payload: any, submitContext: any = {}) => ({
  businessName: cleanText(payload?.metadata?.business_name || submitContext?.business_name, 300),
  domain: normalizeSubmissionDomain(payload?.metadata?.businessDomain || submitContext?.domain)
});

export const createSubmissionIdentityFingerprint = async (identity: any) => hashDraftSubmissionValue(
  JSON.stringify({
    businessName: normalizeSubmissionBusinessName(identity?.businessName),
    domain: normalizeSubmissionDomain(identity?.domain)
  })
);

export const createSubmissionContentFingerprint = async ({ payload, rawResponses, draftId, identity }: any) => {
  const content = payload?.userdata && typeof payload.userdata === 'object'
    ? payload.userdata
    : rawResponses && typeof rawResponses === 'object'
      ? rawResponses
      : {};
  return hashDraftSubmissionValue(JSON.stringify(stableValue({
    draftId: cleanText(draftId, 300),
    businessName: normalizeSubmissionBusinessName(identity?.businessName),
    domain: normalizeSubmissionDomain(identity?.domain),
    content
  })));
};

export const authorizeDraftSubmission = async ({
  base44,
  resumeCredential,
  expectedDraftId,
  payload,
  submitContext
}: any) => {
  const credential = parseCredential(resumeCredential);
  if (!credential) {
    return { authorized: false, status: 401, code: 'DRAFT_CREDENTIAL_REQUIRED', error: 'A valid draft recovery credential is required.' };
  }
  const suppliedHash = await hashDraftSubmissionValue(credential.secret);
  const candidates = await base44.asServiceRole.entities.ProFormDraft.filter(
    { session_id: credential.sessionId },
    '-last_saved_at',
    20
  );
  const draft = (Array.isArray(candidates) ? candidates : []).find((candidate) => (
    candidate?.id
    && (!expectedDraftId || candidate.id === expectedDraftId)
    && (
      constantTimeEqual(String(candidate.access_token_hash || ''), suppliedHash)
      || parseSharedHashes(candidate.shared_access_token_hashes_json)
        .some((storedHash) => constantTimeEqual(storedHash, suppliedHash))
    )
  ));
  if (!draft?.id) {
    return { authorized: false, status: 401, code: 'DRAFT_CREDENTIAL_REJECTED', error: 'The draft recovery credential does not match the submitted draft.' };
  }
  if (cleanText(draft.soft_deleted_at, 100)) {
    return { authorized: false, status: 410, code: 'DRAFT_REMOVED', error: 'This questionnaire draft was removed by an administrator.' };
  }

  const identity = getSubmissionIdentity(payload, submitContext);
  const draftName = normalizeSubmissionBusinessName(draft.business_name);
  const draftDomain = normalizeSubmissionDomain(draft.domain);
  const submittedName = normalizeSubmissionBusinessName(identity.businessName);
  const submittedDomain = normalizeSubmissionDomain(identity.domain);
  const conflicts: string[] = [];
  if (draftName && submittedName && draftName !== submittedName) conflicts.push('businessName');
  if (draftDomain && submittedDomain && draftDomain !== submittedDomain) conflicts.push('domain');
  if (conflicts.length > 0) {
    return {
      authorized: false,
      status: 409,
      code: 'SUBMISSION_IDENTITY_CONFLICT',
      error: 'The submission identity does not match the secured questionnaire draft.',
      conflictFields: conflicts
    };
  }
  return { authorized: true, draft, identity };
};
