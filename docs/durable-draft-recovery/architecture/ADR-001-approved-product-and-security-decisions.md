# ADR-001: Approved Durable Draft Recovery Product and Security Decisions

- Status: Accepted
- Date: 2026-08-05
- Owners: Isaac Hines; Engineering

## Context

The Pro Website Questionnaire needs durable draft persistence, client recovery, submitted-response access, support recovery, auditable retention, controlled email delivery, browser compatibility, and a reversible release process. Existing behavior already uses `ProFormDraft` and `ProFormDraftEvent`; this decision extends that model rather than replacing it.

The initial release deliberately prioritizes recovery speed and a consistent client experience over verified identity for public email recovery. An email collected or used by this release is an unverified email association, not a verified email address. The exact normalized email can retrieve sensitive questionnaire content under the controls below, but those controls do not prove ownership of the address.

This ADR is the authoritative product and security contract for later implementation. No product decision within its scope remains unresolved.

## Release boundaries

| Boundary | Authoritative meaning |
| --- | --- |
| Initial release behavior | Email-only public recovery, independent recovery-code access, password-only support/admin access, persistent signed browser grants, existing draft entities, the retention rules below, and production-disabled release controls are approved for implementation. |
| Disabled future framework | OTP recovery and magic-link recovery must be structurally supported but disabled. Their later activation must not require destructive data migration. They do not verify or authorize recovery in the initial release. |
| Explicitly out of scope | Client account registration, an initial OTP or magic-link requirement, a general recovery-code email button, embedded email/collaboration experiences, direct staging promotion, deleting blue production, replacing the existing draft entities, cookie-only recovery, and claims that Clear All erases browser history are excluded. |

## Approved decisions

### A. Authoritative draft storage

1. `ProFormDraft` remains the authoritative current draft snapshot table.
2. `ProFormDraftEvent` remains the append-oriented audit/event table.
3. Implementation must extend these existing entities instead of replacing them.
4. Browser storage is a fast/offline cache and cannot be the sole authority.
5. Base44 server state must support recovery when browser storage is blocked or cleared.
6. Every answer-bearing entry, validation value, touched state, expanded state, and incomplete editor value must be recoverable when technically serializable.
7. Raw `File` and `Blob` objects cannot be restored after browser closure.
8. Uploaded file URLs and safe metadata may be persisted.

### B. Opening recovery modal

1. The opening recovery modal always appears.
2. A signed-invitation email may be prefilled.
3. The client may change a prefilled email.
4. Changing a signed-invitation email must create or associate a new draft.
5. Changing the email must never retrieve the replacement email's existing draft automatically.
6. Email is optional.
7. A client who does not provide an email must explicitly acknowledge that they may not be able to recover answers after leaving unless they save the recovery code.
8. The modal must display the draft's recovery code.
9. The modal must provide a copy button for the recovery code.
10. Only one email field is required.
11. A confirm-email field is not required.

### C. Email-only recovery

1. The initial release permits email-only recovery from a public questionnaire or recovery page.
2. The exact normalized email is sufficient to retrieve the newest eligible draft.
3. No OTP is required in the initial release.
4. No magic-link click is required in the initial release.
5. Email ownership is not verified at initial collection.
6. Email ownership is not verified during initial email-only recovery.
7. Public email recovery must use all of these controls:
   - Generic public errors.
   - Per-IP rate limits.
   - Per-email-hash rate limits.
   - Increasing delays.
   - CAPTCHA after suspicious or repeated attempts.
   - Temporary lockouts.
   - Recovery-attempt auditing.
8. Email-only recovery creates a direct privacy risk: anyone who knows a client's exact email may be able to view the newest eligible questionnaire and submitted answers.
9. Isaac knowingly accepts this risk for the initial release because speed and client consistency are the current priority.
10. The system must include disabled framework support for OTP recovery and magic-link recovery.
11. Future OTP or magic-link activation must not require a destructive data migration.
12. Product copy, logs, and documentation must not describe email-only recovery as secure verification or describe an associated email as verified.

### D. Recovery code

