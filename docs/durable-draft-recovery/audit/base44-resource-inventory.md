# Base44 resource inventory

Status: static resource baseline<br>
Branch/revision: `feature/durable-draft-recovery` at `73ece4c`<br>
Audit date: 2026-08-05

## Scope and safe discovery

This inventory covers local Base44 configuration, four entity schemas, eight local function resource directories, three agent definitions, and every source call site that uses those resources. `base44/.app.jsonc` was checked only to confirm that an ignored local app binding exists; its identifier is not recorded here.

The authenticated, read-only commands `npx base44 whoami` and `npx base44 functions list` were used. The latter listed seven remote functions. No entities were queried through the CLI, no record contents were read, no secret values were printed, and no deploy/create/update/delete command was run.

## Configuration

| Resource | Path | Current contract |
| --- | --- | --- |
| Project config | `base44/config.jsonc` | Site name, install `npm install`, build `npm run build`, serve `npm run dev`, output `./dist` |
| Local app binding | `base44/.app.jsonc` | Populated, Git-ignored app ID; value intentionally omitted |
| Client | `src/api/base44Client.js` | `createClient` with resolved app/server/token/function version and `requiresAuth:false` |
| URL/config resolver | `src/lib/app-params.js` | Base44 URL params and Vite defaults persisted into browser local storage |

## Entity summary

| Entity | Schema | Required | RLS in repository | FLS | Retention/migration importance |
| --- | --- | --- | --- | --- | --- |
| `ProFormDraft` | `base44/entities/ProFormDraft.jsonc` | `session_id` | None declared | None declared | Primary migration source for server drafts; no TTL, expiry, archival, or deletion job found |
| `ProFormDraftEvent` | `base44/entities/ProFormDraftEvent.jsonc` | `session_id` | None declared | None declared | Activity/audit stream containing serialized values; no TTL or pruning found |
| `ProFormSubmission` | `base44/entities/ProFormSubmission.jsonc` | `metadata`, `userdata` | Create/write open objects; read/update/delete by creator or admin | None declared | Final record of truth; must preserve IDs and session linkage during migration |
| `ProFormSubmissionIntake` | `base44/entities/ProFormSubmissionIntake.jsonc` | `questionnaire_session_id` | Admin-only read/update/delete/write | None declared | Durable fallback/recovery queue with retry/repair state; no TTL or archival found |

No schema declares a formal relationship/reference type. All relationships are logical strings:

- `ProFormDraft.session_id` ↔ submission `metadata.questionnaire_session_id` ↔ intake `questionnaire_session_id` ↔ event `session_id`;
- `ProFormDraft.final_submission_id` and `ProFormSubmissionIntake.linked_submission_id` point logically to a `ProFormSubmission.id`;
- record `id`, `created_date`, `updated_date`, and `created_by` are treated as Base44-managed fields and are not declared in these schemas.

### ProFormDraft

Required: `session_id`.

Optional fields:

- identity/context: `business_name`, `domain`, `user_id`, `user_name`, `user_email`;
- lifecycle/navigation: `status`, `current_question_id`, `last_changed_question_id`, `last_changed_at`, `last_saved_at`, `submit_attempted_at`, `submitted_at`;
- recoverable payload strings: `responses_json`, `validation_status_json`, `touched_questions_json`, `expanded_questions_json`, `metadata_json`, `userdata_json`, `mapped_payload_json`, `draft_metadata_json`;
- errors/linkage: `save_error`, `submit_error`, `final_submission_id`;
- AI repair: `ai_repair_status`, `last_ai_repair_at`, `ai_repair_error_json`, `ai_repair_report_json`, `ai_repaired_payload_json`, `ai_repair_applied`.

`textValidationMeta`, a version/revision, an idempotency key, an owner/client namespace, expiry, and a unique-session declaration are absent.

Access:

| Layer | Readers | Writers |
| --- | --- | --- |
| Frontend | `draftPersistence.js` filters by session for upsert; `ProFormDraftRecovery.jsx` lists all | `draftPersistence.js` creates/updates; `DraftEditPanel.jsx` updates |
| Backend | retry and repair functions filter by ID | retry updates submit status/link; repair updates AI repair fields |

