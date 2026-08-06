import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPAQUE_TOKEN_BYTES,
  MIN_HMAC_SECRET_BYTES,
  PRO_DRAFT_SECURITY_VERSION,
  ProDraftSecurityError,
  SECURITY_ERROR_CODES,
  SECURITY_SECRET_NAMES,
  bytesToHex,
  fromBase64Url,
  generateOpaqueToken,
  generateSecureRandomBytes,
  generateSecureRecoveryCode,
  getHashFingerprint,
  getSafeSecurityDiagnostics,
  hashNormalizedRecoveryEmail,
  hashRecoveryCode,
  hashResumeToken,
  hexToBytes,
  hmacSha256Base64Url,
  hmacSha256Hex,
  importHmacSha256Key,
  sha256Bytes,
  sha256Hex,
  timingSafeEqualBytes,
  timingSafeEqualStrings,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from '../../base44/functions/_shared/proDraftSecurity/entry.ts';

const syntheticSecret = (name, character) => Object.freeze({
  name,
  value: character.repeat(MIN_HMAC_SECRET_BYTES),
});

const recoveryCodeSecret = syntheticSecret(
  SECURITY_SECRET_NAMES.RECOVERY_CODE,
  'r',
);
const recoveryEmailSecret = syntheticSecret(
  SECURITY_SECRET_NAMES.RECOVERY_EMAIL,
  'e',
);
const resumeTokenSecret = syntheticSecret(
  SECURITY_SECRET_NAMES.RESUME_TOKEN,
  't',
);

const deterministicRandomProvider = (...batches) => {
  let call = 0;
  return {
    get callCount() {
      return call;
    },
    getRandomValues(bytes) {
      const values = batches[Math.min(call, batches.length - 1)] ?? [];
      call += 1;
      bytes.fill(0);
      bytes.set(Uint8Array.from(values).subarray(0, bytes.length));
      return bytes;
    },
  };
};

const expectSecurityCode = (action, code) => {
  try {
    action();
    throw new Error('Expected security operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProDraftSecurityError);
    expect(error.code).toBe(code);
  }
};

describe('backend Base64URL and byte encodings', () => {
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('matches the RFC 4648 vector for %j', (plainText, encoded) => {
    expect(toBase64Url(utf8Encode(plainText))).toBe(encoded);
    expect(utf8Decode(fromBase64Url(encoded))).toBe(plainText);
  });

  it('accepts canonical padded and unpadded Base64URL', () => {
    expect(utf8Decode(fromBase64Url('Zg'))).toBe('f');
    expect(utf8Decode(fromBase64Url('Zg=='))).toBe('f');
    expect(utf8Decode(fromBase64Url('Zm8'))).toBe('fo');
    expect(utf8Decode(fromBase64Url('Zm8='))).toBe('fo');
  });

  it.each(['+', '/', 'a=b', 'A', 'Zg=', 'Z===', 'AB'])(
    'rejects invalid or noncanonical Base64URL %j',
    (input) => {
      expect(() => fromBase64Url(input)).toThrow(ProDraftSecurityError);
    },
  );

  it('handles empty arrays and strict hexadecimal round trips', () => {
    expect(toBase64Url(new Uint8Array())).toBe('');
    expect(fromBase64Url('')).toEqual(new Uint8Array());
    expect(bytesToHex(new Uint8Array())).toBe('');
    expect(hexToBytes('')).toEqual(new Uint8Array());
    expect(bytesToHex(hexToBytes('00aBff'))).toBe('00abff');
    expect(() => hexToBytes('abc')).toThrowError(
      expect.objectContaining({ code: SECURITY_ERROR_CODES.INVALID_HEX }),
    );
    expect(() => hexToBytes('zz')).toThrowError(
      expect.objectContaining({ code: SECURITY_ERROR_CODES.INVALID_HEX }),
    );
  });

  it('rejects malformed UTF-8 without replacement decoding', () => {
    expect(() => utf8Decode(Uint8Array.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: SECURITY_ERROR_CODES.INVALID_UTF8 }),
    );
  });
});

