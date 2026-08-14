# Pro Questionnaire Identity Recovery

## Purpose

`resolveProQuestionnaireIdentity` recovers missing Business Name and Domain values for Pro questionnaire drafts and failed-submission intake records. It is deliberately separate from the structural payload-repair agent.

The resolver never overwrites a non-placeholder value. Empty strings and placeholder values such as `unknown`, `null`, `n/a`, and `unnamed business` are treated as missing. Conflicting valid values are reported for review and are not changed automatically.

## Confidence and evidence contract

- Business Name is auto-eligible at a deterministic score of **0.90 or greater**.
- Domain is auto-eligible at a deterministic score of **0.92 or greater**.
- Business candidates must appear exactly in allowlisted client-authored narrative fields. Model confidence cannot make an unsupported candidate eligible.
- Conflicting company candidates cap the deterministic Business Name score below the auto-apply threshold.
- Domain discovery runs only when a Business Name is confirmed and a primary location is available.
- Only SerpAPI `organic_results` are considered. Ads, directories, social networks, review sites, aggregators, malformed hosts, private-network targets, parked pages, unreachable pages, and conflicting high-scoring domains are rejected.
- Candidate websites must corroborate the company identity, location, and IT/MSP services. Search rank contributes to the score but cannot establish identity by itself.

Domains are stored as normalized hostnames. Source URLs and short evidence excerpts are retained in admin-only audit records.

## Trigger behavior

- **Diagnose** performs no source-record update and no submission. It returns a structural diagnosis plus identity candidates and creates an admin-only audit attempt.
- **Repair Only** applies eligible identity fields, synchronizes canonical fields and the working payload, runs structural repair, and never submits.
- **Repair + Retry** applies eligible fields, structurally repairs and validates the payload, then performs the existing guarded retry once. A provider or repair failure does not create a submission.
- **Scheduled** may update identity fields only when scheduled auto-apply is enabled. It never submits, retries, deletes, archives, or changes a draft/intake workflow status.

Every source-record write re-reads the current record and checks a resolver-versioned payload fingerprint. A stale record is left unchanged.

## Backend configuration

The following Base44 backend secrets/configuration values are used:

- `SERPAPI_API_KEY` — required for live domain discovery. It is read only by the backend resolver and must never be exposed to frontend code or logs.
- `IDENTITY_RESOLUTION_AUTO_APPLY` — set to the exact string `true` only after the shadow rollout is approved. Missing, empty, or any other value keeps scheduled writes in shadow mode.
- `DRAFT_RECOVERY_PASSWORD` — also signs short-lived, payload-bound internal grants between backend functions. The raw secret is never sent.

Manual Repair actions remain available while scheduled auto-apply is disabled. Provider failures are fail-closed and return reviewable error codes.

## Schedule and capacity

Base44 invokes the schedule at 09:00 UTC and 10:00 UTC Monday through Friday. The function converts the current time to `America/Chicago`; only the invocation occurring at 04:00 Central proceeds. This covers both CST and CDT.

Each active run:

- uses selected-field, server-side paginated queries;
- considers only unarchived failed/attempted records without a linked final submission;
- attempts an unchanged record no more than once per Central weekday;
- processes at most 15 records with concurrency three;
- stops starting work at a 150-second deadline;
- caches identical SerpAPI queries for 24 hours; and
- records eligible, attempted, auto-eligible, applied, review, provider-failure, stale-abort, duration, and backlog metrics.

## Audit and review

`ProFormIdentityResolutionAttempt` stores the resolver version, source fingerprint, trigger, candidates, short evidence, search URLs, decisions, provider, timestamps, and errors. `ProFormIdentityResolutionRun` stores scheduled run metrics. `ProFormIdentitySearchCache` stores the 24-hour organic-result cache. All three entities are admin-only.

The authenticated review endpoint requires the attempt ID, field, decision, and expected fingerprint. Apply is refused when the source record changed or a valid value already exists. A Domain cannot be applied before a Business Name exists. Rejected candidates are suppressed for the same payload fingerprint and resolver version; changed questionnaire content permits reevaluation.

## Rollout

1. Configure `SERPAPI_API_KEY` and leave `IDENTITY_RESOLUTION_AUTO_APPLY` unset or false.
2. Observe three weekday shadow runs and review every auto-eligible candidate, or at least 20 candidates when available.
3. Enable scheduled writes only if there are zero incorrect high-confidence candidates and provider failures are acceptable.
4. Monitor seven enabled weekdays. Set `IDENTITY_RESOLUTION_AUTO_APPLY` back to false immediately after any false positive.

The future internal company-database provider plugs into the resolver ahead of public web search. Its adapter will provide corroborating evidence without changing the scheduler, buttons, report, or review contracts.
