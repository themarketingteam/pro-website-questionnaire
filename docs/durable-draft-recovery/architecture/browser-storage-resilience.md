# Browser storage resilience

- Status: foundational adapter and storage-safe application boot implemented; questionnaire-store integration is deferred
- Date: 2026-08-05
- Sources: `src/lib/resilientStorage.js`; `src/lib/app-params.js`; `src/api/base44Client.js`; `src/lib/AuthContext.jsx`
- Tests: `src/test/storage/resilientStorage.test.js`; `src/test/appParamsSafety.test.js`; `src/test/base44ClientInitialization.test.js`; `src/test/authContextSafety.test.jsx`; `tests/e2e/draft-v2/storage-recovery.spec.js`

## Purpose and boundary

The resilient-storage adapter gives browser code a non-crashing asynchronous storage contract when browser persistence is available, partially restricted, or completely unavailable. It is suitable for a future Redux Persist integration and for direct string or JSON access.

This foundation does not change the current questionnaire store, create a server draft, add a recovery code, modify a Base44 entity, or authorize a user. A later integration prompt must deliberately replace the current Redux Persist storage binding after its boot and migration behavior is approved.

Browser storage is never an authorization boundary. Values in IndexedDB, localStorage, sessionStorage, or memory are client-controlled and must not prove identity, draft ownership, recovery permission, or administrative access. Future server-authority integration must authenticate and authorize every remote operation independently.

## Application boot integration

`app-params.js` now protects window/location acquisition, URL parsing, the localStorage property getter, reads, writes, document access, and history replacement. It retains the Base44 parameter set (`app_id`, `server_url`, `access_token`, `from_url`, and `functions_version`) and resolves non-empty values in this order: query parameter, Vite environment default, then stored value. Empty query/default values do not overwrite a last known stored value. No browser object is captured at module scope.

An `access_token` query value is captured synchronously and its removal is attempted without blocking initialization. Successful removal retains the path, unrelated query parameters, and fragment. If parsing or `replaceState` fails, initialization continues and diagnostics report only boolean capability/outcome fields; they never include parameter values or exception messages.

`base44Client.js` initializes exactly one real SDK client with `appId`, `serverUrl`, `token`, `functionsVersion`, and `requiresAuth: false`. A missing app ID or thrown/empty SDK result yields a null client plus a stable value-free error code. `App.jsx` renders `AppInitializationError` only for that real client-initialization failure; it does not fabricate an app ID or a production client.

`AuthContext.jsx` bounds both the public-settings request and authenticated-user lookup to 4,000 ms. Every rejection and timeout exits both startup loading flags. Only allowlisted error types and fixed messages reach React state; raw backend messages, response bodies, tokens, and error objects are not logged. A public-settings/auth availability error remains non-blocking for the public questionnaire, while explicit 401/403 authentication requirements preserve the existing login behavior.

The initialization and render error screens state that saved information was not intentionally deleted. Reload/retry is non-destructive. The render boundary retains a separate delete-and-reload action, but labels it as permanently clearing browser-saved questionnaire state and never runs it automatically.

## Public API

The module exports:

- `STORAGE_MODES` and `STORAGE_ERROR_CODES`;
- `StorageAdapterError`;
- `createResilientStorage(options?)` and `defaultResilientStorage`;
- `probeBrowserStorageCapabilities()` and `getStorageDiagnostics()`;
- protected local/session storage access helpers; and
- `resetStorageDiagnosticsForTests()`, which is explicitly test-only.

Each adapter implements `getItem`, `setItem`, and `removeItem` as Promise-returning Redux Persist-compatible methods. It also implements `getJson`, `setJson`, `removeJson`, `probe`, `getMode`, and `getDiagnostics`.

An empty/non-string key and a non-string base-adapter value are explicit programmer errors and reject with `StorageAdapterError`. Browser persistence failures do not reject: the operation continues through the fallback chain.

## Fallback and conflict rules

The persistent preference order is:

1. native IndexedDB;
2. localStorage; and
3. adapter-instance memory for the current page lifetime.

IndexedDB uses database `pro_questionnaire_browser_cache`, object store `key_value`, version `1`, and records containing `key`, `value`, `updatedAt`, and `schemaVersion`. It opens and performs transactions with a default 1,500 ms timeout. Tests can inject a shorter timeout and a fake IndexedDB factory. Handles are closed after each operation and late open success after a timeout is also closed.

localStorage fallback values use a versioned envelope containing the string value and update metadata. Existing raw localStorage strings remain readable as legacy values. When multiple layers contain a record, the newest `updatedAt` wins; equal timestamps prefer IndexedDB, then localStorage, then memory. This prevents a successful fallback write from being hidden later by a stale preferred-layer copy.

By default, a successful IndexedDB write removes a stale localStorage copy. The optional `mirrorToLocalStorage` setting writes the same versioned record to both durable layers. Mirroring is off by default so the adapter does not create untracked competing copies.

Removal is best effort across IndexedDB, localStorage, and memory. One layer's failure does not prevent cleanup in the remaining layers. The module never calls `localStorage.clear()` and never clears the IndexedDB database because a key or record is malformed.

