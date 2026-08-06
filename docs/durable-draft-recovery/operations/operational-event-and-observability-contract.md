# Operational Event and Observability Contract

Status: local implementation on `feature/durable-draft-recovery`; schema, functions, and secrets are not deployed or configured.

## Current logging inventory

| Source | Current data | PII risk | Answer risk | Needed | Disposition | Operational event |
|---|---|---:|---:|---|---|---|
| `src/pages/ProQuestionnaire.jsx` initialization logs | credential/init/validation objects | Yes | Yes | Outcome only | Remove object logging; use safe logger and telemetry | `draft_bootstrap`, `draft_load`, `critical_invariant_failure` |
| `src/pages/TestZapier.jsx` and admin intake warnings | arbitrary caught/provider error | Possible | Possible | Safe result only | Redact to allowlisted code/status | `zapier_delivered`, `zapier_failed`, `zapier_suppressed` |
| `ErrorBoundary` and store normalization | constant messages | No | No | Yes | Preserve constants; safe wrapper for metadata | `critical_invariant_failure` |
| `NavigationTracker` Base44 app log | navigation event | Low | No | Optional | Preserve without route query strings | none |
| recovery/admin backend functions | request IDs and safe error codes | No by contract | No | Yes | Preserve through server safe logger | recovery/admin categories |
| `ProFormRecoverySecurityEvent` | abuse outcomes and purpose-bound hashes | Protected | No | Yes | Preserve as security audit; do not duplicate raw subjects | CAPTCHA, lockout, admin authorization |
| `ProFormDraftEvent` | lifecycle plus legacy value/identity columns | Yes | Yes | Authoritative history | Do not use as metrics sink; scoped backend access only | draft/save/conflict summaries |
| migration checkpoint/conflict entities | cursors, hashes, safe diagnostics | Protected | Bundle/report risk | Yes | Preserve; never log bundles/reports | migration categories |
| CI/load/release scripts | commands, counts, artifact paths | Synthetic leakage possible | Fixture risk | Yes | Run artifact safety scanner; keep synthetic-only | synthetic/health categories |
| health and staging certification reports | aggregate probe/release outcomes | No when conforming | No | Yes | Emit aggregates and stable codes | `synthetic_probe`, `health_check` |
| request ID helpers | opaque server-generated IDs | No | No | Yes | Reuse `createServerRequestId` | all backend events |

## Entity and event contract

`ProFormOperationalEvent` is admin-only for create/read/update/delete. Only `event_id`, `event_type`, and `environment` are required. Other dimensions are optional, bounded metrics. `metadata_json` is produced by an explicit scalar allowlist. The 41 stable categories are defined in `proDraftOperationalEvents`; callers cannot invent categories.

Severity is deterministic: routine success is `info`; retry, conflict, offline, first SES failure, CAPTCHA, and lockout are `warning`; partial transaction, submission/PDF/provider/admin failures and failed health probes are `error`; RLS boundary success, cross-client leakage, lost acknowledged state, migration content mismatch, and critical invariants are `critical`.

## Fingerprints and authorization

Draft, session, source-tab, and admin-grant-token IDs use purpose-separated HMAC-SHA-256 with `PRO_FORM_OPERATIONAL_FINGERPRINT_SECRET`. The secret must contain at least 32 bytes and remains separate from email lookup, recovery code, abuse, authorization, and migration secrets. Telemetry retains only 12–16 lowercase hex characters. A fingerprint is correlation data, never identity proof or authorization.

The browser queue is bounded to 50, contains no canonical state or full identifier, and invokes `recordProDraftOperationalEvents`; it never calls the entity API. Failed delivery restores a bounded batch and never mutates draft state. The server limits POST JSON to 128 KiB and 50 events, authorizes one privilege class per batch, derives environment/request/fingerprints, validates metadata, and only then uses service role.

## Aggregation, retention, and alerts

`getProDraftOperationalSummary` requires the password-issued, device-bound admin grant and returns counts, rates, retry totals, latency percentiles, RLS/migration critical totals, and synthetic health only. It selects a single environment and isolates synthetic rows by exact `test_run_id`; it returns no individual content or raw identifiers.

Ordinary transient events receive the approved short operational window. Security-boundary and critical-invariant events may receive a longer approved window or `retention_hold`; telemetry does not itself authorize a hold or deletion. Future alert routing should trigger on critical events, sustained error-rate thresholds, save latency, recovery/SES/submission failures, migration conflicts, and synthetic probe failure. Alert payloads use only summary dimensions.

## Test obligations

Schema/RLS, categories, validation, severity, metadata, HMAC consistency/separation, redaction, queue bounds, best-effort failure, ingest authorization/allowlists, summary safety, test isolation, and critical invariants are automated. Production acceptance additionally requires staging thresholds and alert delivery evidence; deployment is outside this change.
