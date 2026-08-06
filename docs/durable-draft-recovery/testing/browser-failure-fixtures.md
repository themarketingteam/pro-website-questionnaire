# Browser failure and concurrency fixtures

- Status: fixture mechanics and browser-local canonical-cache acceptance implemented; server-linked durable-draft V2 acceptance remains pending
- Date: 2026-08-05
- Scope: local, read-only harness validation and future staging-only acceptance support

## Evidence categories

The browser suite keeps three evidence categories separate:

1. **Harness validation** uses `[HARNESS]` titles under `tests/e2e/harness/`. These tests prove that a browser fault, offline transition, lifecycle event, or isolation primitive behaves as configured. They do not certify application recovery.
2. **Current baseline characterization** remains in the opt-in Vitest files under `src/test/baseline-characterization/`. Those tests record existing defects and are not release acceptance.
3. **Requirement acceptance** lives under `tests/e2e/draft-v2/`. Browser-local boot, cache, fallback, reload, malformed-cache, and client-isolation scenarios are active. Server recovery, email, revision/CAS, server-backed multi-tab conflict, server clear, submission locking, and offline reconciliation remain explicit `test.fixme` cases. A passing harness test cannot make a pending server scenario pass.

No fixture in this foundation submits a questionnaire, sends email, uploads a file, calls Zapier, or deploys Base44 resources.

## Storage modes

`tests/e2e/fixtures/storageFixtures.js` installs its shim with `context.addInitScript`, so the selected mode exists before the first application script on every subsequent navigation. Playwright supplies a fresh context per ordinary test; tests that create extra contexts must close them explicitly.

| Mode | Simulation | DOM exception |
| --- | --- | --- |
| `normal` | Browser storage is unchanged. | — |
| `localstorage_getter_throws` | Reading `window.localStorage` fails. | `SecurityError` |
| `localstorage_read_throws` | Local-storage read operations fail while writes remain available. | `SecurityError` |
| `localstorage_write_throws` | Local-storage mutation operations fail. | `SecurityError` |
| `localstorage_quota_exceeded` | Reads work and mutations fail as if quota is exhausted. | `QuotaExceededError` |
| `sessionstorage_getter_throws` | Reading `window.sessionStorage` fails. | `SecurityError` |
| `sessionstorage_unavailable` | `sessionStorage` is absent. | — |
| `indexeddb_unavailable` | `indexedDB` is absent. | — |
| `indexeddb_open_throws` | `indexedDB.open()` fails synchronously. | `InvalidStateError` |
| `indexeddb_transaction_fails` | An opened database rejects transactions. | `InvalidStateError` |
| `all_persistent_storage_unavailable` | Local storage throws; session storage and IndexedDB are absent. | `SecurityError` for local storage |

Capability diagnostics return only availability booleans and exception names. Their probe key/value is synthetic and removed when writes work; stored questionnaire values are never read or printed.

Example:

```js
await installStorageFailureMode(context, 'localstorage_quota_exceeded');
await page.goto('/');
const capabilities = await getStorageCapabilityDiagnostics(page);
```

Browser engines differ in native property descriptors, private-mode quota behavior, and when they surface IndexedDB failures. The fixture deliberately uses standards-level shims with stable exception names rather than reproducing an engine’s internal object identity. Native Safari private browsing, enterprise policies, and real exhausted device storage still require manual device validation.

### Canonical-cache helpers

The fixture also exports:

- `readCanonicalDraftCache(page)`, which selects the newest namespaced `:draft-cache` record from IndexedDB/localStorage and parses only synthetic test state;
- `replaceCanonicalDraftCacheWithMalformed(page)`, which replaces only namespaced canonical-cache records for malformed-envelope fallback testing; and
- `installRuntimePersistentWriteFailure(page)`, which injects post-commit IndexedDB/localStorage write failures so reload can prove the previous durable record survived.

These helpers never enumerate or print production data. Active specs use unique `example.test` identities against the read-only local target. Cache inspection is test-only and is not production diagnostic UI.

## Network and offline modes

`tests/e2e/fixtures/networkFixtures.js` injects only on recognized draft paths. Static assets fall through unchanged. Documented production hosts and Zapier are independently denied. Records contain only method, sanitized route, relative timing, and status; request headers and bodies are never captured.

| Mode | Behavior |
| --- | --- |
| `online` | Known draft requests continue normally. |
| `offline_before_load` | The context starts offline and recognized draft requests deterministically abort. |
| `offline_after_load` | The caller loads the page, then invokes `goOffline()` when required. |
| `draft_save_timeout` | A recognized draft request is held until manually released or aborted. |
| `draft_save_500` | A recognized draft request receives a synthetic HTTP 500. |
| `draft_save_connection_reset` | A recognized draft request aborts with a connection-reset classification. |
| `slow_network` | A recognized draft request waits for the configured delay, then falls through. |
| `duplicate_response` | Repeated recognized requests receive the same explicitly synthetic response marker. |
| `out_of_order_response` | Requests are queued and released by index in the test-selected order. |

