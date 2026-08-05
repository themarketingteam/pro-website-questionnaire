# Source Baseline Validation

## Classification

- Classification: `BASELINE_CERTIFIED_WITH_KNOWN_TEST_FAILURES`
- Baseline tag: `pre-durable-draft-recovery-2026-08-05`
- Baseline SHA: `27ddc347d55db00796a0e3e19ac343245519b01e`
- Validation started (UTC): `2026-08-05T18:57:59Z`
- Validation completed (UTC): `2026-08-05T19:01:05Z`

The tag is a practical source-code rollback point: it can be checked out independently, installed with its committed lockfile, built, and served locally. It is not fully certified because its existing test suite, lint, and type-check commands do not pass.

## Prerequisites and immutable reference

| Check | Result | Evidence |
| --- | --- | --- |
| Active branch before validation | PASS | `feature/durable-draft-recovery` |
| Active working tree before validation | PASS | Clean |
| Prior source manifest | PASS | `docs/durable-draft-recovery/baseline/source-baseline-manifest.md` |
| Peeled tag SHA | PASS | `27ddc347d55db00796a0e3e19ac343245519b01e` |
| Backup branch SHA | PASS | `27ddc347d55db00796a0e3e19ac343245519b01e` |
| Remote backup branch | PASS | `origin/backup/pre-durable-draft-recovery-2026-08-05` resolves to the same SHA |
| Remote annotated tag | PASS | Tag object `c588fa54629d661819ce15a92deaac4041a8f04a`; peeled remote tag resolves to the baseline SHA |

## Clean-checkout method

The baseline was checked out with `git worktree add --detach` at the immutable tag. The temporary checkout was outside the active repository at:

```text
/tmp/pro-content-baseline-validation.XCYMTn/worktree
```

`HEAD` was detached at the approved tag and exact baseline SHA. `git status --short`, the tracked diff, and the staged diff were empty both before and after validation. No commit or tracked-file modification was made in the tagged checkout. Generated `node_modules/` and `dist/` content remained ignored and uncommitted.

## Validation environment and toolchain

| Item | Observed value |
| --- | --- |
| Operating system | macOS 26.6 (build 25G72) |
| Kernel / architecture | Darwin 25.6.0 / arm64 |
| Node | `v26.5.1` |
| npm | `11.17.0` |
| npm registry | `https://registry.npmjs.org/` |
| Package manager | npm, inferred from `package-lock.json` v3 and npm scripts |
| `packageManager` field | Not configured |
| `engines` field | Not configured |
| Vite | `6.3.6` |
| React / React DOM | `18.3.1` / `18.3.1` |
| Redux Toolkit / Redux / React Redux | `2.11.2` / `5.0.1` / `9.2.0` |
| Redux Persist | `6.0.0` |
| Base44 SDK / Vite plugin | `0.8.39` / `1.0.30` |
| Base44 CLI | Not declared or installed; no CLI was added or run |
| Vitest | `1.6.1` |
| Jest | Not installed |
| Playwright | Not installed |
| TypeScript | `5.9.3` |
| ESLint | `9.36.0` |

Source identity hashes:

| Artifact | SHA-256 / object ID |
| --- | --- |
| `package.json` | `f816dc3c0faf8af179cde6e6a93225acfc50242e8ae8570e882281876e47ca63` |
| `package-lock.json` | `8eed243b1344fd407f2a05671110ac2df4edd9567063925a2ce16112d9b7bbba` |
| `base44/config.jsonc` | `e11938b7f2ba35f99870082014ecc9151612e9a66214772faab618323be25e45` |
| Git tree object | `40c3ed4e05e1ba228eb6781b4d2c4c6bf7f8932f` |
| Tracked tree-listing SHA-256 | `416d7a7a34968d26d5dcec5f56f4ebcdd387a657f84443833c11de3d3532611b` |

## Reproducible dependency install

