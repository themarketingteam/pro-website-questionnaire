# Backend cryptography contract

- Contract version: `1`
- Module: `base44/functions/_shared/proDraftSecurity/entry.ts`
- Runtime target: Base44 Deno Web Crypto and Node/Vitest Web Crypto
- Deployment status: shared source remains endpoint-free; a drift-tested copy is exercised only by the staging admin self-check

## Scope and security boundary

The shared module supplies cryptographic primitives for later draft bootstrap, save, invitation, recovery, and administration functions. It performs no environment lookup, Base44 call, entity mutation, authorization decision, logging, token storage, or public response handling. Callers inject secret material at runtime and remain responsible for authorization, rate limits, lifecycle checks, audit policy, and safe persistence.

Hashes and fingerprints are identifiers or integrity/lookup material. They are not authentication, proof of email ownership, proof of client identity, or authorization to read a draft.

## Algorithms and formats

| Purpose | Algorithm/source | Stored or returned format |
| --- | --- | --- |
| Random bytes | Web Crypto `crypto.getRandomValues` | New `Uint8Array` |
| Opaque resume token | At least 32 random bytes | Unpadded Base64URL, optionally preceded by a nonsecret purpose prefix such as `pdrt_` |
| General digest/state hash | SHA-256 | Lowercase 64-character hexadecimal unless a caller explicitly requests bytes |
| Keyed lookup/storage hash | HMAC-SHA-256 | Lowercase 64-character hexadecimal; generic helper also supports unpadded Base64URL |
| Recovery code | Rejection sampling over the approved 31-symbol alphabet | 20 normalized characters displayed as five groups of four |
| Hash fingerprint | Prefix of an already-computed lowercase SHA-256/HMAC hex value | First 12 hexadecimal characters |

MD5, SHA-1, `Math.random()`, custom encryption, and non-Web-Crypto random fallbacks are prohibited.

## Base64URL and text encoding

`toBase64Url` emits RFC 4648 URL-safe text using `A-Z`, `a-z`, `0-9`, `-`, and `_`, without padding. `fromBase64Url` accepts canonical padded or unpadded input, rejects other characters, rejects malformed lengths and padding, and rejects noncanonical trailing bits. Empty byte arrays and the empty encoded value round-trip explicitly.

UTF-8 conversion uses `TextEncoder` and a fatal `TextDecoder`; malformed UTF-8 never becomes replacement characters silently. Hexadecimal storage output is lowercase. Hex decoding accepts upper- or lowercase source text but rejects odd lengths and non-hexadecimal characters.

## Randomness and opaque tokens

Each random request must be a positive integer no larger than 4096 bytes. An unavailable or throwing Web Crypto provider produces a value-free typed error; there is no fallback source.

Opaque tokens default to 32 random bytes, providing 256 bits of source entropy before Base64URL encoding. Token content never includes a draft ID, email, user ID, timestamp, or other metadata. Optional prefixes are nonsecret lowercase purpose labels ending in `_`; they add no entropy and must not be interpreted as authorization. The module returns the raw token only to the immediate caller and does not persist it.

## Recovery-code generation

The generator reuses the approved backend recovery-code contract:

- Alphabet: `23456789ABCDEFGHJKMNPQRSTUVWXYZ`
- Normalized length: 20 characters
- Display format: five groups of four separated by hyphens
- Format capacity: approximately 99.0839 bits
- Hint: final four normalized characters

The largest multiple of 31 below 256 is 248. Random bytes 0 through 247 are accepted and mapped modulo 31; bytes 248 through 255 are rejected. If a batch yields fewer than 20 accepted symbols, the module requests another secure batch. Both batch size and retry count are bounded. The raw or formatted code is never logged or stored by this module.

## HMAC secret requirements and purpose separation

Every HMAC secret must contain at least 32 UTF-8/raw bytes. Secret text is never trimmed, normalized, logged, fingerprinted, or stored in source. Imported keys are nonextractable and signing-only. This module deliberately does not cache keys; callers may keep a key only within their function invocation/runtime and must use a bounded, purpose-specific cache if one is later introduced.

Purpose helpers require a runtime object containing the expected secret name and its injected value. A mismatched name fails closed.

| Purpose | Runtime secret name | Domain separator | Input rule |
| --- | --- | --- | --- |
| Recovery-code lookup | `PRO_FORM_RECOVERY_CODE_SECRET` | `pro-draft:recovery-code:v1:` | Normalize with the approved recovery-code contract; reject malformed input |
| Recovery-email lookup | `PRO_FORM_EMAIL_LOOKUP_SECRET` | `pro-draft:recovery-email:v1:` | Require an already-normalized, valid email; do not lowercase in the hash helper |
| Resume-token storage/lookup | `PRO_FORM_DRAFT_TOKEN_SECRET` | `pro-draft:resume-token:v1:` | Require a structurally valid opaque token of at least the 256-bit encoded length |

Operators must provision three independently generated values. Merely using different environment-variable names or domain separators does not make reused secret material acceptable. Raw SHA-256 is forbidden for low-entropy email or recovery-code lookup. SHA-256 remains appropriate for state hashes, nonsecret fingerprints, and opaque high-entropy token storage, although this contract uses purpose-separated HMAC for resume tokens.

