import { QUESTIONS } from '@/components/pro-form/questionData';
import { getQuestionById } from '@/components/pro-form/questionUtils';

const IMMEDIATE_TYPES = new Set([
  'question_reset',
  'conditional_cleanup',
  'location_add',
  'location_update',
  'location_remove',
  'location_primary_set',
]);

export const mapDraftMutationToEvent = (mutation) => {
  if (!mutation || !mutation.mutationId) return null;
  const question = mutation.questionId
    ? getQuestionById(QUESTIONS, mutation.questionId)
    : null;
  const textLike = ['text', 'textarea'].includes(question?.type)
    || mutation.mutationType.startsWith('ui_draft_');
  let eventType = 'draft_mutation';
  if (mutation.reason === 'question_reset') eventType = 'question_reset';
  else if (mutation.reason === 'conditional_cleanup') eventType = 'conditional_cleanup';
  else if (mutation.mutationType.startsWith('location_')) eventType = mutation.mutationType;
  else if (mutation.reason === 'validation_change') eventType = 'validation_status_changed';
  else if (mutation.reason === 'ui_draft_change') eventType = 'ui_draft_changed';
  else if (textLike) eventType = 'text_changed';
  else if (mutation.reason === 'response_change') eventType = 'answer_changed';
  return Object.freeze({
    event: Object.freeze({
      eventType,
      mutationId: mutation.mutationId,
      ...(mutation.questionId ? { questionId: mutation.questionId } : {}),
      ...(question?.type ? { questionType: question.type } : {}),
      metadata: Object.freeze({
        reason: mutation.reason,
        changedFieldCount: mutation.changes?.length || 0,
      }),
    }),
    debounceMs: textLike && !IMMEDIATE_TYPES.has(eventType) ? 1_000 : 0,
    debounceKey: `${eventType}:${mutation.questionId || 'draft'}`,
  });
};

export const getSafeDraftEventMappingDiagnostics = (mapping) => Object.freeze({
  eventType: mapping?.event?.eventType || null,
  questionId: mapping?.event?.questionId || null,
  debounceMs: Number.isSafeInteger(mapping?.debounceMs) ? mapping.debounceMs : null,
  includesRawValue: Object.hasOwn(mapping?.event || {}, 'value'),
  includesCredential: false,
  includesToken: false,
});
