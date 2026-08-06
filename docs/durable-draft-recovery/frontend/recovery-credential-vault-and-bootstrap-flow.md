# Recovery Credential Vault and Bootstrap Flow

- Vault version: `1`
- Browser key version: `v5`
- Canonical schema version: `4`
- Runtime modules: `src/lib/proDraftCredentialVault.js` and `src/lib/proDraftBootstrapCoordinator.js`
- UI status: controller foundation only; the opening modal is intentionally deferred
- Deployment status: source-only; no Base44 deployment or feature-flag change

## Security boundary

Resume tokens and recovery-session tokens are bearer authorization. They are
kept in the scoped credential vault and never enter Redux, canonical draft
state, URLs, analytics, logs, exceptions, or browser key names. The vault is
not encryption and browser-origin storage is not described as
cryptographically secure. A script executing in the same origin may be able to
read browser storage, so XSS prevention and dependency integrity remain part
of the authorization boundary.

The key is
`pro-questionnaire:v5:<non-PII-namespace>:draft-credentials`. It contains no
draft ID, email, token, or recovery code. An admin grant, Base44 token, AWS
credential, signed-invitation token, and other unrelated secrets are rejected
or absent from the bundle.

## Credential bundle

Version 1 validates this complete logical record before replacing a prior
record:

```text
version, environment, browserNamespace, draftId, sessionId,
resumeToken, recoverySessionToken, recoverySessionExpiresAt,
recoveryCode, recoveryCodeHint, recoveryCodeVersion,
authorizationMethod, storedAtClient, lastUsedAtClient
```

Unknown/future versions, environments, authorization methods, identifiers,
tokens, codes, expirations, and fields fail closed. The active frontend
environment and namespace must match. Resume tokens are bounded opaque
Base64URL/prefix-compatible values. Recovery-session tokens require exactly two
bounded compact Base64URL segments; the client does not decode their claims or
treat them as authoritative. Recovery codes use the versioned ambiguity-safe
20-character contract.

Raw recovery code retention is limited to the scoped vault:

- a newly issued code may be retained because it was returned directly to this browser;
- a successfully used code is retained by the approved default policy;
- an email recovery stores only the code hint;
- no code is sent to Base44 except an explicit code-recovery request (the later authorized recovery-email flow is outside this coordinator).

## Storage modes

The vault uses the shared resilient adapter in this order: IndexedDB,
localStorage, then page memory. Its result reports the layer that actually
accepted the operation. In `memory_only` mode the credential and display code
remain usable during the current page lifetime, but may be lost when the page
or browser closes. The future UI must state this limitation.

Validation and JSON serialization complete before a write, preserving the
last known good record on failure. A malformed record returns a safe typed
failure and is not allowed to erase or overwrite the canonical cache. Expired
recovery-session cleanup removes only the session token and expiration; a
resume token, recovery code, IDs, and canonical cache remain intact.

## Bootstrap phases and outcomes

The phase sequence is:

```text
idle → reading_identity → reading_local_cache → reading_credentials
→ resuming_stored_draft / awaiting_client_choice / recovering_by_email /
  recovering_by_code / creating_new_draft
→ loading_authorized_draft → reconciling_state → hydrating_redux
→ ready | error
```

Outcomes are `legacy_flow`, `new_draft_created`, `stored_draft_resumed`,
`email_draft_recovered`, `code_draft_recovered`,
`signed_invitation_resumed`, `signed_invitation_new_draft`,
`anonymous_draft_created`, `submitted_draft_loaded`,
`local_only_recovery`, and `empty_usable_fallback`.

When durable draft V2 is disabled, bootstrap returns `legacy_flow` without
dispatching, invoking a V2 API, or changing the current production behavior.
When enabled, initialization reads flags, safe identity, namespace, local
canonical cache, and the credential vault in that order. It removes an expired
recovery session, tries a resume token first, then a nonexpired exact-draft
recovery session, then an explicitly verified signed invitation. A changed
signed-invitation email cannot use the invitation to search replacement-email
drafts.

If exact authorization cannot resume, the coordinator returns
`awaiting_client_choice`. It does not create a draft, recover from an email in
the URL, recover by code, or dispatch empty canonical state. The visual modal
and its accessibility behavior are Prompt 2 work.

## Explicit actions

New draft creation requires a validated email association or explicit
anonymous-recovery acknowledgement. It generates a Web Crypto client bootstrap
token and idempotency key, invokes `bootstrapProFormDraft`, retains one-time
credentials, reconciles the returned canonical state, dispatches exactly one
`loadCanonicalDraftState`, and writes the selected canonical state to the local
cache.

Email recovery is explicit and uses normalized email while preserving
`unverified` status. It stores the exact-draft recovery-session token and hint,
loads that draft, and reports whether other eligible drafts exist. Code
recovery is also explicit, does not require email, and retains the normalized
entered code according to storage policy only after success. Neither path
automatically associates an unrelated email.

The hook creates one coordinator per questionnaire store, shares the in-flight
bootstrap across React Strict Mode effects, supports final-unmount
cancellation, and exposes safe phase/outcome/summary booleans. The credential
context exposes only display-code, hint, mode, clear, and replace capabilities;
tokens and the raw bundle are not public context values.

## Local/server reconciliation

`compareCanonicalDraftFreshness` governs initial selection:

| Sources | Result |
| --- | --- |
| Server only | Hydrate server. |
| Authorized local only | Hydrate local and set `pendingServerSync=true` for the later sync manager. |
| Equal | Select server consistently. |
| Server newer | Select server. |
| Local newer | Select local and mark pending server sync. |
| Diverged compatible | Preserve both, select server conservatively, and return `mergeRequired=true`. |
| Incompatible local/server | Hydrate the authorized server state and preserve the incompatible cache. |
| Submitted server versus active local | Submitted server wins and hydrates read-only. |

Cleared/superseded, expired, and deleted canonical states are never hydrated as
active. Safe reconciliation diagnostics contain status/revision/count/hash
metadata only; credentials and PII are excluded.

## Deferred integration

This batch does not add the visual recovery modal, migrate ordinary autosave,
install listener-middleware server saves, enable any environment flag, push a
schema, or deploy Base44. The later sync manager will consume
`pendingServerSync`/`mergeRequired`, start ordinary server autosave only after
bootstrap, and resolve conflicts without changing this credential boundary.

## Evidence

Synthetic evidence is in `proDraftCredentialVault.test.js`,
`proDraftBootstrapCoordinator.test.js`, `useProDraftBootstrap.test.jsx`, and
the controller-level `bootstrap-controller.spec.js`. It covers durable and
memory storage, malformed/future bundles, token/code validation, expiry,
resume/invitation/email/code/new/submitted paths, reconciliation, diagnostics,
Redux exclusion, Strict Mode, cancellation, and the six currently nonvisual
controller E2E scenarios. Source tests are not staging or production
certification.
