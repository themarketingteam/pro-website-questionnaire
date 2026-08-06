# Authoritative Client Draft Synchronization Manager Contract

- Status: Implemented and locally tested; staging and production certification pending
- Version: 1
- Date: 2026-08-06
- Runtime scope: Pro Questionnaire durable-draft V2 only
- Implementation: `src/lib/proFormDraftSyncManager.js`

## Authority and ownership

Redux is the current in-browser canonical state. The existing local canonical
persistence controller is the sole browser-cache writer. The sync manager
starts, flushes, and stops that controller; it does not create a second Redux
cache subscription. The manager alone owns V2 server-save scheduling,
serialization, retries, lifecycle coordination, and the in-memory event queue.

`ProDraftSyncProvider` owns one manager per Redux store and draft identity. It
is not constructed until bootstrap and entry acknowledgement make the
questionnaire interactive. A zero-delay disposal grace period allows React
Strict Mode's development remount without constructing a second manager;
changing draft identity disposes the old record.

## Public API

The React-independent manager exports `start`, `stop`, `scheduleSave`,
`saveImmediately`, `flush`, `queueEvent`, `flushEvents`, `setOnlineState`,
`handleVisibilityChange`, `handlePageHide`, `handleBeforeUnload`,
`markSubmitAttempted`, `markSubmitFailed`, `markSubmitted`,
`invalidateAfterSupersession`, `getStatus`, `subscribeStatus`, and `dispose`.

The React facade exposes only `scheduleSave`, `flush`, `queueEvent`,
`syncStatus`, `lastServerSavedAt`, `isReadOnly`, `hasConflict`, and `retryNow`,
plus the submit-lifecycle methods required by the questionnaire integration.
It does not expose a manager, token, credential bundle, storage internals, or
API client.

## Dependencies

All runtime-sensitive dependencies are injected or protected by adapters:

| Dependency | Contract |
| --- | --- |
| Redux store and canonical selector | Read complete state after reducers finish; never accept handler snapshots. |
| Local persistence/cache | Flush the existing canonical persistence owner before a network save. |
| Credential vault | Load a draft-bound resume token or recovery session; credentials never enter Redux. |
| Draft and event API clients | Call `saveProFormDraft` and `appendProFormDraftEvents` through the approved client. |
| Clock, timers, random/ID generator | Injectable for deterministic testing. |
| Online, visibility, lifecycle | Protected providers/adapters; no unguarded browser-global assumption. |
| Conflict/coordination adapter | Receives safe conflict projections and emits allowlisted revision/lifecycle messages; no canonical values or tokens. |
| Logger | Receives only safe state, count, code, revision, delay, and boolean fields. |

## State machine

The public states are `idle`, `local_saving`, `local_saved`, `server_saving`,
`server_saved`, `offline_local_only`, `retrying`, `conflict`, `error`,
`submitted`, `superseded`, and `disposed`.

Local flush completion cannot erase a network `retrying`, `conflict`, `error`,
`submitted`, or `superseded` state. `server_saved` is reported only after a
validated backend acknowledgement. Memory-only or disconnected operation is
reported as `offline_local_only`. Submitted and superseded states lock all
ordinary saves and cancel timers.

## Debounce, serialization, and coalescing

| Setting | Default | Bound |
| --- | ---: | --- |
| Ordinary debounce | 650 ms | Constructor configurable |
| Continuous-change maximum wait | 2,000 ms | Constructor configurable |
| Retry base | 1,000 ms | Constructor configurable |
| Retry maximum | 30,000 ms | Constructor configurable |
| Automatic retry ceiling | 8 | Constructor configurable |
| Reconnect stabilization | 250 ms | Constructor configurable |
| Event batch | 50 | Protocol maximum |
| Event queue | 500 | Constructor configurable, hard-bounded |

Only one draft request may be in flight. A change during that request marks a
pending save; after acknowledgement, the newest complete Redux state is read
and saved. Ordinary changes are coalesced, while the maximum-wait timer emits a
periodic snapshot during continuous typing. Same-content observations are
ignored.

## Save and revision protocol

At request time the manager:

1. Flushes the existing local canonical persistence controller.
2. Reads the current canonical state from Redux after reducers have completed.
3. Normalizes and serializes the complete state and calculates its SHA-256
   state hash.
4. Loads draft-bound authorization from the credential vault and checks draft
   ID and session ID.
5. Sends Redux's monotonic client revision and current backend-issued server
   revision to `saveProFormDraft` with the requested status and sync reason.