describe('backend Web Crypto random and opaque-token generation', () => {
  it('returns a fresh random byte array of the requested length', () => {
    const provider = deterministicRandomProvider([1, 2, 3, 4]);
    const bytes = generateSecureRandomBytes(4, provider);
    expect(bytes).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid random length %p', (length) => {
    expectSecurityCode(
      () => generateSecureRandomBytes(length),
      SECURITY_ERROR_CODES.INVALID_RANDOM_LENGTH,
    );
  });

  it('rejects excessive allocation and unavailable providers', () => {
    expectSecurityCode(
      () => generateSecureRandomBytes(4097),
      SECURITY_ERROR_CODES.RANDOM_LENGTH_EXCEEDED,
    );
    expectSecurityCode(
      () => generateSecureRandomBytes(32, {}),
      SECURITY_ERROR_CODES.CRYPTO_UNAVAILABLE,
    );
  });

  it('creates an unpadded 256-bit opaque token with an optional safe prefix', () => {
    const provider = deterministicRandomProvider(
      Array.from({ length: DEFAULT_OPAQUE_TOKEN_BYTES }, (_, index) => index),
    );
    const token = generateOpaqueToken({ prefix: 'pdrt_', cryptoProvider: provider });
    expect(token).toMatch(/^pdrt_[A-Za-z0-9_-]{43}$/u);
    expect(token).not.toContain('=');
    expect(fromBase64Url(token.slice('pdrt_'.length))).toHaveLength(32);
  });

  it('rejects weak token lengths and unsafe prefixes', () => {
    expectSecurityCode(
      () => generateOpaqueToken({ byteLength: 31 }),
      SECURITY_ERROR_CODES.TOKEN_ENTROPY_TOO_LOW,
    );
    expectSecurityCode(
      () => generateOpaqueToken({ prefix: 'Draft ID: ' }),
      SECURITY_ERROR_CODES.INVALID_TOKEN_PREFIX,
    );
  });

  it('produces unique opaque tokens in a synthetic smoke sample', () => {
    const tokens = new Set(
      Array.from({ length: 128 }, () => generateOpaqueToken()),
    );
    expect(tokens.size).toBe(128);
  });
});

describe('backend SHA-256 and HMAC-SHA-256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ])('matches the SHA-256 vector for %j', async (input, expected) => {
    expect(await sha256Hex(input)).toBe(expected);
    expect(bytesToHex(await sha256Bytes(utf8Encode(input)))).toBe(expected);
  });

  it('matches RFC 4231 HMAC-SHA-256 test case 6', async () => {
    const secret = Uint8Array.from({ length: 131 }, () => 0xaa);
    const input = 'Test Using Larger Than Block-Size Key - Hash Key First';
    const expected = '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54';
    expect(await hmacSha256Hex(secret, input)).toBe(expected);
    expect(fromBase64Url(await hmacSha256Base64Url(secret, input)))
      .toEqual(hexToBytes(expected));
  });

  it('imports nonextractable signing-only HMAC keys', async () => {
    const key = await importHmacSha256Key('k'.repeat(MIN_HMAC_SECRET_BYTES));
    expect(key.algorithm.name).toBe('HMAC');
    expect(key.extractable).toBe(false);
    expect(key.usages).toEqual(['sign']);
  });

  it('rejects empty and short HMAC secrets without trimming', async () => {
    await expect(importHmacSha256Key('')).rejects.toMatchObject({
      code: SECURITY_ERROR_CODES.INVALID_SECRET,
    });
    await expect(importHmacSha256Key('short')).rejects.toMatchObject({
      code: SECURITY_ERROR_CODES.SECRET_TOO_SHORT,
    });
    await expect(importHmacSha256Key(`  ${'x'.repeat(30)}`)).resolves.toBeDefined();
  });

  it('separates identical inputs by independent secret material', async () => {
    const input = 'same-synthetic-input';
    const first = await hmacSha256Hex('a'.repeat(32), input);
    const second = await hmacSha256Hex('b'.repeat(32), input);
    expect(first).not.toBe(second);
  });
});

