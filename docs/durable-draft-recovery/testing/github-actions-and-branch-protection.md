# GitHub Actions and branch protection

- Status: workflow source implemented; repository protection remains a manual GitHub administration task
- Date: 2026-08-05
- Node runtime: `22.23.1` from the repository `.node-version`

## Automation inventory and preserved responsibilities

The repository had no `.github/workflows` directory, Dependabot configuration, Renovate configuration, CI secret reference, package-manager cache declaration, or automated deployment workflow before this foundation. No existing workflow responsibility was replaced. The new workflows use the root `package-lock.json` through the setup-node npm cache and always install with `npm ci`.

No workflow invokes a Base44 deploy/push command, moves a domain, sends email, calls Zapier, enables durable draft V2, or tests production. Production deployment remains a separate, explicitly authorized operation outside GitHub Actions.

## Quality workflow

`.github/workflows/durable-draft-quality.yml` runs for pull requests targeting `main`, pushes to `feature/durable-draft-recovery`, and manual dispatch. Its required jobs are:

1. `source-safety`: fetches complete history, verifies the immutable baseline tag and backup branch at the approved SHA, scans changed files without printing matches, runs deployment-target static tests, and validates the test manifest.
2. `unit-quality`: runs lint, typecheck, normal CI tests, and the separate baseline-characterization suite. All commands execute and the job fails if any required gate fails; no validation uses `continue-on-error`.
3. `build`: builds an explicit staging-style bundle with V2 off and the kill switch on, scans built files for secret patterns, and uploads file hashes plus safe build metadata. It does not deploy the bundle.
4. `e2e-harness`: installs Chromium and runs only `[HARNESS]` fixture-mechanics tests against the managed local preview with production and writes disabled.
5. `pending-requirements-report`: emits text and JSON reports, publishes the pending count to the job summary, and remains non-strict during foundation work.

The final summary job uses `scripts/build-ci-summary.mjs` and reports safe statuses, the commit, pending count, baseline status, no-deploy confirmation, and artifact names. Unit logs, build manifests, and Playwright evidence are retained for 14 days; pending-requirement reports are retained for 30 days.

The quality workflow is intentionally expected to remain red while the recorded normal-test, lint, and typecheck baseline debt exists. A green build or harness job alone does not certify the feature. Characterization tests stay separate because reproducing an existing defect is not release acceptance.

## Manual staging E2E workflow

`.github/workflows/durable-draft-staging-e2e.yml` has only `workflow_dispatch`. It requires the GitHub Actions secret `PRO_DRAFT_STAGING_URL`; no production URL or production credential is accepted or required. The preflight rejects a missing URL, credentials/query/fragment in the URL, loopback targets, documented production hostnames, production permission, and write permission before a browser starts.

GitHub exposes `workflow_dispatch` only after the workflow file exists on the repository's default branch. Pushing this foundation to the feature branch makes it reviewable and lets the automatic feature-branch quality workflow run, but it does not make the staging Run workflow button available before an approved merge to `main`.

Inputs select `smoke` (desktop Chromium), `desktop` (Chromium, Firefox, and WebKit), or `all` (desktop plus mobile Chromium/WebKit and an optional Windows Microsoft Edge job). Edge uses the Playwright `msedge` channel, stores its own evidence, and never blocks ordinary Linux quality CI.

`allow_writes` is reserved for a later implementation gate. The current workflow records the requested value but always supplies `E2E_ALLOW_WRITES=false`; final submission therefore cannot be enabled by this input. Smoke execution uses the safe fixture, which blocks Zapier and attaches console/network summaries without bodies or headers. Artifact URL summaries omit every query parameter and fragment.

The workflow checks out the optional `commit_sha`, or the then-current `feature/durable-draft-recovery` revision when it is blank. It cannot run successfully until the separately deployed staging site exists and `PRO_DRAFT_STAGING_URL` is configured. It never substitutes a production or guessed URL.

Because staging E2E is manual-only and the quality workflow references no repository secrets, pull requests from forks receive no staging secret. Do not change the staging workflow to `pull_request_target` or another privileged automatic trigger.

## Recommended `main` branch protection

Codex cannot assume repository-administration permission. A repository administrator must configure a branch ruleset or classic branch protection manually and verify the exact check names after the workflows have run at least once.

Require pull requests, disallow force pushes and branch deletion, require approval after the last material push, and require these quality checks:

- `Source safety`
- `Unit quality`
- `Build`
- `E2E harness`
- `Pending requirements report`

Do not require the summary job as a substitute for the underlying gates. `main` remains protected from routine batch pushes, including Codex feature work.

Add these release checks only after their implementations and safe evidence paths are ready:

- staging E2E across the approved browser scope;
- forward migration validation;
- reverse-migration validation; and
- production-disabled release certification.

Strict pending-test enforcement is deliberately not a required check yet. The later implementation gate must switch release workflows to `npm run test:e2e:pending-strict` and require zero pending release-blocking scenarios before merge/release approval.

Production deployment, feature enablement, and domain movement must remain separate workflows or manual procedures with their own explicit authorization, environment protection, approvers, and rollback gates. They must never be appended to either workflow created here.

## Manual GitHub configuration checklist

1. Add `PRO_DRAFT_STAGING_URL` as a repository or protected-environment Actions secret only after a staging site has been deployed and verified.
2. Confirm workflow permissions remain read-only for repository contents.
3. Run the quality workflow once so GitHub registers its check names.
4. Apply the recommended `main` ruleset and required checks.
5. Do not expose staging secrets to forks or enable privileged fork-code execution.
6. Keep the staging workflow manual until implementation, cleanup, external-side-effect, and staging-readiness gates pass.
7. Review artifact access/retention under the organization data-handling policy.
8. Record the ruleset evidence in the later release package; source documentation alone does not prove branch protection is active.
