import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
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

const createMemoryStorage = () => {
  const storage = {};

  Object.defineProperties(storage, {
    length: {
      configurable: true,
      get: () => Object.keys(storage).length,
    },
    clear: {
      configurable: true,
      value: () => {
        Object.keys(storage).forEach((key) => delete storage[key]);
      },
    },
    getItem: {
      configurable: true,
      value: (key) =>
        Object.prototype.hasOwnProperty.call(storage, key)
          ? storage[key]
          : null,
    },
    key: {
      configurable: true,
      value: (index) => Object.keys(storage)[index] ?? null,
    },
    removeItem: {
      configurable: true,
      value: (key) => delete storage[key],
    },
    setItem: {
      configurable: true,
      value: (key, value) => {
        Object.defineProperty(storage, String(key), {
          configurable: true,
          enumerable: true,
          writable: true,
          value: String(value),
        });
      },
    },
  });

  return storage;
};

// Node's experimental Web Storage globals can shadow jsdom with undefined values.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: createMemoryStorage(),
});
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: createMemoryStorage(),
});

// nwsapi (used by jsdom) recursively queries these selectors while evaluating
// the inline :has(input:focus) rule in MultiGeographicQuestion.
const nativeQuerySelector = Element.prototype.querySelector;
Element.prototype.querySelector = function querySelector(selector) {
  if (
    selector === ':scope input:focus' ||
    selector === ':scope input:focus-visible'
  ) {
    return null;
  }

  return nativeQuerySelector.call(this, selector);
};

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

  try {
    vi.clearAllMocks();
  } catch {}

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
