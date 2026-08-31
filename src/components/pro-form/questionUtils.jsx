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

// Build a complete, boolean-only expansion map so QuestionWrapper and
// conditional-child rendering never interpret a missing key differently.
// Older drafts can contain child expansion keys without the parent key. When
// that legacy shape belongs to an answered "yes" branch, reveal the branch so
// the client is not left with a selected answer and inaccessible follow-ups.
export function normalizeExpandedQuestionState(QUESTIONS, responses = {}, expandedQuestions = {}) {
  if (!Array.isArray(QUESTIONS)) return {};

  const source = expandedQuestions && typeof expandedQuestions === 'object'
    ? expandedQuestions
    : {};
  const answers = responses && typeof responses === 'object' ? responses : {};
  const next = {};

  QUESTIONS.forEach((question) => {
    const children = Array.isArray(question.conditionalChildren)
      ? question.conditionalChildren
      : [];
    const hasParentState = Object.prototype.hasOwnProperty.call(source, question.id);
    const repairLegacyYesBranch = (
      !hasParentState
      && children.length > 0
      && answers[question.id] === 'yes'
    );

    next[question.id] = hasParentState
      ? source[question.id] === true
      : repairLegacyYesBranch;

    children.forEach((child) => {
      const hasChildState = Object.prototype.hasOwnProperty.call(source, child.id);
      if (repairLegacyYesBranch) {
        next[child.id] = true;
      } else if (hasChildState) {
        next[child.id] = source[child.id] === true;
      } else {
        next[child.id] = answers[question.id] === 'yes' && next[question.id] === true;
      }
    });
  });

  return next;
}

export function isChildQuestion(questionId) {
  return String(questionId || '').includes('.');
}

// Compute parent validation deterministically from schema + child snapshot
// Returns one of: 'complete' | 'needs_work' | 'incomplete'
export function computeParentValidationStatus(parentQuestion, parentAnswer, childStatuses = {}) {
  if (!parentQuestion || parentQuestion.type !== 'yes_no') return '';

  // If parent says 'no' → parent is complete regardless of children and child states should be cleared upstream
  if (parentAnswer === 'no') return 'complete';

  // If not explicitly 'yes' yet, treat as incomplete
  if (parentAnswer !== 'yes') return 'incomplete';

  const requiredChildren = (parentQuestion.conditionalChildren || []).filter(c => c.requiredIfParentYes);
  if (requiredChildren.length === 0) return 'complete';

  let anyNeedsWork = false;
  for (const child of requiredChildren) {
    const st = childStatuses[child.id] || '';
    if (st === '' || st === 'incomplete') return 'incomplete';
    if (st === 'needs_work') anyNeedsWork = true;
  }
  return anyNeedsWork ? 'needs_work' : 'complete';
}
