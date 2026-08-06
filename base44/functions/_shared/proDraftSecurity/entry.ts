/**
 * Runtime-neutral Web Crypto primitives for durable-draft backend functions.
 *
 * This module performs no I/O, logging, Base44 calls, entity access, or secret
 * lookup. Callers inject purpose-bound secret material at runtime.
 */

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_ENTROPY_BITS,
  RECOVERY_CODE_LENGTH,
  RECOVERY_CODE_VERSION,
  RecoveryCodeContractError,
  encodeRecoveryCodeFromRandomValues,
  formatRecoveryCode,
  normalizeRecoveryCodeInput,
} from '../proDraftIdentity/entry.ts';

export const PRO_DRAFT_SECURITY_VERSION = 1;
export const MIN_HMAC_SECRET_BYTES = 32;
export const MAX_RANDOM_BYTES_PER_CALL = 4096;
export const DEFAULT_OPAQUE_TOKEN_BYTES = 32;
export const HASH_FINGERPRINT_LENGTH = 12;

export const SECURITY_SECRET_NAMES = Object.freeze({
  RECOVERY_CODE: 'PRO_FORM_RECOVERY_CODE_SECRET',
  RECOVERY_EMAIL: 'PRO_FORM_EMAIL_LOOKUP_SECRET',
  RESUME_TOKEN: 'PRO_FORM_DRAFT_TOKEN_SECRET',
} as const);

export const SECURITY_ERROR_CODES = Object.freeze({
  INVALID_STRING: 'PRO_DRAFT_SECURITY_INVALID_STRING',
  INVALID_BYTES: 'PRO_DRAFT_SECURITY_INVALID_BYTES',
  INVALID_UTF8: 'PRO_DRAFT_SECURITY_INVALID_UTF8',
  INVALID_BASE64URL: 'PRO_DRAFT_SECURITY_INVALID_BASE64URL',
  MALFORMED_BASE64URL_LENGTH: 'PRO_DRAFT_SECURITY_MALFORMED_BASE64URL_LENGTH',
  INVALID_HEX: 'PRO_DRAFT_SECURITY_INVALID_HEX',
  INVALID_RANDOM_LENGTH: 'PRO_DRAFT_SECURITY_INVALID_RANDOM_LENGTH',
  RANDOM_LENGTH_EXCEEDED: 'PRO_DRAFT_SECURITY_RANDOM_LENGTH_EXCEEDED',
  CRYPTO_UNAVAILABLE: 'PRO_DRAFT_SECURITY_CRYPTO_UNAVAILABLE',
  CRYPTO_OPERATION_FAILED: 'PRO_DRAFT_SECURITY_CRYPTO_OPERATION_FAILED',
  INVALID_TOKEN_PREFIX: 'PRO_DRAFT_SECURITY_INVALID_TOKEN_PREFIX',
  TOKEN_ENTROPY_TOO_LOW: 'PRO_DRAFT_SECURITY_TOKEN_ENTROPY_TOO_LOW',
  INVALID_SECRET: 'PRO_DRAFT_SECURITY_INVALID_SECRET',
  SECRET_TOO_SHORT: 'PRO_DRAFT_SECURITY_SECRET_TOO_SHORT',
  SECRET_PURPOSE_MISMATCH: 'PRO_DRAFT_SECURITY_SECRET_PURPOSE_MISMATCH',
  RECOVERY_CODE_INVALID: 'PRO_DRAFT_SECURITY_RECOVERY_CODE_INVALID',
  RECOVERY_CODE_RETRY_LIMIT: 'PRO_DRAFT_SECURITY_RECOVERY_CODE_RETRY_LIMIT',
  NORMALIZED_EMAIL_INVALID: 'PRO_DRAFT_SECURITY_NORMALIZED_EMAIL_INVALID',
  RESUME_TOKEN_INVALID: 'PRO_DRAFT_SECURITY_RESUME_TOKEN_INVALID',
  HASH_INVALID: 'PRO_DRAFT_SECURITY_HASH_INVALID',
} as const);

