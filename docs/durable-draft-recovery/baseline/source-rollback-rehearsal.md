# Production Source Rollback Rehearsal

## Classification

- Final classification: `ROLLBACK_SOURCE_READY_WITH_KNOWN_BASELINE_FAILURES`
- Rehearsal timestamp (UTC): `2026-08-05T19:08:08Z`
- Approved tag: `pre-durable-draft-recovery-2026-08-05`
- Approved baseline SHA: `27ddc347d55db00796a0e3e19ac343245519b01e`
- Approved root tree: `40c3ed4e05e1ba228eb6781b4d2c4c6bf7f8932f`

The immutable source is retrievable from GitHub, installable from its committed lockfile, buildable with output identical to the independent baseline validation, and usable to create a nondestructive emergency branch. Known baseline test, lint, and type-check failures prevent an unqualified ready classification.

## Remote-origin evidence

- Origin with credentials removed: `https://github.com/themarketingteam/pro-website-questionnaire.git`
- Remote annotated tag object: `c588fa54629d661819ce15a92deaac4041a8f04a`
- Remote peeled tag SHA: `27ddc347d55db00796a0e3e19ac343245519b01e`
- Remote backup branch: `backup/pre-durable-draft-recovery-2026-08-05`
- Remote backup branch SHA: `27ddc347d55db00796a0e3e19ac343245519b01e`
- Reference comparison: PASS

Both references were queried directly with `git ls-remote`. Neither reference was moved, deleted, recreated, or pushed.

## Fresh-clone retrieval

| Field | Result |
| --- | --- |
| Method | Fresh `git clone --no-checkout` from configured GitHub origin |
| Temporary path | `/tmp/pro-content-rollback-rehearsal.A2OHv4/fresh-clone` |
| Clone started (UTC) | `2026-08-05T19:05:38Z` |
| Tag checkout completed (UTC) | `2026-08-05T19:05:40Z` |
| Tag fetched explicitly | PASS |
| Backup branch fetched explicitly | PASS |
| Object alternates | None; current repository object database was not reused |
| Detached HEAD | `27ddc347d55db00796a0e3e19ac343245519b01e` |
| Initial working-tree status | Clean |
| Final working-tree status | Clean |
| Temporary clone cleanup | Removed after evidence capture |

No commit or tracked modification was created in the fresh clone. `node_modules/` and `dist/` remained ignored and uncommitted.

## Install result

| Field | Result |
| --- | --- |
| Command | `npm ci` |
| Registry | `https://registry.npmjs.org/` |
| Started (UTC) | `2026-08-05T19:05:46Z` |
| Finished (UTC) | `2026-08-05T19:05:57Z` |
| Exit code | `0` |
| Packages | 769 added; 770 audited |
| Lockfile SHA-256 after install | `8eed243b1344fd407f2a05671110ac2df4edd9567063925a2ce16112d9b7bbba` |
| Lockfile change | None |

Warnings matched the baseline validation: one deprecated dependency, 29 audit findings (1 low, 8 moderate, 18 high, 2 critical), and five install scripts awaiting npm `allowScripts` review.

## Validation results

| Area | Command | Exit | Result |
| --- | --- | ---: | --- |
| Package test script | `NOT_CONFIGURED` | — | No package `test` script exists |
| Vitest | `./node_modules/.bin/vitest run --config src/vitest.config.js --reporter=verbose` | 1 | 21/23 files and 178/181 tests passed |
| Lint | `npm run lint` | 1 | 54 problems: 34 errors, 20 warnings |
| Type check | `npm run typecheck` | 2 | 264 diagnostics across 48 files |
| Production build | `npm run build` | 0 | PASS |
| Existing Playwright test | `NOT_CONFIGURED` | — | Playwright is not installed |
| Existing schema/environment validation | `NOT_CONFIGURED` | — | No applicable safe local script exists |

The Vitest run started at `2026-08-05T19:06:09Z` and finished at `2026-08-05T19:06:29Z`. It reproduced the exact known baseline failure set:

