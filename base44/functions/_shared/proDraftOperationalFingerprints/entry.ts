/** Purpose-separated, non-authorizing operational fingerprints. */

export const PRO_DRAFT_OPERATIONAL_FINGERPRINT_VERSION = 1;
export const OPERATIONAL_FINGERPRINT_SECRET_NAME = 'PRO_FORM_OPERATIONAL_FINGERPRINT_SECRET';
export const OPERATIONAL_FINGERPRINT_PURPOSES = Object.freeze({
  DRAFT: 'draft', SESSION: 'session', SOURCE_TAB: 'source_tab', ADMIN_GRANT: 'admin_grant',
} as const);

export type OperationalFingerprintPurpose = typeof OPERATIONAL_FINGERPRINT_PURPOSES[keyof typeof OPERATIONAL_FINGERPRINT_PURPOSES];
type CryptoLike = Pick<Crypto, 'subtle'>;

function bytes(value: string): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>; }
function assertSecret(secret: string): void {
  if (typeof secret !== 'string' || bytes(secret).byteLength < 32) throw new Error('OPERATIONAL_FINGERPRINT_SECRET_INVALID');
}

export async function createOperationalFingerprint(
  value: string,
  purpose: OperationalFingerprintPurpose,
  secret: string,
  options: Readonly<{length?: number; cryptoProvider?: CryptoLike}> = {},
): Promise<string> {
  assertSecret(secret);
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new Error('OPERATIONAL_FINGERPRINT_INPUT_INVALID');
  if (!Object.values(OPERATIONAL_FINGERPRINT_PURPOSES).includes(purpose)) throw new Error('OPERATIONAL_FINGERPRINT_PURPOSE_INVALID');
  const length = options.length ?? 16;
  if (!Number.isInteger(length) || length < 12 || length > 16) throw new Error('OPERATIONAL_FINGERPRINT_LENGTH_INVALID');
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
  const key = await cryptoProvider.subtle.importKey('raw', bytes(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = new Uint8Array(await cryptoProvider.subtle.sign('HMAC', key, bytes(`pro-draft-operational:v1:${purpose}:${value}`)));
  return Array.from(signature, (item) => item.toString(16).padStart(2, '0')).join('').slice(0, length);
}

export async function createOperationalFingerprints(
  values: Readonly<{draftId?: string; sessionId?: string; sourceTabId?: string; adminGrantTokenId?: string}>,
  secret: string,
  cryptoProvider?: CryptoLike,
): Promise<Readonly<Record<string, string>>> {
  const entries = await Promise.all([
    ['draft_fingerprint', values.draftId, OPERATIONAL_FINGERPRINT_PURPOSES.DRAFT],
    ['session_fingerprint', values.sessionId, OPERATIONAL_FINGERPRINT_PURPOSES.SESSION],
    ['source_tab_fingerprint', values.sourceTabId, OPERATIONAL_FINGERPRINT_PURPOSES.SOURCE_TAB],
    ['admin_grant_fingerprint', values.adminGrantTokenId, OPERATIONAL_FINGERPRINT_PURPOSES.ADMIN_GRANT],
  ].filter((entry) => entry[1]).map(async ([key, value, purpose]) => [key, await createOperationalFingerprint(value!, purpose as OperationalFingerprintPurpose, secret, {cryptoProvider})]));
  return Object.freeze(Object.fromEntries(entries));
}
