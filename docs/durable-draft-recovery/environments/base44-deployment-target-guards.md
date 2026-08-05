# Base44 Deployment Target Guards

- Status: implemented locally; no deployment performed
- Date: 2026-08-05
- Applies to: staging and production Base44 deployments

## Purpose

The production and staging checkouts intentionally carry different ignored `base44/.app.jsonc` files. Base44 deploy reads that local link, so copying the file between checkouts could redirect an otherwise valid command to the wrong cloud app.

Every repository-managed deployment must use one of the guarded package wrappers. The verifier compares the locally linked app ID with environment-specific expected IDs supplied outside Git, checks the branch and working tree, and exits nonzero before tests, build, or Base44 deploy when any condition is ambiguous.

Direct `npx base44 deploy` is prohibited outside these wrappers. The CLI command remains visible only as the final, short-circuited step inside each package script.

## Required variables

| Variable | Required behavior |
| --- | --- |
| `PRO_DEPLOY_ENVIRONMENT` | Required; exact value `staging` or `production`. No default. |
| `BASE44_EXPECTED_APP_ID` | Required; exact app ID expected for this invocation. |
| `BASE44_PRODUCTION_APP_ID` | Required; production identity supplied by an approved secret store or ignored local file. |
| `BASE44_STAGING_APP_ID` | Required; staging identity supplied by an approved secret store or ignored local file. |
| `ALLOW_PRODUCTION_DEPLOY` | Defaults to blocked; production requires the exact lowercase string `true`. |
| `EXPECTED_GIT_BRANCH` | Required; staging normally uses `feature/durable-draft-recovery`, production normally uses `main`. |
| `VITE_APP_ENVIRONMENT` | Placeholder for later frontend environment display. When supplied to the verifier, it must equal `PRO_DEPLOY_ENVIRONMENT`. |

Actual app IDs and secrets must never be committed. The tracked [.env.staging.example](../../../.env.staging.example) and [.env.production.example](../../../.env.production.example) contain placeholders only. `.env.staging`, `.env.production`, and every other real `.env*` file remain ignored.

## Why link files stay separate

The production-linked primary checkout retains its original `base44/.app.jsonc`. The sibling staging clone has a different staging-specific file. Both are ignored and untracked.

Never copy, synchronize, commit, email, or paste one checkout's link file into the other. A Git clone does not carry `.app.jsonc`; each environment is linked independently. If the link is missing, the verifier returns `MISSING_APP_LINK` and deployment stops.

## Staging configuration and workflow

From the isolated staging clone:

```bash
cp .env.staging.example .env.staging
chmod 600 .env.staging
# Replace every placeholder using values from the approved secret store.
set -a
source .env.staging
set +a
npm run verify:base44-target
```

The staging guard requires all of the following:

- the local link equals `BASE44_EXPECTED_APP_ID`;
- the expected ID equals `BASE44_STAGING_APP_ID` and differs from `BASE44_PRODUCTION_APP_ID`;
- the production and staging IDs are not equal;
- the branch equals `EXPECTED_GIT_BRANCH` and is not `main`;
- HEAD is attached and the worktree is clean;
- a supplied `VITE_APP_ENVIRONMENT` equals `staging`.

Only a separately authorized deployment prompt may then run:

```bash
npm run deploy:base44:staging
```

That wrapper re-verifies with `--required-environment=staging`, runs the focused guard suite, then runs the root `npm run check` gate (lint, typecheck, normal CI tests, and build). Only a completely green gate can reach `npx base44 deploy -y`. A production environment declaration cannot pass through the staging-named wrapper.

## Production configuration and workflow

