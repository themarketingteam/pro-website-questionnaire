# Post-Staging Certification Freeze Policy

Status: **DEFINED, NOT ACTIVE**. No staging certification tag exists.

1. `_next` must be created only from the exact peeled commit of a valid annotated staging certification tag.
2. Any runtime, schema, function, dependency, or build-configuration change after certification requires a new feature commit, staging deployment, affected or full recertification as classified by the freeze validator, and a new date-qualified certification tag.
3. Production configuration-only changes still require target, disabled-first flags, secret-name/version, integration, RLS, build-marker, smoke, and evidence verification. “Configuration only” never bypasses security or production-disabled gates.
4. Do not make direct `_next` edits that are absent from Git. Rebuild from the certified tag when drift is found.
5. Documentation/evidence-only changes may preserve a candidate only when the freeze validator proves no runtime/schema/function/build change, report checksums are regenerated, and the final precheck passes on the documentation commit.
6. Emergency exceptions require an incident ID, owner and security approval, exact diff, time bound, rollback plan, data-preservation assessment, and retrospective staging recertification. They never authorize an untracked production edit, RLS weakening, secret disclosure, forced tag move, or `main` bypass.
7. Tags are immutable. A conflicting tag stops release; create a new approved date-qualified tag after recertification.

This policy becomes active only when `STAGING_RELEASE_CANDIDATE_CERTIFIED` is observed, the manifest checksum is recorded in the annotated tag, and remote branch/tag verification succeeds.