The client-side upsert sorts duplicate session records and picks the newest. That behavior acknowledges duplicates but does not prevent them.

### ProFormDraftEvent

Required: `session_id`.

Optional fields: `event_type`, `question_id`, `question_type`, `value_json`, `value_summary`, `value_length`, `selected_option_count`, `business_name`, `domain`, `user_id`, and `created_at_iso`.

Access:

| Layer | Readers | Writers |
| --- | --- | --- |
| Frontend | None found | `ProQuestionnaire.createDraftEvent`; submit-stage recorder in `proQuestionnaireSubmit.js` |
| Backend | None found | repair function emits recovery events with service role |

`value_json` stores the serialized changed value, not merely metadata. This may include complete free-text answers or uploaded-file descriptors. There is no event sequence, deduplication key, retention rule, or per-field security policy in source.

### ProFormSubmission

Required top-level objects: `metadata` and `userdata`.

`metadata` defines optional `business_name`, `businessDomain`, `submission_datetime`, and `service_type`. `userdata` defines the full questionnaire projection: additional-page options, services, industries, locations, company description, delivery/pricing/differentiation/goals/tone, certifications, sales process, guarantees, acquisition/objectives, client size/challenges/frustrations/outcomes/value/ideal and avoided clients, CTA, and additional notes.

The schema's RLS allows create/write and restricts read/update/delete to the creator email or a Base44 admin. Whether unauthenticated create is permitted in the active app is a runtime policy question; the source public client does call `create` directly.

Access:

| Layer | Readers | Writers |
| --- | --- | --- |
| Frontend | None in active questionnaire | `proSubmissionResilience.js` direct create; `AdminSubmitIntake.jsx` direct create |
| Backend | retry/repair filter by session or ID | fallback, retry, and repair create using service role |

The retry/repair functions stamp/search `metadata.questionnaire_session_id`, although that nested field is not explicitly declared in the entity schema. It is therefore an important compatibility field to verify during later migration.

### ProFormSubmissionIntake

Required: `questionnaire_session_id`.

Optional fields cover:

- client identity: `business_name`, `business_domain`, `user_email`, `user_id`;
- lifecycle: `status`, `intake_reason`, `source`, client/server creation times, retry time/count, notes;
- failure/payload evidence: primary/fallback/retry errors, transformed payload, raw responses, diagnostics;
- outcome: linked submission ID and Zapier state;
- AI repair lifecycle, reports, repaired payload, applied/retry/source fields.

The `status` enum is `submitted`, `received_intake`, `retry_pending`, `retry_success`, `retry_failed`, or `abandoned`. The schema declares admin-only read/update/delete/write. The server fallback nevertheless creates/updates this entity through service-role access, which bypasses client RLS as intended.

Access:

| Layer | Readers | Writers |
| --- | --- | --- |
| Frontend | `QuestionnaireIntakeRecovery.jsx` lists directly | None |
| Backend | fallback/retry/repair filter by ID or questionnaire session | fallback upserts; retry/repair update lifecycle and repair fields |

## Direct frontend entity calls

| Call site | Entity.operation | UI class | Authorization visible in source |
| --- | --- | --- | --- |
| `src/lib/draftPersistence.js` | `ProFormDraft.filter` | Public/shared | Entity policy only; no backend function boundary |
| `src/lib/draftPersistence.js` | `ProFormDraft.update` | Public/shared | Entity policy only |
| `src/lib/draftPersistence.js` | `ProFormDraft.create` | Public/shared | Entity policy only |
| `src/pages/ProQuestionnaire.jsx` | `ProFormDraftEvent.create` | Public | Entity policy only |
| `src/lib/proQuestionnaireSubmit.js` | `ProFormDraftEvent.create` | Public/shared | Entity policy only |
| `src/pages/ProFormDraftRecovery.jsx` | `ProFormDraft.list` | Password-gated admin UI | UI password grant is not passed to this entity call |
| `src/components/admin/DraftEditPanel.jsx` | `ProFormDraft.update` | Password-gated admin UI | UI password grant is not passed to this entity call |
| `src/components/admin/QuestionnaireIntakeRecovery.jsx` | `ProFormSubmissionIntake.list` | Admin or password-gated UI | Entity RLS; password grant is not passed to list call |
| `src/lib/proSubmissionResilience.js` | `ProFormSubmission.create` | Public/shared | Entity RLS/create policy |
| `src/pages/AdminSubmitIntake.jsx` | `ProFormSubmission.create` | Base44-admin UI | `AdminOnly` plus page auth state |