Production values are configured later from the production secret store, never copied from staging:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# Replace every placeholder only during an approved release procedure.
set -a
source .env.production
set +a
npm run verify:base44-target
```

Production requires:

- the local link, expected ID, and `BASE44_PRODUCTION_APP_ID` to match;
- the expected ID to differ from `BASE44_STAGING_APP_ID`;
- `ALLOW_PRODUCTION_DEPLOY=true` exactly;
- a clean `main` branch with `EXPECTED_GIT_BRANCH=main`; or a detached exact release tag explicitly declared as `EXPECTED_GIT_BRANCH=refs/tags/<approved-tag>` by a future immutable release workflow;
- all target tests plus the root lint, typecheck, normal CI test, and build gates to pass before the deploy command is reachable.

Only an explicitly authorized production release may run:

```bash
npm run deploy:base44:production
```

The production wrapper is intentionally additionally fail-closed while existing full-suite gates fail. No release procedure may bypass the target verifier or reorder the deployment command ahead of its gates.

Baseline characterizations are deliberately not part of either deployment wrapper. They assert current defects and run separately through `npm run test:baseline-characterization`; their success cannot satisfy release acceptance.

## Safe output

The verifier prints only:

1. declared environment;
2. app name from `base44/config.jsonc`;
3. SHA-256 fingerprint of the local app ID;
4. Git branch or exact detached tag marker;
5. `PASS`, `PASS_READ_ONLY`, or one safe failure code.

It never prints an app ID, token, secret value, environment dump, JSONC content, or stack trace.

## Read-only diagnostics

Normal verification rejects any dirty worktree. `--read-only` is an explicit diagnostic mode that still validates the environment, IDs, and branch but returns `PASS_READ_ONLY`; it is never used by a deployment wrapper and does not authorize a later direct deploy.

To fingerprint only the local link without exposing its ID:

```bash
npm run verify:base44-target -- --fingerprint-only
```

Fingerprint-only mode reads the local config/link, prints `PASS_READ_ONLY`, and does not require deployment variables. A fingerprint proves equality/inequality only; it does not authorize deployment.

## Failure codes

| Code | Meaning |
| --- | --- |
| `MISSING_DEPLOY_ENVIRONMENT` | `PRO_DEPLOY_ENVIRONMENT` is absent. |
| `UNKNOWN_DEPLOY_ENVIRONMENT` | Environment is not `staging` or `production`. |
| `WRAPPER_ENVIRONMENT_MISMATCH` | Declared environment does not match the named package wrapper. |
| `MISSING_EXPECTED_APP_ID` | `BASE44_EXPECTED_APP_ID` is absent. |
| `MISSING_PRODUCTION_APP_ID` | Production comparison ID is absent. |
| `MISSING_STAGING_APP_ID` | Staging comparison ID is absent. |
| `MISSING_EXPECTED_GIT_BRANCH` | Expected branch/tag declaration is absent. |
| `APP_ID_COLLISION` | Production and staging IDs are identical. |
| `STAGING_USES_PRODUCTION_APP_ID` | Staging expected ID equals the production ID. |
| `STAGING_EXPECTED_ID_MISMATCH` | Staging expected ID differs from the declared staging ID. |
| `PRODUCTION_USES_STAGING_APP_ID` | Production expected ID equals the staging ID. |
| `PRODUCTION_EXPECTED_ID_MISMATCH` | Production expected ID differs from the declared production ID. |
| `LOCAL_APP_ID_MISMATCH` | Local link does not match the expected ID. |
| `DIRTY_WORKTREE` | Tracked or untracked work exists outside ignored files. |
| `STAGING_MAIN_FORBIDDEN` | A staging verification is running on `main`. |
| `GIT_BRANCH_MISMATCH` | Attached branch differs from the expected branch. |
| `GIT_BRANCH_UNAVAILABLE` | Git branch state cannot be determined. |
| `PRODUCTION_REQUIRES_MAIN_OR_RELEASE_TAG` | Production is on neither `main` nor an explicitly approved exact tag. |
| `DETACHED_HEAD_NOT_APPROVED_TAG` | Detached HEAD is not the exact externally declared production release tag, or staging is detached. |
| `PRODUCTION_DEPLOY_NOT_ALLOWED` | `ALLOW_PRODUCTION_DEPLOY` is not the exact string `true`. |
| `FRONTEND_ENVIRONMENT_MISMATCH` | Supplied `VITE_APP_ENVIRONMENT` differs from the deployment environment. |
| `MISSING_BASE44_CONFIG` | `base44/config.jsonc` is missing. |
| `MALFORMED_BASE44_CONFIG` | Project config is not valid JSONC. |
| `MISSING_APP_NAME` | Project config has no nonempty name. |
| `MISSING_APP_LINK` | `base44/.app.jsonc` is missing. |
| `MALFORMED_APP_LINK` | Link file is not valid JSONC. |
| `MISSING_APP_ID` | Link file has no nonempty `id`. |
| `REPOSITORY_ROOT_NOT_FOUND` | Script cannot locate the repository root. |
| `VERIFICATION_INPUT_UNREADABLE` | Git or required local input could not be read safely. |
| `INVALID_ARGUMENT` | Unsupported or conflicting verifier flags were supplied. |

## Emergency procedure when IDs are unknown

1. Stop. Do not deploy, relink, unlink, or copy either `.app.jsonc`.
2. Run fingerprint-only mode separately in each checkout.
3. Compare the fingerprints with the sanitized [staging registration](./staging-app-registration.md).
4. Retrieve the full IDs only from the approved Base44 dashboard/secret store and place them in restricted environment variables or the ignored environment file.
5. Run normal verification. If any fingerprint or identity relationship is unexpected, treat it as a link incident and require owner review.

Do not use an app name, URL, free subdomain, or guessed ID as a substitute for the exact app-ID comparisons.

## No-deployment declaration

This guard implementation did not run either deployment wrapper and did not invoke `npx base44 deploy`, entity/function/agent/connector/auth/site push, domain operations, data operations, or integration setup. No Base44 cloud resource changed.
