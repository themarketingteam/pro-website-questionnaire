# Codex Durable-Draft Resource Bootstrap Runbook

## Purpose

This runbook explains how Codex and engineers verify and safely repair the local resources required for durable-draft-recovery work. The bootstrap utility is deliberately limited to local Git references, branch selection, repository prerequisites, and documentation directories. It does not deploy, authenticate to, or modify Base44.

## Why previous prompts blocked

Earlier validation and rollback prompts required a clean `feature/durable-draft-recovery` working tree. Five unknown changes were present, and their ownership could not safely be assumed:

- Deleted: `index.html`
- Deleted: `jsconfig.json`
- Deleted: `tailwind.config.js`
- Modified: `package.json`
- Modified: `package-lock.json`

Those changes were preserved unchanged on `rescue/durable-draft-pre-validation-uncommitted-2026-08-05` at commit `7913aea61f1f326f95bbd70420477a1157e5ad53`, pushed to origin, and documented in [the rescue record](../baseline/uncommitted-work-rescue-record.md). The full rescue branch must not be merged automatically.

## Bootstrap commands

From anywhere inside the repository:

```bash
npm run workspace:check
npm run workspace:repair
npm run workspace:check
```

Equivalent direct commands are:

```bash
node scripts/ensure-durable-draft-workspace.mjs \
  --mode check \
  --branch feature/durable-draft-recovery

node scripts/ensure-durable-draft-workspace.mjs \
  --mode repair \
  --branch feature/durable-draft-recovery \
  --baseline-sha 27ddc347d55db00796a0e3e19ac343245519b01e
```

Add `--json` for machine-readable output. JSON output contains statuses, paths, reference SHAs, actions, warnings, errors, and missing-output resources; it never includes app IDs, tokens, or environment-variable values.

## Check versus repair mode

Check mode performs no repairs. It verifies repository prerequisites and Git references, detects the current branch and dirty state, and reports missing directories and evidence-dependent outputs. Missing noncritical directories and output documents are warnings. A missing output is not fabricated.

Repair mode additionally:

- Fetches branches and tags from configured remotes when available.
- Fetches a missing local baseline tag from the verified origin tag.
- Creates a missing local backup tracking branch from its verified origin branch.
- Creates a missing local feature tracking branch from origin, or creates the feature branch from the verified baseline when no remote feature branch exists.
- Switches to the expected feature branch only when the working tree is clean.
- Creates missing required documentation directories recursively.

Repair mode never commits, pushes, resets, restores, cleans, stashes, or invokes Base44. Running repair repeatedly is idempotent: existing correct resources are reused, and completed repairs are not duplicated.

## Branch creation and reference safety

The approved immutable baseline references are:

- Tag: `pre-durable-draft-recovery-2026-08-05`
- Backup branch: `backup/pre-durable-draft-recovery-2026-08-05`
- SHA: `27ddc347d55db00796a0e3e19ac343245519b01e`

The expected feature branch is `feature/durable-draft-recovery`. The utility verifies both immutable references against the approved SHA before using either as a branch source. It fails closed on a mismatch and never moves a remote reference, force-pushes, or pushes `main`.

## Directory creation

Repair mode ensures these directories exist:

```text
docs/durable-draft-recovery/
docs/durable-draft-recovery/baseline/
docs/durable-draft-recovery/architecture/
docs/durable-draft-recovery/audit/
docs/durable-draft-recovery/environments/
docs/durable-draft-recovery/release/
docs/durable-draft-recovery/runbooks/
docs/durable-draft-recovery/migration/
docs/durable-draft-recovery/testing/
docs/durable-draft-recovery/deployment/
```

To add a new required documentation directory, add its repository-relative path once to `REQUIRED_DIRECTORIES` in `scripts/ensure-durable-draft-workspace.mjs`, add a focused isolated-repository test, run repair twice, and verify the second run reports no creation action.

## Missing-output behavior

The utility reports but never fabricates these evidence-dependent documents:

- `docs/durable-draft-recovery/baseline/source-baseline-manifest.md`
- `docs/durable-draft-recovery/baseline/source-baseline-validation.md`
- `docs/durable-draft-recovery/baseline/source-rollback-rehearsal.md`

The active prompt must create a missing document when it authorizes gathering the necessary evidence. Failed validation still produces its required report with exact observed failures and a failed or blocked classification. Missing historical evidence must never be invented.

## Base44 resource rules

The utility contains no Base44 command and performs no Base44 operation. A missing staging or next app may be created only when an active prompt explicitly authorizes cloud creation, identifies the target unambiguously, and passes the required safeguards. Missing Base44 secrets, app IDs, integrations, domains, or data are never guessed or inferred.

Production deployment and domain movement remain prohibited unless an explicit production or cutover prompt authorizes them. `base44/.app.jsonc` remains ignored and environment-specific.

## Secret handling

Never print or commit secret values. Do not add `.env` files, access tokens, private keys, recovery passwords, AWS credentials, npm tokens, GitHub tokens, cookies, or credential-bearing URLs. A missing non-derivable secret is a valid blocker. Secret names and safe placeholders may be documented when required.

Before preserving a dirty workspace or committing bootstrap changes, scan staged additions and untracked files. Report a suspected secret by path, line category, and secret type without reproducing its value.

## Dirty-worktree recovery

The utility detects dirtiness but intentionally does not rescue it automatically. For unknown changes:

1. Inventory all modified, staged, deleted, and untracked paths.
2. Scan the complete change set for secrets.
3. Create a uniquely named rescue branch from the current `HEAD` while keeping the working tree.
4. Stage and commit the exact safe change set on that rescue branch.
5. Push the rescue branch without force and verify its remote SHA.
6. Return to `feature/durable-draft-recovery` only after remote preservation succeeds.
7. Verify the feature branch is clean and document the rescue location.

Do not use stash as the primary preservation mechanism, and do not use `git reset --hard`, `git clean`, `git checkout -- <path>`, or `git restore <path>` to discard unknown work.

## Allowed blockers

Stop only for a concrete condition such as missing authentication, a missing non-derivable secret, conflicting immutable references, potential secret exposure, destructive production-data ambiguity, missing external permissions, an action that would overwrite user work, or another explicit safety prohibition.

A missing branch, local tag, documentation directory, required script, test, package script, or prompt-authorized output is not itself a terminal blocker when it can be created safely and deterministically.

## Invocation by later prompts

Later durable-draft prompts should begin with:

```bash
git fetch --all --tags --prune
npm run workspace:check
```

If check mode reports safely repairable local resources, run:

```bash
npm run workspace:repair
npm run workspace:check
```

If the result includes `WORKTREE_DIRTY_REQUIRES_RESCUE`, follow the deliberate rescue workflow before switching branches. If it includes a conflict, secret, authentication, or permission blocker, stop with that specific code and remediation rather than mutating around it.

## Ready-state verification

Before feature work or commit:

```bash
git branch --show-current
git status --short
git rev-parse 'pre-durable-draft-recovery-2026-08-05^{}'
git rev-parse backup/pre-durable-draft-recovery-2026-08-05
npm run workspace:check
```

The active branch must be `feature/durable-draft-recovery`; unknown working-tree changes must already be rescued; the tag and backup branch must resolve to `27ddc347d55db00796a0e3e19ac343245519b01e`. Missing evidence-dependent reports must be created by the active evidence-gathering prompt, not by the utility.

This bootstrap utility does not deploy, publish, link, create, clone, or modify any Base44 application or cloud resource.