| Field | Result |
| --- | --- |
| Command | `npm ci` |
| Started (UTC) | `2026-08-05T18:57:59Z` |
| Finished (UTC) | `2026-08-05T18:58:07Z` |
| Exit code | `0` |
| Packages | 769 added; 770 audited |
| Lockfile after install | Unchanged; SHA-256 still `8eed243b1344fd407f2a05671110ac2df4edd9567063925a2ce16112d9b7bbba` |

Important install warnings were one deprecated package (`whatwg-encoding@3.1.1`), 29 audit findings (1 low, 8 moderate, 18 high, 2 critical), and five dependency install scripts awaiting npm `allowScripts` review. No registry, dependency, or lockfile change was made.

## Validation command results

| Area | Exact command or status | Exit | Result |
| --- | --- | ---: | --- |
| Package test script | `NOT_CONFIGURED` | — | No `test` script exists in `package.json` |
| Existing Vitest suite | `./node_modules/.bin/vitest run --config src/vitest.config.js --reporter=verbose` | 1 | FAIL: 21/23 files passed; 178/181 tests passed |
| Lint | `npm run lint` | 1 | FAIL: 54 problems (34 errors, 20 warnings) |
| Lint autofix | `npm run lint:fix` | — | Not run because it would modify the immutable checkout |
| Type check | `npm run typecheck` | 2 | FAIL: 264 TypeScript diagnostics across 48 files |
| Production build | `npm run build` | 0 | PASS |
| Existing smoke-test script | `NOT_CONFIGURED` | — | Manual local preview performed instead |
| Existing Playwright test | `NOT_CONFIGURED` | — | Playwright is not installed and no configuration exists |
| Existing schema/config validation | `NOT_CONFIGURED` | — | No safe local validation script exists |
| Existing environment validation | `NOT_CONFIGURED` | — | No safe local validation script exists |

The Vitest configuration uses jsdom, and the executed tests were isolated local tests with mocks. No questionnaire was submitted and no production email, Zapier request, or Base44 write was initiated.

## Known baseline failures and warnings

The Vitest run started at `2026-08-05T18:58:25Z`, finished at `2026-08-05T18:58:45Z`, and reported:

- One failed suite: `src/test/proSubmissionRepairHelpers.test.js` cannot resolve `../src/lib/server/proSubmissionRepairHelpers.js`.
- `Q24 Other requires custom text and normal option stays complete when switching back`: expected `complete`, received `incomplete`.
- `writes a recoverable local backup when the database save fails`: no expected local backup key was found.
- `payload normalization preserves x/y zero values and filters incomplete rows`: expected numeric `0`, received string `"0"`.

Lint reported 34 unused-import errors and 20 warnings, primarily unused variables/imports and unused ESLint disable directives. Type checking reported 264 diagnostics across 48 files, including missing inferred properties, missing `ImportMeta.env` typing, component prop incompatibilities, and unknown Redux state typing. These failures were documented without changing the baseline.

Build warnings were that the Base44 proxy was not enabled because `VITE_BASE44_APP_BASE_URL` was unset and that the browser compatibility datasets were stale. Neither warning blocked the build.

## Production build output

- Command: `npm run build`
- Started (UTC): `2026-08-05T18:59:08Z`
- Finished (UTC): `2026-08-05T18:59:13Z`
- Exit code: `0`
- Output directory from `base44/config.jsonc`: `./dist`
- Total output: 56 files, 2,328,920 bytes
- Expected entry point: `dist/index.html` present
- JavaScript assets: 11 present under `dist/assets/`
- Deterministic manifest format: UTF-8 TSV, sorted by relative path, with `path`, byte size, and SHA-256 on each line
- Build-manifest SHA-256: `fa7824d49f628c6228b1640a2ba71f4e19fe096731eae7544abb2aaf4670d98b`

Deterministic build manifest:

```text
assets/ConfirmModal-Gw1CUMTS.js	6518	d5e335464f40a3d7bb0efb39c35b50aa377470eec5365b65178883acd16227b9
assets/ImageTaggingQuestion--glRgy-R.js	8722	860d8609204ab4e095798b118094f230f012f804e6b35908be9da30327006e2d
assets/index-BkDB4qJ3.css	88735	9c9aa6d596515d1f0eef77c2e5fd8305b3e67fa0e74aa3cee99a90dbb86b4528
assets/index-CWh7Jp7j.js	636760	310d7953bccff7722a24ec23b67f6bd454704437c27f30d8abdf7ebd4bb46ece
assets/index.es-C0yItm73.js	159418	32f26f3cc8278813020799d7644b4a051d1107d6063db08ebe201df2474d428e
assets/inter-cyrillic-400-normal-HOLc17fK.woff	9780	6e441a6c94788318fa02b6d0a633aa29eebe27b69c6567eb1e59b4edc68ed70e
assets/inter-cyrillic-400-normal-obahsSVq.woff2	7712	f0bb586459ce8f09b238285040f17e3e9e9538b2c5a7aae0775194e33c36c3c3
assets/inter-cyrillic-600-normal-4D_pXhcN.woff	9936	cc190ed1b64eb650a4ad7e97c7a668cb8b34acd9c4c7f7bf4372c0cbacd35795
assets/inter-cyrillic-600-normal-CWCymEST.woff2	7972	6c2a37f82a676bcd441b735e4e2cda4edb8873a059ab9c362a84f0711f257041
assets/inter-cyrillic-700-normal-CjBOestx.woff2	7904	5917871d3cc970d8ce195101cbf65c1f68ec948022eb6070030342bb7edfb3bb
assets/inter-cyrillic-700-normal-DrXBdSj3.woff	9912	72b6daa49173e531027d8a260ef128e142a165811cab6a2875eefe0c3c58fa0e
assets/inter-cyrillic-ext-400-normal-BQZuk6qB.woff2	10232	ef572f9187a8be018d9d9c2c6b77c1f6cb2af4199f02fc16c292ea10ab25a2cc
assets/inter-cyrillic-ext-400-normal-DQukG94-.woff	13336	5cb2f1cc0936f89a42ceae34f5a5720248dc5b8114c12b1c33a7d2ef01a9b6b9
assets/inter-cyrillic-ext-600-normal-Bcila6Z-.woff	13464	a5073285409443f4653c858de58c5dc0bfc2fd33e60d8747388345e7c5ab1ab3
assets/inter-cyrillic-ext-600-normal-Dfes3d0z.woff2	10484	509fca9c59564f9a846fa69bc647f9b050fc11abf1c9f6f3da71fb2d5ed425bd
assets/inter-cyrillic-ext-700-normal-BjwYoWNd.woff2	10496	a46b99781170971e2c99a87ff7ee9f5cf90a9dfcd18175e1be6300201d030123
assets/inter-cyrillic-ext-700-normal-LO58E6JB.woff	13408	0f3d4be2bd7018f78fa3484a5f6e9d8ce567689426643b84a47e8cabb91e5f16
assets/inter-greek-400-normal-B4URO6DV.woff2	7776	c15ddd00a9927b56f5c655a41f976f79bd848a20cce91fc14227751872a1cc27
assets/inter-greek-400-normal-q2sYcFCs.woff	9924	bdae9d28729e8c68587d5d54e216d771a40d7a6800e824586a6e2f570c2f10df
assets/inter-greek-600-normal-BZpKdvQh.woff	10032	090b24e22fc4ddf41450d13bdec81c8a74808b9fc7edaf8df06c909b177a8992
assets/inter-greek-600-normal-plRanbMR.woff2	7944	9c5a897f9d9fcfe60d90631d766ae62b4bf1edd76633fa7a4b2f8c87e036789b
assets/inter-greek-700-normal-BUv2fZ6O.woff	9980	53368f53d5fc43381dcc45c8533ba2476f80337136313525f96dcbdc736616a5
assets/inter-greek-700-normal-C3JjAnD8.woff2	7920	737c6c91cd60372d30e6540096ada83c89c9b4613cd7472e3366bf2e07ad99f1
assets/inter-greek-ext-400-normal-DGGRlc-M.woff2	5264	eadedd9e13c2582430a9fb1519eb86152fdabb483a6f66d90f8d8a52e977a1b7
assets/inter-greek-ext-400-normal-KugGGMne.woff	7064	4f2b6f92ddfece8812e79774d446218aa6e0773ff8c2d31130fe2bdc23bd22d0
assets/inter-greek-ext-600-normal-B8X0CLgF.woff	7212	efc7aa9cce5c505dd8cc4c4daf00247fa805f37bcda96079239ba3358ab27dfb
assets/inter-greek-ext-600-normal-DRtmH8MT.woff2	5432	399f94d75aa73403e40e2353e8c0cc75c38f7362a6ca263b3b02d9723157ffe5
assets/inter-greek-ext-700-normal-BoQ6DsYi.woff	7216	b26ed64c9135a750ad580b92152bedeef90771e74e18f6f7759a6d7adb0f1b5d
assets/inter-greek-ext-700-normal-qfdV9bQt.woff2	5444	b7b2732ebc981b30a5463ffc850407649dba41e625aee124cc63293da4547629
assets/inter-latin-400-normal-C38fXH4l.woff2	23664	8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc
assets/inter-latin-400-normal-CyCys3Eg.woff	30696	e20fa0b4fd2dd26e4d14b3ac3cc922509c3a63fa5e910e90c614544aa042dd45
assets/inter-latin-600-normal-CiBQ2DWP.woff	31260	6a9cb3a509b4eeaf12b7dda6c4aacac3e85d07f4201bf4dd716e332e692b87bd
assets/inter-latin-600-normal-LgqL8muc.woff2	24452	f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a
assets/inter-latin-700-normal-BLAVimhd.woff	31320	7c5ed5655730de337704d3fc94628515cd7e3d8d32368871709bf56ac0397e7a
assets/inter-latin-700-normal-Yt3aPRUw.woff2	24356	6f56409fd3d64bb85f7d070bce20749db2d66b6d63cec586cc22d1c761be2491
assets/inter-latin-ext-400-normal-77YHD8bZ.woff	47560	22ae8360fbad24d2af7c6c9898a346c881774dc87f7cf94bd262c48ad58d7116
assets/inter-latin-ext-400-normal-C1nco2VV.woff2	35000	6744a7f509ebc6ab220a6cd4ea77e898adf014f03d88dcda5d45d8a9feefb4e9
assets/inter-latin-ext-600-normal-CIVaiw4L.woff	48668	22ff20a6170674fb9637c2a072227be86303bb6ec52b829b9d7077405f7196a6
assets/inter-latin-ext-600-normal-D2bJ5OIk.woff2	36260	e4bdf67b0cd15ca9e184509275be95db942195d3cc2b17f6a0452f2adf75d0bf
assets/inter-latin-ext-700-normal-Ca8adRJv.woff2	36244	143f9504f1377012aa3e39c90c4354ef429cb0494b9ac0e1437f1a81e5412236
assets/inter-latin-ext-700-normal-TidjK2hL.woff	48632	1761edba32014180deab3dbbe3f7156c64ef6f34bc76313ba31ce227fc9ff391
assets/inter-vietnamese-400-normal-Bbgyi5SW.woff	6500	54aa42d325bcdfd623ecb9eac4a5e3c6420c63d7b86e9d8545fb479f653beb57
assets/inter-vietnamese-400-normal-DMkecbls.woff2	4972	547ad9fdaeb0ae43487f4b8a02e47c36553c0c0cb73c8aa98f93b7b615f6b55d
assets/inter-vietnamese-600-normal-BuLX-rYi.woff	6640	24a01e7bd947aeef91ae8f7b8edeb23fadaf5ceda34a610ce62d2bbdaea57e83
assets/inter-vietnamese-600-normal-Cc8MFFhd.woff2	5100	1aeb94ae9db052a4a2fe6f3046f928cff1fdbd7abdf870a9a01c13cae6faeba5
assets/inter-vietnamese-700-normal-BZaoP0fm.woff	6632	412023ab2f41333b373e2c6eb2a3ebab806fddd610015d2ae8cd4f4314c7ba92
assets/inter-vietnamese-700-normal-DlLaEgI2.woff2	5104	5fafa3829a16d9ea5ac3a67c51e54186353122790b604a3e361f96cab188da8b
assets/ProQuestionnaire-DU1hiOuR.js	118673	eacb1d88efc6cef55bdd427beb0b7736d03c3f6cd2a6409455973b27d29aedcd
assets/purify.es-C_uT9hQ1.js	21975	78442dafb8e1a783c5b49acf85f9b3d75d91cd97f3b76dc0fd19be218c725aad
assets/ReduxDataValidator-DqyrUf3m.js	4561	c4db8cfe8aef8308b223f353a0cbe8e93147008c4e571d90919809636c0d2a77
assets/ThankYou-DdLXT5Em.js	2910	60d326d7327233c08b4555fec4957f2e85eb0f9ae66372f98d821fae33d5db88
assets/ThankYouModal-_0KJuv_9.js	3250	ab7224cb138c03fc4ebd478f24bad40718e290e102a652bb6a7b9753a8dbdf48
assets/useQuestionnairePdfDownload-D56HWL3_.css	6997	3c7c422a88472eb9be618a5df1026e2ccf06579d439053266c7e5794db1a5f8b
assets/useQuestionnairePdfDownload-Dnv7goG_.js	597672	dc0e71efde1d9c8426b9fa795cd233b76212b3d9559f5f5703701077ef21b13f
assets/ValidationGuide-DcDC2HVm.js	1902	a43be2cdf41dd8ae5207e3313198b26222d9cf176f42e67fef798fd70df4c00d
index.html	1923	953ecc6bf255b4e20f0e534231915397c1c04b560349a6b0e5911512bd6d6786
```

