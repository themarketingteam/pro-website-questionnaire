const MISSING_IDENTITY_VALUES = new Set([
  '',
  'unknown',
  'null',
  'undefined',
  'n/a',
  'na',
  'none',
  '-',
  '—',
  'unnamed business',
  'unknown business',
  'unknown domain'
]);

const SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';
const INTERNAL_SCOPE = 'pro-identity-resolver-internal';
const GRANT_VERSION = 1;
const INTERNAL_TTL_SECONDS = 120;
const encoder = new TextEncoder();

const toBase64Url = (value: Uint8Array) => {
  let binary = '';
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export const isMissingIdentityValue = (value: unknown) => (
  typeof value !== 'string' || MISSING_IDENTITY_VALUES.has(value.trim().toLowerCase())
);

const centralTimeParts = (date: Date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
);

export const centralDateKey = (date: Date) => {
  const parts: any = centralTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const isCentralFourAmWeekday = (date: Date) => {
  const parts: any = centralTimeParts(date);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday)
    && parts.hour === '04'
    && Number(parts.minute) < 15;
};

export const createIdentityResolverInternalGrant = async ({
  recordType,
  recordId,
  trigger,
  apply
}: any) => {
  const secret = Deno.env.get(SECRET_NAME) || '';
  if (!secret) throw new Error('identity_internal_signing_unconfigured');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    version: GRANT_VERSION,
    scope: INTERNAL_SCOPE,
    issuedAt,
    expiresAt: issuedAt + INTERNAL_TTL_SECONDS,
    recordType,
    recordId,
    trigger,
    apply: Boolean(apply)
  };
  const payloadPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadPart));
  return `${payloadPart}.${toBase64Url(new Uint8Array(signature))}`;
};