describe('backend timing-safe comparisons', () => {
  const baseline = Uint8Array.from([1, 2, 3, 4]);

  it('compares equal bytes and empty arrays', () => {
    expect(timingSafeEqualBytes(baseline, Uint8Array.from(baseline))).toBe(true);
    expect(timingSafeEqualBytes(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it('compares first-byte, last-byte, and length differences', () => {
    expect(timingSafeEqualBytes(baseline, Uint8Array.from([0, 2, 3, 4]))).toBe(false);
    expect(timingSafeEqualBytes(baseline, Uint8Array.from([1, 2, 3, 0]))).toBe(false);
    expect(timingSafeEqualBytes(baseline, Uint8Array.from([1, 2, 3]))).toBe(false);
  });

  it('encodes strings consistently without normalizing them', () => {
    expect(timingSafeEqualStrings('same', 'same')).toBe(true);
    expect(timingSafeEqualStrings('Same', 'same')).toBe(false);
    expect(timingSafeEqualStrings('\u00e9', 'e\u0301')).toBe(false);
  });
});

describe('secure recovery-code generation', () => {
  it('uses the approved deterministic alphabet, format, hint, and entropy', () => {
    const provider = deterministicRandomProvider(
      Array.from({ length: 32 }, (_, index) => index),
    );
    const result = generateSecureRecoveryCode({ cryptoProvider: provider });
    expect(result).toEqual({
      version: 1,
      normalizedCode: '23456789ABCDEFGHJKMN',
      formattedCode: '2345-6789-ABCD-EFGH-JKMN',
      hint: 'JKMN',
      entropyBits: 20 * Math.log2(31),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects bytes 248 through 255 and accepts boundary byte 247', () => {
    const values = [
      248, 249, 250, 251, 252, 253, 254, 255, 247,
      ...Array.from({ length: 19 }, (_, index) => index),
    ];
    const result = generateSecureRecoveryCode({
      cryptoProvider: deterministicRandomProvider(values),
    });
    expect(result.normalizedCode).toBe('Z23456789ABCDEFGHJKM');
  });

  it('requests another secure batch after insufficient accepted symbols', () => {
    const provider = deterministicRandomProvider(
      Array.from({ length: 32 }, () => 255),
      Array.from({ length: 32 }, (_, index) => index),
    );
    const result = generateSecureRecoveryCode({
      cryptoProvider: provider,
      maxAttempts: 2,
    });
    expect(provider.callCount).toBe(2);
    expect(result.formattedCode).toBe('2345-6789-ABCD-EFGH-JKMN');
  });

  it('fails with a value-free typed error after the retry bound', () => {
    const provider = deterministicRandomProvider(
      Array.from({ length: 32 }, () => 255),
    );
    expectSecurityCode(
      () => generateSecureRecoveryCode({ cryptoProvider: provider, maxAttempts: 2 }),
      SECURITY_ERROR_CODES.RECOVERY_CODE_RETRY_LIMIT,
    );
    expect(provider.callCount).toBe(2);
  });

  it('emits no ambiguous characters and is unique in a smoke sample', () => {
    const codes = Array.from({ length: 256 }, () => generateSecureRecoveryCode());
    expect(new Set(codes.map(({ normalizedCode }) => normalizedCode)).size).toBe(256);
    for (const code of codes) {
      expect(code.normalizedCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{20}$/u);
      expect(code.normalizedCode).not.toMatch(/[01ILO]/u);
    }
  });
});

describe('purpose-separated durable-draft hashes', () => {
  it('normalizes approved recovery-code input before stable hashing', async () => {
    const normalized = '23456789ABCDEFGHJKMN';
    const formatted = '2345-6789-ABCD-EFGH-JKMN';
    expect(await hashRecoveryCode(normalized, recoveryCodeSecret))
      .toBe(await hashRecoveryCode(formatted, recoveryCodeSecret));
  });

  it('hashes only an already-normalized recovery email', async () => {
    const normalized = 'synthetic.person+draft@example.test';
    const first = await hashNormalizedRecoveryEmail(normalized, recoveryEmailSecret);
    const second = await hashNormalizedRecoveryEmail(normalized, recoveryEmailSecret);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    await expect(
      hashNormalizedRecoveryEmail('Synthetic.Person@EXAMPLE.TEST', recoveryEmailSecret),
    ).rejects.toMatchObject({
      code: SECURITY_ERROR_CODES.NORMALIZED_EMAIL_INVALID,
    });
    await expect(
      hashNormalizedRecoveryEmail('person\u00a0@example.test', recoveryEmailSecret),
    ).rejects.toMatchObject({
      code: SECURITY_ERROR_CODES.NORMALIZED_EMAIL_INVALID,
    });
  });

  it('hashes a structurally valid high-entropy resume token consistently', async () => {
    const token = generateOpaqueToken({ prefix: 'pdrt_' });
    const first = await hashResumeToken(token, resumeTokenSecret);
    const second = await hashResumeToken(token, resumeTokenSecret);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    await expect(hashResumeToken('short', resumeTokenSecret)).rejects.toMatchObject({
      code: SECURITY_ERROR_CODES.RESUME_TOKEN_INVALID,
    });
  });

  it('enforces the declared secret name for every hash purpose', async () => {
    await expect(
      hashRecoveryCode('23456789ABCDEFGHJKMN', recoveryEmailSecret),
    ).rejects.toMatchObject({
      code: SECURITY_ERROR_CODES.SECRET_PURPOSE_MISMATCH,
    });
    await expect(
      hashNormalizedRecoveryEmail('person@example.test', resumeTokenSecret),
    ).rejects.toMatchObject({
      code: SECURITY_ERROR_CODES.SECRET_PURPOSE_MISMATCH,
    });
    await expect(
      hashResumeToken(generateOpaqueToken(), recoveryCodeSecret),
    ).rejects.toMatchObject({
      code: SECURITY_ERROR_CODES.SECRET_PURPOSE_MISMATCH,
    });
  });

  it('uses independent domain separators as well as independent secrets', async () => {
    const logicalValue = 'same-synthetic-input';
    const sameSecret = 's'.repeat(32);
    const codePurpose = await hmacSha256Hex(
      sameSecret,
      `pro-draft:recovery-code:v1:${logicalValue}`,
    );
    const emailPurpose = await hmacSha256Hex(
      sameSecret,
      `pro-draft:recovery-email:v1:${logicalValue}`,
    );
    const tokenPurpose = await hmacSha256Hex(
      sameSecret,
      `pro-draft:resume-token:v1:${logicalValue}`,
    );
    expect(new Set([codePurpose, emailPurpose, tokenPurpose]).size).toBe(3);
  });

  it('never includes raw sensitive input in typed error text', async () => {
    const rawCodeMarker = 'RAW-CODE-MARKER';
    const rawEmailMarker = 'RAW-EMAIL-MARKER';
    const rawTokenMarker = 'RAW-TOKEN-MARKER';
    const errors = await Promise.all([
      hashRecoveryCode(rawCodeMarker, recoveryCodeSecret).catch((error) => error),
      hashNormalizedRecoveryEmail(rawEmailMarker, recoveryEmailSecret)
        .catch((error) => error),
      hashResumeToken(rawTokenMarker, resumeTokenSecret).catch((error) => error),
    ]);
    const serialized = errors.map((error) => `${error.code}:${error.message}`).join('|');
    expect(serialized).not.toContain(rawCodeMarker);
    expect(serialized).not.toContain(rawEmailMarker);
    expect(serialized).not.toContain(rawTokenMarker);
  });
});

describe('safe security diagnostics and source constraints', () => {
  it('returns only frozen, nonsecret algorithm metadata', () => {
    const diagnostics = getSafeSecurityDiagnostics();
    expect(diagnostics).toEqual({
      version: PRO_DRAFT_SECURITY_VERSION,
      randomSource: 'Web Crypto getRandomValues',
      digestAlgorithm: 'SHA-256',
      macAlgorithm: 'HMAC-SHA-256',
      minimumHmacSecretBytes: 32,
      defaultOpaqueTokenBytes: 32,
      recoveryCodeVersion: 1,
      recoveryCodeLength: 20,
      recoveryCodeAlphabetSize: 31,
      recoveryCodeEntropyBits: 20 * Math.log2(31),
    });
    expect(Object.isFrozen(diagnostics)).toBe(true);
  });

  it('returns a short hash fingerprint and rejects raw or malformed input', () => {
    const hash = 'abcdef0123456789'.repeat(4);
    expect(getHashFingerprint(hash)).toBe('abcdef012345');
    expectSecurityCode(
      () => getHashFingerprint('person@example.test'),
      SECURITY_ERROR_CODES.HASH_INVALID,
    );
  });

  it('contains no insecure randomness, legacy digest, logging, or Base44 operation', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'base44/functions/_shared/proDraftSecurity/entry.ts',
      ),
      'utf8',
    );
    expect(source).not.toMatch(/Math\s*\.\s*random\s*\(/u);
    expect(source).not.toMatch(/\b(?:MD5|SHA-1)\b/u);
    expect(source).not.toMatch(/console\s*\./u);
    expect(source).not.toMatch(/@base44\/sdk|createClientFromRequest|entities\./u);
    expect(source).not.toMatch(/Deno\.env|process\.env/u);
  });
});
