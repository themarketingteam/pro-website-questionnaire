import {
  STORAGE_MODES,
  defaultResilientStorage,
} from '@/lib/resilientStorage';

export const PRO_DRAFT_DEVICE_ID_VERSION = 1;
export const PRO_DRAFT_DEVICE_ID_ENTROPY_BITS = 128;

const STORAGE_KEY = 'pro_draft_random_device_id_v1';
const DEVICE_PATTERN = /^pdd_[A-Za-z0-9_-]{22}$/u;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

let memoryDeviceId = null;
let lastMode = STORAGE_MODES.UNKNOWN;

function encodeBase64Url(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64URL_ALPHABET[(combined >>> 18) & 63];
    output += BASE64URL_ALPHABET[(combined >>> 12) & 63];
    if (second !== undefined) output += BASE64URL_ALPHABET[(combined >>> 6) & 63];
    if (third !== undefined) output += BASE64URL_ALPHABET[combined & 63];
  }
  return output;
}

export function validateProDraftDeviceId(value) {
  return typeof value === 'string' && DEVICE_PATTERN.test(value);
}

export function generateProDraftDeviceId(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
    throw new Error('PRO_DRAFT_DEVICE_CRYPTO_UNAVAILABLE');
  }
  const bytes = new Uint8Array(PRO_DRAFT_DEVICE_ID_ENTROPY_BITS / 8);
  cryptoProvider.getRandomValues(bytes);
  return `pdd_${encodeBase64Url(bytes)}`;
}

export async function getOrCreateProDraftDeviceId(options = {}) {
  const storage = options.storage ?? defaultResilientStorage;
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
  try {
    const stored = await storage.getItem(STORAGE_KEY);
    if (validateProDraftDeviceId(stored)) {
      memoryDeviceId = stored;
      lastMode = storage.getMode?.() ?? STORAGE_MODES.UNKNOWN;
      return stored;
    }
  } catch {
    // A page-lifetime random identifier remains available without bypassing IP limits.
  }
  if (!validateProDraftDeviceId(memoryDeviceId)) {
    memoryDeviceId = generateProDraftDeviceId(cryptoProvider);
  }
  try {
    await storage.setItem(STORAGE_KEY, memoryDeviceId);
    lastMode = storage.getMode?.() ?? STORAGE_MODES.UNKNOWN;
  } catch {
    lastMode = STORAGE_MODES.MEMORY_ONLY;
  }
  return memoryDeviceId;
}

export async function clearProDraftDeviceId(options = {}) {
  const storage = options.storage ?? defaultResilientStorage;
  memoryDeviceId = null;
  try {
    await storage.removeItem(STORAGE_KEY);
    lastMode = storage.getMode?.() ?? STORAGE_MODES.UNKNOWN;
    return true;
  } catch {
    lastMode = STORAGE_MODES.MEMORY_ONLY;
    return false;
  }
}

export function getSafeProDraftDeviceDiagnostics() {
  return Object.freeze({
    version: PRO_DRAFT_DEVICE_ID_VERSION,
    entropyBits: PRO_DRAFT_DEVICE_ID_ENTROPY_BITS,
    presentInPageMemory: validateProDraftDeviceId(memoryDeviceId),
    storageMode: lastMode,
    randomIdentifier: true,
    browserFingerprinting: false,
    storesInRedux: false,
    authorizationCredential: false,
  });
}
