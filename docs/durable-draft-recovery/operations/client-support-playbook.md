# Client Support Playbook

## Safety script

Say: “I can help you use the available recovery options and confirm safe draft
metadata. Email recovery locates eligible drafts; it does not verify identity.”

Never request a client password, share the admin password, read answers aloud
without appropriate authorization, expose raw database records in a browser,
or ask for a full recovery code in an insecure ticket when a hint suffices.
Record only safe request IDs, code hint, approximate save time, lifecycle
status, browser/storage mode, and support outcome.

## Approved staff operations

- Locate a draft only in the password-gated admin recovery interface using the
  minimum supplied search context; never through direct browser entity access.
- Identify `active`, `submit_failed`, `submitted`, and `cleared_superseded`
  from the protected lifecycle projection. Submitted is read-only.
- Apply or release a retention hold only through the protected admin update,
  with a nonempty case-linked reason and audit event.
- Regenerate a submitted PDF only through a protected operation that verifies
  the submitted source-state hash. That dedicated operation is not currently
  certified; escalate rather than reconstructing from raw records.
- Retry a failed submission only through the idempotent protected admin
  operation after checking destination state; never create a duplicate intake.

## Client has a recovery code

1. Direct the client to the official recovery page and have them enter the
   code themselves.
2. Confirm only the hint and generic outcome; do not copy the code.
3. If recovery fails, record the safe error/request ID and check lockout or
   CAPTCHA guidance without confirming whether a draft exists.
4. Escalate after one controlled retry or any cross-client concern.

## Client has email but no code

1. Explain that email lookup is not identity verification.
2. Have the client enter the address on the official recovery flow.
3. If multiple eligible drafts appear, let the client choose using safe label,
   status, and time; support must not choose based on answers.
4. If delivery fails, follow the failed-email workflow below.

## Client has neither code nor email

Explain that support cannot bypass recovery authorization. Gather safe business
context and approximate dates, open a protected-admin review, and require the
approved authorization process. Do not search or disclose answers to establish
ownership. Escalate unresolved access to the support lead.

## Client entered the wrong email

Do not confirm whether either address exists. Ask the client to retry their own
correct address through the official flow. Changing a draft association
requires a dedicated protected operation and audit; never edit it through a
browser entity endpoint.

## Multiple drafts under one email

Explain that each draft is separate. Present only the authorized safe choices:
business label, active/submitted status, and saved/submitted time. The client
chooses explicitly. Do not merge drafts manually or imply newest is correct.

## Newest draft is submitted

A submitted draft is read-only. Offer its submitted PDF when authorized. If
the client needs to continue new work, use Start New; do not reopen or overwrite
the submitted record.

## Client wants an older active draft

Use the recovery choice list and confirm status/time, not answers. Load the
selected active draft through the protected recovery flow. Warn that edits are
independent of newer or submitted drafts.

## Clear All created a new draft

Explain that Clear All preserved the old record as superseded and created a
linked active replacement. Confirm the replacement generation and time through
safe admin metadata. Do not delete or reactivate the old draft ad hoc.

## Recovery-code email failed

Capture the safe request ID and delivery error class. Ask the client to check
ordinary spam/quarantine once, without disclosing provider configuration.
Engineering checks SES mode, redirect/recipient class, quota, and provider
status. Never resend to an unconfirmed changed address or expose whether a
draft exists.

## Client closed the browser during upload

Have the client reopen the same browser/tab path and allow synchronization to
settle. Confirm storage mode and authoritative last-save time. Files may require
reselection if the upload was not server-acknowledged. Do not promise an upload
exists until the server confirms it.

## Draft is submit-failed

Confirm the draft remains active/submit-failed and that its last save is
acknowledged. Engineering checks the safe submission failure and destination
status before a protected retry. Prevent duplicate submissions; do not create
a manual intake record as a shortcut.

## PDF unavailable

For submitted drafts, use only the protected regenerate/read-only PDF workflow
when it is available and authorized. Verify its source state hash matches the
submitted hash. If no protected operation exists, escalate; do not reconstruct
the PDF from browser-accessed raw answers.

## Browser blocks storage

Explain that server saves remain authoritative after acknowledgment. Help the
client allow site storage or use a supported non-private session, then recover
through the official flow. Do not ask them to paste browser storage contents.

## Link opened from Outlook, Gmail, or Teams

In-app browsers may isolate storage. Ask the client to open the exact official
link in a supported external browser without forwarding it. Recovery links and
tokens are credentials; never request a screenshot containing the full URL.

## Client believes answers are missing

Stop editing. Record approximate time, browser/tab, last acknowledged save,
safe request ID, draft generation, and status. Engineering compares revisions,
events, and hashes through protected backend tools. Suspected loss of
acknowledged state is SEV-1 when systemic and must preserve evidence.

## Client requests deletion

Open the approved privacy/deletion workflow and apply a retention hold while
identity, legal basis, scope, and backups are reviewed. Support does not delete
records directly. Record the hold reason through a protected admin operation.

## Security or privacy concern

Do not investigate by opening additional client drafts. Preserve safe evidence,
stop disclosure, notify the security owner immediately, and classify suspected
cross-client exposure or RLS bypass as SEV-1. Use the security acknowledgment
template; do not speculate about impact.

## Support completion record

Record case ID, safe request ID, scenario, status, actions, escalation, client
message used, and resolution. Exclude answers, raw emails, codes, passwords,
grants, tokens, cookies, secrets, full links, and raw database exports.
