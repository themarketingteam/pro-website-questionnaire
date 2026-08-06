# Opening Recovery Modal Contract

- Status: Implemented and locally tested; staging certification pending
- Date: 2026-08-06
- Scope: Durable Draft V2 questionnaire entry only

## Entry boundary

When Durable Draft V2 is enabled, `ProDraftBootstrapGate` owns questionnaire
entry. The full questionnaire remains unmounted while the coordinator prepares
the local identity, cache, and credential state. The gate then opens the modal
for every entry, including a stored authorized resume and a submitted draft.
The questionnaire mounts only after the bootstrap phase is `ready` and the
person explicitly continues from the modal.

The disabled V2 path returns the legacy questionnaire directly and does not
invoke the V2 hook. The enabled path suspends the legacy session bootstrap,
before-unload backup, legacy autosave, and draft-event writers. This change does
not implement the later authoritative V2 autosave migration.

## Controlled state machine

The modal exposes these twelve controlled states:

1. `choose_recovery_method`
2. `email_entry`
3. `email_recovery_loading`
4. `email_recovery_result`
5. `code_entry`
6. `code_recovery_loading`
7. `code_recovery_result`
8. `creating_new_draft`
9. `recovery_code_acknowledgement`
10. `welcome_back`
11. `submitted_read_only_ready`
12. `error`

Bootstrap and recovery credentials are held by the coordinator credential
vault. Recovery-session tokens and raw recovery codes are not copied into
Redux, canonical questionnaire state, URLs, diagnostics, or modal summaries.
CAPTCHA tokens exist only in transient component state for one recovery call
and are cleared after an attempt, reset, or unmount.

## Opening disclosure and choices

The opening title is **Save and recover your questionnaire**. It explains that
an email can locate the most recently created questionnaire and that a unique
recovery code must be saved securely. It also displays this accepted-risk
warning:

> Email recovery does not verify ownership of the email address. Anyone who
> knows the exact email address may be able to access the newest eligible
> questionnaire associated with it.

The opening actions are:

- `Continue with an email`
- `Recover with a recovery code`
- `Continue without an email`

## Email and anonymous entry

There is one optional email field. Entering an email does not automatically
search for a draft. The person must choose either `Continue with this email` to
create a new association or `Recover saved answers using this email` to invoke
email recovery.

When a signed-invitation email is changed, the modal states:

> Changing this email will start a new questionnaire association. It will not
> open drafts that already belong to the replacement email.

Continuing without an email clears any prefilled value and remains disabled
until the person acknowledges:

> I understand that without an email address or a saved recovery code, I may
> not be able to recover my answers after leaving this questionnaire.

## Recovery-code entry and acknowledgement

Code recovery uses a single `Recovery code` field with placeholder
`XXXX-XXXX-XXXX-XXXX-XXXX`, plus `Recover questionnaire` and `Back` actions.
It resolves one exact authorized draft and keeps submitted drafts read-only.

A newly created draft displays its full code once through the credential-vault
boundary. The copy action uses the Clipboard API, announces success through an
`aria-live` status, and selects the code for manual copy when the API is not
available. Entry remains gated until `I have viewed or copied my recovery
code.` is acknowledged. When persistent browser storage is unavailable, the
modal warns that the code may not remain available after the browser closes.

## Failure, lockout, and CAPTCHA behavior

Recovery failures use the same generic message for email and code:

> We could not recover a questionnaire with the information provided.

Safe server metadata may add a retry delay or require a CAPTCHA. The CAPTCHA
adapter renders only after the server requires it, reads the public site key
from `VITE_PRO_DRAFT_CAPTCHA_SITE_KEY`, and forwards a token only to the next
recovery request. A deterministic test token is accepted only when
`VITE_PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED=true` and the runtime environment is
`staging` or `test`; the adapter explicitly rejects that token in production.
No CAPTCHA secret is present in frontend source.

## Submitted and accessible behavior

A submitted questionnaire opens only after the modal says it will be
read-only and offers `View submitted questionnaire`. The mounted content is
wrapped in a disabled fieldset. The modal uses the existing Radix dialog
primitive for focus containment and background inertness, prevents Escape and
outside-pointer dismissal, has no close button, and constrains height with
internal scrolling on narrow viewports. Loading and copy/security outcomes use
status or alert semantics.

## Local evidence

- Component contract: 42 passing tests across the modal, gate, and CAPTCHA
  adapter.
- Browser matrix: 35 passing cases across desktop Chromium, Firefox, WebKit,
  mobile Chromium, and mobile WebKit.
- Scenarios: new email, anonymous/storage-blocked start, code recovery,
  email recovery with conditional CAPTCHA, changed signed email, stored resume,
  and submitted read-only entry.
- The visual harness is a separate local Vite entry enabled only by
  `E2E_PRO_DRAFT_ENTRY_VISUALS=true`; it uses an in-memory fake coordinator and
  performs no external request.

This is source and local-browser evidence. No staging site was deployed, no
email was sent, no Base44 resource was changed, and no production behavior was
enabled by this implementation.

## Public recovery continuation

The separate [public recovery page and panel contract](./public-recovery-page-and-panel-contract.md)
reuses this modal's coordinator, credential-vault, generic-error, and
conditional-CAPTCHA boundaries at `/recover-draft`. Unlike the mandatory
opening gate, the public page accepts only an explicit email or recovery-code
request and may expose the email-authorized older-draft list. The persistent
V2 panel is rendered immediately before Question 1 with compact footer access;
it is never rendered in the global header. Neither surface changes this
modal's V2-disabled legacy behavior or activates ongoing server autosave.
