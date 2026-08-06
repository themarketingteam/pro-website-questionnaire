# Staging Application Rollback Drill Plan

## Safety boundary

This drill is staging-only. It does not authorize a production deployment, a domain move, a push, or a change to `main`. Blue production remains the legacy fallback and must remain unchanged. The pre-durable baseline commit `27ddc347d55db00796a0e3e19ac343245519b01e` must never be deployed into an RLS-hardened staging app because it is not compatible with the durable-draft entities, backend authorization, or RLS contract.

Run `npm run release:precheck-staging-rollback` first. Any nonzero result is a hard stop before Base44 secrets, flags, deployments, data, or domains are changed.

## Required identities and evidence

- Current RC source commit: `e22ceaa0b0fb64f11c661de74657a7f32f4da46f`.
- Prior source: an explicit earlier commit with `DRAFT_RLS_CERTIFIED_IN_STAGING` evidence and a passing build. None is presently certified.
- Exact staging URL/app identity, current deployed commit, backup/export fingerprint, and secret-set version must be supplied through approved non-production configuration.
- Confirm `main` and `origin/main` remain the approved baseline, production inputs are absent, no migration lease is active, no replacement is in progress, and submitted records are locked.
- Capture counts, revision/hash projections, relationship integrity, current flags, secret names/versions (never values), and sanitized browser-state fingerprints.

## Ordered live drill (only after PASS)

1. Create namespaced synthetic records for all nine migration entity classes and record safe identifiers, revisions, and SHA-256 projections.
2. Activate both client and server kill switches. Verify new server writes fail closed, local canonical edits remain safe where policy permits, submitted records remain read-only, and recovery credentials already shown to a user are not silently discarded.
3. Confirm zero active migration leases/replacements and preserve the pre-drill export/checkpoint.
4. Deploy only the identified prior RLS-compatible staging commit. Do not alter schema, RLS, secrets, domains, or data.
5. Run Chromium and WebKit checks for refresh/reopen persistence, memory-only isolation, recovery, conflict, submission lock, PDF read-only behavior, and absence of direct entity access.
6. Run green-to-blue synthetic reverse synchronization in dry-run, apply, interruption, and resume modes. Verify green-native creates, updated records, submitted-state preservation, conflicts, counts, hashes, relationships, zero duplicates, and idempotent rerun.
7. Deploy the current RC commit, restore the approved staging flag state, then repeat health, RLS, browser, and data checks.
8. Remove only records bearing the exact drill namespace after reference-count and submitted-state checks. Verify zero active lease/replacement, zero unresolved synthetic conflicts, and zero remaining test records.

## Stop conditions

Stop without deployment or domain activity for a missing/ambiguous target, production target indication, missing backup, missing secret version, dirty tree, commit mismatch, missing certified compatible predecessor, failed build, active lease/replacement, lost local state, submitted-state regression, hash/count/relationship difference, duplicate, unresolved conflict, RLS bypass, direct entity access, mail/PDF side effect, or failed cleanup.

If a live step fails after mutation, keep the kill switch active, preserve evidence and data, restore the last known RLS-compatible source only when its compatibility is still proven, and escalate. Never compensate by deploying the pre-durable baseline or relaxing RLS.

## Current execution decision

The 2026-08-06 precheck is blocked: no prior `DRAFT_RLS_CERTIFIED_IN_STAGING` commit exists in repository evidence, and no staging target/deployment fingerprint, backup fingerprint, or secret-set version is configured. Therefore no live kill-switch change, Base44 deployment, data mutation, browser staging run, or cleanup occurred. The local synthetic model remains safe to run with `npm run release:run-synthetic-staging-rollback`.
