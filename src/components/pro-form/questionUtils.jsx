// Lightweight helpers for schema-driven question lookup
// Keep generic and production-safe

export function getQuestionById(QUESTIONS, questionId) {
  if (!Array.isArray(QUESTIONS)) return null;
  const top = QUESTIONS.find(q => q.id === questionId);
  if (top) return top;
  for (const q of QUESTIONS) {
    if (Array.isArray(q.conditionalChildren)) {
      const child = q.conditionalChildren.find(c => c.id === questionId);
      if (child) return child;
    }
  }
  return null;
}

export function getParentQuestionByChildId(QUESTIONS, childId) {
  if (!Array.isArray(QUESTIONS)) return null;
  // Fast path using dotted id convention
  const parentId = (childId || '').includes('.') ? String(childId).split('.')[0] : null;
  if (parentId) {
    const parent = QUESTIONS.find(q => q.id === parentId);
    if (parent) return parent;
  }
  // Fallback: search by membership
  for (const q of QUESTIONS) {
    if (Array.isArray(q.conditionalChildren) && q.conditionalChildren.some(c => c.id === childId)) {
      return q;
    }
  }
  return null;
}

export function getAllQuestionIds(QUESTIONS) {
  if (!Array.isArray(QUESTIONS)) return [];
  const ids = [];
  for (const q of QUESTIONS) {
    ids.push(q.id);
    if (Array.isArray(q.conditionalChildren)) {
      q.conditionalChildren.forEach(c => ids.push(c.id));
    }
  }
  return ids;
}

export function isChildQuestion(questionId) {
  return String(questionId || '').includes('.');
}