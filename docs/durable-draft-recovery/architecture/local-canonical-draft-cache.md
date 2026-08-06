# Local Canonical Draft Cache Contract

- Cache envelope version: `1`
- Canonical schema version: `4`
- Browser namespace/key version: `v5`
- Cache key: `pro-questionnaire:v5:<hashed-namespace>:draft-cache`
- Runtime modules: `src/lib/questionnaireCanonicalDraftCache.js` and `src/components/store/localCanonicalDraftPersistence.js`
- Authority: browser-local recovery aid only; never server authority

## Scope and authority

The cache stores the complete canonical questionnaire projection after Redux reducers finish. It provides deterministic same-browser reload continuity through the existing resilient IndexedDB → localStorage → page-memory adapter. It does not create a Base44 record, acknowledge a server revision, authorize recovery, enable Draft V2, synchronize tabs, or prove cross-device durability.

The cache key contains only the established hashed questionnaire namespace. Canonical identity metadata and the normalized recovery-email association may exist in canonical state, but authorization tokens and raw recovery codes are forbidden. The separate `draft-credentials` vault owns recovery authorization material. Raw email, business, domain, user ID, token, or recovery material never appears in either key name. Browser-origin access controls are not a server authorization boundary.

## Envelope

Every write validates this complete envelope before replacing the prior value:

```json
{
  "cacheVersion": 1,
  "namespaceVersion": "v5",
  "canonicalStateJson": "{...stable canonical schema-v4 JSON...}",
  "canonicalStateHash": "64-lowercase-hex-sha256",
  "canonicalStateSchemaVersion": 4,
  "savedAtClient": "2026-08-05T12:00:00.000Z",
  "storageMode": "indexeddb",
  "byteSize": 1234
}
```

`canonicalStateJson` and `canonicalStateHash` are produced only by canonical serialization and hashing functions. `byteSize` is the UTF-8 byte length of `canonicalStateJson`. `savedAtClient` is non-authoritative. `storageMode` is the adapter mode that accepted the write: `indexeddb`, `localstorage`, or `memory_only` (with `unknown` permitted before capability resolution).

The implementation warns with value-free diagnostics in development/test when canonical JSON exceeds 750 KB. It neither truncates nor silently drops categories.

## Write and failure preservation

The post-reducer subscriber uses a 100 ms debounce and a 500 ms maximum wait. Synchronous Redux actions coalesce. A canonical hash equal to the last confirmed hash is skipped. Bootstrap/sync-only actions do not alter canonical hash input, so status updates cannot create a persistence loop.

Serialization, validation, hashing, quota, and adapter failures occur before or instead of replacing the last known good envelope. A malformed existing envelope is returned as a typed failure and is not deleted automatically. Bootstrap suppresses its first write when a malformed, incompatible, diverged, or otherwise indeterminate cache must be preserved; the cache can be replaced only after a real form change produces a different canonical hash.

After a successful write, Redux receives local-only status:

- `local_saved` for IndexedDB/localStorage;
- `offline_local_only` for page-memory fallback;
- `error` with a safe code for a failed write.

Local persistence never increments `clientRevision` or `serverRevision`, never reports `server_saved`, and never invokes a Base44 client or network API.

## Bootstrap selection

The V2 recovery coordinator reads this cache before its scoped credential
vault and before any authoritative API call. It does not dispatch an empty
state while client choice is pending. Authorized local/server reconciliation
uses canonical compatibility and freshness, protects submitted server state,
marks local-newer/local-only selections for later server sync, and preserves
both sides of a divergence. Malformed and incompatible caches are not deleted.

The existing `ReduxProvider` local-only selection remains the active flow when
V2 is disabled. Ongoing server autosave has not been migrated in this batch.

`ReduxProvider` follows this order:

1. derive the hashed namespace;
2. create the scoped resilient adapter/store;
3. await bounded Redux Persist rehydration;
4. normalize the complete form and hidden conditional children;
5. inspect, then load, the canonical cache if valid;
6. compare canonical Redux and cache sources;
7. hydrate the selected source;
8. mark browser bootstrap ready;
9. start the local subscriber.

Selection rules are deterministic:

- valid nonempty cache beats semantically empty Redux;
- valid nonempty Redux beats an empty/missing cache;
- equal canonical hashes keep Redux without rewriting;
- compatible states use submission protection, server revision, client revision, server time, client-time hint, then hash divergence rules;
- malformed cache never overwrites valid Redux;
- incompatible/diverged/indeterminate sources preserve Redux and do not destroy the other cache during bootstrap;
- invalid Redux falls back to a normalized empty state, after which a valid cache may restore;
- no browser decision is described as server recovery.

## Redux Persist migration

Redux Persist version `4` stores all recoverable form categories: committed responses, validation, touched/expanded state, text metadata, allowlisted credentials, UI draft state, field metadata, draft context, question pointers, last mutation, and submitted receipt. Bootstrap/sync diagnostics remain volatile.

Version 2/3 persisted maps migrate through complete whole-form normalization. Missing v4 categories receive fresh safe defaults. Hidden conditional children are removed from every associated map, UI scope, field-metadata path, and question pointer. Credentials remain only inside the same hashed namespace. Ambiguous global legacy keys remain inventory-only and are never automatically migrated or deleted.

## Removal and rollback

Explicit same-client reset removes both the scoped Redux Persist value and canonical cache. Ordinary malformed reads do not remove anything.

Source rollback is the repository's documented feature-branch rollback procedure. Browser records are independently versioned, so an older build can ignore the `draft-cache` key. Rollback must not bulk-delete cache data: keep the scoped record available for a corrected forward build or an explicit user reset. There was no deployment or Base44 schema/API change in this batch.

## Test state

Active local tests cover envelope validation, injected dependencies, size warning, last-good preservation, debounce/max-wait/flush/stop behavior, whole-form v4 migration, source selection, credentials and client isolation, IndexedDB/localStorage/memory truthfulness, reload round trips, validation/touched/expanded recovery, context storage-state capture, malformed cache fallback, and zero uncaught page errors across the configured five Playwright projects.

Still pending: canonical server persistence, server acknowledgement/revision/CAS, authorized server recovery, email, server-backed multi-tab merge/conflict, server clear/supersession, submission locking, cross-device recovery, staging certification, and deployment.
