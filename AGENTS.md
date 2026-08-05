# Repository Instructions

## Durable Draft Recovery Resource Bootstrap and Safety Rules

These rules apply to every durable-draft-recovery task in this repository. The active prompt remains the authority for task scope; these rules describe how to create missing safe resources without weakening production safeguards.

### Required startup sequence

At the start of every durable-draft task:

1. Locate the Git repository root and read this `AGENTS.md` completely.
2. Run `git fetch --all --tags --prune` when network access is available.
3. Run `node scripts/ensure-durable-draft-workspace.mjs --mode check --branch feature/durable-draft-recovery`. Use `--mode repair` when the check identifies deterministic local resources that the utility can safely repair.
4. Confirm the intended branch and inspect the complete working-tree state.
5. Create safe directories and output files explicitly required by the active prompt when they are absent.
6. Confirm that the active prompt does not implicitly require a production deployment. Production deployment is prohibited unless the prompt explicitly authorizes it.

### Safe resource creation

Create a missing resource instead of stopping when all of these conditions are true:

- The active prompt explicitly requires the resource.
- The resource can be created deterministically and non-destructively.
- Creation does not require guessing a secret.
- Creation cannot alter production unintentionally.

Resources that should normally be created automatically when required include local tracking branches, feature branches from a verified baseline, local tag references fetched from origin, local backup-branch tracking references, documentation directories, required Markdown outputs, scripts, tests, package scripts, and staging-only configuration templates.

Add and test a missing package script when the active prompt explicitly requires it. Create Base44 staging or next applications only when the active prompt explicitly authorizes cloud creation and all target safeguards pass. A missing Base44 cloud resource is never implicit authorization to create it.

### Branch bootstrap rules

The approved references are:

- Baseline tag: `pre-durable-draft-recovery-2026-08-05`
- Backup branch: `backup/pre-durable-draft-recovery-2026-08-05`
- Feature branch: `feature/durable-draft-recovery`
- Expected baseline SHA: `27ddc347d55db00796a0e3e19ac343245519b01e`

Apply these rules:

- If a required local branch is absent and its verified remote branch exists, create a local tracking branch.
- If the feature branch is absent locally and remotely, create it from the verified baseline.
- If the local baseline tag is absent and the remote tag exists, fetch the tag from origin.
- If the local backup branch is absent and its remote reference is verified, create the local tracking reference.
- If local and remote immutable references disagree, stop with a specific conflict code.
- Never move an existing remote tag or branch to another SHA without explicit authorization.
- Never force-push.
- Never change or push `main` during feature development.

### Dirty-worktree rules

Do not return a generic `BLOCKED_UNCOMMITTED_WORK` merely because unknown changes exist. Instead:

1. Inventory every modified, staged, deleted, and untracked path.
2. Scan the entire change set for secrets and unsafe generated artifacts without printing secret values.
3. Create a unique rescue branch from the current `HEAD` while retaining the working tree.
4. Commit the complete safe change set on the rescue branch without altering its contents.
5. Push and remotely verify the rescue branch before leaving it.
6. Return to the intended feature branch and continue only after confirming it is clean.

Never discard unknown changes. Never use `git reset --hard`, `git clean`, or stash as the primary preservation mechanism. Block only when a secret, authentication failure, or destructive ambiguity prevents safe preservation.

The workspace bootstrap utility reports dirtiness and the required rescue action; it must not automatically commit or push user work.

### Output-creation rules

When a prompt requires a document, report, script, branch, directory, test, configuration template, or package script, create it if missing and update it idempotently if it exists. Do not block solely because an earlier prompt did not create an expected output.

Reconstruct missing prerequisite documentation only from verifiable Git, repository, and newly observed command evidence. Never fabricate historical evidence or test results. A failed or blocked validation must still produce the required report with its exact commands, exit codes, failures, and an accurate `FAILED` or `BLOCKED` classification.

### Base44 rules

- Use `npx base44`; never invoke a bare global `base44` command.
- Before any Base44 cloud operation, run `npx base44 whoami` unless the active prompt explicitly prohibits all Base44 commands.
- Create a Base44 app only when the active prompt explicitly requires it.
- Do not assume cloning an app copies database records, users, secrets, domains, or integrations.
- Do not deploy production unless the active prompt explicitly authorizes production deployment.
- Do not connect or move a domain without an explicit cutover prompt.
- Do not guess or fabricate Base44 app IDs or secrets.
- Keep `base44/.app.jsonc` untracked and environment-specific.
- Fail closed on deployment-target ambiguity.

### Secret rules

- Never invent or guess a secret.
- Never print a secret value.
- Never commit `.env` files, credentials, private keys, recovery passwords, AWS secrets, access tokens, authentication cookies, or credential-bearing URLs.
- A missing required secret is an actionable configuration blocker, not a resource Codex may fabricate.
- Secret names and non-secret placeholders may be created when required.

### Validation rules

- A failed test must not prevent creation of its validation report.
- Record exact commands, exit codes, warnings, and failures.
- Do not claim success that was not observed.
- Deployment success is not functional certification.
- A missing previous report triggers regeneration when the necessary evidence can be gathered safely.
- Verify staged paths and scan them for secrets before every commit.

### Allowed blockers

Block only for a concrete condition such as:

- Missing authentication.
- A missing non-derivable secret.
- Conflicting immutable Git references.
- Potential secret exposure.
- Destructive ambiguity involving production data.
- Unavailable external-account permission.
- A required action that would overwrite or delete user work.
- An explicit safety or security prohibition.

“Resource does not exist” is not by itself an acceptable blocker when the active prompt authorizes deterministic, non-destructive creation.
