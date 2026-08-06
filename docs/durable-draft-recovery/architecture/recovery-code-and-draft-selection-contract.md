# Recovery Code and Draft Selection Contract

- Status: Implemented and locally tested contract; security primitives and recovery endpoints pending
- Contract version: `1`
- Date: 2026-08-05
- Scope: Browser formatting/validation and pure Base44-backend encoding/selection helpers
- Architecture authority: [ADR-003](./ADR-003-draft-identity-recovery-and-lifecycle-contract.md)

## Security boundary

This batch defines deterministic data contracts. It does not generate a recovery code, hash a code, persist a code or verifier, query an entity, prove control of an email address, authorize a recovery session, or expose a public endpoint. The frontend module has no Base44 dependency. The backend shared module is pure TypeScript with no Base44 call, I/O, logging, random source, or mutation of supplied records.

The later backend security-primitives batch must provide cryptographically secure bytes, a versioned keyed verifier, constant-time verification where applicable, rate limits, lockout/delay controls, generic public responses, safe audit, scoped signed grants, secret management, and one-time issuance. Only the verifier and an explicitly approved last-four hint may eventually be stored. A raw or normalized code must never be stored in Redux, browser-key names, Base44 entities, logs, analytics, exception context, or migration metadata.

## Recovery-code format

Version 1 uses:

| Property | Value |
| --- | --- |
| Alphabet | `23456789ABCDEFGHJKMNPQRSTUVWXYZ` |
| Alphabet size | 31 unique symbols |
| Normalized length | 20 symbols |
| Group size | 4 symbols |
| Group count | 5 |
| Display shape | `XXXX-XXXX-XXXX-XXXX-XXXX` |
| Excluded ambiguous symbols | `0`, `1`, `I`, `L`, `O` |

The format entropy is:

`20 × log2(31) = 99.0839262077375 bits`

This is format capacity, not a claim about generation quality. Actual entropy depends on the later backend generator supplying independent, cryptographically secure bytes. Contract drift validation fails below 96 bits.

## Input normalization and display

`normalizeRecoveryCodeInput`:

1. Accepts strings only.
2. Removes ordinary ASCII spaces and ASCII hyphens.
3. Uppercases the remaining input.
4. Rejects normalized lengths below or above 20.
5. Rejects every character outside the exact alphabet.
6. Does not strip tabs, newlines, Unicode separators, underscores, slashes, punctuation, or other arbitrary characters.

The successful normalization result contains the canonical code for immediate verification work. That field is sensitive transient data and is not safe telemetry. `validateRecoveryCodeFormat` and `getSafeRecoveryCodeDiagnostics` return only validity, normalized length, error code, and—only for diagnostics—the version. Diagnostics never contain raw input, normalized input, or a hint.

`formatRecoveryCode` accepts only an already valid uppercase 20-symbol normalized value and inserts four hyphens. It does not silently normalize its argument. `deriveRecoveryCodeHint` normalizes a valid input and returns only its last four canonical characters. A caller must independently establish an approved admin-only display context; a hint cannot identify or authorize a draft.

## Deterministic unbiased encoding

`encodeRecoveryCodeFromRandomValues(values)` accepts caller-supplied bytes. It is deliberately not a random generator.

For a 31-symbol alphabet, `248` is the largest multiple of 31 below 256. The encoder therefore:

1. Accepts byte values `0` through `247`.
2. Rejects byte values `248` through `255`.
3. Maps each accepted byte with `value % 31` only after that rejection.
4. Stops after exactly 20 accepted values.
5. Throws the typed `RECOVERY_CODE_INSUFFICIENT_ENTROPY` error when finite input ends first.
6. Rejects non-byte values and never loops beyond the supplied array.

The rejection step prevents modulo bias. A later security module must repeatedly request secure bytes until this helper succeeds. Neither contract module calls `Math.random`, Web Crypto, Node crypto, or a Base44 API.

## Draft lifecycle normalization

The authoritative lifecycle values are:

- `active`
- `submit_attempted`
- `submit_failed`
- `submitted`
- `cleared_superseded`
- `expired`
- `deleted`

