Validation checklist:
1. retry function finds intake by intakeId.
2. retry function finds intake by questionnaireSessionId.
3. already linked intake does not duplicate submission.
4. valid intake creates ProFormSubmission.
5. retry_success updates intake.
6. retry_failed updates intake with safe error.
7. malformed payload returns controlled error.
8. npm run build should be run in the app environment.