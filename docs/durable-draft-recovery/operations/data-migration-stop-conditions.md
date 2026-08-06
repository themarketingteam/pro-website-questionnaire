# Data Migration Stop Conditions

## Stop before starting

STOP when source/target/environment is ambiguous; production authorization is
absent; backup or restore evidence is missing; RLS is unverified; secrets or
schema versions are incompatible; another lease exists; dry run is incomplete;
submitted protection is unproved; file references are unresolved; or rollback
cannot be executed.

## Stop during transfer

STOP on lease loss, pagination instability, checkpoint/hash mismatch, unknown
entity/field/status, duplicate logical ID, non-idempotent replay, cross-client
boundary signal, submitted mutation, raw sensitive artifact, unexpected write
side, error threshold breach, missing file, cleanup failure, or any operation
outside the approved batch/environment.

## Stop before cutover

STOP unless two quiet delta passes complete; counts and content hashes match;
every conflict has an approved disposition; late writes are reconciled; files
verify; submitted records remain identical; RLS attacks pass; green health and
synthetic cleanup pass; reverse migration is ready; blue remains intact; and
data/domain/incident owners sign off.

## Stop reverse migration or rollback

STOP on a green-native record without an approved mapping, newer blue write,
three-way comparison conflict, destructive delete request, submitted mismatch,
duplicate final submission, missing origin mapping, hash divergence, lease
loss, or partial cleanup. Preserve both sides and the checkpoint; never resolve
by overwriting the newer record automatically.

## Evidence and restart

Record the safe stop code, UTC checkpoint, batch/lease ID, counts, hashes,
conflict classes, build/schema/policy versions, operator, and approvals. Exclude
answers, emails, credentials, recovery material, raw URLs, and app IDs. Restart
only from the verified checkpoint after the data owner approves a written
remediation and the same preconditions pass again.