1. Every draft receives its own unique, high-entropy recovery code.
2. The recovery code independently recovers that draft.
3. A client does not need to provide the email when a valid recovery code is used.
4. The recovery code must be human-readable and easy to copy.
5. Ambiguous characters should be avoided.
6. Only a secure hash or keyed hash of the recovery code may be stored in Base44.
7. The raw recovery code must not appear in logs, analytics, storage-key names, or entity projections.
8. The recovery code must remain accessible in the opening modal and directly above Question 1 and/or in the questionnaire footer.
9. The recovery code must not be placed in the site header.
10. The current release does not provide a general "Email me this recovery code" button.
11. Clear All is the sole approved email exception: a new recovery code is generated and automatically emailed when a recovery email exists.

### E. Multiple drafts for one email

1. One email may have multiple drafts.
2. Email recovery opens the most recently created eligible draft.
3. Selection uses the server-created timestamp, never client time.
4. The newest-created rule applies whether the newest eligible record is active, submit failed, or submitted.
5. Cleared/superseded, expired, and deleted records are excluded from automatic email recovery.
6. When the newest record is submitted, it opens read-only and provides "Recover a different questionnaire."
7. After successful recovery authorization, older-draft selection may display only these safe identifying fields:
   - Business name.
   - Created date.
   - Status.
8. Selecting an older draft does not change which record is newest.

### F. Submitted questionnaires

1. Submitted questionnaires reopen read-only.
2. Email-only recovery may display all submitted answers.
3. Recovery-code access may display all submitted answers.
4. The client may generate or download the PDF from the submitted snapshot.
5. A submitted record must never become editable.
6. Clear All is not shown for submitted records.
7. Submitted records provide "Start a New Questionnaire."
8. Starting new creates a separate blank draft with its own recovery code.
9. Starting new leaves the submitted record unchanged.
10. Submitted-response access is required for one year.
11. Completed-submission retention otherwise follows the existing completed-submission policy.

### G. Clear All

1. Clear All cannot delete actual browser history.
2. It clears only application-managed questionnaire cache and state.
3. It marks the previous draft `cleared_superseded`.
4. The old record remains available to support and audit.
5. The old record is excluded from automatic email recovery.
6. A completely new `ProFormDraft` record is created.
7. The new record receives a new draft ID, new session ID, new recovery code, and empty canonical state.
8. The recovery email is retained.
9. The new draft becomes the newest-created record for the email.
10. The new recovery code is automatically emailed when an email exists.
11. Failure to send the email must not undo creation of the new draft.
12. When delivery fails, the client must still be shown the code and asked to copy it.

### H. Amazon SES

1. The intended sender is `MSP Success Websites <noreply@mspsuccesswebsites.com>`.
2. Amazon SES configuration must be inventoried before implementation.
3. The inventory and acceptance checks must validate region, sandbox/production status, verified sender/domain, IAM permissions, limits, bounce handling, and complaint handling.
4. Staging email must never go to the entered client.
5. Staging email must be redirected to an internal allowlist.
6. Staging email subjects must begin with `[STAGING]`.
7. SES credentials must be stored as Base44 secrets.
8. SES access must use least-privilege IAM.

### I. Admin recovery

1. The initial release remains password-only for support/admin access.
2. A Base44 admin account is not required by the selected initial workflow.
3. Password verification must occur in a backend function.
4. Successful verification issues a signed recovery grant.
5. The browser grant has no fixed time expiration.
6. The grant must survive browser restarts when persistent browser storage works.
7. The grant must be revocable through every one of these mechanisms:
   - Secret rotation.
   - Grant-version increment.
   - "Forget this device."
   - Browser storage clearing.
8. Password attempts require rate limiting, increasing delays, temporary lockouts, generic errors, and audit logging.
9. The browser must never receive direct unrestricted entity access.
10. The grant must not appear in Redux, URLs, logs, analytics, or entity rows.
11. A persistent password-only grant has weaker identity assurance than authenticated individual admin accounts. Isaac knowingly accepts that risk for the selected initial workflow.

### J. Retention

