# Save recovery repair — November 17, 2026

The reported Pro warning was reproduced as a completed-draft workflow problem: a real submitted draft had later Q3/Q4 edit events but no new accepted save revision. Submitted drafts remained editable, while the backend correctly held changes to the completed copy. This surfaced as a generic database failure.

A second live fault was independently confirmed: submitProQuestionnaireFallback returned HTTP 503 and the Base44 loader message requiring a default handler or Deno.serve. Its deployed entry/config matched Git; the handler now uses an explicit default export with request validation.

Completed questionnaires now show authoritative answers read-only and offer an explicit Start a revision action. Different browser edits are preserved separately and can be included by choice. A new authenticated, idempotent working copy must have a durable initial snapshot before the browser changes its recovery URL and reloads. Original answers, receipts, and delivery state are retained. Optional lineage fields record the source; historical receipt problems do not prevent copying authorized answers and do not authorize redelivery.

The client also repairs organizer revision conflicts by archiving the local arrangement, loading the current server tree/revision, and retaining unrelated pending edits/deletions. Pending recovery uses an explicit ledger rather than bootstrap timestamp alone. Acknowledged ledgers retire without deleting later pending edits.

Local preview models the new revision flow and completed-write protection. Focused regressions exercise actual hosted handlers, failed/malformed acknowledgments, duplicate and advanced-child retries, schema padding, offline recovery, and immutable source records. Final test/build/live results are recorded outside Git under /Users/isaachines/.codex/backups/questionnaire-save-incident-20261117. Live test records must be synthetic; no Zapier/email delivery or customer record migration is part of this verification.