The first seven rows are the direct draft-entity count reported by this audit. The final three are included to make the complete direct entity surface explicit.

## Function deployment snapshot

Local function directories: 8. Read-only remote listing: 7.

| Function | Local entry | Remote list 2026-08-05 | Draft/recovery role |
| --- | --- | --- | --- |
| `generateAIContent` | `base44/functions/generateAIContent/entry.ts` | Listed | None; AI content generation |
| `generateAIContentOpenAI` | `base44/functions/generateAIContentOpenAI/entry.ts` | Listed | None; alternate AI content generation |
| `sendToZapier` | `base44/functions/sendToZapier/entry.ts` | Listed | Post-submit/retry external delivery |
| `validateQuestionText` | `base44/functions/validateQuestionText/entry.ts` | Listed | Answer and final validation |
| `retryProQuestionnaireIntakeSubmission` | `base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts` | Listed | Draft/intake retry |
| `repairProQuestionnaireIntakeSubmission` | `base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts` | Listed | Draft/intake diagnosis, repair, retry |
| `verifyDraftRecoveryAccess` | `base44/functions/verifyDraftRecoveryAccess/entry.ts` | Listed | Password/grant authorization |
| `submitProQuestionnaireFallback` | top-level placeholder; implementation at `entry/entry.ts` | **Not listed** | Durable submission/intake fallback |

The `sendToZapier` and retry resources each have identical top-level and nested `entry/entry.ts` copies. The submit fallback differs: its top-level file is only a three-line compatibility comment that points to its own path, while the implementation is nested. Static source cannot establish whether a different remote version exists; the CLI name was absent, so the active client fallback call is not certified as available.

### Function details

| Function | Auth/service role | Request → response | Entities/secrets/external services | Error behavior and relevance |
| --- | --- | --- | --- | --- |
| `generateAIContent` | No handler-level caller check; uses service-role key for Base44 agent API | `{userInstruction, questionContext, draftContent}` → `{content,isQuestions}` | Secrets `BASE44_APP_ID`, `BASE44_SERVICE_ROLE_KEY`; `msp_content_strategist` agent via Base44 HTTP API | 400 missing instruction; polls up to 55 s, otherwise 500. No active frontend invocation found. |
| `generateAIContentOpenAI` | No handler-level caller check; no Base44 entity role | instruction/context/draft/business/form data → `{content,done}` | `OPENAI_KEY`; OpenAI Assistants API and source-configured assistant ID | 400 missing instruction; polling/run errors return 500. Referenced only by currently unmounted `AIContentModal`. |
| `sendToZapier` | No handler-level caller check; wildcard CORS | Arbitrary final payload → success/Zapier status/body metadata | `ZAPIER_WEBHOOK_URL` name with allowed fallback; Zapier HTTP | 8 s abort; 502 rejection, 504 timeout, 500 other. Used after final create and from admin/recovery paths. No entity access. |
| `validateQuestionText` | No handler-level caller check | `{text,questionContext}` aliases accepted → validation status/message/count/range | `OPENAI_KEY`; OpenAI chat `gpt-4o-mini` | 400 missing/unknown question; deterministic trailing-sentence response; other errors 500. No entity access. |
| `verifyDraftRecoveryAccess` | Password itself is the authorization factor | `{password}` issues grant; `{token}` verifies grant → authorized/expiry/token | `DRAFT_RECOVERY_PASSWORD`; no entity/external API | POST only; 401 invalid/expired, 405 method, 503 missing secret. HMAC-SHA256 grant TTL is seven days. |
| `retryProQuestionnaireIntakeSubmission` | Accepts Base44 role `admin` or valid recovery grant; uses service role after authorization | draft/intake/session ID, `forceRetry`, optional grant → success/link IDs/Zapier state or error | `ProFormDraft`, `ProFormSubmissionIntake`, `ProFormSubmission`; `DRAFT_RECOVERY_PASSWORD`, `ZAPIER_WEBHOOK_URL`; Zapier | 403 unauthorized, 400 invalid/missing payload, 404 missing record, 500 create/update errors. Duplicate checks are by session/link but are not atomic. |
| `repairProQuestionnaireIntakeSubmission` | Accepts Base44 role `admin` or valid recovery grant; uses service role | draft/intake/session ID, mode, retry flags, optional grant → report/repaired/link/Zapier state | All four entities; `DRAFT_RECOVERY_PASSWORD`, `ZAPIER_WEBHOOK_URL`; Base44 repair agent and Zapier | 403 unauthorized, 400 missing selector, 404 record, 422 unsafe repair, 500 create/handler errors. Draft mode stores repair data and does not create final submission, though `repair_and_retry` sends to Zapier. Intake mode can create final submission. |
| `submitProQuestionnaireFallback` | No explicit handler auth check; creates request client then uses service role | transformed payload, raw snapshot, failure flags/errors, session, context/diagnostics → final submission or received-intake result | `ProFormSubmission`, `ProFormSubmissionIntake`; no named custom secret/external call | 400 missing session; catches final-create failure and attempts intake; 500 only if durable intake also fails. Local implementation is not remotely listed. |