export type SecurityErrorCode = typeof SECURITY_ERROR_CODES[
  keyof typeof SECURITY_ERROR_CODES
];
export type SecuritySecretName = typeof SECURITY_SECRET_NAMES[
  keyof typeof SECURITY_SECRET_NAMES
];
export type ByteInput = Uint8Array | string;
export type SecretMaterial = Uint8Array | string;
export type RandomCryptoProvider = Pick<Crypto, 'getRandomValues'>;
export type SubtleCryptoProvider = Pick<Crypto, 'subtle'>;
export type SecurityCryptoProvider = RandomCryptoProvider & SubtleCryptoProvider;

export type PurposeBoundSecret = Readonly<{
  name: SecuritySecretName;
  value: SecretMaterial;
}>;

export type OpaqueTokenOptions = Readonly<{
  byteLength?: number;
  prefix?: string;
  cryptoProvider?: RandomCryptoProvider;
}>;

export type RecoveryCodeGenerationOptions = Readonly<{
  cryptoProvider?: RandomCryptoProvider;
  randomBatchSize?: number;
  maxAttempts?: number;
}>;

export type SecureRecoveryCode = Readonly<{
  version: number;
  normalizedCode: string;
  formattedCode: string;
  hint: string;
  entropyBits: number;
}>;

export type SafeSecurityDiagnostics = Readonly<{
  version: number;
  randomSource: 'Web Crypto getRandomValues';
  digestAlgorithm: 'SHA-256';
  macAlgorithm: 'HMAC-SHA-256';
  minimumHmacSecretBytes: number;
  defaultOpaqueTokenBytes: number;
  recoveryCodeVersion: number;
  recoveryCodeLength: number;
  recoveryCodeAlphabetSize: number;
  recoveryCodeEntropyBits: number;
}>;

const ERROR_MESSAGES: Readonly<Record<SecurityErrorCode, string>> = Object.freeze({
  [SECURITY_ERROR_CODES.INVALID_STRING]: 'A string input is required.',
  [SECURITY_ERROR_CODES.INVALID_BYTES]: 'A byte-array input is required.',
  [SECURITY_ERROR_CODES.INVALID_UTF8]: 'The byte input is not valid UTF-8.',
  [SECURITY_ERROR_CODES.INVALID_BASE64URL]: 'The Base64URL input is invalid.',
  [SECURITY_ERROR_CODES.MALFORMED_BASE64URL_LENGTH]: 'The Base64URL length is invalid.',
  [SECURITY_ERROR_CODES.INVALID_HEX]: 'The hexadecimal input is invalid.',
  [SECURITY_ERROR_CODES.INVALID_RANDOM_LENGTH]: 'The random-byte length is invalid.',
  [SECURITY_ERROR_CODES.RANDOM_LENGTH_EXCEEDED]: 'The random-byte length exceeds the limit.',
  [SECURITY_ERROR_CODES.CRYPTO_UNAVAILABLE]: 'The required Web Crypto provider is unavailable.',
  [SECURITY_ERROR_CODES.CRYPTO_OPERATION_FAILED]: 'The Web Crypto operation failed.',
  [SECURITY_ERROR_CODES.INVALID_TOKEN_PREFIX]: 'The opaque-token prefix is invalid.',
  [SECURITY_ERROR_CODES.TOKEN_ENTROPY_TOO_LOW]: 'The opaque token requires at least 256 bits of entropy.',
  [SECURITY_ERROR_CODES.INVALID_SECRET]: 'The HMAC secret material is invalid.',
  [SECURITY_ERROR_CODES.SECRET_TOO_SHORT]: 'The HMAC secret material is too short.',
  [SECURITY_ERROR_CODES.SECRET_PURPOSE_MISMATCH]: 'The HMAC secret purpose is invalid.',
  [SECURITY_ERROR_CODES.RECOVERY_CODE_INVALID]: 'The recovery code is invalid.',
  [SECURITY_ERROR_CODES.RECOVERY_CODE_RETRY_LIMIT]: 'Recovery-code generation exhausted its retry limit.',
  [SECURITY_ERROR_CODES.NORMALIZED_EMAIL_INVALID]: 'The normalized recovery email is invalid.',
  [SECURITY_ERROR_CODES.RESUME_TOKEN_INVALID]: 'The resume token is invalid.',
  [SECURITY_ERROR_CODES.HASH_INVALID]: 'The stored hash is invalid.',
});

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*={0,2}$/u;
const BASE64URL_UNPADDED_PATTERN = /^[A-Za-z0-9_-]*$/u;
const HEX_PATTERN = /^[0-9a-f]+$/u;
const TOKEN_PREFIX_PATTERN = /^[a-z][a-z0-9-]{0,30}_$/u;
const RESUME_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CONTROL_OR_WHITESPACE_PATTERN = /[\s\u0000-\u001f\u007f]/u;
const RECOVERY_CODE_DOMAIN = 'pro-draft:recovery-code:v1:';
const RECOVERY_EMAIL_DOMAIN = 'pro-draft:recovery-email:v1:';
const RESUME_TOKEN_DOMAIN = 'pro-draft:resume-token:v1:';
const DEFAULT_RECOVERY_CODE_BATCH_SIZE = 32;
const DEFAULT_RECOVERY_CODE_MAX_ATTEMPTS = 8;
const MAX_RECOVERY_CODE_ATTEMPTS = 64;

