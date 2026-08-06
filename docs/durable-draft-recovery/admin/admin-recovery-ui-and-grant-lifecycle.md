# Admin recovery UI and grant lifecycle

Status: implemented source contract; staging certification pending<br>
Branch: `feature/durable-draft-recovery`<br>
Date: 2026-08-06

## Authorization gate

`/admin/draft-recovery` and `/admin/questionnaire-intake-recovery` mount the
`ProDraftAdminAuthorizationProvider`, `DraftRecoveryPasswordGate`, and
`ProDraftAdminRecoveryShell`. The provider first asks the isolated grant vault
to validate a stored grant. A valid current-environment, current-policy,
device-bound grant opens the shell without password re-entry. Missing,
malformed, revoked, version-mismatched, or rejected credentials return the UI
to the password gate.

The password is held only in the gate input, sent once to the password
authorization function, and cleared before the request completes. The UI does
not compare passwords. Error copy is generic. Authenticating, rate-limited,
locked, and storage-failure states disable unsafe repeat submission and expose
accessible status text.

The signed admin grant has no fixed expiry. It is isolated from Redux, URLs,
ordinary component context, visible DOM, analytics, and logs. The shell gives
ordinary recovery components only an authorized API client and UI cache/edit
coordination functions.

## Persistent and memory-only modes

The grant vault stores the grant bundle and random admin device identifier
through resilient storage. When browser persistence is unavailable it falls
back to page-lifetime memory and displays:

> This browser is not allowing persistent storage. You may need to enter the recovery password again after closing it.

Memory-only mode is functional but never described as persistent. It can
require password re-entry after reload or browser restart.

## Forget this device

The shell exposes `Forget this device` with an explicit confirmation. The
authorization client attempts the backend forget audit on a best-effort basis,
then removes the local grant and random admin device ID even if that audit is
unavailable. The shell clears only admin API caches and active admin-edit UI
state. It does not clear questionnaire drafts, recovery codes, client Redux,
or questionnaire browser storage. The provider then returns to the password
gate.

If an API rejects a grant during an active edit, the client removes the invalid
grant and the shell warns that unsaved administrative edit values will be
discarded before returning to the gate.

## Backend-only APIs

The browser recovery UI uses `proDraftAdminApiClient` for:

- paginated draft list and exact draft detail;
- paginated event history and lineage/duplicate diagnostics;
- allowlisted revision-safe draft updates;
- paginated intake list and exact intake detail;
- authorized retry, diagnosis, repair, and repair-plus-retry.

The client attaches the current grant and device ID in the JSON request body.
It never places them in a URL. The protected functions authorize before
service-role entity access, return bounded projections, and produce safe audit
events. Frontend direct access to draft, event, intake, recovery-security, and
email-verification-attempt entities is prohibited by
`npm run test:admin-no-direct-entities`.

## Pagination and exact search

Draft list requests default to 25 rows and allow 25, 50, or 100. Status and
environment filters execute on the server. Search requires both an allowlisted
mode and explicit submit: Draft ID, Session ID, Final submission ID, Recovery
email, or Domain. Input settles for 300 ms before submit is enabled; partial
email text is never sent on each keystroke. Query-bound signed cursors prevent
reuse under another filter/search specification.

Intake records and event history use independent server cursors. Draft and
intake details load only when expanded. Events load only when the Events view
is selected.

## Editing, events, and lineage

The edit panel displays only approved fields, validates mapped JSON, requires
an edit reason, sends a fresh idempotency key and expected server revision,
and shows audit success. A conflict reloads the latest revision while keeping
the administrator's unsaved form values visible for comparison. Submitted
content is read-only; approved retention controls remain available. Migration
source IDs are read-only and recovery/security hashes are never rendered.

Event history shows safe summaries and redaction level by default. Stored
event JSON requires explicit `Show stored event value` opt-in and warns that
client-entered questionnaire content may appear. Backend projection continues
to suppress credential-shaped values.

Lineage shows previous/replacement links, generation, supersession reason,
replacement transaction status, duplicate candidates, and a selection
recommendation. Submitted and active records receive a do-not-merge warning.
There is no automatic merge or delete operation.

## Retry, repair, and external side effects

Draft and intake retry/repair calls use the same authorized client. They retain
server-side environment routing: suppressed delivery is reported as
suppressed, staging redirect as redirected, and no request-body destination
override exists. `AI Repair + Retry` states that a successful repair can create
a final submission.

## Test surfaces

- Gate/context/client tests cover restore, password entry, generic failure,
  lock/rate limiting, memory-only behavior, grant isolation, revocation, and
  forgetting.
- Admin component tests cover shell state, list/detail pagination, exact API
  routing, edit validation/success/conflict/submitted lock, event opt-in,
  lineage/duplicate warnings, intake retry/repair, and suppression/redirect.
- Backend service tests cover bounded projections, signed cursors, JSON
  diagnostics, allowlists, revision/idempotency, and intake list/detail.
- The static frontend boundary check rejects prohibited entity access.
- Local Playwright covers the real gate in every configured browser project,
  storage denial, mobile layout, URL/DOM credential absence, and sensitive
  entity request absence. Credentialed end-to-end admin workflows remain
  staging-only pending an explicitly configured synthetic password/corpus.

## Local validation record

Observed on 2026-08-06 after `npm ci`:

| Command | Result |
|---|---|
| Focused admin gate/context/client/service/page/component suites | `PASS` — 73/73 |
| `npm run test:admin-no-direct-entities` | `PASS` — 8 frontend source files |
| `npm test` | `FAILED` — 1,789/1,794 passed; five established failures remain in `proQuestionnaire.regression.test.jsx` and `proSubmissionRepairHelpers.test.js` |
| Admin Playwright spec, five configured projects | `PASS` for executable local scope — 12 passed, 8 intentionally skipped (desktop-only mobile assertions and credentialed staging-only scenarios) |
| `npm run lint` | `FAILED` — 28 errors and 14 warnings in established non-admin files; the migrated admin files produced no lint finding |
| `npm run typecheck` | `FAILED` — repository-wide `checkJs`/dependency/type-declaration debt, including generic UI primitive inference across existing and migrated JSX |
| `npm run build` | `PASS` |
| Redux/URL/console credential-sink source scan | `PASS`; the sole production `adminGrant` occurrence is the intended JSON request-body transport in `proDraftAdminApiClient` |

The first browser run also found that the visual gate title lacked heading
semantics. The gate was corrected to an `h1`; the rerun passed in Chromium,
Firefox, WebKit, mobile Chromium, and mobile WebKit.

No deployment, schema push, Base44 data mutation, production access, or Git
push is part of this source change.
