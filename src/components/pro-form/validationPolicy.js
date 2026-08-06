// Temporary production policy: AI feedback is optional and must never block submit.
// Set this back to true when the validation service is ready to be required again.
export const REQUIRE_AI_TEXT_VALIDATION_FOR_SUBMISSION = false;

export const hasNonEmptyTextValue = (value) => String(value ?? '').trim().length > 0;