export class ProDraftSecurityError extends Error {
  readonly code: SecurityErrorCode;

  constructor(code: SecurityErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ProDraftSecurityError';
    this.code = code;
  }
}

function securityError(code: SecurityErrorCode): never {
  throw new ProDraftSecurityError(code);
}

function requireBytes(value: unknown): Uint8Array {
  if (Object.prototype.toString.call(value) !== '[object Uint8Array]') {
    return securityError(SECURITY_ERROR_CODES.INVALID_BYTES);
  }
  return value as Uint8Array;
}

function requireSubtleCrypto(
  provider: SubtleCryptoProvider | undefined,
): SubtleCrypto {
  if (!provider || !provider.subtle) {
    return securityError(SECURITY_ERROR_CODES.CRYPTO_UNAVAILABLE);
  }
  return provider.subtle;
}

function resolveSubtleProvider(
  provider?: SubtleCryptoProvider,
): SubtleCryptoProvider | undefined {
  return provider ?? globalThis.crypto;
}

function resolveRandomProvider(
  provider?: RandomCryptoProvider,
): RandomCryptoProvider | undefined {
  return provider ?? globalThis.crypto;
}

function byteInput(value: ByteInput): Uint8Array {
  if (typeof value === 'string') return utf8Encode(value);
  return new Uint8Array(requireBytes(value));
}

function cryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function secretBytes(value: SecretMaterial): Uint8Array {
  const bytes = typeof value === 'string'
    ? utf8Encode(value)
    : new Uint8Array(requireBytes(value));
  if (bytes.length === 0) {
    return securityError(SECURITY_ERROR_CODES.INVALID_SECRET);
  }
  if (bytes.length < MIN_HMAC_SECRET_BYTES) {
    return securityError(SECURITY_ERROR_CODES.SECRET_TOO_SHORT);
  }
  return bytes;
}

function requirePurposeSecret(
  secret: PurposeBoundSecret,
  expectedName: SecuritySecretName,
): SecretMaterial {
  if (
    !secret
    || typeof secret !== 'object'
    || secret.name !== expectedName
    || !('value' in secret)
  ) {
    return securityError(SECURITY_ERROR_CODES.SECRET_PURPOSE_MISMATCH);
  }
  return secret.value;
}

function boundedPositiveInteger(
  value: unknown,
  maximum: number,
  invalidCode: SecurityErrorCode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return securityError(invalidCode);
  }
  if ((value as number) > maximum) {
    return securityError(SECURITY_ERROR_CODES.RANDOM_LENGTH_EXCEEDED);
  }
  return value as number;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return output;
}

function decodeBase64(base64: string): Uint8Array {
  try {
    const decoded = globalThis.atob(base64);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return securityError(SECURITY_ERROR_CODES.INVALID_BASE64URL);
  }
}

