# Durable Draft Recovery Source Baseline

## Baseline identity

- Repository: `themarketingteam/pro-website-questionnaire`
- Origin: `https://github.com/themarketingteam/pro-website-questionnaire.git`
- Verified production branch: `origin/main`
- Verified baseline commit: `27ddc347d55db00796a0e3e19ac343245519b01e`
- Baseline commit subject: `fix: harden live questionnaire recovery and validation`
- Annotated baseline tag: `pre-durable-draft-recovery-2026-08-05`
- Backup branch: `backup/pre-durable-draft-recovery-2026-08-05`
- Working feature branch: `feature/durable-draft-recovery`
- Baseline date: `2026-08-05`
- Manifest timestamp (UTC): `2026-08-05T18:22:57Z`

The annotated tag and backup branch were created directly at the verified baseline commit before this manifest was added. This manifest exists only on the feature branch.

## Production-commit evidence

The production source baseline was selected from the fetched remote state, independently of the dirty working tree:

1. GitHub reports `main` as the repository's default branch, and `origin/HEAD` resolves to `origin/main`.
2. After `git fetch --all --tags --prune`, `origin/main`, local `main`, and the pre-branch-switch `HEAD` all resolved to `27ddc347d55db00796a0e3e19ac343245519b01e`.
3. The `main` history contains commit `6dac337bd11d4e438a3d36deb0269fa6e8608b2b`, titled `chore: retrigger Base44 deployment`. It is an ancestor of the baseline and records that the repository's `main` history is used to trigger Base44 deployment.
4. The selected commit is the latest fetched `origin/main` commit and is explicitly titled `fix: harden live questionnaire recovery and validation`.
5. Repository and GitHub checks found no release manifest, GitHub release, production tag, GitHub Actions workflow/run, GitHub deployment record, commit-status context, or alternate remote production branch naming a different production SHA.

On this evidence, `origin/main` was the single supported production source-of-truth reference, so its exact existing commit was backed up without creating a new baseline commit.

## Working-tree state when the SHA was selected

Local `main` matched `origin/main` exactly (`+0/-0`) when the production SHA was selected. The working tree was not clean, and none of these changes was staged:

```text
 D index.html
 D jsconfig.json
 M package-lock.json
 M package.json
 D tailwind.config.js
```

The modified `package.json` and `package-lock.json` blob hashes were not present in any fetched local or remote commit. These five local changes were preserved, were not stashed or reset, and were not included in the baseline tag or backup branch.

## Runtime and dependency baseline

The following values describe the committed baseline, not the uncommitted working tree:

- `.nvmrc`: absent
- `.node-version`: absent
- `package.json` `engines`: absent
- `package.json` `packageManager`: absent
- Inferred package manager: npm
- Active lockfile: `package-lock.json` (lockfile version 3)
- Baseline `package-lock.json` SHA-256: `8eed243b1344fd407f2a05671110ac2df4edd9567063925a2ce16112d9b7bbba`

## Base44 application identity and scope

- `base44/config.jsonc`: present in the baseline commit
- `base44/.app.jsonc`: present locally as an ignored link file; absent from the baseline commit
- Production Base44 app name from non-secret configuration: `Pro Website Questionnaire`
- Linked app identifier fingerprint (SHA-256): `f030ea980e900a98b3d172630fe4f52522ebe14ba09e834be668b48e29cfc4f9`

No Base44 cloud resources were changed while creating this source baseline. No domain was moved, and no production data was changed. This Git backup does not itself back up Base44 database records.

Base44 data rollback will require the later bidirectional migration process; restoring this Git tag or backup branch alone cannot roll back database records.

## Verification commands

Run these commands from the repository root:

```bash
git fetch origin --tags
git rev-parse 'pre-durable-draft-recovery-2026-08-05^{}'
git rev-parse backup/pre-durable-draft-recovery-2026-08-05
git ls-remote --tags origin \
  'refs/tags/pre-durable-draft-recovery-2026-08-05' \
  'refs/tags/pre-durable-draft-recovery-2026-08-05^{}'
git ls-remote --heads origin \
  refs/heads/backup/pre-durable-draft-recovery-2026-08-05
```

The peeled tag, local backup branch, remote peeled tag, and remote backup branch must all resolve to:

```text
27ddc347d55db00796a0e3e19ac343245519b01e
```