Handler-level authentication is reported literally from source. Base44 may impose additional invocation policy outside this repository, so “no handler-level check” does not prove anonymous remote reachability.

### Backend entity operation map

| Function | Reads | Writes |
| --- | --- | --- |
| `submitProQuestionnaireFallback` | Intake filter by questionnaire session | Submission create; intake create/update |
| `retryProQuestionnaireIntakeSubmission` | Draft filter; intake filter; submission filter | Submission create; draft update; intake update |
| `repairProQuestionnaireIntakeSubmission` | Draft/intake/submission filters | Draft event create; draft update; intake update; submission create |

No function generates PDFs or sends email. `sendToZapier` and repair/retry perform external webhook delivery. The active frontend invokes six unique function names: the public questionnaire/submit path uses `validateQuestionText`, `sendToZapier`, and `submitProQuestionnaireFallback`; admin surfaces use `verifyDraftRecoveryAccess`, `retryProQuestionnaireIntakeSubmission`, and `repairProQuestionnaireIntakeSubmission`. The dormant AI modal directly fetches `generateAIContentOpenAI`.

## Agent resources

| Agent | Path | Use |
| --- | --- | --- |
| `form_qa_validator` | `base44/agents/form_qa_validator.jsonc` | QA definition present; current `validateQuestionText` uses OpenAI directly instead |
| `msp_content_strategist` | `base44/agents/msp_content_strategist.jsonc` | `generateAIContent` and dormant modal grammar flow |
| `pro_submission_repair_agent` | `base44/agents/pro_submission_repair_agent.jsonc` | Conservative payload diagnosis/repair in the repair function |

## Authorization and data-lifecycle gaps to preserve in the baseline

1. Draft and event schemas have no source-declared RLS/FLS, while public and password-gated browser code accesses them directly.
2. The password gate protects UI rendering but its grant is not attached to direct entity `list`/`update`; only retry/repair function calls validate it.
3. Draft session identity is a caller-controlled browser string and is not declared unique.
4. Submission/intake duplicate checks are filter-then-create and cannot provide atomic exactly-once semantics.
5. Serialized responses, error diagnostics, AI reports, and event values have no source-defined retention/expiry behavior.
6. The fallback function needed for durable intake is not present in the remote name listing and has an ambiguous local entry layout.
7. Service-role functions authorize before sensitive reads in retry/repair. The fallback intentionally has no equivalent admin gate because it serves the public submission path; its abuse/rate boundary is not defined in this repository.

These are inventory findings only. No schema, function, policy, or data was changed.