An idempotency key belongs to one exact state hash. A retry of that exact state
reuses the key; a different state gets a new cryptographically generated key.
Time is not the sole key source. Success is accepted only when draft ID, state
hash, client revision, server revision, and requested status validate. Redux
keeps any newer local client revision while recording the acknowledged client
revision separately; server revision changes only from an accepted backend
response. Idempotent backend success follows the same acceptance path.

Serialization or local-cache failure stops the network request and retains the
previous good cache and server snapshot. On conflict the manager authorizes and
loads current server state, performs the documented three-way field merge, and
retries at most three rounds. Genuine same-field ambiguity pauses ordinary
saves until explicit choices are applied. See
[Draft conflict merge and multi-tab contract](./conflict-merge-and-multi-tab-contract.md).

## Offline, retry, and authorization behavior

Offline transitions cancel network and retry timers but continue local cache
writes. Reconnect waits 250 ms, then reads and saves the newest complete state.
Network, timeout, and 5xx failures retry with bounded exponential backoff,
bounded jitter, backend retry-after precedence, and an eight-retry ceiling.
Invalid requests, denied authorization, conflicts, and terminal lifecycle
errors do not retry automatically.

On an authorization failure the manager tries a stored recovery session when
available, or an injected refresh adapter. Otherwise it enters the safe
authorization-required error state while preserving local answers.

## Lifecycle behavior

The manager registers `visibilitychange`, `pagehide`, `beforeunload`, `online`,
and `offline`. Hidden visibility performs an immediate serialized save when it
is safe. Immediate local persistence remains the durability guarantee.

The Base44 function surface and `base44.functions.fetch` capability were
inspected. The current draft API client has no bounded authenticated keepalive
save contract, so `pagehide` records `local_cache_only` and relies on browser
cache/next resume. A keepalive path is used only if a separately reviewed
adapter is explicitly injected. `beforeunload` performs no confirmation prompt
and makes no asynchronous network-completion claim.

## Event queue

Events are deduplicated by event ID, rejected if their shape contains a
credential-like field, retained in a bounded in-memory queue, and sent in
batches of at most 50. Snapshot success opportunistically flushes events.
Event retry state and backoff are independent: an event failure cannot undo or
misreport an accepted canonical snapshot and does not block questionnaire use.

## Legacy/V2 exclusivity audit

| Existing path | V2 enabled | V2 disabled |
| --- | --- | --- |
| `ProFormDraft.create/update` legacy debounce | Disabled before scheduling | Preserved |
| Direct `ProFormDraftEvent.create` | Replaced by manager queue | Preserved |
| Legacy global failure backup | Disabled; canonical cache is authoritative | Preserved |
| Legacy `beforeunload` listener | Disabled | Preserved |
| Submit-stage direct entity events | Disabled | Preserved |
| V2 manager/provider | One active manager after bootstrap-ready | Not constructed |

The submit helper receives an explicit `legacyDraftPersistenceEnabled` flag.
The feature-disabled page renders the legacy content with its default `true`;
the feature-enabled bootstrap gate renders it with `false`. No legacy
implementation was deleted.

## Security exclusions

- Tokens, recovery codes, credential bundles, and authorization objects are
  outside Redux and the public React facade.
- Logger calls never receive canonical state, answers, raw events, credentials,
  or provider error text.
- Safe diagnostics expose state, revisions, counts, storage mode, and safe
  codes only.
- Page lifecycle handling does not invent keepalive support.
- No production or staging deployment is part of this implementation.

## Test evidence and remaining work

`src/test/proFormDraftSyncManager.test.js` covers debounce, maximum wait,
single-flight coalescing, idempotency, success/conflict/terminal states,
offline/reconnect, retry classes and ceiling, retry-after, lifecycle fallback,
event independence, credential fallback, local failure, and log/token safety.
Permanent event failures are also verified to pause automatic delivery without
invalidating or repeatedly blocking accepted snapshots; an explicit forced
event flush can retry after the underlying issue is resolved.
`src/test/ProDraftSyncContext.test.jsx` covers Strict Mode ownership, disabled
mode, safe facade, and identity-change disposal. API-client, canonical-cache,
local-persistence, Redux, status UI, save/event integration, and feature-mode
tests provide adjacent evidence.

This implementation does not yet migrate every individual component to the
canonical mutation factory. Interactive conflict merge and multi-tab safety are
now implemented; complete component mutation capture remains a later prompt.
Local source evidence is not staging or production certification.