1. Unsubmitted drafts are retained for one year.
2. Submit-failed drafts are retained for one year.
3. Cleared/superseded drafts are retained for one year.
4. Events associated with those records are retained for one year unless a later approved policy changes the duration.
5. Completed submissions follow the existing completed-submission retention policy, subject to the one-year submitted-response access requirement in section F.
6. Destructive cleanup must begin in dry-run mode.
7. Cleanup must not remove recent repair/support cases automatically.

### K. Browser and link behavior

1. The questionnaire is a browser-hosted website.
2. Links may be received through Outlook, Gmail, Microsoft Teams, iOS Mail, and Android Gmail.
3. Clicking the link should open the website in the available device browser.
4. No embedded widget is being built.
5. No in-email questionnaire is being built.
6. No Teams tab or widget is being built.
7. No Gmail or Outlook add-in is being built.
8. Required browser coverage includes:
   - Chrome.
   - Edge.
   - Firefox.
   - Safari/WebKit.
   - iOS Safari-sized WebKit.
   - Android Chrome-sized Chromium.
9. Manual link-opening checks are required from Outlook, Gmail, Microsoft Teams, iOS Mail, and Android Gmail.

### L. Conflict handling

1. Multiple-tab edits must use field/question-level change metadata.
2. Non-overlapping edits should merge.
3. Newer values must not be silently overwritten by stale autosaves.
4. Same-field conflicts must be surfaced or deterministically resolved under a documented rule.
5. A submitted draft can never be reverted by a delayed save.

### M. Git and release control

1. The baseline tag and backup branch remain immutable.
2. Development occurs on `feature/durable-draft-recovery`.
3. Development prompts push the feature branch, not `main`.
4. The current production Base44 application remains the blue fallback.
5. The staging app must use the production name with the suffix `_staging`.
6. The clean production candidate must use the production name with the suffix `_next`.
7. The staging app is never promoted directly to production.
8. Production code is first deployed with the new process disabled.
9. A separate final enablement step activates the process.
10. Global activation is permitted only after all required automated and production-disabled checks pass.
11. No percentage canary or invitation canary is required by the approved decision.
12. A kill switch must remain available.

### N. Non-goals

The approved category N decisions are the explicit non-goals enumerated in the dedicated section below. They are exclusions, not deferred initial-release requirements.

## Accepted risks

### Email-only recovery privacy risk

Anyone who knows a client's exact normalized email may be able to retrieve and view the newest eligible questionnaire, including submitted answers. Neither initial email collection nor initial email-only recovery verifies ownership. Rate limits, delays, CAPTCHA, lockouts, generic errors, and auditing reduce abuse but do not turn knowledge of an email address into identity verification. Isaac knowingly accepts this privacy risk for the initial release because speed and client consistency are the current priority.

### Persistent password-only support grant risk

A persistent signed grant obtained from one shared support/admin password has weaker identity assurance and individual accountability than authenticated, individually assigned admin accounts. The lack of a fixed time expiration increases the consequence of device or browser compromise. Backend verification, scoped access, revocation mechanisms, rate limits, lockouts, safe grant handling, and auditing reduce but do not eliminate this risk. Isaac knowingly accepts this risk for the selected initial release workflow.

## Consequences

### Positive consequences

- Server-authoritative drafts remain recoverable after browser cache loss while local cache still supports fast and offline interaction.
- Existing entities and audit history are preserved rather than destructively replaced.
- Clients can recover with either an unverified email association or a draft-specific high-entropy code.
- Submitted records remain immutable while still supporting read-only viewing and PDF access.
- Clear All creates an auditable succession of records instead of erasing history.
- The blue/staging/next release structure and disabled-first production rollout preserve a source and application fallback.

### Security and operational consequences

- Public email-only recovery exposes questionnaire content to anyone who knows the exact email and gets through abuse controls.
- Password-only persistent support grants require strong backend scope, revocation, storage, and audit controls.
- Recovery-code confidentiality is critical because the raw code independently authorizes draft access.
- SES requires environment-aware routing, verified infrastructure, least-privilege credentials, and bounce/complaint operations before enablement.
- One-year draft/event retention and submitted-response access require dry-run cleanup, support holds, and verifiable retention jobs.
- Multiple-tab merge rules require per-field metadata and a server-side guard that makes submission terminal.
- Raw browser `File` and `Blob` objects remain inherently non-restorable after closure; only uploaded URLs and safe metadata can survive.

