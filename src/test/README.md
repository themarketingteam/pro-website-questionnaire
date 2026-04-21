Test Coverage Summary

- proQuestionnaire.regression.test.jsx
  - Q23 answered Yes, then 23.1 expanded: verifies no crash and child renders when parent is yes and expanded
  - Persisted state rehydrate: ensures expanded 23 / 23.1 loads safely
  - Final validation uses canonical payloads and does not change parent status for optional child: asserts validateQuestionText called with question_23_1 and question_25_1, parent 23 not forced incomplete
  - Backend failure sets child status neutral and surfaces via controlled error path

- questionUtils.logic.test.js
  - Directly validates computeParentValidationStatus keeps parents complete regardless of optional child statuses for Q23/Q25

Run tests: npx vitest run