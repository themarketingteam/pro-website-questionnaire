# Staging Release Candidate Contract

- Status: Source gate implemented; release candidate not frozen
- Version: 1
- Required environment: `staging`
- Production effect: none
- Tag creation: deferred to Prompt 4

## Candidate and freeze

A release candidate is one exact Git commit on
`feature/durable-draft-recovery`. The candidate is not established by editing a
Markdown status: required reports must carry an accepted classification, an
approved candidate/ancestor commit, and a matching SHA-256 sidecar.

`validate-release-candidate-feature-freeze.mjs` classifies changes as runtime,
schema, function, test, documentation, or evidence. Freeze enforcement is
deliberately disabled in version 1 until Prompt 4 supplies the immutable freeze
ref. Once enforced, runtime changes invalidate the candidate; schema/function
changes require redeployment and complete staging recertification; test changes
require affected-suite evidence; documentation/evidence-only changes can
preserve the candidate after checksum regeneration.

Every post-freeze release fix requires a new commit, affected/full suite rerun
as classified, and a new manifest and evidence set.

## Required reports and evidence

`config/durable-draft-staging-release-candidate.json` enumerates the required
browser storage, canonical state, authoritative API, public recovery, SES,
client recovery, admin, RLS, security, lifecycle, comprehensive automation,
and migration reports. The five required browser projects are Chromium,
Firefox, WebKit, Mobile Chromium, and Mobile WebKit.

The precheck also requires passing security verdicts, the fixed load thresholds,
zero unresolved cleanup records, direct-entity and sensitive-bundle scans,
fail-closed production defaults, staging V2/public recovery/banner flags, and
disabled OTP, magic link, diagnostics, and kill switch. Unresolved high/critical
defects and unaccepted critical risks block the candidate.

## Allowed pending items

Only these requirement families may remain pending:

- Green live cross-app migration.
- Production-disabled deployment certification.
- Production domain cutover.
- Post-cutover monitoring.
- Production rollback migration.

Browser storage, draft save/recovery, email/code recovery, Clear All, submission
and PDF, admin recovery, RLS, staging security, and staging capacity cannot be
pending. The manual real-device/browser, mail-app link, and rollback-drill
entries remain explicit placeholders; this prompt does not mark them complete.

## Precheck and manifest

`npm run release:precheck-staging-rc` exits nonzero on any missing, failed,
stale, unchecked, pending, unsafe, or unresolved release condition. Its report
contains only commit IDs, checksums, safe failure codes, and verdicts.

`build-staging-release-candidate-manifest.mjs` verifies report and evidence
checksums and emits the required immutable metadata plus a checksum sidecar.
It accepts only SHA-256 app/URL fingerprints—never an app ID, raw URL, email,
answer, code, token, or credential. Its verdict is one of:

- `READY_FOR_FINAL_STAGING_MANUAL_CERTIFICATION`
- `BLOCKED`
- `FAILED`

## Orchestration and manual workflow

`run-staging-release-candidate-certification.mjs` runs the precheck, strict
coverage, comprehensive automated staging/browser groups, manual/rollback
placeholder verification, and manifest generation. `--resume` reuses only
passed nonsecurity groups; security groups always rerun. The orchestrator stops
before tag creation and contains no deployment, push, `_next`, domain, or
production operation.

The manual GitHub workflow requires the protected staging URL secret, checks
out an exact commit without persisted credentials, builds with explicit safe
staging flags, runs the strict orchestrator, scans its artifacts, and uploads
only `.durable-draft-artifacts/staging-rc`. It is not available to fork events
and cannot deploy or create a tag.

## Current manual evidence status

Real-device/browser checks, keyboard/screen-reader accessibility, mail-app link
and email-client rendering checks, PDF visual QA, and the rollback drill remain
pending by design. Prompt 4 will create the freeze ref and tag only after all
automated and manual evidence is complete. No production state is changed by
this contract.

Prompt 2 adds a fail-closed manual evidence validator covering the accessibility
checklist, device/mail-link manifest, email-client rendering matrix, and PDF QA
report. Local Chromium desktop and Pixel 7 emulation passed 24/24 axe checks
with no serious, critical, or moderate findings; this does not satisfy physical
device or assistive-technology rows. No staging URL, approved test mailbox, or
device-cloud credential was available, and the synthetic PDF exposed a
nonstandard single tall-page pagination defect. The RC therefore remains
blocked and no manual status is advanced.

Prompt 3 adds the fail-closed staging rollback precheck, local nine-entity reverse-migration interruption/resume drill, application rollback plan, and domain-transfer rehearsal checklist. The live classification is **STAGING_APPLICATION_ROLLBACK_DRILL_BLOCKED** because no prior RLS-certified compatible commit or complete staging target/backup/secret-set evidence exists. The current RC was not deployed, rolled back, or rolled forward; no staging or production resource changed.