function validateNormalizedRecoveryEmail(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 254
    || value !== value.trim()
    || CONTROL_OR_WHITESPACE_PATTERN.test(value)
    || value !== value.normalize('NFC')
    || value !== value.toLowerCase()
  ) {
    return securityError(SECURITY_ERROR_CODES.NORMALIZED_EMAIL_INVALID);
  }

  const parts = value.split('@');
  if (parts.length !== 2) {
    return securityError(SECURITY_ERROR_CODES.NORMALIZED_EMAIL_INVALID);
  }
  const [localPart, domain] = parts;
  if (
    localPart.length === 0
    || localPart.length > 64
    || domain.length === 0
    || domain.length > 253
    || domain.includes('..')
  ) {
    return securityError(SECURITY_ERROR_CODES.NORMALIZED_EMAIL_INVALID);
  }
  const labels = domain.split('.');
  if (labels.some((label) => (
    label.length === 0
    || label.length > 63
    || !/^[a-z0-9-]+$/u.test(label)
    || label.startsWith('-')
    || label.endsWith('-')
  ))) {
    return securityError(SECURITY_ERROR_CODES.NORMALIZED_EMAIL_INVALID);
  }
  return value;
}

function validateResumeToken(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 43
    || value.length > 8192
    || !RESUME_TOKEN_PATTERN.test(value)
  ) {
    return securityError(SECURITY_ERROR_CODES.RESUME_TOKEN_INVALID);
  }
  return value;
}

export function utf8Encode(value: string): Uint8Array {
  if (typeof value !== 'string') {
    return securityError(SECURITY_ERROR_CODES.INVALID_STRING);
  }
  return new TextEncoder().encode(value);
}

export function utf8Decode(value: Uint8Array): string {
  const bytes = requireBytes(value);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return securityError(SECURITY_ERROR_CODES.INVALID_UTF8);
  }
}

