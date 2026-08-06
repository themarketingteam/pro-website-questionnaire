# Draft Identity and Email Normalization Contract

- Identity version: `1`
- Recovery-email normalization version: `1`
- Module: `src/lib/proDraftIdentity.js`
- Status: client contract implemented and unit-tested; no recovery UI, backend authorization, Base44 schema, or deployment change
- Sources: [ADR-001](./ADR-001-approved-product-and-security-decisions.md), [ADR-003](./ADR-003-draft-identity-recovery-and-lifecycle-contract.md), [canonical draft state](./canonical-draft-state-contract.md), [browser namespace policy](./browser-namespace-and-legacy-key-policy.md)

## Purpose and boundary

This module defines deterministic questionnaire identity and recovery-email association semantics for later browser, Base44 Deno, migration, modal, and cutover adapters. An email association is not proof that a person owns an address. The accepted initial release may later use an exact normalized, still-`unverified` email for recovery under the separately approved backend security controls.

This implementation does not load or search drafts, generate or hash recovery codes, compute a recovery lookup hash, issue a recovery session, add a modal, change the questionnaire, modify an entity, send email, or authorize access. It imports no Base44 client and performs no storage or network operation.

## Existing field names and distinct roles

No current name is renamed or silently reinterpreted:

| Layer | Existing fields |
| --- | --- |
| URL query | `userId`, `userEmail`, `userName`, `businessName`, `domainName` |
| Redux/canonical credentials | `userId`, `userEmail`, `userName`, `businessName`, `domain`; canonical compatibility also recognizes `domainName` |
| Current `ProFormDraft` record | `user_id`, `user_email`, `user_name`, `business_name`, `domain` |
| Submission metadata | `business_name`, `businessDomain`, `submission_datetime` |
| Current PDF inputs | response snapshot, business name, and domain |

The logical email roles are intentionally distinct:

| Role | Contract |
| --- | --- |
| Questionnaire user email | The existing `userEmail`/`user_email` compatibility value. A caller must deliberately choose whether it becomes a recovery association. |
| Recovery email | The display and normalized email associated with the identity context. It may be unverified. |
| Signed-invitation email | A claimed invitation email. Query text alone never proves that the invitation or email is verified. |
| Client-entered email | A replacement or directly entered value with source `client_entered` and status `unverified`. |
| Email used to recover a draft | A later recovery input with source `recovered_by_email`; it remains `unverified` in the initial email-only policy. |

`createDraftIdentityContext` accepts the existing camelCase credential object only as compatibility input. It does not write the Base44 snake_case fields or alter their current behavior.

## Identity sources

`DRAFT_IDENTITY_SOURCE_VALUES` contains exactly:

- `signed_invitation`
- `client_entered`
- `recovered_by_email`
- `recovered_by_code`
- `admin_corrected`
- `migrated_legacy`
- `anonymous`

A source records provenance, not authorization. `signed_invitation` may later accompany `verified_signed_invitation` only after a backend validates a signed token and returns a trusted result. `recovered_by_email` describes the accepted unverified email-only selection flow. `recovered_by_code` describes a later exact-draft code grant. `anonymous` means no email association.

## Association intents

`DRAFT_IDENTITY_ASSOCIATION_INTENTS` contains exactly:

- `new_invitation`
- `resume_current_draft`
- `recover_by_email`
- `recover_by_code`
- `changed_signed_email`
- `clear_all_replacement`
- `start_new_after_submission`
- `legacy_migration`
- `anonymous_start`

`changed_signed_email`, `clear_all_replacement`, `start_new_after_submission`, and `anonymous_start` always require a new draft association later. `new_invitation` requires one only when no current authorized draft exists. The helper deliberately returns `false` for both recovery intents; it does not decide whether email or code recovery is authorized.

Clear All later preserves the email association while creating a replacement draft. Start New later preserves the submitted record while creating a new draft. Neither workflow is implemented here.

## Verification states

The only states are:

- `unverified`
- `verified_signed_invitation`
- `verified_otp`
- `verified_magic_link`

There is no ambiguous `verified` state. Client-entered and email-recovery values normalize to `unverified`. A caller cannot create a verified context merely by supplying a query value or status string: verified states require an explicit trusted-backend adapter option. That option is an integration boundary, not verification by this module. OTP and magic-link states are future-compatible but their workflows remain disabled.

## Recovery-email normalization

`normalizeRecoveryEmail(input, {allowEmpty})` returns:

```json
{
  "valid": true,
  "displayEmail": "Synthetic.Person+Draft@Example.TEST",
  "normalizedEmail": "synthetic.person+draft@example.test",
  "normalizationVersion": 1,
  "errorCode": null
}
```

The example is synthetic. Normalization:

1. accepts strings only;
2. rejects ASCII controls before trimming, including tab/newline injection;
3. trims surrounding Unicode whitespace and applies NFC where supported;
4. permits a blank value only with `allowEmpty=true`;
5. requires exactly one `@` and nonempty local/domain portions;
6. rejects embedded whitespace;
7. enforces 64-character local, 254-character total, 253-character domain, and 63-character label limits;
8. rejects consecutive domain dots and labels beginning or ending with `-`;
9. uses the runtime `URL` hostname parser for safe IDN-to-ASCII/punycode conversion;
10. lowercases the complete address for lookup consistency while retaining the trimmed display form.

It does not remove Gmail dots, remove `+tag`, infer aliases, query DNS/SMTP, log either email form, or use a restrictive provider-specific regular expression. The normalized value supports deterministic association only; it is not verification or authorization.

## Business-domain normalization

`normalizeBusinessDomain(input)` accepts an HTTP(S) URL or hostname. It keeps the NFC-normalized trimmed input in `displayDomain`, lowercases and IDN-normalizes the hostname, removes one trailing dot, and removes one leading `www.` only from `normalizedDomain`. URL paths are permitted and ignored for comparison because a full current website URL may be supplied.

The normalizer rejects controls, empty required input, malformed URLs, non-HTTP(S) schemes, URL credentials, invalid ports, query strings, fragments, invalid hostname labels, and IP addresses. It makes no public-suffix assumption and is not an authorization boundary.

Synthetic examples:

| Input | Hostname | Normalized comparison |
| --- | --- | --- |
| `https://example.com` | `example.com` | `example.com` |
| `http://www.example.com/` | `www.example.com` | `example.com` |
| `EXAMPLE.COM` | `example.com` | `example.com` |
| `https://bücher.example/path` | `xn--bcher-kva.example` | `xn--bcher-kva.example` |

## Identity context

`createDraftIdentityContext` returns a fresh normalized object:

```json
{
  "identityVersion": 1,
  "formType": "pro-questionnaire",
  "invitationId": "invitation-synthetic-1",
  "userId": "user-synthetic-1",
  "userName": "Synthetic User",
  "businessName": "Synthetic Business",
  "normalizedDomain": "synthetic.example.test",
  "displayDomain": "https://www.synthetic.example.test/path",
  "recoveryEmail": "Synthetic.Person+Draft@Example.TEST",
  "normalizedRecoveryEmail": "synthetic.person+draft@example.test",
  "recoveryEmailSource": "client_entered",
  "recoveryEmailVerificationStatus": "unverified",
  "associationIntent": "new_invitation",
  "signedInvitationEmail": null,
  "normalizedSignedInvitationEmail": null,
  "signedInvitationEmailChanged": false,
  "anonymousRecoveryAcknowledged": false
}
```

The example is synthetic. The context may contain PII and must not be logged. It cannot contain signed-invitation, recovery-session, resume, admin, Base44, or other access tokens; recovery codes and recovery-code hashes are also forbidden. An absent invitation remains `null`. Inputs are never mutated.

## Signed-email change and anonymous flow

`isSignedInvitationEmailChanged` compares normalized valid email values. It returns `false` when there is no signed email or the values are equivalent, `true` for a different valid replacement, and a typed value-free invalid result for malformed input.

When a signed email changes, context creation forces:

- source `client_entered`;
- verification status `unverified`;
- intent `changed_signed_email`;
- `signedInvitationEmailChanged=true`.

No draft lookup or Base44 operation occurs. A later coordinator must create/associate a new draft and must not search the replacement email's existing drafts.

An `anonymous_start` with no email is invalid until `anonymousRecoveryAcknowledged=true`. This records only the future recovery-risk acknowledgement; it does not create a code or modal.

## Safe diagnostics and browser keys

`getSafeDraftIdentityDiagnostics` exposes only versions, form type, presence booleans, approved enums, signed-email-change state, acknowledgement state, and an error code. It never returns email, business name, domain, user ID/name, invitation ID, token, or recovery code.

The existing browser namespace continues to reduce its identity seed to an opaque `ns_<32 hex>` key segment. Its non-cryptographic hash partitions same-origin browser records only. Raw email, business name, domain, user ID, and invitation ID never appear in generated key names, and the namespace/hash must never authorize server access.

## Future backend lookup and verification

A later backend prompt must compute a versioned keyed HMAC of the normalized recovery email, protect/rotate its key, apply abuse controls, and compare only within an authorized backend operation. This client module intentionally computes no lookup hash. Later OTP and magic-link adapters may use the explicit verification states after their separately approved backend verification succeeds; their current disabled state is unchanged.

## Evidence

`src/test/proDraftIdentity.test.js` covers email/domain boundaries, IDN handling, role/source/intent enums, signed-email changes, anonymous acknowledgement, trusted verification boundary, no-token contexts, input immutability, fresh outputs, safe comparison, and PII-free diagnostics. Passing unit tests are local contract evidence only and do not certify a recovery endpoint, Base44 schema, staging environment, or production behavior.