- `src/test/proSubmissionRepairHelpers.test.js` failed to load because of its unresolved helper import.
- Q24 `Other` switching remained `incomplete` instead of `complete`.
- The database-save failure test did not find its expected recoverable local backup.
- Geographic zero coordinates were normalized as strings instead of numbers.

No failure was fixed or suppressed.

## Reproducible build result

| Field | Result |
| --- | --- |
| Command | `npm run build` |
| Started (UTC) | `2026-08-05T19:06:41Z` |
| Finished (UTC) | `2026-08-05T19:06:46Z` |
| Exit code | `0` |
| Output | 56 files; 2,328,920 bytes |
| `dist/index.html` | Present |
| JavaScript assets | 11 |
| Fresh-clone build-manifest SHA-256 | `fa7824d49f628c6228b1640a2ba71f4e19fe096731eae7544abb2aaf4670d98b` |
| Prompt 2 build-manifest SHA-256 | `fa7824d49f628c6228b1640a2ba71f4e19fe096731eae7544abb2aaf4670d98b` |
| Manifest comparison | Exact match |

The build reproduced byte-for-byte from the GitHub clone. The build-output scan found zero matches for the required recovery secrets, AWS secret name, npm/GitHub token patterns, and private-key headers.

## Safe local preview

| Check | Result |
| --- | --- |
| Command | `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` |
| Route | `http://127.0.0.1:4173/` |
| HTTP status | `200` |
| Visible heading | `MSP Success - Pro \| Website Content Questionnaire` |
| App-shell marker | `Validation Status Guide` present |
| Immediate JavaScript crash | None observed |
| Browser console errors | 0 |
| Form interaction or submission | None |
| Preview shutdown | Confirmed |

No production submission, email, Zapier delivery, Base44 write, or production PDF generation occurred.

## Remote backup checkout

The fresh clone switched to the explicitly fetched `origin/backup/pre-durable-draft-recovery-2026-08-05` reference in detached mode.

- Checkout SHA: `27ddc347d55db00796a0e3e19ac343245519b01e`
- Checkout root tree: `40c3ed4e05e1ba228eb6781b4d2c4c6bf7f8932f`
- Working-tree status: clean
- Comparison with approved tag: exact match

## Emergency rollback branch dry run

A second temporary worktree was created from the unchanged feature HEAD `e21c6ec87c71f7729cfa1b9e54ead522d1e6aad3`. Inside it:

1. `emergency/rollback-dry-run` was created from the immutable tag.
2. Its HEAD resolved to `27ddc347d55db00796a0e3e19ac343245519b01e`.
3. Its root tree resolved to `40c3ed4e05e1ba228eb6781b4d2c4c6bf7f8932f`, exactly matching the tag.
4. Its working tree was clean.
5. The temporary worktree was removed.
6. The local dry-run branch was deleted and confirmed absent.
7. The branch was never pushed.

The active feature HEAD remained `e21c6ec87c71f7729cfa1b9e54ead522d1e6aad3` throughout the dry run. Local `main` and `origin/main` remained at the baseline SHA; neither was reset or pushed.

## Known limits and STOP conditions

- The baseline has the recorded Vitest, lint, and type-check failures.
- Node and npm versions are not pinned by `package.json` or a version file.
- The dependency audit reports high and critical findings.
- This rehearsal did not test a Base44 deployment, cloud application rollback, database rollback, reverse synchronization, or domain reassignment.
- Source rollback alone cannot recover records written after a future blue-to-green cutover.
- Domain rollback must STOP until newer green records have been synchronized back to blue and reconciled by the later bidirectional migration utility.

## Side-effect and command-history statement

The execution shell was noninteractive with shell history disabled, so persisted shell-history inspection was unavailable. The complete command trace for this rehearsal contains zero Base44 CLI or deployment commands.

No Base44 application or cloud resource was read or modified, no production domain changed, no production database was accessed, and no database record changed. No force push, `main` push, tag update, or backup-branch update occurred. This report certifies only source retrieval, local validation/build/preview, and nondestructive emergency-branch preparation.
