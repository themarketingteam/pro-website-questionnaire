import { createTestRunId } from '../helpers/testRunId.js';

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const buildClient = ({ clientKey, testRunId }) => deepFreeze({
  businessName: `E2E STAGING Fixture Company ${clientKey.toUpperCase()}`,
  clientIdentity: `e2e-client-${clientKey}-0001`,
  domain: `${clientKey}.fixture.example.test`,
  email: `questionnaire+${clientKey}@example.test`,
  environment: 'staging',
  questions: {
    certification: [{ name: 'Synthetic Security Certification', selected: true }],
    checkbox: ['Synthetic Managed Services', 'Synthetic Security Services'],
    guarantee: [{ description: 'Synthetic service response guarantee', selected: true }],
    location: {
      address: '100 Example Test Way, Testville, TS 00000',
      greaterArea: false,
      latitude: 0,
      longitude: 0,
      primary: true,
    },
    numericRange: { maximum: 25, minimum: 10 },
    radio: 'synthetic_option_a',
    text: 'Synthetic questionnaire answer',
    textarea: 'Synthetic-only questionnaire detail for browser fixture validation.',
  },
  testRunId,
  userId: `e2e-user-${clientKey}-0001`,
  userName: `E2E Fixture User ${clientKey.toUpperCase()}`,
});

export const createQuestionnaireFixture = (providedRunId) => {
  const testRunId = createTestRunId(providedRunId);
  return buildClient({ clientKey: 'client-a', testRunId });
};

export const createSecondIsolatedClient = (primaryFixture) => {
  const testRunId = createTestRunId(primaryFixture?.testRunId);
  return buildClient({ clientKey: 'client-b', testRunId });
};
