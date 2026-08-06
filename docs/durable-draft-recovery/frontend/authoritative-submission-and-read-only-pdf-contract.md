# Authoritative submission and read-only PDF contract

Status: implemented as local source and synthetic tests on 2026-08-06. No Base44 deployment or production operation was performed.

## Phase model

`proDraftSubmissionCoordinator.js` owns the ten phases: `idle`, `validating`, `saving_validation_state`, `flushing_draft`, `locking_submit_attempted`, `submitting`, `saving_submitted`, `saving_submit_failed`, `completed`, and `failed`.

Final validation is applied through one canonical Redux mutation. Its validation, touched, expanded, text-validation, and confirmation credential fields are then flushed to browser persistence and the authoritative API. An invalid result remains editable and never reaches an external submission boundary.

## Immutable submission boundary

After validation is accepted, the coordinator reads canonical Redux again, normalizes and deep-clones it, computes its deterministic SHA-256 state hash, transforms and repairs the business payload, adds draft/session/hash/environment metadata, and deep-freezes the resulting snapshot. ProFormSubmission, durable intake fallback, and Zapier receive this mapped payload through the existing resilient submission path. Mutable Redux is not reread within that external operation.

The current intake interpretation is preserved: a successful `ProFormSubmissionIntake` write means the questionnaire was durably received and completes the client lifecycle with an `intake:<id>` final identity. A failed primary and failed intake remains `submit_failed`.

## Locking and success

Ordinary debounce/retry work is canceled after the pre-submit flush. `submit_attempted` must be accepted by the draft API before the external call begins. On external success, the final ID and timestamp are written into the canonical draft, and the submitted save is accepted only when status and state hash match.

The submitted canonical state remains in the scoped browser cache and authorized Base44 draft record. The safe receipt stores draft ID, final ID, timestamp, submission/PDF hashes, PDF availability, and the lock-pending flag; it never duplicates answers or credentials. Submitted reducers reject ordinary mutations and the sync manager rejects delayed saves.

## Partial success and failure

If the external submission succeeds but the final draft lock cannot be confirmed, the client immediately becomes read-only, preserves the final ID and full canonical cache, sets `submissionLockPending=true`, and retries only the submitted draft save. The external operation is not invoked again automatically.

If external submission fails, `submit_failed` is saved with a safe code. Answers, scoped cache, and the credential vault remain available, and no submitted receipt is created.

## Read-only recovery and PDF

`ProQuestionnaireReadOnlyView.jsx` renders the recovered submitted draft in question order, applies submitted conditional visibility, exposes no mutation controls, and provides PDF, Start New, and Recover Different Questionnaire actions. Clear All, reset, edit, and save controls are absent.

`proDraftSubmittedPdfService.js` requires a submitted canonical state and matching receipt identity/timestamp/hash. It builds the existing PDF model from that exact draft’s responses, business name, domain, and authoritative submitted timestamp. It never selects a newer email-associated draft and never includes recovery tokens, recovery codes, email, or administrative metadata. Recovered and immediate generation from the same canonical snapshot have identical source hashes and models.

Start New uses the existing replacement transaction and creates an independent draft without mutating the submitted record or its PDF source.

## Compatibility and tests

The coordinator delegates entity creation, payload repair, retry, intake fallback, and environment-aware Zapier handling to `proQuestionnaireSubmit.js` and `proSubmissionResilience.js`. Existing ProFormSubmission shape is retained with the new top-level linkage metadata.

Focused unit coverage contains 28 authoritative-submission/PDF cases plus submitted sync and Redux foundation suites. The synthetic Playwright specification contains the required 17 cases and runs under the five configured browser/device projects. Live staging behavior remains a separate release gate.

## Staging certification status — 2026-08-06

The [full lifecycle staging attempt](../testing/staging-full-draft-lifecycle-certification.md)
is **FULL_DRAFT_LIFECYCLE_BLOCKED**. The coordinator/read-only/PDF/sync focused
set passed 80/80, but a later required repair-helper gate failed 2 of 124 tests.
No schema, function, site, record, external submission, PDF, or browser session
was deployed or exercised. The source contract remains implemented but not
environment-certified.
