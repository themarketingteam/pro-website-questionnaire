import { describe, expect, it } from 'vitest';
import {
  APPLY_FORM_MUTATION_ACTION_TYPE,
  createApplyFormMutationAction,
  createDraftMutationMetadata,
  createMutationId,
  getSafeMutationDiagnostics,
  prepareFormMutationPayload,
} from '@/components/store/formMutationFactory';
import {
  DraftStateSerializationError,
  DraftStateValidationError,
} from '@/lib/questionnaireDraftState';

const mutationMetadata = (overrides = {}) => ({
  mutationId: 'mutation-1',
  mutationType: 'answer_changed',
  reason: 'response_change',
  changedAtClient: '2026-08-05T12:00:00.000Z',
  sourceTabId: 'tab-1',
  baseServerRevision: 4,
  ...overrides,
});

describe('form mutation factory', () => {
  it('uses crypto.randomUUID outside the reducer when available', () => {
    expect(createMutationId({
      crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
    })).toBe('12345678123412341234123456789abc');
  });

  it('uses getRandomValues and deterministic random fallbacks', () => {
    const fromBytes = createMutationId({
      crypto: {
        getRandomValues: (bytes) => {
          bytes.fill(0xab);
          return bytes;
        },
      },
    });
    expect(fromBytes).toBe('ab'.repeat(16));
    expect(createMutationId({ crypto: null, random: () => 0.5 }))
      .toBe('80000000'.repeat(4));
  });

  it('creates deterministic metadata with injected time and randomness', () => {
    const metadata = createDraftMutationMetadata({
      mutationType: 'answer_changed',
      reason: 'response_change',
      sourceTabId: 'tab-1',
      baseServerRevision: 7,
    }, {
      now: () => Date.parse('2026-08-05T12:30:00.000Z'),
      crypto: { randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    });
    expect(metadata).toEqual({
      mutationId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
      mutationType: 'answer_changed',
      reason: 'response_change',
      changedAtClient: '2026-08-05T12:30:00.000Z',
      sourceTabId: 'tab-1',
      baseServerRevision: 7,
    });
  });

  it('normalizes every atomic mutation section without retaining input references', () => {
    const input = {
      setResponses: { '5': [{ label: 'Synthetic City' }], '5_primary': 0 },
      deleteResponseKeys: ['5_old', '5_old'],
      setValidationStatus: { '5': 'complete' },
      deleteValidationKeys: ['5_old'],
      setTouchedQuestions: { '5': true },
      deleteTouchedKeys: ['5_old'],
      setExpandedQuestions: { '5': true },
      deleteExpandedKeys: ['5_old'],
      setTextValidationMeta: { '5': { isDirty: false } },
      deleteTextValidationMetaKeys: ['5_old'],
      setUiDraftState: {
        'question:5': {
          kind: 'location-editor',
          version: 1,
          data: { query: 'Synthetic' },
          updatedAtClient: '2026-08-05T12:00:00.000Z',
          sourceTabId: 'tab-1',
        },
      },
      deleteUiDraftStateKeys: ['question:old'],
      setCredentials: { businessName: 'Synthetic Business' },
      currentQuestionId: 5,
      lastChangedQuestionId: '5',
      mutationMetadata: mutationMetadata(),
    };
    const output = prepareFormMutationPayload(input);
    expect(output.setResponses).toEqual(input.setResponses);
    expect(output.setResponses).not.toBe(input.setResponses);
    expect(output.setResponses['5']).not.toBe(input.setResponses['5']);
    expect(output.deleteResponseKeys).toEqual(['5_old']);
    expect(output.currentQuestionId).toBe('5');
    expect(output.setCredentials).toEqual({ businessName: 'Synthetic Business' });
  });

  it('creates the public Redux action only after validation succeeds', () => {
    const action = createApplyFormMutationAction({
      setResponses: { '6': 'Synthetic response' },
      mutationMetadata: mutationMetadata(),
    });
    expect(action.type).toBe(APPLY_FORM_MUTATION_ACTION_TYPE);
    expect(action.payload.setResponses['6']).toBe('Synthetic response');
  });

  it('rejects an invalid subsection atomically', () => {
    expect(() => prepareFormMutationPayload({
      setResponses: { '6': 'Valid section' },
      setTouchedQuestions: { '6': 'not-a-boolean' },
      mutationMetadata: mutationMetadata(),
    })).toThrowError(DraftStateValidationError);
  });

  it('rejects unsupported values, secret fields, and prototype-pollution keys', () => {
    expect(() => prepareFormMutationPayload({
      setResponses: { '6': new Map() },
      mutationMetadata: mutationMetadata(),
    })).toThrowError(DraftStateSerializationError);
    expect(() => prepareFormMutationPayload({
      recoveryCode: 'must-not-enter-redux',
      mutationMetadata: mutationMetadata(),
    })).toThrowError(DraftStateValidationError);
    const polluted = Object.create(null);
    Object.defineProperty(polluted, '__proto__', { enumerable: true, value: 'blocked' });
    expect(() => prepareFormMutationPayload({
      setResponses: polluted,
      mutationMetadata: mutationMetadata(),
    })).toThrowError(DraftStateValidationError);
  });

  it('requires safe, complete mutation metadata', () => {
    expect(() => prepareFormMutationPayload({ setResponses: { '6': 'Synthetic' } }))
      .toThrowError(DraftStateValidationError);
    expect(() => prepareFormMutationPayload({
      mutationMetadata: mutationMetadata({ reason: 'arbitrary_reason' }),
    })).toThrowError(DraftStateValidationError);
  });

  it('returns diagnostics containing counts rather than response values', () => {
    const diagnosticSource = prepareFormMutationPayload({
      setResponses: { '6': 'PII-LIKE-SYNTHETIC-VALUE' },
      mutationMetadata: mutationMetadata(),
    });
    const diagnostics = getSafeMutationDiagnostics(diagnosticSource);
    expect(diagnostics.responseSetCount).toBe(1);
    expect(JSON.stringify(diagnostics)).not.toContain('PII-LIKE-SYNTHETIC-VALUE');
  });
});
