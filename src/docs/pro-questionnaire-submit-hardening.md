# Pro Questionnaire Submit Hardening

## Final submit paths verified

### 1) Normal submit path
- Client completes questionnaire and confirms submit.
- Payload is normalized, repaired, validated, and submitted through `createProFormSubmissionWithFallback`.
- If `ProFormSubmission.create` succeeds, the questionnaire is marked submitted and Zapier is attempted after save.

### 2) Primary create retry behavior
- Primary create uses retry logic for retryable failures like timeout, network, rate-limit, and server errors.
- If retries still fail, the flow automatically moves to server fallback.

### 3) Server fallback path
- Fallback calls `submitProQuestionnaireFallback`.
- If fallback can create `ProFormSubmission`, the user still completes successfully.
- If fallback cannot create a final submission but can safely receive intake, it stores `ProFormSubmissionIntake`.

### 4) Intake-only received path
- Intake-only success means the platform received the questionnaire but final record creation was deferred.
- This is still treated as a protected recovery state rather than silent loss.
- Admin/support can later retry with `retryProQuestionnaireIntakeSubmission`.

### 5) Transform and validation recovery
- Transform failure and validation failure both create a recovery path.
- The user receives a friendly recovery message with a recovery code.
- Progress backups and submit-stage records are written when possible.

### 6) Clarity behavior
- Clarity is non-fatal.
- Clarity tagging/event failures do not block submit, fallback, PDF generation, or recovery behavior.

### 7) Browser storage behavior
- `localStorage` and `sessionStorage` writes are wrapped with safe helpers.
- Storage failures do not block submit.

### 8) Payload normalization and repair
- `normalizeQuestionnaireResponses` hardens raw answers.
- `repairProSubmissionPayload` repairs optional feature sections before final persistence.
- Undefined values are stripped.
- Unsafe upload-like objects are removed.
- Required business metadata is not faked.

### 9) Recovery code behavior
- On controlled submit failure, the user sees a recovery code based on the questionnaire session.
- Support should use this together with business name/domain and intake/admin records.

### 10) PDF behavior
- Users can still download the PDF from the confirmation modal.
- PDF generation is independent from final submission creation.

### 11) Duplicate click protection
- Confirm modal blocks duplicate click submission while a submit is already in progress.

## Development debug URL params
These only work in development builds. Production ignores them.

- `?debugSubmitFailure=primary_create`
  - Expected result: primary create fails, fallback should succeed if available.
- `?debugSubmitFailure=network_timeout`
  - Expected result: timeout-style primary failure, fallback path should run.
- `?debugSubmitFailure=fallback_create`
  - Expected result: fallback is forced to fail, user should get recovery message/intake failure handling.
- `?debugSubmitFailure=transform`
  - Expected result: transform stage fails immediately, recovery path runs.
- `?debugSubmitFailure=validation`
  - Expected result: repaired payload validation is forced to fail, recovery path runs.

## Operational checklist for Isaac’s team
When a client says they could not submit:

1. Ask for the business name and domain.
2. Ask for the recovery code if one was shown.
3. Search `ProFormSubmission` using business name/domain/session.
4. Search `ProFormSubmissionIntake` using business name/domain/session.
5. If intake exists with `received_intake`, run `retryProQuestionnaireIntakeSubmission`.
6. If no intake exists, inspect Clarity/session activity around:
   - `pro_questionnaire_submit_primary_failed`
   - `pro_questionnaire_submit_fallback_success`
   - `pro_questionnaire_submit_fallback_failed`
   - submit stage events
7. Check whether Zapier received the notification.

## Support instructions for intake retry
- Open the admin recovery workflow.
- Find the intake record by business/domain/session.
- Retry only records that were received but not linked to a final submission.
- Confirm whether retry changed the record to success and created a linked submission.

## Current safety guarantees
- Normal `ProFormSubmission.create` success path is preserved.
- Primary failure can fall back to server submission.
- Intake capture can preserve data when final record creation cannot complete.
- Optional malformed feature sections should not block submission.
- Clarity failures are non-fatal.
- Browser storage failures are non-fatal.
- Production ignores all submit debug params.
- Final submit path uses `createProFormSubmissionWithFallback`, `repairProSubmissionPayload`, `normalizeQuestionnaireResponses`, safe Clarity helpers, safe browser helpers, submit-stage logging, and intake fallback behavior.

## Build and test status
- `npm run build`: not executed by tool in this pass.
- `npm test`: not executed by tool in this pass.
- `retryProQuestionnaireIntakeSubmission`: not present in the currently deployed backend function list, so retry verification is currently limited until that function is restored/deployed.

## Known limitations
- Debug simulation is for development only and should be tested locally.
- Build/test status should be re-run after each hardening batch merge.