export function toBase64Url(value: Uint8Array): string {
  const bytes = requireBytes(value);
  if (bytes.length === 0) return '';
  return globalThis.btoa(bytesToBinaryString(bytes))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

export function fromBase64Url(value: string): Uint8Array {
  if (typeof value !== 'string') {
    return securityError(SECURITY_ERROR_CODES.INVALID_STRING);
  }
  if (value === '') return new Uint8Array();
  if (!BASE64URL_PATTERN.test(value) || value.includes('=') && !/=+$/u.test(value)) {
    return securityError(SECURITY_ERROR_CODES.INVALID_BASE64URL);
  }

  const firstPadding = value.indexOf('=');
  const unpadded = firstPadding < 0 ? value : value.slice(0, firstPadding);
  const paddingLength = value.length - unpadded.length;
  if (
    !BASE64URL_UNPADDED_PATTERN.test(unpadded)
    || unpadded.length % 4 === 1
    || (paddingLength > 0 && value.length % 4 !== 0)
    || (paddingLength > 0
      && paddingLength !== ((4 - (unpadded.length % 4)) % 4))
  ) {
    return securityError(SECURITY_ERROR_CODES.MALFORMED_BASE64URL_LENGTH);
  }

  const standard = unpadded.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = standard.padEnd(standard.length + ((4 - standard.length % 4) % 4), '=');
  const decoded = decodeBase64(padded);
  if (toBase64Url(decoded) !== unpadded) {
    return securityError(SECURITY_ERROR_CODES.INVALID_BASE64URL);
  }
  return decoded;
}

export function bytesToHex(value: Uint8Array): string {
  const bytes = requireBytes(value);
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

export function hexToBytes(value: string): Uint8Array {
  if (typeof value !== 'string') {
    return securityError(SECURITY_ERROR_CODES.INVALID_STRING);
  }
  if (value === '') return new Uint8Array();
  if (value.length % 2 !== 0 || !/^[0-9a-fA-F]+$/u.test(value)) {
    return securityError(SECURITY_ERROR_CODES.INVALID_HEX);
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export function generateSecureRandomBytes(
  length: number,
  cryptoProvider?: RandomCryptoProvider,
): Uint8Array {
  const boundedLength = boundedPositiveInteger(
    length,
    MAX_RANDOM_BYTES_PER_CALL,
    SECURITY_ERROR_CODES.INVALID_RANDOM_LENGTH,
  );
  const provider = resolveRandomProvider(cryptoProvider);
  if (!provider || typeof provider.getRandomValues !== 'function') {
    return securityError(SECURITY_ERROR_CODES.CRYPTO_UNAVAILABLE);
  }

  const bytes = new Uint8Array(boundedLength);
  try {
    provider.getRandomValues(bytes);
  } catch {
    return securityError(SECURITY_ERROR_CODES.CRYPTO_OPERATION_FAILED);
  }
  return new Uint8Array(bytes);
}

export function generateOpaqueToken(options: OpaqueTokenOptions = {}): string {
  const byteLength = options.byteLength ?? DEFAULT_OPAQUE_TOKEN_BYTES;
  if (!Number.isSafeInteger(byteLength) || byteLength < DEFAULT_OPAQUE_TOKEN_BYTES) {
    return securityError(SECURITY_ERROR_CODES.TOKEN_ENTROPY_TOO_LOW);
  }
  if (byteLength > MAX_RANDOM_BYTES_PER_CALL) {
    return securityError(SECURITY_ERROR_CODES.RANDOM_LENGTH_EXCEEDED);
  }
  const prefix = options.prefix ?? '';
  if (prefix !== '' && !TOKEN_PREFIX_PATTERN.test(prefix)) {
    return securityError(SECURITY_ERROR_CODES.INVALID_TOKEN_PREFIX);
  }
  return `${prefix}${toBase64Url(
    generateSecureRandomBytes(byteLength, options.cryptoProvider),
  )}`;
}

export async function sha256Bytes(
  input: ByteInput,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<Uint8Array> {
  const subtle = requireSubtleCrypto(resolveSubtleProvider(cryptoProvider));
  try {
    return new Uint8Array(await subtle.digest(
      'SHA-256',
      cryptoBuffer(byteInput(input)),
    ));
  } catch {
    return securityError(SECURITY_ERROR_CODES.CRYPTO_OPERATION_FAILED);
  }
}

export async function sha256Hex(
  input: ByteInput,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  return bytesToHex(await sha256Bytes(input, cryptoProvider));
}

export async function importHmacSha256Key(
  secret: SecretMaterial,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<CryptoKey> {
  const subtle = requireSubtleCrypto(resolveSubtleProvider(cryptoProvider));
  try {
    return await subtle.importKey(
      'raw',
      cryptoBuffer(secretBytes(secret)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch (error) {
    if (error instanceof ProDraftSecurityError) throw error;
    return securityError(SECURITY_ERROR_CODES.CRYPTO_OPERATION_FAILED);
  }
}

export async function hmacSha256Bytes(
  secret: SecretMaterial,
  input: ByteInput,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<Uint8Array> {
  const subtle = requireSubtleCrypto(resolveSubtleProvider(cryptoProvider));
  const key = await importHmacSha256Key(secret, cryptoProvider);
  try {
    return new Uint8Array(await subtle.sign(
      'HMAC',
      key,
      cryptoBuffer(byteInput(input)),
    ));
  } catch {
    return securityError(SECURITY_ERROR_CODES.CRYPTO_OPERATION_FAILED);
  }
}

export async function hmacSha256Hex(
  secret: SecretMaterial,
  input: ByteInput,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  return bytesToHex(await hmacSha256Bytes(secret, input, cryptoProvider));
}

export async function hmacSha256Base64Url(
  secret: SecretMaterial,
  input: ByteInput,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  return toBase64Url(await hmacSha256Bytes(secret, input, cryptoProvider));
}

export function timingSafeEqualBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  const leftBytes = requireBytes(left);
  const rightBytes = requireBytes(right);
  const maximumLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function timingSafeEqualStrings(left: string, right: string): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return securityError(SECURITY_ERROR_CODES.INVALID_STRING);
  }
  return timingSafeEqualBytes(utf8Encode(left), utf8Encode(right));
}

export function generateSecureRecoveryCode(
  options: RecoveryCodeGenerationOptions = {},
): SecureRecoveryCode {
  const randomBatchSize = boundedPositiveInteger(
    options.randomBatchSize ?? DEFAULT_RECOVERY_CODE_BATCH_SIZE,
    MAX_RANDOM_BYTES_PER_CALL,
    SECURITY_ERROR_CODES.INVALID_RANDOM_LENGTH,
  );
  const maxAttempts = options.maxAttempts ?? DEFAULT_RECOVERY_CODE_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts)
    || maxAttempts <= 0
    || maxAttempts > MAX_RECOVERY_CODE_ATTEMPTS
  ) {
    return securityError(SECURITY_ERROR_CODES.INVALID_RANDOM_LENGTH);
  }

  const randomValues: number[] = [];
  let normalizedCode = '';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    randomValues.push(...generateSecureRandomBytes(
      randomBatchSize,
      options.cryptoProvider,
    ));
    try {
      normalizedCode = encodeRecoveryCodeFromRandomValues(randomValues);
      break;
    } catch (error) {
      if (!(error instanceof RecoveryCodeContractError)) throw error;
    }
  }
  if (normalizedCode === '') {
    return securityError(SECURITY_ERROR_CODES.RECOVERY_CODE_RETRY_LIMIT);
  }

  return Object.freeze({
    version: RECOVERY_CODE_VERSION,
    normalizedCode,
    formattedCode: formatRecoveryCode(normalizedCode),
    hint: normalizedCode.slice(-4),
    entropyBits: RECOVERY_CODE_ENTROPY_BITS,
  });
}

export async function hashRecoveryCode(
  input: unknown,
  secret: PurposeBoundSecret,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  const normalized = normalizeRecoveryCodeInput(input);
  if (!normalized.valid) {
    return securityError(SECURITY_ERROR_CODES.RECOVERY_CODE_INVALID);
  }
  return hmacSha256Hex(
    requirePurposeSecret(secret, SECURITY_SECRET_NAMES.RECOVERY_CODE),
    `${RECOVERY_CODE_DOMAIN}${normalized.normalizedCode}`,
    cryptoProvider,
  );
}

export async function hashNormalizedRecoveryEmail(
  input: unknown,
  secret: PurposeBoundSecret,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  const normalizedEmail = validateNormalizedRecoveryEmail(input);
  return hmacSha256Hex(
    requirePurposeSecret(secret, SECURITY_SECRET_NAMES.RECOVERY_EMAIL),
    `${RECOVERY_EMAIL_DOMAIN}${normalizedEmail}`,
    cryptoProvider,
  );
}

export async function hashResumeToken(
  input: unknown,
  secret: PurposeBoundSecret,
  cryptoProvider?: SubtleCryptoProvider,
): Promise<string> {
  const token = validateResumeToken(input);
  return hmacSha256Hex(
    requirePurposeSecret(secret, SECURITY_SECRET_NAMES.RESUME_TOKEN),
    `${RESUME_TOKEN_DOMAIN}${token}`,
    cryptoProvider,
  );
}

export function getHashFingerprint(hash: unknown): string {
  if (typeof hash !== 'string' || hash.length !== 64 || !HEX_PATTERN.test(hash)) {
    return securityError(SECURITY_ERROR_CODES.HASH_INVALID);
  }
  return hash.slice(0, HASH_FINGERPRINT_LENGTH);
}

export function getSafeSecurityDiagnostics(): SafeSecurityDiagnostics {
  return Object.freeze({
    version: PRO_DRAFT_SECURITY_VERSION,
    randomSource: 'Web Crypto getRandomValues',
    digestAlgorithm: 'SHA-256',
    macAlgorithm: 'HMAC-SHA-256',
    minimumHmacSecretBytes: MIN_HMAC_SECRET_BYTES,
    defaultOpaqueTokenBytes: DEFAULT_OPAQUE_TOKEN_BYTES,
    recoveryCodeVersion: RECOVERY_CODE_VERSION,
    recoveryCodeLength: RECOVERY_CODE_LENGTH,
    recoveryCodeAlphabetSize: RECOVERY_CODE_ALPHABET.length,
    recoveryCodeEntropyBits: RECOVERY_CODE_ENTROPY_BITS,
  });
}