The compiled output was not added to Git.

## Build-output secret scan

The build was scanned without printing any candidate value. Results:

| Pattern category | Matches |
| --- | ---: |
| `AWS_SECRET_ACCESS_KEY` | 0 |
| `DRAFT_RECOVERY_PASSWORD` | 0 |
| `PRO_FORM_DRAFT_TOKEN_SECRET` | 0 |
| npm token patterns | 0 |
| GitHub token patterns | 0 |
| Private-key headers | 0 |
| Sensitive environment values embedded in output | 0 |

No `.env` file is tracked at the baseline, and no sensitive environment candidate was present in the build process. Secret scan: PASS. No critical secret-detection blocker was found.

## Safe local preview smoke test

The existing `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` command served the production build only on localhost.

| Check | Result |
| --- | --- |
| Route | `http://127.0.0.1:4173/` |
| HTTP status | `200` |
| Rendered title | `Kaseya - Pro Website Content Form` |
| Visible identifying heading | `MSP Success - Pro \| Website Content Questionnaire` |
| App shell marker | `Validation Status Guide` present |
| Main questionnaire route reached | PASS |
| Immediate JavaScript crash | None observed |
| Browser console errors | 0 |
| Submission or form interaction | None |
| Preview shutdown | Confirmed; localhost port no longer served the app |

## Blockers, limits, and side-effect statement

There is no install or build blocker to using this tag as a source-code rollback point. Full baseline certification is blocked by the four Vitest failures, lint failure, and type-check failure documented above. The unpinned Node/npm toolchain and npm audit findings are additional reproducibility and dependency-health risks.

No fixes were made to the tagged source. No Base44 CLI command or deployment was performed, no Base44 cloud resource or production record was changed, no domain was moved, and no external email, Zapier submission, questionnaire submission, or client-facing PDF was generated. This validation covers source-code rollback only; it does not validate or provide Base44 database rollback.
