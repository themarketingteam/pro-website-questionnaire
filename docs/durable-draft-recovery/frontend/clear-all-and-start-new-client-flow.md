# Clear All and Start New Client Flow

- Status: Implemented locally; environment certification pending
- Date: 2026-08-06
- Deployment: None performed or authorized by this change

## User interface contract

Active drafts expose **Clear All**. Its confirmation title is **Start over with a new questionnaire?** and explains that the current draft is archived for support, removed as the email’s automatically opened draft, and replaced by a new blank draft with a new recovery code. The warning says that website-managed information for the current draft is cleared and explicitly says browser history is not erased.

Submitted read-only drafts do not expose Clear All. Outside the disabled review fieldset they expose **Start a New Questionnaire**. Its confirmation says the submitted questionnaire remains unchanged and a separate blank questionnaire and recovery code are created.

Both paths finish in the **Save your new recovery code** acknowledgement dialog. The full code remains in component/controller memory until the user confirms it was copied or saved. The dialog masks the recovery email and reports one of four exact delivery outcomes: delivered, staging redirected, failed, or no associated email. Email failure never rolls back a committed replacement. A retry control exists only when the operation explicitly permits retry, the raw code is still in memory, and the attempt/backoff limit has not been reached.

## Clear All sequence

1. The confirmation dialog opens; Cancel receives initial focus and Enter cannot trigger the destructive action unless the confirm button itself is focused.
2. The controller deduplicates confirmation clicks and forces the local canonical persistence controller to flush.
3. It forces an authoritative server save and requires an accepted server revision.
4. It stops the old sync manager and invokes `clearAndReplaceProFormDraft` with exact vault authorization, the accepted revision, a cryptographic idempotency key, and a cryptographic replacement resume token.
5. A recovery-required response is retried only with the same idempotency key and source request. The old local namespace is preserved until the existing transaction is confirmed committed.
6. After commit, the manager is invalidated, timers/event delivery are cancelled, late callbacks are generation-rejected, and the manager is disposed.
7. A namespace derived from the replacement draft ID is created. The new resume credential bundle is stored there without putting the raw code or any token in Redux.
8. Only the old namespace’s `draft-credentials`, `draft-cache`, `redux-state`, `last-server-base`, and `pending-events` keys are removed. Other clients and namespaces are not enumerated or cleared.
9. The replacement is loaded from the authoritative draft API, saved to its canonical cache, hydrated into Redux, and handed to a new draft-tagged sync manager.
10. Internal history state records only opaque draft/namespace/read-only metadata. It never contains a recovery code or token and no hard reload occurs.
11. After code acknowledgement, raw one-time controller memory is cleared and focus/scroll returns to Question 1.

The backend replacement transaction already emits `draft_replacement_committed`; the client therefore does not duplicate a clear/supersession event.

## Start New sequence

Start New uses the same secure idempotency, credential, authoritative-load, acknowledgement, and manager-switch boundaries. It requires a submitted canonical source. It does not supersede or delete the submitted draft, does not remove its namespace, credential bundle, canonical cache, receipt, or PDF source, and does not force a server mutation of that record. Browser Back resolves the history metadata as submitted/read-only; recovery can also reopen it.

## Partial failure and recovery

Before commit, server/API failure resumes the existing manager and preserves the old namespace. A partial commit keeps returned one-time credentials in memory, then invokes the same backend operation with the same idempotency key so the server identifies the already-created transaction. No second draft is created blindly. After a committed replacement, a credential/cache load failure is reported as a safe recovery condition; the committed server records remain authoritative and support-recoverable.

## Browser and cache safety

Namespace derivation uses only an opaque draft identifier hash. Cleanup calls exact storage keys and never `clear()`, `localStorage.clear()`, IndexedDB database deletion, or broad prefix enumeration. Submitted history stays read-only; superseded history stays non-editable. The sync manager tags its source draft and rejects saves/events whose lifecycle generation predates invalidation or disposal.

## Test evidence

- Focused API/controller/dialog/sync/namespace/store validation: **83/83 passed**.
- API client coverage includes exact Base44 function names, vault authorization, feature flag, secure idempotency/token generation, partial response, and safe errors/diagnostics.
- Controller coverage includes forced flush/save, failure stop, commit, partial recovery, duplicate confirmation, exact namespace cleanup, Client B retention, new hydration/manager, submitted preservation, safe history, email result, and raw-memory acknowledgement.
- Component coverage includes exact wording, cancellation/confirmation, safe initial focus, modal/mobile semantics, code copy/acknowledgement, four delivery messages, masking, and bounded retry.
- Sync lifecycle coverage proves delayed save completion after supersession cannot dispatch an accepted revision into Redux.
- Synthetic E2E: **90/90 passed** (18 scenarios in `tests/e2e/draft-v2/clear-all-and-start-new.spec.js` across Chromium, Firefox, WebKit, mobile Chromium, and mobile WebKit).
- Full normal suite: **1,650/1,655 passed** after updating the now-obsolete next-batch Clear All guard. The five remaining failures are the established Q24/backup/geographic normalization and submission-repair assertions outside this flow.
- `npm run build` passed. Changed-file lint has no errors. Repository-wide lint remains blocked by 32 established errors and 16 warnings; repository-wide typecheck remains blocked by established project-wide JavaScript/dependency typing debt, with no errors in the replacement-flow file set.

Local synthetic evidence is not staging or production certification. No real email, final submission, Base44 deployment, schema push, or production mutation is part of these tests.
