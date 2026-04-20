import { QUESTIONS } from '@/components/pro-form/questionData';
import { getAllQuestionIds, getQuestionById, getParentQuestionByChildId, isChildQuestion } from '@/components/pro-form/questionUtils';

function uniqArray(arr) {
  return Array.from(new Set(arr || []));
}

export function normalizePersistedState(state) {
  if (!state || typeof state !== 'object') return state;

  const knownIds = new Set(getAllQuestionIds(QUESTIONS));
  const allowedResponseKeys = new Set();
  knownIds.forEach((id) => {
    allowedResponseKeys.add(id);
    allowedResponseKeys.add(`${id}_other`);
    allowedResponseKeys.add(`${id}_primary`);
  });

  const next = { ...state };
  next.responses = { ...(state.responses || {}) };
  next.validationStatus = { ...(state.validationStatus || {}) };
  next.touchedQuestions = { ...(state.touchedQuestions || {}) };
  next.expandedQuestions = { ...(state.expandedQuestions || {}) };

  // 1) Remove unknown keys across slices
  Object.keys(next.responses).forEach((k) => {
    if (!allowedResponseKeys.has(k)) delete next.responses[k];
  });
  Object.keys(next.validationStatus).forEach((k) => {
    if (!knownIds.has(k)) delete next.validationStatus[k];
  });
  Object.keys(next.touchedQuestions).forEach((k) => {
    if (!knownIds.has(k)) delete next.touchedQuestions[k];
  });
  Object.keys(next.expandedQuestions).forEach((k) => {
    if (!knownIds.has(k)) delete next.expandedQuestions[k];
  });

  // Helpers for type checks
  const getType = (id) => getQuestionById(QUESTIONS, id)?.type;
  const getOptions = (id) => getQuestionById(QUESTIONS, id)?.options || [];
  const getShowOther = (id) => !!getQuestionById(QUESTIONS, id)?.showOther;

  // 2) Normalize values per type
  knownIds.forEach((id) => {
    const type = getType(id);
    if (!type) return;

    let val = next.responses[id];

    switch (type) {
      case 'yes_no': {
        if (val !== 'yes' && val !== 'no') {
          delete next.responses[id];
        }
        break;
      }

      case 'radio': {
        const opts = getOptions(id);
        const showOther = getShowOther(id);
        if (typeof val === 'string' && opts.includes(val)) {
          // ok
        } else if (showOther && typeof val === 'string' && val.trim() && !opts.includes(val)) {
          // Move legacy custom value to _other and set main to Other
          if (!next.responses[`${id}_other`] || !String(next.responses[`${id}_other`]).trim()) {
            next.responses[`${id}_other`] = String(val);
          }
          next.responses[id] = 'Other';
        } else if (val === 'Other') {
          // Ensure _other key exists (even if empty) so UI treats as incomplete
          if (next.responses[`${id}_other`] == null) next.responses[`${id}_other`] = '';
        } else if (val == null || val === '') {
          // leave empty
        } else {
          // invalid -> clear
          delete next.responses[id];
        }
        break;
      }

      case 'checkbox': {
        const opts = new Set(getOptions(id));
        const arr = Array.isArray(val) ? val.slice() : [];
        const keep = [];
        arr.forEach((v) => {
          if (typeof v !== 'string') return;
          if (id === '3' && v.startsWith('CATEGORY:')) { keep.push(v); return; }
          if (opts.has(v)) keep.push(v);
        });
        next.responses[id] = uniqArray(keep);
        // _other may be string or array; normalize to array of non-empty strings when max is set in UI else keep string
        // Here, just coerce array types safely if exists
        const otherKey = `${id}_other`;
        if (otherKey in next.responses) {
          const o = next.responses[otherKey];
          if (Array.isArray(o)) {
            next.responses[otherKey] = o.map(s => String(s || '').trim()).filter(Boolean);
          } else if (typeof o === 'string') {
            next.responses[otherKey] = String(o);
          } else {
            delete next.responses[otherKey];
          }
        }
        break;
      }

      case 'multi_certification':
      case 'multi_guarantee':
      case 'multi_text': {
        if (!Array.isArray(val)) next.responses[id] = [];
        break;
      }

      case 'image_tagging': {
        // Must be an object with url/tags; if malformed leave as-is (UI can handle) or clear when nonsense
        if (val && typeof val === 'object') {
          // ok
        } else if (val != null) {
          delete next.responses[id];
        }
        break;
      }

      default:
        // textarea, numeric_range, file_upload: leave as-is
        break;
    }
  });

  // 6) Conditional children clean-up if parent !== 'yes'
  QUESTIONS.forEach((q) => {
    if (Array.isArray(q.conditionalChildren)) {
      q.conditionalChildren.forEach((child) => {
        const parentVal = next.responses[q.id];
        if (parentVal !== 'yes') {
          // Clear validation, collapse UI
          if (child.id in next.validationStatus) next.validationStatus[child.id] = '';
          next.expandedQuestions[child.id] = false;
        }
      });
    }
  });

  // 7) Legacy certification migration (prefer canonical)
  const legacyCertList = next.responses['1.2.1'];
  const canonicalCertList = next.responses['12.1'];
  if ((Array.isArray(legacyCertList) && legacyCertList.length > 0) && (!Array.isArray(canonicalCertList) || canonicalCertList.length === 0)) {
    next.responses['12.1'] = legacyCertList;
  }
  const legacyCertYesNo = next.responses['1.2'];
  if ((legacyCertYesNo === 'yes' || legacyCertYesNo === 'no') && (next.responses['12'] !== 'yes' && next.responses['12'] !== 'no')) {
    next.responses['12'] = legacyCertYesNo;
  }
  // Remove legacy mirror fields and any related statuses/expansion/touched
  ['1.2', '1.2.1'].forEach((legacyId) => {
    delete next.responses[legacyId];
    delete next.validationStatus[legacyId];
    delete next.touchedQuestions[legacyId];
    delete next.expandedQuestions[legacyId];
  });

  // Finally, ensure child keys present in slices are only for known child ids
  Object.keys(next.validationStatus).forEach((k) => {
    if (!knownIds.has(k)) delete next.validationStatus[k];
  });

  return next;
}