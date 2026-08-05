import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import {
  installNormalTestStorage,
  installStorageDescriptor,
} from '@/test/utils/storage';

// Install storage before test modules are collected so libraries that capture
// Web Storage at import time never see Node's experimental globals.
const testStorage = installNormalTestStorage();

const restoreCleanTestStorage = () => {
  testStorage.local.storage.clear();
  testStorage.session.storage.clear();
  installStorageDescriptor('localStorage', { value: testStorage.local.storage });
  installStorageDescriptor('sessionStorage', { value: testStorage.session.storage });
};

vi.mock('@/api/base44Client', () => {
  const createMockEntity = () => ({
    create: vi.fn(async (payload) => ({ id: 'test-record-id', ...payload })),
    update: vi.fn(async (id, payload) => ({ id, ...payload })),
    filter: vi.fn(async () => []),
    list: vi.fn(async () => []),
  });

  return {
    base44: {
      entities: {
        ProFormSubmission: createMockEntity(),
        ProFormDraft: createMockEntity(),
        ProFormDraftEvent: createMockEntity(),
        ProFormSubmissionIntake: createMockEntity(),
      },
      functions: {
        invoke: vi.fn(),
      },
      integrations: {
        Core: {
          UploadFile: vi.fn(),
        },
      },
      auth: {
        me: vi.fn(),
      },
    },
  };
});

import { base44 } from '@/api/base44Client';

const defaultFunctionInvoke = async (name, payload) => {
  if (name === 'sendToZapier') {
    return { data: { success: true } };
  }

  if (name === 'submitProQuestionnaireFallback') {
    const shouldReturnIntake = Boolean(
      payload?.transformFailed
      || payload?.validationFailed
      || !payload?.transformedPayload,
    );

    if (shouldReturnIntake) {
      return {
        data: {
          success: true,
          received: true,
          submissionCreated: false,
          intakeId: 'fallback-intake-id',
          zapierSent: false,
        },
      };
    }

    return {
      data: {
        success: true,
        received: true,
        submissionCreated: true,
        submission: {
          id: 'fallback-submission-id',
          ...payload?.transformedPayload,
        },
        zapierSent: false,
      },
    };
  }

  if (name === 'retryProQuestionnaireIntakeSubmission') {
    return { data: { success: true, linkedSubmissionId: 'retried-submission-id' } };
  }

  if (name === 'repairProQuestionnaireIntakeSubmission') {
    return { data: { success: true, linkedSubmissionId: 'repaired-submission-id' } };
  }

  if (name === 'validateQuestionText') {
    return { data: { status: 'complete' } };
  }

  if (name === 'verifyDraftRecoveryAccess') {
    return { data: { authorized: false } };
  }

  throw new Error(`Unexpected Base44 function invocation in test: ${name}`);
};

const resetMock = (mock, implementation) => {
  mock.mockReset();
  mock.mockImplementation(implementation);
};

const resetEntity = (entity) => {
  resetMock(entity.create, async (payload) => ({ id: 'test-record-id', ...payload }));
  resetMock(entity.update, async (id, payload) => ({ id, ...payload }));
  resetMock(entity.filter, async () => []);
  resetMock(entity.list, async () => []);
};

const createMatchMedia = () => vi.fn().mockImplementation((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// nwsapi recursively queries these selectors while evaluating an inline
// :has(input:focus) rule in MultiGeographicQuestion.
const nativeQuerySelector = Element.prototype.querySelector;
Element.prototype.querySelector = function querySelector(selector) {
  if (
    selector === ':scope input:focus'
    || selector === ':scope input:focus-visible'
  ) {
    return null;
  }

  return nativeQuerySelector.call(this, selector);
};

let fetchGuard;
let xhrOpenGuard;

beforeEach(() => {
  restoreCleanTestStorage();

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: createMatchMedia(),
  });

  for (const entity of Object.values(base44.entities)) resetEntity(entity);
  resetMock(base44.functions.invoke, defaultFunctionInvoke);
  resetMock(base44.integrations.Core.UploadFile, async ({ file }) => ({
    file_url: `https://example.test/${file?.name || 'upload'}`,
  }));
  resetMock(base44.auth.me, async () => ({
    id: 'test-user-id',
    email: 'test-user@example.test',
    role: 'admin',
  }));

  fetchGuard = vi.fn(() => {
    throw new Error('Test attempted an unmocked fetch');
  });
  vi.stubGlobal('fetch', fetchGuard);

  xhrOpenGuard = vi
    .spyOn(XMLHttpRequest.prototype, 'open')
    .mockImplementation(() => {
      throw new Error('Test attempted an unmocked XMLHttpRequest');
    });
});

afterEach(() => {
  cleanup();

  expect(fetchGuard).not.toHaveBeenCalled();
  expect(xhrOpenGuard).not.toHaveBeenCalled();

  xhrOpenGuard.mockRestore();
  vi.unstubAllGlobals();

  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }

  restoreCleanTestStorage();
});
