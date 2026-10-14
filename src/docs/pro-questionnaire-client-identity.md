# Pro questionnaire client identity and draft persistence

## Launch contracts

Normal visits resume the secured draft capability in the URL fragment or the browser's saved capability. The editable form remains locked until `syncProQuestionnaireDraft` confirms a database draft and returns a recovery credential.

An explicit new-client launch uses:

```text
/?newClient=true&newClientRequestId=<unguessable-request-id>&businessName=<optional>&domainName=<optional>
```

If no request ID is supplied, the browser creates one and writes it into the URL before contacting the server. The server stores only its SHA-256 hash. Replaying the same request ID returns the same draft instead of creating a duplicate, and a replay with conflicting identity is rejected. One-time launch parameters are removed only after the server confirms the draft.

When incoming identity conflicts with an existing secured draft, the form stays locked. The user must continue the existing draft, create a separate new client, or cancel. No action silently transfers answers between clients.

## Persistence and recovery

- Answer mutations are coalesced and serialized with mutation IDs and monotonically increasing client sequences.
- The database revision is authoritative; browser storage is an outbox only.
- Save status reports pending, saving, confirmed, retrying, or unable to save. “Confirmed” is shown only after a server revision is returned.
- Retryable failures use bounded backoff. Pending changes are flushed on `visibilitychange` and `pagehide` when supported.
- Explicit deletions are sent as deletion keys so an unloaded empty state cannot erase a server answer.
- Recovery links contain an unguessable capability in the fragment. Only its hash is stored by the application.

## Submission boundary

`submitProQuestionnaireDurable` verifies the secured draft capability, draft ID, client identity, content fingerprint, and stable attempt ID before creating or reusing a submission. The fallback intake path uses the same authorization first. An identity or idempotency conflict is rejected and cannot be converted into an intake belonging to another client.

Privacy-safe telemetry records bootstrap failures, storage blocking, rejected saves, retry exhaustion, identity conflicts, confirmed revisions, and submission identity conflicts. Questionnaire answers and recovery credentials are excluded.
