// Generic schema-driven policies for conditional children

// Only children explicitly marked requiredIfParentYes participate in parent completion
export function doesChildParticipateInParentCompletion(childSchema) {
  return !!childSchema?.requiredIfParentYes;
}

// Textareas stay neutral when empty until validated or user interacts
export function shouldChildRemainNeutralWhenEmpty(childSchema) {
  if (!childSchema) return true;
  return childSchema.type === 'textarea';
}

// When parent is not active (not 'yes'), clear hidden child validation states to avoid stale influence
export function shouldClearHiddenChildState(childSchema) {
  return true; // safe default
}