### Public-recovery abuse hashing

Future public recovery rate limits reserve `PRO_FORM_ABUSE_HASH_SECRET`. It must
contain at least 32 random bytes and must be generated independently from the
recovery-email lookup, recovery-code, resume-token, draft-link, recovery-session,
admin-grant, and idempotency secrets. It is not configured by this source-only
batch.

The recovery security policy uses HMAC-SHA-256 with four noninterchangeable
domains:

| Abuse subject | Domain separator |
| --- | --- |
| Trusted normalized network address or stable unknown bucket | `pro-draft:abuse:ip:v1:` |
| Random client device ID | `pro-draft:abuse:device:v1:` |
| Already-normalized recovery email | `pro-draft:abuse:email-subject:v1:` |
| Normalized recovery-code subject | `pro-draft:abuse:code-subject:v1:` |

These hashes are rate-limit correlation keys, not authorization credentials.
The raw inputs and full hashes are absent from public responses and diagnostics;
raw inputs are never written to the recovery security-event entity.

## Timing-safe comparison

`timingSafeEqualBytes` traverses the maximum input length, folds all byte differences, and returns false for unequal lengths. Equal-length values do not exit early. Empty arrays compare equal. `timingSafeEqualStrings` UTF-8 encodes each string and delegates to the byte comparison; it performs no email or recovery-code normalization, so callers must normalize before comparison.

JavaScript runtimes and optimizing compilers do not offer a universal hard real-time guarantee. The helper reduces obvious data-dependent early exits but does not replace protocol-level enumeration defenses, uniform public responses, rate limits, or timing analysis.

## Safe errors, diagnostics, and logging

All validation and crypto failures use `ProDraftSecurityError` with a stable code and static message. Errors omit submitted email, recovery code, token, secret, digest, and provider exception text. `getSafeSecurityDiagnostics` exposes only version, algorithm names, public bounds, and recovery-code format metadata.

`getHashFingerprint` accepts only a completed 64-character lowercase hash and returns 12 characters. A fingerprint must never be computed directly from PII, a raw token, a raw recovery code, or secret material. It is for log correlation only and must never participate in authorization or equality lookup.

No raw email, normalized email, recovery code, opaque token, HMAC secret, or full sensitive lookup hash may be logged. Tests may hold synthetic values in local assertions but must not print them.

## Rotation implications

Rotating any lookup secret changes every hash under that purpose. A later rotation design must carry an explicit hash/key version, support a bounded dual-read or rehash migration window, prevent cross-purpose fallback, and remove the retired key after reconciliation. Recovery-code, recovery-email, and resume-token rotations are independent events. Rotation must not expose either secret or raw lookup input, and a hash from one purpose/version must never be accepted under another.

## Test coverage

`src/test/proDraftSecurity.test.js` covers:

- RFC Base64URL vectors, canonical padding, malformed input, UTF-8, and hex;
- random length/unavailability/bounds and opaque-token entropy/character/uniqueness checks;
- SHA-256 vectors and RFC 4231 HMAC-SHA-256 test case 6;
- minimum secret length, nonextractable keys, and secret/domain separation;
- equal, unequal, different-length, empty, and string comparisons;
- deterministic recovery-code generation, alphabet/format/hint, rejection boundary, refill, retry bound, and uniqueness smoke coverage;
- stable recovery-code, normalized-email, and resume-token hashes;
- required secret-name enforcement, value-free errors, safe diagnostics, and hash fingerprints;
- static prohibitions on insecure randomness, legacy digests, logging, environment reads, Base44 operations, and deployment behavior.

Vitest exercises the module through Node Web Crypto. TypeScript static validation covers the Deno-compatible Web Crypto surface and `.ts` import graph. The module uses only web-platform APIs and the existing runtime-neutral backend recovery-code contract.

## Staging certification evidence — 2026-08-05

The separate Base44 staging app now contains independently generated `PRO_FORM_RECOVERY_CODE_SECRET`, `PRO_FORM_EMAIL_LOOKUP_SECRET`, and `PRO_FORM_DRAFT_TOKEN_SECRET` values. Each began as 48 random bytes before Base64URL encoding; all six cross-contract values were checked pairwise distinct. No corresponding purpose secret is configured in production, no production value was copied, and `DRAFT_RECOVERY_PASSWORD` was not changed.

Candidate `b719b0c08c28360c22cfc3cff0eb41fcc1462c02` deployed only the admin-authenticated `proDraftSecuritySelfCheck` function to staging. The authenticated invocation reported security version `1` and true booleans for secret length/separation, recovery-code generation/hash, normalized-email lookup hash, opaque-token generation, resume-token hash, and request-limit behavior. The response passed exact-schema and sensitive-pattern scans. It returned no value, length, hash, hint, email, token, code, draft identifier, or stack trace.

The function bundle contains drift-tested copies of the shared primitives because Base44 function bundles cannot import outside their own directory. A local test requires the bundled sources to remain byte-equivalent to the shared contracts after normalizing only their relative import paths.

This evidence certifies primitive behavior only. It creates no draft bootstrap/save/recovery endpoint, enables no public recovery method, and does not enable durable draft V2.