## Durability and diagnostics

| Mode | Meaning | Survives reload? |
| --- | --- | --- |
| `indexeddb` | The authoritative write succeeded in IndexedDB. | Expected, subject to browser eviction and user controls. |
| `localstorage` | IndexedDB failed and the write succeeded in localStorage. | Expected, subject to browser eviction, quota, and user controls. |
| `memory_only` | Every persistent write failed; the value exists only in this adapter instance. | No. |
| `unknown` | No operation or capability probe has established a mode. | Not established. |

Diagnostics contain only layer names, status/error codes, counters, capability states, mode, and durability. They never contain stored values or storage keys. A missing key is recorded as `missing`, which is distinct from a failed read. A memory-only write is always `durable: false`.

Capability results describe what was observed during the latest operations; they are not a permanent browser guarantee. A later operation can downgrade or recover a layer.

## Error codes

Programmer and JSON codes:

- `invalid_key`, `invalid_value`;
- `json_circular_value`, `json_parse_failed`;
- `json_serialization_failed`, `json_unsupported_value`.

IndexedDB codes:

- `indexeddb_unavailable`, `indexeddb_open_failed`, `indexeddb_open_blocked`;
- `indexeddb_open_timeout`, `indexeddb_operation_timeout`;
- `indexeddb_transaction_aborted`, `indexeddb_transaction_error`;
- `indexeddb_request_error`, `indexeddb_invalid_state`;
- `indexeddb_security_error`, `indexeddb_record_invalid`.

Web Storage codes:

- `localstorage_unavailable`, `localstorage_read_failed`;
- `localstorage_write_failed`, `localstorage_remove_failed`;
- `localstorage_quota_exceeded`;
- `sessionstorage_unavailable`, `sessionstorage_read_failed`;
- `sessionstorage_write_failed`, `sessionstorage_remove_failed`.

The adapter does not expose browser exception messages because they can vary by browser and may contain unsafe context. Callers should branch on stable error codes.

## JSON safety

`setJson` validates and serializes the entire new value before calling any storage write. It accepts JSON primitives, arrays, and plain objects. It rejects cycles, non-finite numbers, `undefined`, functions, symbols, `BigInt`, symbol-keyed properties, Blob/File values, DOM nodes, dates, maps, sets, and other non-plain instances. It does not use the compatibility `safeJsonStringify` circular replacement.

Because validation happens first, a serialization failure cannot overwrite the last known good value. `getJson` returns its caller-supplied fallback for missing or malformed JSON, records `json_parse_failed` for malformed content, and leaves the stored bytes untouched for later diagnosis or recovery.

## Session storage helpers

`tryGetSessionStorage`, `safeSessionGetItem`, `safeSessionSetItem`, and `safeSessionRemoveItem` protect both the `sessionStorage` property getter and the operation itself. Session storage is intentionally outside the draft-persistence fallback chain. It is available for future short-lived recovery/admin session state but cannot establish authority across a reload or between devices.

The compatibility helpers in `browserSafety.js` now use the same protected-object-access pattern and include local/session remove functions. Existing callers remain supported while authoritative draft state is directed toward the resilient adapter.

## Test matrix

The storage suite uses development-only `fake-indexeddb` plus controlled Web Storage doubles. It covers:

- IndexedDB success, missing keys, thrown open, open timeout, transaction abort, and getter denial;
- localStorage getter/read/write/quota failures;
- localStorage durability, memory-only fallback, and all-persistent-layers-unavailable behavior;
- best-effort removal, optional mirroring, metadata conflict resolution, concurrent keys, and isolated adapter memory;
- malformed JSON, circular overwrite protection, and rejection of functions, symbols, Blob values, and DOM nodes;
- protected session helpers and the existing browser-safety compatibility API;
- Redux Persist Promise signatures, invalid caller inputs, diagnostics modes, test reset, and absence of storage logging.

Boot-specific unit coverage adds window/document absence, malformed URL parsing, throwing storage getter/read/write/quota operations, throwing history replacement, parameter precedence, token URL cleanup, value-free client diagnostics, request rejection, and never-settling request timeouts. The activated `DR-BOOT-001`/`DR-BOOT-002` Playwright matrix covers normal storage, four localStorage failure modes, unavailable IndexedDB, and all persistent storage unavailable. It runs in the five configured Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari projects with writes and cross-origin requests denied.

These source and local-browser tests are implementation evidence, not staging or production certification. The release still requires the named staging, production-disabled, and post-enable evidence in the traceability matrix.

Timeout tests wait beyond settlement and assert that no unhandled rejection is emitted. Full application, characterization, Playwright fixture, lint, type-check, and build results remain part of the prompt validation record rather than being treated as durability guarantees.

## Future integration

The later questionnaire-store integration must inject `defaultResilientStorage` into Redux Persist, preserve versioned state normalization/migration, expose a non-sensitive storage warning when mode is `memory_only`, and keep the questionnaire usable while rehydration completes or persistence is denied. Server synchronization must treat local state as an untrusted replica and resolve authority through authenticated server records; it must not infer authorization from any browser-stored identifier or token.