The legacy value `draft` becomes `active`. Blank or absent status becomes `active` only when the caller explicitly marks a valid legacy draft or the record has both a stable ID and at least one valid server-created timestamp. Existing current statuses remain unchanged. Unknown values become `unknown` and are never automatically eligible. Normalization never mutates the source record.

## Automatic email-recovery eligibility

Lifecycle-eligible statuses are exactly:

- `active`
- `submit_attempted`
- `submit_failed`
- `submitted`

`submitted` deliberately remains eligible. `cleared_superseded`, `expired`, `deleted`, and unknown values are ineligible. A record is also excluded when it lacks a stable ID, has a superseding-draft link, is soft-deleted, has finalized retention deletion, declares a different environment, or is explicitly marked staging/test while production selection is requested. Missing future metadata on otherwise valid legacy records does not itself cause rejection.

Eligibility and selection do not inspect email fields. They assume an upstream backend has already performed a scoped association lookup. Email normalization, equality, or presence is never authorization.

## Newest-created selection

`selectNewestEligibleDraft(records, options)` operates on a copied list and does not modify records or input order. It filters lifecycle, deletion, supersession, and environment metadata, then sorts with this exact descending tuple:

1. Logical creation time: valid `origin_created_at`, then valid `source_created_date`, then Base44 `created_date`.
2. `origin_record_id`.
3. `source_record_id`.
4. Destination Base44 record ID.

Identity ties use documented bytewise string order descending. `updated_date`, `last_saved_at`, all client timestamps, answer content, email values, and destination import order are ignored. Consequently, an older draft updated or imported more recently cannot win. A newest-logically-created `submitted` record wins over an older `active` record, while a native green record remains newer than an older blue record imported later.

When at least one otherwise eligible record has a valid logical creation timestamp, otherwise eligible records with no valid `origin_created_at`, `source_created_date`, or `created_date` are excluded and diagnostics include `INVALID_CREATION_TIMESTAMP_EXCLUDED`. If all eligible records lack valid logical creation timestamps, selection falls back deterministically through the same logical identity tuple and emits `ALL_CREATION_TIMESTAMPS_INVALID_ID_FALLBACK`. This fallback preserves deterministic legacy behavior but is a data-quality warning, not preferred production ordering.

The result contains the selected internal record, eligible/excluded counts, and a separate safe diagnostic object. Diagnostics contain only version, selection presence, counts, and warning enums; they contain no email, answer, code, hint, or record payload.

## Environment isolation

When `expectedEnvironment` is supplied, an explicitly different record environment is excluded. Missing environment metadata is tolerated for defensively recognized legacy records. Production selection additionally rejects explicit staging/test flags even when the environment field is missing or inconsistent. These are local contract safeguards, not proof of deployed application isolation, clean migration, or authorization.

## Cross-runtime conformance

The browser and backend implementations consume one synthetic fixture corpus:

- `src/test/fixtures/proDraftIdentityConformance.json`

It covers normalization, formatting, invalid symbols and lengths, deterministic encoding, rejection sampling, status normalization, all eligibility states, newest-created ordering, submitted-newest behavior, supersession, timestamp ties, malformed timestamps, deterministic fallback, and environment mismatch.

`npm run test:identity-contract` evaluates both implementations and fails on version, alphabet, length, grouping, lifecycle, eligible-status, fixture, entropy, ambiguous-character, generation, hashing, Base44-call, or logging drift. Fixture codes and records are deterministic synthetic examples and are not issued credentials or production data.

## Deferred production dependencies

Before any recovery path can be enabled, later approved work must add and certify:

1. A backend-only cryptographically secure byte source.
2. Versioned keyed hashing/verifier storage and secret rotation.
3. Unique-code issuance and collision handling.
4. Exact-code verification scoped to one draft.
5. Authorized email association lookup before this selector runs.
6. Generic response, anti-enumeration, throttling, delay, CAPTCHA, and lockout controls.
7. Environment-bound recovery grants and audit events.
8. Base44 entity fields, RLS/FLS, retention, and migration/backfill contracts.
9. Staging, production-disabled, and production-enabled certification.

No Base44 command, entity change, secret operation, function deployment, site deployment, recovery exposure, or production data operation was performed for this contract.