## Future-compatible design requirements

1. Recovery authorization must be modeled so email-only, recovery-code, OTP, and magic-link methods can coexist without replacing existing draft or event records.
2. OTP and magic-link paths must remain disabled in the initial release, with no active challenge issuance, verification, or recovery grant from those methods.
3. Enabling OTP or magic link later must be additive and must not require destructive migration of existing drafts, submitted snapshots, events, email associations, or recovery-code hashes.
4. Recovery events must be able to distinguish the authorization method, outcome, abuse-control decision, and grant version without storing raw codes, OTPs, magic-link tokens, or unrestricted entity data.
5. Email values must remain explicitly classified as associated/unverified until a future verification method actually succeeds.
6. Recovery codes must remain independently revocable/rotatable at the draft boundary while storing only a secure hash or keyed hash.
7. Signed support grants must remain scoped and versioned so secret rotation, grant-version changes, device forgetting, and storage clearing revoke them.
8. Draft state must preserve serializable answer, validation, touch, expansion, incomplete-editor, upload-URL, and safe upload-metadata state.
9. Per-field change metadata and a terminal submitted state must support deterministic conflict handling across tabs and delayed saves.
10. Email delivery must retain an environment boundary that redirects staging mail to an internal allowlist and prefixes the subject.
11. Release controls must support disabled-first production deployment, separate global enablement, and an enduring kill switch.
12. Later changes to verification, retention, cleanup, release activation, or data access require explicit policy and migration review under the supersession procedure.

### 2026-08-06 disabled verification-framework implementation note

The source now contains the additive, undeployed
`ProFormEmailVerificationAttempt` entity, separate OTP/magic-link HMAC
purposes, one-time lifecycle helpers, exact relative redirect allowlist,
verified recovery-session handoff claims, four feature-disabled functions, and
a storage-free client placeholder. OTP is six numeric digits with rejection
sampling, a 10-minute default/15-minute maximum lifetime, five default
attempts, and lockout. Magic tokens contain 256 bits of entropy and expire
after 30 minutes. Neither raw value is persisted or logged.

This implements structural compatibility only. `PRO_DRAFT_EMAIL_OTP_ENABLED`
and `PRO_DRAFT_MAGIC_LINK_ENABLED` remain false; the attempt entity is not
pushed; secrets are reserved but unconfigured; no URL, route, UI, email,
deployment, or initial-email-recovery replacement is authorized. Successful
future consumption preserves the existing recovery-email lookup identity and
requires an exact selected draft, so no destructive association migration is
needed. Activation remains subject to the supersession/security review below.

## Explicit non-goals (category N)

1. No client account-registration system.
2. No initial OTP requirement.
3. No initial magic-link requirement.
4. No general recovery-code email button.
5. No embedded email or collaboration widget.
6. No direct promotion of staging to production.
7. No deletion of the current blue production app.
8. No destructive replacement of `ProFormDraft` or `ProFormDraftEvent`.
9. No reliance on cookies as the only recovery mechanism.
10. No claim that Clear All erases browser history.

## Supersession procedure

1. Any change to an accepted decision requires a new ADR or an explicitly versioned superseding ADR; implementation prompts may not silently reinterpret this document.
2. Isaac Hines and Engineering must approve the superseding decision.
3. The new ADR must identify each changed decision, security impact, compatibility impact, data migration or retention impact, rollout plan, rollback plan, and required evidence.
4. The new ADR must link to this ADR and mark whether this ADR is superseded fully or only for named sections.
5. Security-sensitive changes, including enabling OTP or magic link, changing email-only access, changing grant lifetime, changing recovery-code handling, or changing retention, require explicit threat and privacy review.
6. Data-model changes must preserve historical auditability and use non-destructive migration unless a separately approved exception and recovery plan exist.
7. Until a superseding ADR is accepted and version-controlled, this ADR remains authoritative.

## Documentation-only action statement

This ADR records decisions only. Its creation did not change application behavior, entity schemas, packages, secrets, SES configuration, Base44 apps, Base44 cloud resources, production data, domains, release flags, or Git baseline references. No Base44 command or deployment was run.
