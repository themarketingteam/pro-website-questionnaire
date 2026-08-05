# Browser storage resilience

- Status: foundational adapter implemented; questionnaire-store integration is deferred
- Date: 2026-08-05
- Source: `src/lib/resilientStorage.js`
- Tests: `src/test/storage/resilientStorage.test.js`

## Purpose and boundary

The resilient-storage adapter gives browser code a non-crashing asynchronous storage contract when browser persistence is available, partially restricted, or completely unavailable. It is suitable for a future Redux Persist integration and for direct string or JSON access.

This foundation does not change the current questionnaire store, create a server draft, add a recovery code, modify a Base44 entity, or authorize a user. A later integration prompt must deliberately replace the current Redux Persist storage binding after its boot and migration behavior is approved.

Browser storage is never an authorization boundary. Values in IndexedDB, localStorage, sessionStorage, or memory are client-controlled and must not prove identity, draft ownership, recovery permission, or administrative access. Future server-authority integration must authenticate and authorize every remote operation independently.

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

Timeout tests wait beyond settlement and assert that no unhandled rejection is emitted. Full application, characterization, Playwright fixture, lint, type-check, and build results remain part of the prompt validation record rather than being treated as durability guarantees.

## Future integration

The later application-boot integration must inject `defaultResilientStorage` into Redux Persist, preserve versioned state normalization/migration, expose a non-sensitive storage warning when mode is `memory_only`, and keep the questionnaire usable while rehydration completes or persistence is denied. Server synchronization must treat local state as an untrusted replica and resolve authority through authenticated server records; it must not infer authorization from any browser-stored identifier or token.