Example:

```js
const network = await installNetworkScenario(page, context, 'out_of_order_response');
// Trigger two known draft requests without logging their bodies.
await network.releaseAt(1, { marker: 'second-first' });
await network.releaseAt(0, { marker: 'first-second' });
await network.dispose();
```

`reconnect()` restores online state. `dispose()` aborts unreleased synthetic requests, restores the context to online, and removes handlers. These controls simulate browser-visible network behavior; they do not reproduce every proxy, radio, TLS, or server-side queue failure.

## Lifecycle fixtures

`tests/e2e/fixtures/lifecycleFixtures.js` supports controlled `visibilitychange`, `pagehide`, and best-effort `beforeunload`; page/context close; back/forward navigation; mobile viewport background/reopen simulation; and creating a fresh context from captured storage state.

The visibility shim must be installed before navigation. `beforeunload` is dispatched as a cancelable browser event, but engine automation intentionally limits real unload dialogs. Closing a Playwright page or context is observable shutdown, not an operating-system kill. A browser crash, force-quit, mobile eviction, power loss, and process termination must be validated manually on real supported devices because Playwright cannot guarantee the same final I/O or process timing.

## Multi-tab and context fixtures

`tests/e2e/fixtures/multiTabFixtures.js` provides:

- two controlled pages in one browser context;
- two independent contexts with isolated storage;
- same-draft/different-client synthetic identity URLs;
- tab A/tab B evaluation controls;
- per-tab delayed network ordering;
- BroadcastChannel capability detection and pre-navigation unavailability injection; and
- safe accepted-revision marker capture for later V2 tests.

New pages receive the Prompt 2 read-only network policy by default. Identity values must be 8–64 safe synthetic characters and never contain an email, recovery code, access token, or production identifier.

## Synthetic questionnaire data

`tests/e2e/fixtures/questionnaireFixtures.js` supplies stable synthetic business, domain, user, and question values plus one unique run ID. Emails and domains use `example.test`; business names begin `E2E STAGING`; the second-client helper changes every client identity while retaining the same cleanup run ID. Certification and guarantee fixtures contain descriptive metadata only—never a real file or upload.

Future staging writes require all of the following:

- `E2E_TARGET_ENVIRONMENT=staging`;
- `E2E_ALLOW_WRITES=true`;
- a reviewed write-capable spec importing the write-gated fixture;
- `test_run_id` and `environment=staging` markers; and
- an approved cleanup procedure.

Local and production targets reject the write flag before launch.

## Requirement mapping and pending activation

| Requirement | Browser coverage state |
| --- | --- |
| `DR-BOOT-001`, `DR-BOOT-002` | Storage-fault boot matrix and bounded bootstrap. |
| `DR-LOCAL-001`, browser-local part of `DR-MUT-001` | Active last-good snapshot, canonical reload, storage-state, validation/expanded/touched, fallback-mode, malformed-cache, and truthful-status coverage. Canonical server `DR-SAVE-001` remains pending. |
| `DR-OFFLINE-001` | Offline outbox, lifecycle flush, and reconnect. |
| `DR-CONCUR-001` | Merge, conflict, stale-save, duplicate, and ordering behavior. |
| `DR-LOCAL-002`, `DR-SEC-001` | Same-profile browser client isolation is active; server/cross-context recovery authorization remains pending. |

Run the non-strict report during foundation work:

```bash
npm run test:e2e:pending-report
```

It emits both text and JSON and exits zero while clearly listing pending release-blocking tests. Release workflows must use:

```bash
npm run test:e2e:pending-strict
```

Strict mode still fails while any server-linked requirement placeholder remains. Activation requires the corresponding production code, lower-level tests, staging feature flags, safe write/cleanup authorization where applicable, and observed browser evidence. Removing a pending test merely to make strict mode green is prohibited.

The current non-strict report contains eight pending scenarios across `DR-CONCUR-001`, `DR-OFFLINE-001`, `DR-SAVE-001`, and `DR-SEC-001`. The activated browser-local cache and isolation subset passes 70/70 executions across the five configured projects; ten executions remain skipped because canonical server recovery and cross-context recovery authorization are intentionally outside this batch.

## Validation commands

```bash
npm ci
npm run test:e2e:harness
npm run test:e2e:pending-report
npm run test:e2e:pending-strict
npm test
npm run lint
npm run typecheck
npm run build
```

Harness output and Playwright traces remain subject to the redaction and artifact-handling rules in `e2e-test-harness.md`. Sensitive query fields, authorization material, cookies, and request bodies must never be added to fixture diagnostics.
