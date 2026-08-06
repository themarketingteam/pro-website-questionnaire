# Green App Input Manifest

Status: **TEMPLATE BLOCKED — NO CERTIFIED STAGING TAG EXISTS**

The later clean production candidate must use the exact successful staging certification tag and peeled commit. The requested `durable-draft-staging-certified-2026-08-06` tag was not created because the final gate blocked; `a31c4574a9717ddb686156509ba50c5a34aa6e95` is therefore not authorized as `_next` input.

## Source integrity template

| Input | Observed source value | Rule |
| --- | --- | --- |
| Certified tag | Not issued | Resolve and peel the future annotated tag; never substitute a branch head. |
| Certified commit | Not issued | Must equal the tag annotation, tag target, runtime marker, and backend diagnostic. |
| `base44/config.jsonc` SHA-256 | `e11938b7f2ba35f99870082014ecc9151612e9a66214772faab618323be25e45` | Recompute from the certified commit. |
| Entity schema manifest SHA-256 | `ae36e40cbfca02697603637901e5f8f729dcf361d7a22110627b4ca003d27e0d` over 9 sorted per-file SHA-256 lines | Per-file values must also match the certified commit. |
| Function source manifest SHA-256 | `b89608e09005602465b1d3efc3e63c195a14eb6f7125098a1f42cd21bdc62f7d` over 109 sorted `.ts`/`.js`/`.jsonc` SHA-256 lines | Any difference requires recertification. |
| Lockfile SHA-256 | `748673ca867de7bd6295f4e746965afb48c56863ac20b453c15b24f9715b01cc` | Use `npm ci`; do not regenerate. |
| Vite configuration SHA-256 | `9f28db08497ebb906558b9da54a21c1d79609351bf45b472c46a695c9cc145d9` | Production build must be reproduced from Git. |
| Migration utility | Version 1, nine-entity policy | Live green migration remains pending. |

The app name must be the exact existing production name suffixed with `_next`. Do not create it until a valid certification tag exists and a later prompt explicitly authorizes creation.

## Required production secret names

Configure independently generated production values—never staging values—for `BASE44_SERVICE_ROLE_KEY`, `PRO_FORM_DRAFT_TOKEN_SECRET`, `PRO_FORM_DRAFT_EVENT_RETENTION_DAYS`, `PRO_FORM_DRAFT_LINK_SECRET`, `PRO_FORM_RECOVERY_CODE_SECRET`, `PRO_FORM_EMAIL_LOOKUP_SECRET`, `PRO_FORM_RECOVERY_SESSION_SECRET`, `PRO_FORM_IDEMPOTENCY_SECRET`, `PRO_FORM_ABUSE_HASH_SECRET`, `PRO_FORM_ADMIN_GRANT_SECRET`, `PRO_FORM_MIGRATION_APPLY_SECRET`, `PRO_FORM_CROSS_APP_MIGRATION_SECRET`, `PRO_FORM_RETENTION_APPLY_SECRET`, `PRO_DRAFT_CAPTCHA_SECRET_KEY`, `PRO_DRAFT_AWS_ACCESS_KEY_ID`, `PRO_DRAFT_AWS_SECRET_ACCESS_KEY`, and any approved session credential required by the production SES account. Values must not enter Git, frontend variables, logs, or this manifest.

## Disabled-first configuration

- `PRO_DRAFT_V2_SERVER_ENABLED=false`
- `PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED=false`
- `PRO_DRAFT_EMAIL_OTP_ENABLED=false`
- `PRO_DRAFT_MAGIC_LINK_ENABLED=false`
- `PRO_DRAFT_DIAGNOSTICS_ENABLED=false`
- `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE=disabled` until production integration verification
- `PRO_FORM_DRAFT_RETENTION_DRY_RUN=true`
- Frontend V2, public recovery, OTP, magic-link, and diagnostics flags are `false`.
- Staging banner, test hooks, staging recipient rewrites, staging app IDs, staging URLs, staging secrets, and staging/test records are prohibited.

Production integrations require separately verified SES identity/region/quota/bounce handling, backend-only Zapier destination and timeout, CAPTCHA hostname/provider, analytics configuration, Base44 app identity, and domain ownership. Restrictive RLS, backend-only sensitive access, service-role boundaries, submitted locks, abuse controls, retention holds, migration allowlists, and kill-switch controls must match the certified contract before any data or domain action.
