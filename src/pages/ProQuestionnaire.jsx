import React, { useState, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { 
  setResponse, 
  setValidationStatus, 
  setTouchedQuestion, 
  setExpandedQuestion, 
  setAllExpanded,
  setCredentials,
  resetForm,
  deleteResponse,
  initializeExpandedQuestions
} from '@/components/store/formSlice';
import { base44 } from '@/api/base44Client';

import { toast } from "sonner";
import { Loader2, AlertCircle } from 'lucide-react';


import FormHeader from '@/components/pro-form/FormHeader';
import QuestionWrapper from '@/components/pro-form/QuestionWrapper';
import YesNoQuestion from '@/components/pro-form/YesNoQuestion';
import CheckboxQuestion from '@/components/pro-form/CheckboxQuestion';
import RadioQuestion from '@/components/pro-form/RadioQuestion';
import TextareaQuestion from '@/components/pro-form/TextareaQuestion';
import MultiTextQuestion from '@/components/pro-form/MultiTextQuestion';
import MultiGeographicQuestion from '@/components/pro-form/MultiGeographicQuestion';
import FileUploadQuestion from '@/components/pro-form/FileUploadQuestion';
import NumericRangeQuestion from '@/components/pro-form/NumericRangeQuestion';
import MultiCertificationQuestion from '@/components/pro-form/MultiCertificationQuestion';
import MultiGuaranteeQuestion from '@/components/pro-form/MultiGuaranteeQuestion';
import ImageTaggingQuestion from '@/components/pro-form/ImageTaggingQuestion';
import InfoMessageQuestion from '@/components/pro-form/InfoMessageQuestion';
import SelectionSpanIndicator from '@/components/pro-form/SelectionSpanIndicator';
import AutoSaveIndicator from '@/components/pro-form/AutoSaveIndicator';
import ConfirmModal from '@/components/pro-form/ConfirmModal';
import ThankYouModal from '@/components/pro-form/ThankYouModal';
import ValidationGuide from '@/components/pro-form/ValidationGuide';
import ValidationGuideCollapsible from '@/components/pro-form/ValidationGuideCollapsible';
import ReduxDataValidator from '@/components/pro-form/ReduxDataValidator';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import { QUESTIONS, SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import { trackValidationDispatch, trackParentStatusChange, devDiagEnabled } from '@/lib/devDiagnostics';
import { getQuestionById, getParentQuestionByChildId, getAllQuestionIds, isChildQuestion, computeParentValidationStatus } from '@/components/pro-form/questionUtils';

export default function ProQuestionnaire() {
  const dispatch = useDispatch();
  const responses = useSelector((state) => state.form.responses);
  const validationStatus = useSelector((state) => state.form.validationStatus);
  const touchedQuestions = useSelector((state) => state.form.touchedQuestions);
  const expandedQuestions = useSelector((state) => state.form.expandedQuestions);
  const credentials = useSelector((state) => state.form.credentials);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAutoSave, setShowAutoSave] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showThankYouModal, setShowThankYouModal] = useState(false);
  const [submittedBusinessName, setSubmittedBusinessName] = useState('');
  const [submittedDomain, setSubmittedDomain] = useState('');
  const [submittedFormData, setSubmittedFormData] = useState({});
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [showIncompleteList, setShowIncompleteList] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validatingQuestions, setValidatingQuestions] = useState([]);

  // Extract URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const businessNameParam = urlParams.get('businessName') || '';
  const rawDomainParam = urlParams.get('domainName') || '';
  const domainParam = rawDomainParam
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');

  // Calculate span totals for Q3-Q5
  const otherServices = responses['3_other'];
  const otherServicesCount = Array.isArray(otherServices) 
    ? otherServices.filter(v => v?.trim()).length 
    : (otherServices?.trim() ? 1 : 0);
  const servicesCount = (responses['3'] || []).length + otherServicesCount;
  const industriesCount = (responses['4'] || []).length + (responses['4_other'] ? 1 : 0);
  const regionsCount = Array.isArray(responses['5']) ? responses['5'].length : 0;
  const totalSelections = servicesCount + industriesCount + regionsCount;
  const isSpanLimitReached = totalSelections >= 25;
  
  // Extract and store credentials from URL
  useEffect(() => {
    const creds = {
      businessName: businessNameParam,
      domain: domainParam,
      userId: urlParams.get('userId') || '',
      userEmail: urlParams.get('userEmail') || '',
      userName: urlParams.get('userName') || '',
      accessToken: urlParams.get('accessToken') || ''
    };
    
    // Only store if at least one credential field is present
    if (Object.values(creds).some(val => val)) {
      dispatch(setCredentials(creds));
      console.log('✅ Credentials stored in Redux:', creds);
    }
  }, [businessNameParam, domainParam, dispatch]);

  // Set document title and favicon
  useEffect(() => {
    document.title = "Kaseya - Pro Website Content Form";
    
    const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6925fec3678942d22522b010/96c140c55_kaseya-logo.png';
    document.head.appendChild(link);
  }, []);

  // Initialize expanded questions on mount
  useEffect(() => {
    try {
      // Only initialize if not already initialized
      if (Object.keys(expandedQuestions).length === 0) {
        const expanded = {};
        QUESTIONS.forEach(q => {
          expanded[q.id] = false;
          if (q.conditionalChildren) {
            q.conditionalChildren.forEach(child => {
              expanded[child.id] = false;
            });
          }
        });
        if (initializeExpandedQuestions) {
          dispatch(initializeExpandedQuestions(expanded));
        }
      }

      // Check if there's any actual user data
      const hasUserData = Object.keys(responses).length > 0;

      // Only revalidate if there's user data
      if (hasUserData) {
        Object.keys(responses).forEach(key => {
          if (!key.includes('_other') && !key.includes('_primary') && responses[key]) {
            // Mark as touched if not already
            if (!touchedQuestions[key] && setTouchedQuestion) {
              dispatch(setTouchedQuestion({ questionId: key, touched: true }));
            }
          }
        });

        // Only update validation for questions that don't already have a validation status
        // This preserves persisted validation statuses (including AI validation for textareas)
        const questionsToValidate = [];
        QUESTIONS.forEach(q => {
          if (responses[q.id] && q.type !== 'textarea' && !validationStatus[q.id]) {
            questionsToValidate.push({ id: q.id, value: responses[q.id] });
          }
          if (q.conditionalChildren) {
            q.conditionalChildren.forEach(child => {
              if (responses[child.id] && child.type !== 'textarea' && !validationStatus[child.id]) {
                questionsToValidate.push({ id: child.id, value: responses[child.id] });
              }
            });
          }
        });

        // Validate all questions in a single batch
        questionsToValidate.forEach(({ id, value }) => {
          updateQuestionValidation(id, value, responses);
        });
      }
    } catch (error) {
      console.error('Error in initialization useEffect:', error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: dispatch only when status meaningfully changes
  const setValidationStatusIfChanged = (qid, next, snapshot) => {
    const prev = (snapshot ?? validationStatus)?.[qid] ?? '';
    if (prev === next) return false;
    dispatch(setValidationStatus({ questionId: qid, status: next }));
    try { if (devDiagEnabled && devDiagEnabled()) trackValidationDispatch(qid, next); } catch {}
    return true;
  };

  // No more cookie saving - Redux persist handles everything automatically

  const updateResponse = useCallback((questionId, value) => {
    // Persist the field change first
    dispatch(setResponse({ questionId, value }));

    // Prepare merged snapshot for validation logic
    const newResponses = { ...responses, [questionId]: value };

    // If an auxiliary `_other` field changed, also revalidate the owning base question
    if (questionId.endsWith('_other')) {
      const baseId = questionId.slice(0, -6);
      const baseVal = newResponses[baseId];
      // Re-run validation for the base question (radio logic checks `${baseId}_other` itself)
      updateQuestionValidation(baseId, baseVal, newResponses);
      // Mark the base question as touched so icons/lists reflect the latest state immediately
      dispatch(setTouchedQuestion({ questionId: baseId, touched: true }));
    } else {
      // Regular path: validate the changed question
      updateQuestionValidation(questionId, value, newResponses);
    }

    // UI feedback + touched state for the specific control that changed
    setShowAutoSave(prev => prev + 1);
    dispatch(setTouchedQuestion({ questionId, touched: true }));
  }, [dispatch, responses]);

  const calculateQuestion2Status = (status2_1, value2_2) => {
    // Check 2.2 state
    const hasImage = value2_2?.url ? true : false;
    const hasTags = value2_2?.tags && Array.isArray(value2_2.tags) && 
                    value2_2.tags.length > 0 && 
                    value2_2.tags.every(tag => tag.person?.name);

    // If 2.1 has not run or is incomplete
    if (status2_1 === '' || status2_1 === 'incomplete') {
      return 'incomplete';
    }

    // If 2.1 is needs_work
    if (status2_1 === 'needs_work') {
      if (!hasImage) {
        return 'incomplete';
      }
      return 'needs_work';
    }

    // If 2.1 is complete
    if (status2_1 === 'complete') {
      if (!hasImage) {
        return 'incomplete';
      }
      if (!hasTags) {
        return 'needs_work';
      }
      return 'complete';
    }

    return 'incomplete';
  };

  const updateValidationState = (questionId, status) => {
    // Child snapshot after applying this change
    const newStatusSnapshot = { ...validationStatus, [questionId]: status };
    setValidationStatusIfChanged(questionId, status, validationStatus);

    // Special handling for question 2.1
    if (questionId === '2.1') {
      const value2_2 = responses['2.2'];
      const q2Status = calculateQuestion2Status(status, value2_2);
      setValidationStatusIfChanged('2', q2Status, validationStatus);
    }

    // If this is a child question, deterministically update parent using schema
    if (isChildQuestion(questionId)) {
      const parentId = questionId.split('.')[0];
      if (parentId && parentId !== '2') {
        const parentQuestion = getQuestionById(QUESTIONS, parentId);
        const parentAnswer = responses[parentId];
        const childStatuses = {};
        (parentQuestion?.conditionalChildren || [])
          .filter(c => c.requiredIfParentYes)
          .forEach(c => { childStatuses[c.id] = newStatusSnapshot[c.id] || ''; });
        const parentNext = computeParentValidationStatus(parentQuestion, parentAnswer, childStatuses);
        if (parentNext) {
          const changed = setValidationStatusIfChanged(parentId, parentNext, validationStatus);
          if (changed) {
            try { if (devDiagEnabled && devDiagEnabled()) trackParentStatusChange(parentId, parentNext, questionId); } catch {}
          }
        }
      }
    }
  };

  const updateQuestionValidation = (questionId, value, allResponses) => {
    const question = getQuestionById(QUESTIONS, questionId);
    if (!question) return;

    let newStatus = 'incomplete';

    switch (question.type) {
      case 'yes_no': {
        // If answer is 'no' → parent complete and clear children statuses
        if (value === 'no') {
          setValidationStatusIfChanged(questionId, 'complete', validationStatus);
          if (question.conditionalChildren) {
            question.conditionalChildren.forEach(child => {
              if ((validationStatus[child.id] || '') !== '') {
                dispatch(setValidationStatus({ questionId: child.id, status: '' }));
              }
            });
          }
          return;
        }
        if (value === 'yes') {
          const childStatuses = {};
          (question.conditionalChildren || [])
            .filter(c => c.requiredIfParentYes)
            .forEach(c => { childStatuses[c.id] = validationStatus[c.id] || ''; });
          const parentNext = computeParentValidationStatus(question, value, childStatuses);
          const changed = setValidationStatusIfChanged(questionId, parentNext, validationStatus);
          if (changed) {
            try { if (devDiagEnabled && devDiagEnabled()) trackParentStatusChange(questionId, parentNext, undefined); } catch {}
          }
        }
        break;
      }

      case 'checkbox': {
        const selections = Array.isArray(value) ? value : [];
        const otherValue = allResponses[`${questionId}_other`];
        let otherCount = 0;
        if (otherValue) {
          otherCount = Array.isArray(otherValue) 
            ? otherValue.filter(v => v?.trim()).length 
            : (otherValue.trim() ? 1 : 0);
        }
        const totalCount = selections.length + otherCount;
        const min = question.limits?.min || 0;
        const max = question.limits?.max || Infinity;
        newStatus = (totalCount >= min && totalCount <= max) ? 'complete' : 'incomplete';
        break;
      }

      case 'radio': {
        const inOptions = Array.isArray(question.options) && question.options.includes(value);
        const isOtherSelected = value === 'Other' || (question.showOther && value && !inOptions);
        newStatus = (value && (isOtherSelected ? (allResponses[`${questionId}_other`]?.trim()) : true))
          ? 'complete' : 'incomplete';
        break;
      }

      case 'multi_text': {
        const entries = Array.isArray(value) ? value : [];
        const min = question.limits?.min || 1;
        const max = question.limits?.max || Infinity;
        newStatus = (entries.length >= min && entries.length <= max) ? 'complete' : 'incomplete';
        break;
      }

      case 'numeric_range':
        newStatus = (value && value.trim().length > 0) ? 'complete' : 'incomplete';
        break;

      case 'multi_certification':
      case 'multi_guarantee': {
        const items = Array.isArray(value) ? value : [];
        const validItems = items.filter(item => {
          if (question.type === 'multi_certification') {
            return item.saved === true || (item.name?.trim() && item.type && item.saved !== false);
          } else {
            return item.saved === true || (item.name?.trim() && item.type && (item.file || item.description?.trim()) && item.saved !== false);
          }
        });
        const min = question.limits?.min || 0;
        newStatus = validItems.length >= min ? 'complete' : 'incomplete';

        // Special handling for question 14.1
        if (questionId === '14.1') {
          const q14Status = validItems.length > 0 ? 'complete' : 'incomplete';
          dispatch(setValidationStatus({ questionId: '14', status: q14Status }));
        }
        break;
      }

      case 'image_tagging':
        newStatus = (value?.url && Array.isArray(value.tags) && value.tags.length > 0 && 
                    value.tags.every(tag => tag.person?.name)) ? 'complete' : 'incomplete';
        break;

      case 'info_message':
        newStatus = 'complete';
        break;

      // Textarea questions get validated by AI agent - don't set here
      case 'textarea':
        return;
    }

    setValidationStatusIfChanged(questionId, newStatus, validationStatus);
  };

  const resetQuestion = (questionId) => {
    dispatch(deleteResponse(questionId));
    setShowAutoSave(prev => prev + 1);
    dispatch(setValidationStatus({ questionId, status: 'incomplete' }));
  };

  const toggleQuestion = (questionId) => {
    const isCurrentlyExpanded = expandedQuestions[questionId];
    dispatch(setExpandedQuestion({ questionId, expanded: !isCurrentlyExpanded }));
    
    // On expand: do NOT auto-touch optional children or any textarea
    if (!isCurrentlyExpanded) {
      const q = getQuestionById(QUESTIONS, questionId);
      const isChild = isChildQuestion(questionId);
      const isOptionalChild = isChild && q?.requiredIfParentYes !== true;

      // Skip auto-touching and auto-incomplete for optional children and all textareas
      if (q?.type === 'textarea' || isOptionalChild) {
        // no-op on expand
      } else {
        // For required questions (top-level or required children), mark touched and set initial incomplete if unset
        dispatch(setTouchedQuestion({ questionId, touched: true }));
        if (validationStatus[questionId] === '') {
          dispatch(setValidationStatus({ questionId, status: 'incomplete' }));
        }
      }
    }
    
    // If collapsing a parent with conditional children, collapse the children too
    const question = QUESTIONS.find(q => q.id === questionId);
    if (question?.conditionalChildren && isCurrentlyExpanded) {
      question.conditionalChildren.forEach(child => {
        dispatch(setExpandedQuestion({ questionId: child.id, expanded: false }));
      });
    }
  };

  const expandAll = () => {
    const expanded = {};
    QUESTIONS.forEach(q => {
      expanded[q.id] = true;
      if (q.conditionalChildren) {
        q.conditionalChildren.forEach(child => {
          expanded[child.id] = false;
        });
      }
    });
    dispatch(setAllExpanded(expanded));
  };

  const collapseAll = () => {
    const collapsed = {};
    QUESTIONS.forEach(q => {
      collapsed[q.id] = false;
      if (q.conditionalChildren) {
        q.conditionalChildren.forEach(child => {
          collapsed[child.id] = false;
        });
      }
    });
    dispatch(setAllExpanded(collapsed));
  };

  const clearAll = () => {
    setShowClearAllModal(true);
  };

  const handleConfirmClearAll = () => {
    dispatch(resetForm());
    
    // Collapse all questions
    const collapsed = {};
    QUESTIONS.forEach(q => {
      collapsed[q.id] = false;
      if (q.conditionalChildren) {
        q.conditionalChildren.forEach(child => {
          collapsed[child.id] = false;
        });
      }
    });
    dispatch(setAllExpanded(collapsed));

    setShowClearAllModal(false);
    toast.success('All responses cleared');

    // Scroll to top and refresh
    window.scrollTo(0, 0);
    setTimeout(() => window.location.reload(), 100);
  };

  const isQuestionComplete = (questionId) => {
    const question = getQuestionById(QUESTIONS, questionId);
    if (!question) return false;

    // Info messages are non-blocking and always considered complete
    if (question.type === 'info_message') {
      return true;
    }

    // Check validation status first - if it exists and is complete/needs_work, question is complete
    const status = validationStatus[questionId];
    if (status === 'complete' || status === 'needs_work') {
      return true;
    }

    // Don't show complete until question is touched
    if (!touchedQuestions[questionId]) return false;

    const answer = responses[questionId];
    const otherValue = responses[`${questionId}_other`];

    switch (question.type) {
      case 'yes_no':
      const hasValidAnswer = answer === 'yes' || answer === 'no';

      // If answer is "no" AND question was touched, it's complete
      if (answer === 'no' && touchedQuestions[questionId]) return true;

      // If answer is "yes" and has conditional children, check those too
      if (hasValidAnswer && answer === 'yes' && question.conditionalChildren) {
      const requiredChildren = question.conditionalChildren.filter(c => c.requiredIfParentYes);
      const allChildrenComplete = requiredChildren.every(child => {
        // Check validation status first for child questions
        const childStatus = validationStatus[child.id];
        if (childStatus === 'complete' || childStatus === 'needs_work') {
          return true;
        }

        const childQuestion = getQuestionById(QUESTIONS, child.id);
        if (!childQuestion) return false;

        // Check child completion directly without requiring touched status
        const childAnswer = responses[child.id];

        switch (childQuestion.type) {
          case 'textarea':
            return childAnswer && childAnswer.trim().length > 0;

          case 'multi_certification': {
            const items = Array.isArray(childAnswer) ? childAnswer : [];
            const validItems = items.filter(item => {
              const isComplete = item.name?.trim() && item.type;
              return item.saved === true || (isComplete && item.saved !== false);
            });
            const min = childQuestion.limits?.min || 0;
            return validItems.length >= min;
          }

          case 'multi_guarantee': {
            const items = Array.isArray(childAnswer) ? childAnswer : [];
            const validItems = items.filter(item => {
              const isComplete = item.name?.trim() && item.type && (item.file || item.description?.trim());
              return item.saved === true || (isComplete && item.saved !== false);
            });
            const min = childQuestion.limits?.min || 0;
            return validItems.length >= min;
          }

          case 'image_tagging':
            return childAnswer && childAnswer.url && Array.isArray(childAnswer.tags) && 
                   childAnswer.tags.length > 0 && childAnswer.tags.every(tag => tag.person?.name);

          default:
            return false;
        }
      });
      return allChildrenComplete;
      }
      return hasValidAnswer;
      
      case 'checkbox': {
        const selections = Array.isArray(answer) ? answer : [];
        let otherCount = 0;
        if (otherValue) {
          if (Array.isArray(otherValue)) {
            otherCount = otherValue.filter(v => v?.trim()).length;
          } else if (otherValue.trim()) {
            otherCount = 1;
          }
        }
        const totalCount = selections.length + otherCount;
        const min = question.limits?.min || 0;
        const max = question.limits?.max || Infinity;
        return totalCount >= min && totalCount <= max;
      }
      
      case 'radio': {
        const inOptions = Array.isArray(question.options) && question.options.includes(answer);
        const isOtherSelected = answer === 'Other' || (question.showOther && answer && !inOptions);
        return !!answer && (isOtherSelected ? (otherValue && otherValue.trim()) : true);
      }
      
      case 'textarea': {
        const status = validationStatus[questionId];
        // If validation status is set and complete/needs_work, return true
        if (status === 'complete' || status === 'needs_work') {
          return true;
        }
        // Fallback: check if there's text content (for cases where validation status wasn't saved)
        return answer && answer.trim().length > 0;
      }
      
      case 'multi_text': {
        const entries = Array.isArray(answer) ? answer : [];
        // For question 5 (geographic), check for validated locations
        if (questionId === '5') {
          const min = question.limits?.min || 1;
          return entries.length >= min;
        }
        // For other multi-text questions, check for filled text entries
        const filled = entries.filter(e => e?.trim()).length;
        const min = question.limits?.min || 0;
        return filled >= min;
      }
      
      case 'file_upload':
        return !!answer;
      
      case 'numeric_range':
        return answer && answer.trim().length > 0;

      case 'multi_certification': {
        const items = Array.isArray(answer) ? answer : [];
        // Count items that are either explicitly saved OR complete (legacy items)
        const validItems = items.filter(item => {
          const isComplete = item.name?.trim() && item.type;
          return item.saved === true || (isComplete && item.saved !== false);
        });
        const min = question.limits?.min || 0;
        return validItems.length >= min;
      }

      case 'multi_guarantee': {
        const items = Array.isArray(answer) ? answer : [];
        // Count items that are either explicitly saved OR complete
        const validItems = items.filter(item => {
          const isComplete = item.name?.trim() && item.type && (item.file || item.description?.trim());
          return item.saved === true || (isComplete && item.saved !== false);
        });
        const min = question.limits?.min || 0;
        return validItems.length >= min;
      }

          case 'image_tagging':
            return answer && answer.url && Array.isArray(answer.tags) && answer.tags.length > 0 && answer.tags.every(tag => tag.person?.name);

              case 'info_message':
                return true; // Info messages don't require user input

              default:
                return false;
    }
  };

  const getQuestionValidationStatus = (questionId) => {
    return validationStatus[questionId] || 'neutral';
  };

  // Shared completion helpers
  const isQuestionActive = (qid) => {
    if (!isChildQuestion(qid)) return true; // top-level always active
    const parent = getParentQuestionByChildId(QUESTIONS, qid);
    if (!parent) return false;
    return responses[parent.id] === 'yes';
  };

  const isQuestionRequiredNow = (qid) => {
    const q = getQuestionById(QUESTIONS, qid);
    if (!q) return false;
    if (q.type === 'info_message') return false; // never required
    if (isChildQuestion(qid)) {
      return q.requiredIfParentYes === true && isQuestionActive(qid);
    }
    // Parents/top-level are required by default
    return true;
  };

  const shouldParticipateInCompletion = (qid) => {
    const q = getQuestionById(QUESTIONS, qid);
    if (!q) return false;
    if (q.type === 'info_message') return false;
    if (isChildQuestion(qid)) {
      // Only required, active children participate
      return isQuestionRequiredNow(qid);
    }
    // Parents always participate
    return true;
  };

  const getIncompleteQuestions = () => {
    const incomplete = [];
    const allIds = getAllQuestionIds(QUESTIONS);
    allIds.forEach((qid) => {
      const question = getQuestionById(QUESTIONS, qid);
      if (!question) return;

      if (!shouldParticipateInCompletion(qid)) return;

      if (!isQuestionComplete(qid)) {
        incomplete.push(`Q${qid}: ${question.title}`);
      }
    });
    return incomplete;
  };


  const isFormValid = () => {
    return getIncompleteQuestions().length === 0;
  };

  const getQuestionsNeedingValidation = () => {
    const needsValidation = [];
    
    // Check all textarea questions
    QUESTIONS.forEach(q => {
      if (q.type === 'textarea' && responses[q.id]) {
        const status = validationStatus[q.id];
        if (!status || status === '' || status === 'incomplete') {
          needsValidation.push(q.id);
        }
      }
      
      // Check conditional children
      if (q.conditionalChildren && responses[q.id] === 'yes') {
        q.conditionalChildren.forEach(child => {
          if (child.type === 'textarea' && responses[child.id]) {
            const status = validationStatus[child.id];
            if (!status || status === '' || status === 'incomplete') {
              needsValidation.push(child.id);
            }
          }
        });
      }
    });
    
    return needsValidation;
  };

  const runFinalValidations = async () => {
    const questionsToValidate = getQuestionsNeedingValidation();
    
    if (questionsToValidate.length === 0) {
      return true;
    }
    
    setIsValidating(true);
    setValidatingQuestions(questionsToValidate);
    
    try {
      // Run all validations in parallel
      const validationPromises = questionsToValidate.map(async (qId) => {
        const question = getQuestionById(QUESTIONS, qId);
        
        try {
          const questionKey = `question_${qId.replace('.', '_')}`;
          const result = await base44.functions.invoke('validateQuestionText', {
            text: responses[qId],
            questionContext: questionKey
          });
          
          const status = result.data?.status || 'needs_work';
          dispatch(setValidationStatus({ questionId: qId, status }));
          
          return { qId, status };
        } catch (error) {
          console.error(`Validation error for Q${qId}:`, error);
          dispatch(setValidationStatus({ questionId: qId, status: 'needs_work' }));
          return { qId, status: 'needs_work' };
        }
      });
      
      await Promise.all(validationPromises);
      setIsValidating(false);
      setValidatingQuestions([]);
      return true;
    } catch (error) {
      console.error('Final validation error:', error);
      setIsValidating(false);
      setValidatingQuestions([]);
      toast.error('Validation error occurred. Please check your answers.');
      return false;
    }
  };

  const handleSubmitClick = async () => {
    // Run final validations first
    const validationSuccess = await runFinalValidations();
    
    if (!validationSuccess) {
      return;
    }
    
    // After validation, check if form is complete
    if (!isFormValid()) {
      setShowIncompleteList(true);
      return;
    }
    
    setShowIncompleteList(false);
    setShowConfirmModal(true);
  };

  const transformResponsesToPayload = (responses, businessName, domain) => {
    // Transform geographic areas with nested structure
    const geographicAreas = (responses['5'] || []).map((location, index) => ({
      geographic_area_meta: {
        name: typeof location === 'string' ? location : (location.name || location.label || ''),
        label: typeof location === 'string' ? location : (location.label || location.name || ''),
        lat: location.lat != null ? String(location.lat) : '',
        lon: location.lon != null ? String(location.lon) : '',
        place_id: location.place_id || '',
        source: "google",
        primary: index === (responses['5_primary'] || 0)
      }
    }));

    // Transform certifications/partnerships
    const certificationsPartnerships = responses['12'] === 'yes' && responses['12.1'] 
      ? (responses['12.1'] || []).map(item => ({
          cert_item_name: item.name || '',
          cert_item_type: item.type || '',
          cert_item_image_url: item.imageUrl || item.image?.url || '',
          cert_item_file_url: Array.isArray(item.files) && item.files.length > 0 ? item.files[0].url : ''
        }))
      : [];

    // Transform team photo
    const teamPhoto = responses['2'] === 'yes' && responses['2.2']
      ? {
          imageUrl: responses['2.2'].url || '',
          taggedPeople: (responses['2.2'].tags || []).map(tag => ({
            name: tag.person?.name || '',
            position: tag.person?.position || '',
            bio: tag.person?.bio || '',
            x: tag.x || 0,
            y: tag.y || 0
          }))
        }
      : { imageUrl: '', taggedPeople: [] };

    // Transform service guarantee items
    const serviceGuaranteeItems = responses['14'] === 'yes' && responses['14.1']
      ? (responses['14.1'] || []).map(item => ({
          guarantee_name: item.name || '',
          guarantee_type: item.type || '',
          guarantee_file_url: item.fileUrl || item.file?.url || '',
          guarantee_description: item.description || ''
        }))
      : [];

    // Build additional_pages_list structure
    const additionalPagesList = {
      why_choose_us_page: {
        generate_page: responses['1'] === 'yes',
        why_choose_us_description: responses['1'] === 'yes' ? (responses['1.1'] || '') : ''
      },
      meet_the_team_page: {
        generate_page: responses['2'] === 'yes',
        team_introduction: responses['2'] === 'yes' ? (responses['2.1'] || '') : '',
        team_photo_with_tags: teamPhoto
      }
    };

    return {
      metadata: {
        business_name: businessName,
        businessDomain: domain,
        submission_datetime: new Date().toISOString(),
        service_type: "pro"
      },
      userdata: {
        additional_pages_list: additionalPagesList,
        service_offerings: (responses['3'] || []).flatMap(s => {
          if (s.startsWith('CATEGORY:')) {
            const categoryName = s.replace('CATEGORY:', '');
            return SERVICE_OPTIONS_GROUPED[categoryName] || [];
          }
          return [s];
        }),
        service_offerings_other: Array.isArray(responses['3_other']) 
          ? responses['3_other'].filter(v => v?.trim()).join(', ') 
          : (responses['3_other'] || ''),
        target_industries: responses['4'] || [],
        target_industries_other: Array.isArray(responses['4_other'])
          ? responses['4_other'].filter(v => v?.trim()).join(', ')
          : (responses['4_other'] || ''),
        geographic_areas: geographicAreas,
        company_description: responses['6'] || '',
        delivery_model: responses['7'] || '',
        delivery_model_other: responses['7_other'] || '',
        pricing_packaging: responses['8'] || [],
        pricing_packaging_other: responses['8_other'] || '',
        differentiation: responses['9'] || '',
        company_goals: responses['10'] || [],
        company_goals_other: responses['10_other'] || '',
        brand_tone: responses['11'] || '',
        brand_tone_other: responses['11_other'] || '',
        certifications_partnerships: certificationsPartnerships,
        sales_process: responses['13'] || '',
        service_guarantee: responses['14'] === 'yes',
        service_guarantee_items: serviceGuaranteeItems,
        client_acquisition: responses['15'] || '',
        client_acquisition_other: responses['15_other'] || '',
        website_objectives: responses['16'] || [],
        website_objectives_other: responses['16_other'] || '',
        client_size: responses['17'] || '',
        client_challenges: responses['18'] || [],
        client_challenges_other: Array.isArray(responses['18_other'])
          ? responses['18_other'].filter(v => v?.trim()).join(', ')
          : (responses['18_other'] || ''),
        client_frustrations: responses['19'] || '',
        client_outcomes: responses['20'] || [],
        client_outcomes_other: Array.isArray(responses['20_other'])
          ? responses['20_other'].filter(v => v?.trim()).join(', ')
          : (responses['20_other'] || ''),
        value_description: responses['21'] || '',
        ideal_client: responses['22'] || '',
        avoided_clients: responses['23'] === 'yes' ? (responses['23.1'] || '') : '',
        primary_cta: responses['24'] || '',
        primary_cta_other: responses['24_other'] || '',
        additional_notes: responses['25'] === 'yes' ? (responses['25.1'] || '') : ''
      }
    };
  };

  const handleConfirmSubmit = async (businessName, domain) => {
    // NOTE: Do NOT close the modal or set isSubmitting here.
    // The modal manages its own submission state and will re-throw on failure
    // so it can show an inline error without losing user input.
    console.log('📤 [handleConfirmSubmit] Submission started for:', businessName);

    // Transform payload for both database and Zapier
    const transformedPayload = transformResponsesToPayload(responses, businessName, domain);
    
    console.log('==========================================');
    console.log('📤 FORM SUBMISSION - COMPLETE JSON PAYLOAD');
    console.log('==========================================');
    console.log(JSON.stringify(transformedPayload, null, 2));
    console.log('==========================================');

    // Save to database — let errors throw so modal catches them
    await base44.entities.ProFormSubmission.create(transformedPayload);
    console.log('✅ Saved to database');

    // Send to Zapier — non-fatal, log but don't throw
    try {
      console.log('📡 Sending to Zapier via backend function');
      const zapierResult = await base44.functions.invoke('sendToZapier', transformedPayload);
      console.log('📡 Backend function response:', zapierResult.data);
      if (zapierResult.data?.success) {
        console.log('✅ Successfully sent to Zapier');
      } else {
        console.error('❌ Zapier webhook failed:', zapierResult.data?.error);
      }
    } catch (zapierError) {
      // Non-fatal: log but don't fail the submission
      console.error('❌ Zapier webhook error (non-fatal):', zapierError.message);
    }

    // Success — clear store, close modal, show thank you
    dispatch(resetForm());
    toast.success('Questionnaire submitted successfully!');
    setSubmittedBusinessName(businessName);
    setSubmittedDomain(domain);
    setSubmittedFormData(responses);
    setShowConfirmModal(false);
    setShowThankYouModal(true);
    console.log('✅ Submission complete for:', businessName);
  };



  // Determine background color based on selection balance
  const getSpanBackgroundClass = () => {
    if (totalSelections < 8) return 'bg-red-100/25';
    if (totalSelections > 15) return 'bg-amber-100/25';
    return 'bg-green-100/25';
  };

  // Group questions by section
  const sections = QUESTIONS.reduce((acc, question) => {
    if (!acc[question.section]) {
      acc[question.section] = [];
    }
    acc[question.section].push(question);
    return acc;
  }, {});

  const renderQuestion = (question, index) => {
    const commonProps = {
      value: responses[question.id],
      onChange: (val) => updateResponse(question.id, val)
    };

    switch (question.type) {
      case 'yes_no': {
        const sanitizedId = String(question.id).replace(/\./g, '_');
        const groupName = `yes_no_${sanitizedId}`;
        const inputIdBase = `q_${sanitizedId}`;
        return <YesNoQuestion {...commonProps} groupName={groupName} inputIdBase={inputIdBase} />;
      }
      
      case 'checkbox':
        return (
          <CheckboxQuestion
            options={question.options}
            groupedOptions={question.id === "3" ? SERVICE_OPTIONS_GROUPED : null}
            value={responses[question.id] || []}
            onChange={(val) => updateResponse(question.id, val)}
            min={question.limits?.min}
            max={question.limits?.max}
            showOther={question.showOther}
            otherValue={responses[`${question.id}_other`] || (question.showOther && question.limits?.max ? [''] : '')}
            onOtherChange={(val) => updateResponse(`${question.id}_other`, val)}
            columns={question.id === "3" ? 3 : 2}
            allowCategorySelection={question.id === "3"}
            externalDisabled={isSpanLimitReached && (question.id === "3" || question.id === "4")}
          />
        );
      
      case 'radio': {
        // Set context-specific placeholders for "Other" inputs
        let otherPlaceholder = 'Please specify...';
        if (question.id === '15') {
          otherPlaceholder = 'Enter how your clients find you...';
        } else if (question.id === '24') {
          otherPlaceholder = "What action would you like client's to take on your website...";
        } else if (question.id === '11') {
          otherPlaceholder = 'Enter your custom brand voice...';
        } else if (question.id === '7') {
          otherPlaceholder = 'Enter your delivery model...';
        }
        const sanitizedId = String(question.id).replace(/\./g, '_');
        const groupName = `radio_${sanitizedId}`;
        const inputIdBase = `radio_${sanitizedId}`;

        return (
          <RadioQuestion
            options={question.options}
            {...commonProps}
            showOther={question.showOther}
            otherValue={responses[`${question.id}_other`] || ''}
            onOtherChange={(val) => updateResponse(`${question.id}_other`, val)}
            otherPlaceholder={otherPlaceholder}
            groupName={groupName}
            inputIdBase={inputIdBase}
          />
        );
      }
      
      case 'textarea':
        return (
          <>
            {question.id === '25' && (
              <div className="text-[#566C75] italic text-[15px] leading-relaxed mb-4">
                This question is specifically about content, <strong>not design</strong> preferences.
              </div>
            )}
            <TextareaQuestion 
              {...commonProps} 
              questionContext={`Question ${question.id}: ${question.title}`}
              questionId={question.id}
              debounceMs={250}
              onValidationChange={(status) => updateValidationState(question.id, status)}
              currentValidationStatus={validationStatus[question.id]}
              onTouched={() => dispatch(setTouchedQuestion({ questionId: question.id, touched: true }))}
            />
          </>
        );
      
      case 'multi_text':
        // Question 5 uses geographic validation
        if (question.id === '5') {
          return (
            <MultiGeographicQuestion
              selectedLocations={responses[question.id] || []}
              primaryIndex={responses['5_primary'] || 0}
              onAdd={(location) => {
                const current = responses[question.id] || [];
                const newLocations = [...current, location];
                dispatch(setResponse({ questionId: question.id, value: newLocations }));
                setShowAutoSave(s => s + 1);

                // Update validation status
                const min = question.limits?.min || 1;
                const max = question.limits?.max || 5;
                const newStatus = (newLocations.length >= min && newLocations.length <= max) ? 'complete' : 'incomplete';
                dispatch(setValidationStatus({ questionId: question.id, status: newStatus }));
              }}
              onUpdate={(index, updatedLocation) => {
                const current = responses[question.id] || [];
                const newLocations = [...current];
                newLocations[index] = updatedLocation;
                dispatch(setResponse({ questionId: question.id, value: newLocations }));
                setShowAutoSave(s => s + 1);
              }}
              onRemove={(index) => {
                const current = responses[question.id] || [];
                let primaryIndex = responses['5_primary'] || 0;
                // Adjust primary index if we're removing it or something before it
                if (index === primaryIndex) {
                  primaryIndex = 0;
                } else if (index < primaryIndex) {
                  primaryIndex = primaryIndex - 1;
                }
                const newLocations = current.filter((_, i) => i !== index);
                dispatch(setResponse({ questionId: question.id, value: newLocations }));
                dispatch(setResponse({ questionId: '5_primary', value: primaryIndex }));
                setShowAutoSave(s => s + 1);

                // Update validation status
                const min = question.limits?.min || 1;
                const max = question.limits?.max || 5;
                const newStatus = (newLocations.length >= min && newLocations.length <= max) ? 'complete' : 'incomplete';
                dispatch(setValidationStatus({ questionId: question.id, status: newStatus }));
              }}
              onSetPrimary={(index) => {
                dispatch(setResponse({ questionId: '5_primary', value: index }));
                setShowAutoSave(s => s + 1);
              }}
              maxLocations={question.limits?.max || 5}
              externalDisabled={isSpanLimitReached}
            />
          );
        }
        // Other multi-text questions use simple text inputs
        return (
          <MultiTextQuestion
            value={responses[question.id] || ['']}
            onChange={(val) => updateResponse(question.id, val)}
            min={question.limits?.min}
            max={question.limits?.max}
            placeholder="Enter a location"
          />
        );
      
      case 'file_upload':
        return <FileUploadQuestion {...commonProps} />;
      
      case 'numeric_range':
        return (
          <NumericRangeQuestion
            minValue={question.minValue}
            maxValue={question.maxValue}
            value={responses[question.id]}
            onChange={(val) => updateResponse(question.id, val)}
          />
        );

      case 'multi_certification':
        return (
          <MultiCertificationQuestion
            value={responses[question.id] || []}
            onChange={(val) => {
              dispatch(setResponse({ questionId: question.id, value: val }));
              setShowAutoSave(prev => prev + 1);

              // Update validation for Q12 if this is the canonical certifications question
              if (question.id === '12.1' && responses['12'] === 'yes') {
                const validItems = Array.isArray(val) ? val.filter(item => 
                  item.saved === true || (item.name?.trim() && item.type && item.saved !== false)
                ) : [];
                const newStatus = validItems.length > 0 ? 'complete' : 'incomplete';
                dispatch(setValidationStatus({ questionId: '12', status: newStatus }));
              }
            }}
            max={question.limits?.max || 20}
          />
        );

      case 'multi_guarantee':
        return (
          <MultiGuaranteeQuestion
            value={responses[question.id] || []}
            onChange={(val) => {
              updateResponse(question.id, val);

              // Special handling for question 14.1
              if (question.id === '14.1') {
                const validItems = Array.isArray(val) ? val.filter(item => 
                  item.saved === true || (item.name?.trim() && item.type && (item.file || item.description?.trim()) && item.saved !== false)
                ) : [];
                const newStatus = validItems.length > 0 ? 'complete' : 'incomplete';
                dispatch(setValidationStatus({ questionId: '14', status: newStatus }));
              }
            }}
            max={question.limits?.max || 10}
          />
        );

              case 'image_tagging':
            return <ImageTaggingQuestion {...commonProps} />;

                  case 'info_message':
                    return <InfoMessageQuestion 
                      textBefore={question.textBefore || question.guidance}
                      linkLabel={question.linkLabel || 'Question 12'}
                      textAfter={question.textAfter}
                      onLinkClick={() => {
                        const q12Element = document.getElementById('question-12');
                        if (q12Element) {
                          q12Element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          setTimeout(() => {
                            dispatch(setExpandedQuestion({ questionId: '12', expanded: true }));
                          }, 500);
                        }
                      }}
                    />;

                  default:
                    return null;
    }
  };

  const renderConditionalChildren = (parent) => {
    // Hide children if parent is collapsed OR if answer is not "yes"
    if (!parent.conditionalChildren || responses[parent.id] !== 'yes' || !expandedQuestions[parent.id]) {
      return null;
    }

    return (
      <div className="mt-6 ml-6 pl-6 border-l-2 border-blue-200 space-y-8">
        {parent.conditionalChildren.map((child, idx) => (
          <React.Fragment key={child.id}>
            <QuestionWrapper
              number={child.id}
              title={child.title}
              guidance={child.guidance}
              why={child.why}
              examples={child.examples}
              isCollapsible={true}
              isExpanded={expandedQuestions[child.id]}
              onToggle={() => toggleQuestion(child.id)}
              required={child.requiredIfParentYes}
              onReset={() => resetQuestion(child.id)}
              hasAnswer={!!responses[child.id] || !!responses[`${child.id}_other`]}
              isComplete={isQuestionComplete(child.id)}
              wasTouched={touchedQuestions[child.id]}
              isSubQuestion={true}
              validationStatus={getQuestionValidationStatus(child.id)}
              showStatusIcon={touchedQuestions[child.id]}
            >
              {renderQuestion(child)}
            </QuestionWrapper>
            {renderConditionalChildren(child)}
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <FormHeader />
      
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8 md:py-12 md:pl-16">
        {/* Validation Status Guide - Collapsible */}
        <ValidationGuideCollapsible />

        {/* Expand/Collapse Controls */}
        <div className="flex gap-3 mb-6 md:mb-8">
          <button
            type="button"
            onClick={expandAll}
            className="flex-1 md:flex-none px-4 md:px-6 py-3 bg-[#5B8AC4] hover:bg-[#4A7AB3] active:bg-[#3A6AA3] text-white font-bold rounded transition-colors text-sm uppercase min-h-[44px]"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="flex-1 md:flex-none px-4 md:px-6 py-3 bg-[#6B7780] hover:bg-[#5A666F] active:bg-[#4A5660] text-white font-bold rounded transition-colors text-sm uppercase min-h-[44px]"
          >
            Collapse All
          </button>
        </div>

        <div className="space-y-16">
          {Object.entries(sections).map(([sectionName, sectionQuestions], sectionIndex) => (
            <section key={sectionName} className="space-y-8">
              <div className="pb-6 border-b-2 border-[#1E6BA8]">
                <h2 className="text-2xl font-bold text-[#1E6BA8]">
                  {sectionName}
                </h2>
              </div>

              {sectionQuestions.map((question, qIndex) => {
                const isInSpan = ["3", "4", "5"].includes(question.id);

                // For questions 3-5, render with background wrapper
                if (question.id === "3") {
                  // Find Q3, Q4, Q5
                  const spanQuestions = sectionQuestions.filter(q => ["3", "4", "5"].includes(q.id));

                  return (
                    <div key="span-questions-wrapper">
                      <div className={`rounded-lg p-4 -mx-4 ${getSpanBackgroundClass()}`}>
                        {spanQuestions.map(q => (
                          <div key={q.id} className="mb-8 last:mb-0">
                            <QuestionWrapper
                              id={`question-${q.id}`}
                              number={q.id}
                              title={q.title}
                              guidance={q.guidance}
                              why={q.why}
                              examples={q.examples}
                              isCollapsible={true}
                              isExpanded={expandedQuestions[q.id]}
                              onToggle={() => toggleQuestion(q.id)}
                              onReset={() => resetQuestion(q.id)}
                              hasAnswer={!!responses[q.id] || !!responses[`${q.id}_other`]}
                              isComplete={isQuestionComplete(q.id)}
                              wasTouched={touchedQuestions[q.id]}
                              validationStatus={getQuestionValidationStatus(q.id)}
                              showStatusIcon={touchedQuestions[q.id]}
                            >
                              {renderQuestion(q)}
                            </QuestionWrapper>

                            {renderConditionalChildren(q)}
                          </div>
                        ))}

                        <div className="mt-6">
                          <SelectionSpanIndicator
                            servicesCount={servicesCount}
                            industriesCount={industriesCount}
                            regionsCount={regionsCount}
                          />
                        </div>
                      </div>
                    </div>
                  );
                }

                // Skip Q4 and Q5 since they're rendered above
                if (question.id === "4" || question.id === "5") {
                  return null;
                }

                // Render all other questions normally
                return (
                  <div key={question.id}>
                    <QuestionWrapper
                      id={`question-${question.id}`}
                      number={question.id}
                      title={question.title}
                      guidance={question.guidance}
                      why={question.why}
                      examples={question.examples}
                      isCollapsible={true}
                      isExpanded={expandedQuestions[question.id]}
                      onToggle={() => toggleQuestion(question.id)}
                      onReset={() => resetQuestion(question.id)}
                      hasAnswer={!!responses[question.id] || !!responses[`${question.id}_other`]}
                      isComplete={isQuestionComplete(question.id)}
                      wasTouched={touchedQuestions[question.id]}
                      validationStatus={getQuestionValidationStatus(question.id)}
                      showStatusIcon={touchedQuestions[question.id]}
                    >
                      {renderQuestion(question)}
                    </QuestionWrapper>

                    {renderConditionalChildren(question)}
                  </div>
                );
              })}
            </section>
          ))}

          {/* Submit Section */}
          <div className="pt-8 border-t-2 border-[#C1C6C8]">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <button
                type="button"
                onClick={handleSubmitClick}
                disabled={isSubmitting || isValidating}
                className={`flex-1 py-4 text-sm font-bold rounded transition-all flex items-center justify-center uppercase tracking-wide min-h-[52px] ${
                  isSubmitting || isValidating
                    ? 'bg-[#A9B3B7] text-white cursor-not-allowed'
                    : 'bg-[#8DB63C] hover:bg-[#7DA035] active:bg-[#6D9030] text-white'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : isValidating ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Validating {validatingQuestions.length} question{validatingQuestions.length !== 1 ? 's' : ''}...
                  </>
                ) : (
                  'Submit Questionnaire'
                )}
              </button>

              <button
                type="button"
                onClick={clearAll}
                className="w-full sm:w-auto px-8 sm:px-12 py-4 bg-white text-[#4A5F8C] border-2 border-[#4A5F8C] hover:bg-[#F0F2F5] active:bg-[#E0E4EC] rounded transition-all uppercase text-sm font-bold tracking-wide min-h-[52px]"
              >
                Clear All
              </button>
            </div>

            {showIncompleteList && !isFormValid() && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-red-900 mb-2">Please complete the following questions:</h4>
                    <ul className="space-y-1 text-sm text-red-800">
                      {getIncompleteQuestions().map((q, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-red-600">•</span>
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

              <ValidationGuide />
              </div>
              </main>

      <AutoSaveIndicator show={showAutoSave} />
      <ReduxDataValidator />

      {showConfirmModal && (
        <ConfirmModal
          formData={responses}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setShowConfirmModal(false)}
          initialBusinessName={businessNameParam}
          initialDomain={domainParam}
        />
      )}

      {showThankYouModal && (
        <ThankYouModal 
          businessName={submittedBusinessName} 
          domain={submittedDomain}
          formData={submittedFormData}
        />
      )}

      {showClearAllModal && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-[#122947] mb-4">Clear All Responses?</h3>
            <p className="text-[#566C75] mb-6">
              Are you sure? You will have to start over again.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleConfirmClearAll}
                className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Yes, Clear All
              </button>
              <button
                onClick={() => setShowClearAllModal(false)}
                className="flex-1 px-6 py-3 bg-[#C1C6C8] hover:bg-[#A9B3B7] text-white rounded-lg font-medium transition-colors"
              >
                No, Keep Form Info
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      </ErrorBoundary>
      );
      }