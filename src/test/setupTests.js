import '@testing-library/jest-dom';
import { act, cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

vi.mock('@/api/base44Client', () => {
  const createMockEntity = () => ({
    create: vi.fn(async (payload) => ({ id: 'test-record-id', ...payload })),
    update: vi.fn(async (_id, payload) => ({ id: _id, ...payload })),
    filter: vi.fn(async () => []),
    list: vi.fn(async () => [])
  });

  return {
    base44: {
      entities: {
        ProFormSubmission: createMockEntity(),
        ProFormDraft: createMockEntity(),
        ProFormDraftEvent: createMockEntity(),
        ProFormSubmissionIntake: createMockEntity()
      },
      functions: {
        invoke: vi.fn(async (name, payload) => {
          if (name === 'sendToZapier') {
            return { data: { success: true } };
          }

          if (name === 'submitProQuestionnaireFallback') {
            const shouldReturnIntake = Boolean(payload?.transformFailed || payload?.validationFailed || !payload?.transformedPayload);

            if (shouldReturnIntake) {
              return {
                data: {
                  success: true,
                  received: true,
                  submissionCreated: false,
                  intakeId: 'fallback-intake-id',
                  zapierSent: false
                }
              };
            }

            return {
              data: {
                success: true,
                received: true,
                submissionCreated: true,
                submission: { id: 'fallback-submission-id', ...payload?.transformedPayload },
                zapierSent: false
              }
            };
          }

          if (name === 'retryProQuestionnaireIntakeSubmission') {
            return {
              data: {
                success: true,
                linkedSubmissionId: 'retried-submission-id'
              }
            };
          }

          if (name === 'validateQuestionText') {
            return {
              data: {
                status: 'complete'
              }
            };
          }

          return { data: { success: true } };
        })
      },
      integrations: {
        Core: {
          UploadFile: vi.fn(async ({ file }) => ({
            file_url: `https://example.test/${file?.name || 'upload'}`
          }))
        }
      },
      auth: {
        me: vi.fn(async () => ({
          id: 'test-user-id',
          email: 'benjamin.hines8@gmail.com',
          role: 'admin'
        }))
      }
    }
  };
});

const global = globalThis;

// Basic matchMedia mock for components that might use it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();

  try {
    vi.runOnlyPendingTimers();
  } catch {}

  try {
    vi.clearAllTimers();
  } catch {}

  try {
    vi.useRealTimers();
  } catch {}

  try {
    localStorage.clear();
  } catch {}

  try {
    sessionStorage.clear();
  } catch {}
});