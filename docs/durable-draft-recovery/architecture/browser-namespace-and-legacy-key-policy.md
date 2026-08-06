# Browser namespace and legacy-key policy

- Status: version 4 browser namespace implemented; authorized legacy migration is deferred
- Date: 2026-08-05
- Sources: `src/lib/questionnaireBrowserNamespace.js`; `src/lib/legacyQuestionnaireStorage.js`; `src/lib/sessionId.js`; `src/components/store/store.jsx`; `src/lib/draftPersistence.js`

## Boundary

The browser namespace separates local records that share one origin and browser profile. It is not identity proof, authorization, a secret, a recovery credential, or a substitute for server-side access control. Browser values remain client-controlled.

No implementation in this policy loads `ProFormDraft`, creates recovery codes, sends email, changes Base44 resources, or migrates or deletes legacy records.

## Version 4 key format

All new keys use:

`pro-questionnaire:v4:ns_<32 lowercase hexadecimal characters>:<purpose>`

Allowed purposes are:

- `redux-state`
- `legacy-session`
- `draft-cache`
- `failure-backup`
- `migration-marker`
- `submitted-receipt`

The namespace seed precedence is reserved signed invitation ID, `userId`, normalized domain plus normalized business name, normalized email as the last current-flow identifier, then one random anonymous launch ID. URL parsing is safe under missing or malformed browser state. Domains are lowercased and stripped of protocol, credentials, path, query, fragment, port, leading `www.`, and trailing dot. Emails are trimmed and lowercased.

The seed is reduced to a deterministic 128-bit hexadecimal namespace by a small non-cryptographic browser hash. Raw email, user ID, business name, domain, or invitation ID never appears in a generated key. The hash is collision-resistant enough for local namespace partitioning only and must never be reused for recovery-code security or authorization.

## State ownership

Redux state, session ID, and failure backup use separate purpose suffixes under the same namespace. Reset and session-clear operations receive the resolved namespace and remove only that exact key. The application never calls `localStorage.clear()` or deletes the IndexedDB database.

Anonymous identity is stable only for the current page launch. When durable storage is unavailable, the adapter and session remain usable in memory for that page but make no reload-survival claim.

## Legacy inventory

The controlled legacy inventory recognizes exactly:

- `persist:pro-questionnaire-root`
- `pro_questionnaire_session_id`
- keys beginning `pro_questionnaire_local_backup_`

Default inspection returns only key type, presence, and byte size. It does not expose values in diagnostics, associate global records with a current URL, migrate records, or delete records. Client A/Client B ambiguity therefore leaves legacy state untouched.

Legacy values are readable only through explicitly named migration helpers that require an affirmative authorized-migration option. Those helpers are reserved for a later bootstrap/recovery contract. The presence of a legacy value does not authorize its use and does not allow automatic import into a version 4 namespace.

## Future migration gate

Any future migration must authenticate the recovery context, bind one legacy record to one authorized client or draft, validate and normalize the complete payload, write a versioned target, record an auditable migration marker, and retain or remove the source only under a separately approved deletion policy. Ambiguous or malformed data must remain quarantined and cannot be silently assigned.

## Evidence

Unit tests cover seed precedence, normalization, deterministic namespaces, raw-PII exclusion, purpose validation, two-client isolation, session stability and separation, safe legacy metadata, no automatic read/delete, scoped backup reads, and reset isolation. The active client-isolation browser scenarios cover normal persistent storage, localStorage fallback after IndexedDB denial, and memory-only reload behavior.
