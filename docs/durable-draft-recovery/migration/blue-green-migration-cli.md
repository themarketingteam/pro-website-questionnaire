# Blue/green migration CLI

- Script: `scripts/pro-form-blue-green-migration.mjs`
- Package entry: `npm run migration:blue-green -- <command>`
- Status: local implementation only; no endpoint is deployed

## Commands

| Command | Behavior |
| --- | --- |
| `plan` | Validate environment-only configuration and print a redacted, content-free plan. |
| `export` | Request one bounded signed source batch, keep it in memory, emit only safe counts, then discard it. |
| `import` | Stream every dependency-ordered source batch directly to destination dry-run/import. |
| `sync` | Run an overlap-safe incremental blue-to-green delta. |
| `reverse` | Run green-to-blue full/delta reconciliation through reverse identity maps. |
| `late-write` | Reconcile post-freeze blue writes and emit a quiet-window report. |
| `finalize` | Plan or apply ID-map relationship patches. |
| `verify` | Read safe status and require zero open conflicts/unresolved mappings. |
| `file-audit` | Produce classification/blocker metadata without downloading files. |
| `status` | Return checkpoint, entity, mapping, conflict and unresolved counts only. |

## Environment-only configuration

The CLI reads the eleven required `PRO_MIGRATION_*` names from the prompt plus
`PRO_MIGRATION_SOURCE_ENVIRONMENT` and
`PRO_MIGRATION_DESTINATION_ENVIRONMENT`. It accepts no app ID, URL, grant,
device ID, authorization, token, password or secret flag. URLs printed in a
plan are reduced to their scheme and `<redacted-host>`.

The source and destination IDs must differ. Environments must match. Staging
or test use additionally requires `PRO_MIGRATION_TEST_MODE=staging_fixture`;
production/staging crossing is not implemented. The report directory should
be an operator-owned location outside Git.

## Dry run and apply

Dry run is explicit and makes no destination write:

```text
npm run migration:blue-green -- import --dry-run
```

Apply requires both flags exactly:

```text
npm run migration:blue-green -- import --apply --confirm APPLY_CROSS_APP_MIGRATION
```

The confirmation phrase is not authorization. Backend admin-grant and
migration-authorization verification still occur. Conflict threshold defaults
to zero and may be set with `--conflict-threshold N`.

## Streaming, resume and reports

Bundles pass directly from source HTTP response to destination request in
memory. Reports contain redacted endpoints, direction, environments, entity
names and counts only. A structural guard rejects report keys resembling
bundle, record, data, answer, email, grant, authorization, token, password or
secret content.

Confirmed apply records only sequence, previous hash, entity index, cursor and
snapshot cutoff in an owner-only resume report. Dry run does not advance that
checkpoint. `--encrypted-export` fails with
`MIGRATION_CLI_ENCRYPTED_EXPORT_NOT_IMPLEMENTED`; raw export has no option.

Reverse apply uses a separate exact phrase:

```text
npm run migration:blue-green -- reverse --apply --confirm APPLY_GREEN_TO_BLUE_MIGRATION
```

`reverse` refuses any direction except `green_to_blue`; forward sync and
late-write operations refuse `green_to_blue`. Every request carries an opaque
lease ID/owner, and an active opposite-direction lease fails closed.

The local report directory is ignored by Git. Stable names are
`migration-plan.json`, `migration-progress.json`,
`migration-verification.json`, `migration-conflicts.json`,
`migration-file-audit.json`, and `migration-late-writes.json`. The structural
sanitizer rejects payload-bearing keys and removes URL query/fragment material.

## Operational boundary

Do not execute migration commands until both apps have separately configured
and certified roles, exact allowlists, direction, shared cross-app secret,
admin grants and a short-lived orchestrator authorization. Future `_next`
certification must prove live RLS, bundle-size behavior, interruption resume,
forward/reverse mapping, relationship closure, conflicts, counts/hashes and
cleanup without using production data in staging.
