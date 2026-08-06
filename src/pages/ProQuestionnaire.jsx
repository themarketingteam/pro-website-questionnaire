import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
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
  initializeExpandedQuestions,
  setTextareaDirtyMeta,
  applyFormMutation,
  resetQuestionState,
  setUiDraftState,
  clearUiDraftState,
} from '@/components/store/formSlice';
import { createDraftMutationMetadata } from '@/components/store/formMutationFactory';
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
import InfoMessageQuestion from '@/components/pro-form/InfoMessageQuestion';
import SelectionSpanIndicator from '@/components/pro-form/SelectionSpanIndicator';
import AutoSaveIndicator from '@/components/pro-form/AutoSaveIndicator';
import ValidationGuideCollapsible from '@/components/pro-form/ValidationGuideCollapsible';

const ImageTaggingQuestion = lazy(() => import('@/components/pro-form/ImageTaggingQuestion'));
const ConfirmModal = lazy(() => import('@/components/pro-form/ConfirmModal'));
const ThankYouModal = lazy(() => import('@/components/pro-form/ThankYouModal'));
const ValidationGuide = lazy(() => import('@/components/pro-form/ValidationGuide'));
const ReduxDataValidator = lazy(() => import('@/components/pro-form/ReduxDataValidator'));
import ErrorBoundary from '@/components/common/ErrorBoundary';
import { QUESTIONS, SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import { trackValidationDispatch, trackParentStatusChange, devDiagEnabled } from '@/lib/devDiagnostics';
import { getQuestionById, getParentQuestionByChildId, getAllQuestionIds, isChildQuestion } from '@/components/pro-form/questionUtils';
import { serializeError } from '@/components/pro-form/submissionPayload';
import { submitProQuestionnaire } from '@/lib/proQuestionnaireSubmit';
import {
  identifyClarityUser,
  setClarityTags,
  trackClarityEvent,
  getSafeAnswerMetadata
} from '@/lib/clarity';
import { getOrCreateQuestionnaireSessionId } from '@/lib/sessionId';
import { buildDraftEventRecord } from '@/lib/draftEvents';
import {
  createFindExistingDraftBySessionId,
  createSaveDraftSnapshot,
  writeDraftFailureBackup
} from '@/lib/draftPersistence';
import { defaultResilientStorage } from '@/lib/resilientStorage';
import { deriveQuestionnaireBrowserNamespace } from '@/lib/questionnaireBrowserNamespace';
import { useQuestionnairePersistence } from '@/components/store/QuestionnairePersistenceContext';
import ProDraftBootstrapGate from '@/components/pro-form/ProDraftBootstrapGate';
import ProDraftRecoveryPanel from '@/components/pro-form/ProDraftRecoveryPanel';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
} from '@/lib/proDraftRuntimeConfig';
import { useProDraftSync } from '@/hooks/useProDraftSync';

const DeferredSectionLoader = () => (
  <div className="flex items-center justify-center py-6">
    <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin"></div>
  </div>
);

const EMPTY_OBJECT = Object.freeze({});
/** @param {any} state */
const selectQuestionnaireForm = (state) => state?.form || EMPTY_OBJECT;

function ProQuestionnaireContent({ legacyPersistenceEnabled = true }) {
  const dispatch = useDispatch();
  const draftSync = useProDraftSync();
  const questionnairePersistence = useQuestionnairePersistence();
  const browserNamespace = questionnairePersistence.namespace
    || deriveQuestionnaireBrowserNamespace();
  const browserStorage = questionnairePersistence.storage || defaultResilientStorage;
  const standardContentClass = 'w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto';
  const wideContentClass = 'w-full max-w-4xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px] mx-auto';
  const formState = useSelector(selectQuestionnaireForm);
  const responses = formState.responses || EMPTY_OBJECT;
  const validationStatus = formState.validationStatus || EMPTY_OBJECT;
  const textValidationMeta = formState.textValidationMeta || EMPTY_OBJECT;
  const touchedQuestions = formState.touchedQuestions || EMPTY_OBJECT;
  const expandedQuestions = formState.expandedQuestions || EMPTY_OBJECT;
  const credentials = formState.credentials || EMPTY_OBJECT;
  const uiDraftState = formState.uiDraftState || EMPTY_OBJECT;
  const draftCaptureEnabled = !legacyPersistenceEnabled;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const finalSubmitInFlightRef = useRef(false);
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
  const [hasTrackedStart, setHasTrackedStart] = useState(false);
  const trackedTypingQuestionsRef = useRef(new Set());
  const draftSaveTimeoutRef = useRef(null);
  const draftTextEventTimeoutsRef = useRef({});
  const draftRecordIdRef = useRef('');
  const isTestMode = import.meta.env.MODE === 'test';
  const draftSaveDelayMs = isTestMode ? 0 : 600;
  const draftTextEventDelayMs = isTestMode ? 0 : 1000;
  const expandLinkedQuestionDelayMs = isTestMode ? 0 : 500;
  const clearAllReloadDelayMs = isTestMode ? 0 : 100;
  const hasFinalSubmittedRef = useRef(false);
  const lastChangedQuestionIdRef = useRef('');
  const [questionnaireSessionId, setQuestionnaireSessionId] = useState('');

  const dispatchAtomicMutation = useCallback((payload, mutationType, reason, questionId) => {
    dispatch(applyFormMutation({
      ...payload,
      lastChangedQuestionId: questionId || payload.lastChangedQuestionId || null,
      mutationMetadata: createDraftMutationMetadata({
        mutationType,
        reason,
        sourceTabId: formState.draftContext?.sourceTabId || null,
        baseServerRevision: formState.draftContext?.serverRevision || 0,
      }),
    }));
  }, [dispatch, formState.draftContext?.serverRevision, formState.draftContext?.sourceTabId]);

  const setScopedUiDraft = useCallback((scopeKey, kind, data) => {
    if (!draftCaptureEnabled) return;
    dispatch(setUiDraftState({
      scopeKey,
      entry: {
        kind,
        version: 1,
        data,
        updatedAtClient: new Date().toISOString(),
        sourceTabId: formState.draftContext?.sourceTabId || null,
      },
    }));
  }, [dispatch, draftCaptureEnabled, formState.draftContext?.sourceTabId]);

  useEffect(() => {
    if (!legacyPersistenceEnabled) {
      setQuestionnaireSessionId(formState.draftContext?.sessionId || '');
      return undefined;
    }
    let active = true;
    getOrCreateQuestionnaireSessionId({
      namespace: browserNamespace,
      storage: browserStorage,
    }).then((sessionId) => {
      if (active) setQuestionnaireSessionId(sessionId);
    }).catch(() => {});
    return () => { active = false; };
  }, [
    browserNamespace,
    browserStorage,
    formState.draftContext?.sessionId,
    legacyPersistenceEnabled,
  ]);

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
  const spanQuestionIds = ['3', '4', '5'];
  const areAllSpanQuestionsCollapsed = spanQuestionIds.every(
    (id) => expandedQuestions[id] === false
  );
  
  // Extract and store credentials from URL
  useEffect(() => {
    const creds = {
    businessName: businessNameParam,
    domain: domainParam,
    userId: urlParams.get('userId') || '',
    userEmail: urlParams.get('userEmail') || '',
    userName: urlParams.get('userName') || ''
    };

    // Only store if at least one credential field is present
    if (Object.values(creds).some(val => val)) {
    dispatch(setCredentials(creds));
    console.log('Credentials initialized for questionnaire', {
      hasBusinessName: Boolean(creds.businessName),
      hasDomain: Boolean(creds.domain),
      hasUserId: Boolean(creds.userId),
      hasUserEmail: Boolean(creds.userEmail)
    });
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

  useEffect(() => {
    const safeDomain = domainParam || credentials.domain || 'unknown';
    const safeBusinessName = businessNameParam || credentials.businessName || '';

    setClarityTags({
      app: 'pro_questionnaire',
      service_type: 'pro',
      business_domain: safeDomain,
      business_name_present: safeBusinessName ? 'true' : 'false'
    });

    if (credentials.userId) {
      identifyClarityUser({
        userId: credentials.userId,
        pageId: window.location.pathname,
        friendlyName: safeBusinessName || safeDomain || 'Pro Questionnaire Client'
      });
    }

    trackClarityEvent('pro_questionnaire_loaded', {
      business_domain: safeDomain,
      business_name_present: safeBusinessName ? 'true' : 'false'
    });
  }, [
    businessNameParam,
    domainParam,
    credentials.businessName,
    credentials.domain,
    credentials.userId
  ]);

  useEffect(() => {
    if (!legacyPersistenceEnabled) return undefined;
    const handleBeforeUnload = () => {
      void writeDraftFailureBackup({
        namespace: browserNamespace,
        storage: browserStorage,
        questionnaireSessionId,
        responses,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        textValidationMeta,
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current);
        draftSaveTimeoutRef.current = null;
      }

      Object.values(draftTextEventTimeoutsRef.current).forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      draftTextEventTimeoutsRef.current = {};
    };
  }, [
    questionnaireSessionId,
    browserNamespace,
    browserStorage,
    responses,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    textValidationMeta,
    legacyPersistenceEnabled,
  ]);

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
        const initialStatusUpdates = {};

        QUESTIONS.forEach((q) => {
          if (q.type === 'yes_no' && responses[q.id] && !validationStatus[q.id]) {
            initialStatusUpdates[q.id] = computeYesNoParentStatusFromResponses(
              q,
              responses[q.id],
              responses,
              validationStatus
            );
          }
        });

        Object.entries(initialStatusUpdates).forEach(([questionId, status]) => {
          if (status) {
            dispatch(setValidationStatus({ questionId, status }));
          }
        });

        const questionsToValidate = [];
        QUESTIONS.forEach(q => {
          if (responses[q.id] && q.type !== 'textarea' && q.type !== 'yes_no' && !validationStatus[q.id]) {
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

  const findExistingDraftBySessionId = useCallback(
    createFindExistingDraftBySessionId({ draftRecordIdRef }),
    []
  );

  const saveDraftSnapshot = useCallback(
    createSaveDraftSnapshot({
      entities: base44.entities,
      draftRecordIdRef,
      findExistingDraftBySessionId
    }),
    [findExistingDraftBySessionId]
  );

  const saveDraftNow = useCallback(async ({
    status = 'draft',
    submitError = '',
    finalSubmissionId = '',
    responsesSnapshot = responses,
    validationStatusSnapshot = validationStatus,
    touchedQuestionsSnapshot = touchedQuestions,
    expandedQuestionsSnapshot = expandedQuestions
  } = {}) => {
    if (!legacyPersistenceEnabled) {
      if (status === 'submit_attempted') return draftSync.markSubmitAttempted();
      if (status === 'submit_failed') {
        return draftSync.markSubmitFailed('SUBMISSION_FAILED');
      }
      if (status === 'submitted') return draftSync.markSubmitted(finalSubmissionId);
      return draftSync.flush({ reason: 'manual_save' });
    }
    if (!questionnaireSessionId) return null;
    return saveDraftSnapshot({
      sessionId: questionnaireSessionId,
      responses: responsesSnapshot,
      validationStatus: validationStatusSnapshot,
      touchedQuestions: touchedQuestionsSnapshot,
      expandedQuestions: expandedQuestionsSnapshot,
      credentials,
      businessNameParam,
      domainParam,
      serviceOptionsGrouped: SERVICE_OPTIONS_GROUPED,
      currentQuestionId: lastChangedQuestionIdRef.current || '',
      lastChangedQuestionId: lastChangedQuestionIdRef.current || '',
      status,
      submitError,
      finalSubmissionId
    });
  }, [
    saveDraftSnapshot,
    questionnaireSessionId,
    responses,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    credentials,
    businessNameParam,
    domainParam,
    draftSync,
    legacyPersistenceEnabled,
  ]);

  const queueDraftSave = useCallback((changedQuestionId, nextResponses = responses) => {
    if (!legacyPersistenceEnabled) return;
    if (hasFinalSubmittedRef.current || !questionnaireSessionId) return;

    lastChangedQuestionIdRef.current = changedQuestionId;

    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current);
    }

    draftSaveTimeoutRef.current = setTimeout(async () => {
      if (hasFinalSubmittedRef.current) return;

      try {
        await saveDraftSnapshot({
          sessionId: questionnaireSessionId,
          responses: nextResponses,
          validationStatus,
          touchedQuestions,
          expandedQuestions,
          credentials,
          businessNameParam,
          domainParam,
          serviceOptionsGrouped: SERVICE_OPTIONS_GROUPED,
          currentQuestionId: changedQuestionId,
          lastChangedQuestionId: changedQuestionId,
          status: 'draft'
        });
      } catch (error) {
        console.error('Draft autosave failed:', serializeError(error));
        void writeDraftFailureBackup({
          namespace: browserNamespace,
          storage: browserStorage,
          questionnaireSessionId,
          responses: nextResponses,
          validationStatus,
          touchedQuestions,
          expandedQuestions,
          textValidationMeta,
        });
      }
    }, draftSaveDelayMs);
  }, [
    questionnaireSessionId,
    browserNamespace,
    browserStorage,
    responses,
    validationStatus,
    touchedQuestions,
    expandedQuestions,
    textValidationMeta,
    credentials,
    businessNameParam,
    domainParam,
    saveDraftSnapshot,
    draftSaveDelayMs,
    legacyPersistenceEnabled,
  ]);

  const createDraftEvent = useCallback(async ({
    eventType,
    questionId,
    value
  }) => {
    if (!legacyPersistenceEnabled) return false;
    if (!questionnaireSessionId) return;
    try {
      const question = questionId ? getQuestionById(QUESTIONS, questionId) : null;

      const record = buildDraftEventRecord({
        sessionId: questionnaireSessionId,
        eventType,
        questionId,
        questionType: question?.type || 'unknown',
        value,
        businessName: businessNameParam || credentials.businessName || '',
        domain: domainParam || credentials.domain || '',
        userId: credentials.userId || ''
      });

      await base44.entities.ProFormDraftEvent.create(record);
    } catch (error) {
      console.error('Failed to create draft event:', {
        message: error?.message || String(error)
      });
    }
  }, [
    questionnaireSessionId,
    businessNameParam,
    credentials.businessName,
    credentials.domain,
    credentials.userId,
    domainParam,
    draftSync,
    legacyPersistenceEnabled,
  ]);

  const queueDraftEvent = useCallback(({
    eventType,
    questionId,
    value
  }) => {
    if (!legacyPersistenceEnabled) return false;
    const question = getQuestionById(QUESTIONS, questionId);

    const shouldDebounce =
      question?.type === 'text' ||
      question?.type === 'textarea';

    if (shouldDebounce) {
      if (draftTextEventTimeoutsRef.current[questionId]) {
        clearTimeout(draftTextEventTimeoutsRef.current[questionId]);
      }

      draftTextEventTimeoutsRef.current[questionId] = setTimeout(() => {
        createDraftEvent({
          eventType: 'text_changed',
          questionId,
          value
        });
      }, draftTextEventDelayMs);

      return;
    }

    createDraftEvent({
      eventType,
      questionId,
      value
    });
  }, [createDraftEvent, draftTextEventDelayMs, legacyPersistenceEnabled]);

  // Helper: dispatch only when status meaningfully changes
  const setValidationStatusIfChanged = (qid, next, snapshot) => {
    const prev = (snapshot ?? validationStatus)?.[qid] ?? '';
    if (prev === next) return false;
    dispatch(setValidationStatus({ questionId: qid, status: next }));
    try { if (devDiagEnabled && devDiagEnabled()) trackValidationDispatch(qid, next); } catch {}
    return true;
  };

  const computeYesNoParentStatusFromResponses = (question, parentAnswer, allResponses, currentValidationStatus = {}) => {
    if (!question || question.type !== 'yes_no') return '';

    if (parentAnswer === 'no') {
      return 'complete';
    }

    if (parentAnswer !== 'yes') {
      return 'incomplete';
    }

    const requiredChildren = (question.conditionalChildren || []).filter(
      (child) => child.requiredIfParentYes === true
    );

    if (requiredChildren.length === 0) {
      return 'complete';
    }

    let anyNeedsWork = false;

    for (const child of requiredChildren) {
      const childStatus = currentValidationStatus[child.id] || '';
      const childAnswer = allResponses?.[child.id];
      const childQuestion = getQuestionById(QUESTIONS, child.id);

      if (childStatus === 'needs_work') {
        anyNeedsWork = true;
        continue;
      }

      if (childStatus === 'complete') {
        continue;
      }

      if (childQuestion?.type === 'textarea') {
        if (!String(childAnswer || '').trim()) return 'incomplete';
        return 'incomplete';
      }

      if (childQuestion?.type === 'multi_certification') {
        const items = Array.isArray(childAnswer) ? childAnswer : [];
        const validItems = items.filter((item) => {
          return item?.saved === true || (String(item?.name || '').trim() && item?.type && item?.saved !== false);
        });
        if (validItems.length === 0) return 'incomplete';
        continue;
      }

      if (childQuestion?.type === 'multi_guarantee') {
        const items = Array.isArray(childAnswer) ? childAnswer : [];
        const validItems = items.filter((item) => {
          return item?.saved === true || (
            String(item?.name || '').trim() &&
            item?.type &&
            (item?.file || String(item?.description || '').trim()) &&
            item?.saved !== false
          );
        });
        if (validItems.length === 0) return 'incomplete';
        continue;
      }

      if (!childAnswer) {
        return 'incomplete';
      }
    }

    return anyNeedsWork ? 'needs_work' : 'complete';
  };

  // No more cookie saving - Redux persist handles everything automatically

  const updateResponse = useCallback((questionId, value) => {
    if (!hasTrackedStart) {
      trackClarityEvent('pro_questionnaire_started', {
        first_question_id: questionId
      });
      setHasTrackedStart(true);
    }

    const q = getQuestionById(QUESTIONS, questionId);
    const conditionalCleanup = !legacyPersistenceEnabled
      && q?.type === 'yes_no'
      && value !== 'yes'
      && Array.isArray(q.conditionalChildren)
      && q.conditionalChildren.length > 0;
    if (conditionalCleanup) {
      const childIds = q.conditionalChildren.map((child) => child.id);
      const childScopes = Object.keys(uiDraftState).filter((scope) => (
        childIds.some((childId) => scope === `question:${childId}`
          || scope.startsWith(`question:${childId}:`))
      ));
      dispatchAtomicMutation({
        setResponses: { [questionId]: value },
        deleteResponseKeys: childIds.flatMap((childId) => (
          [childId, `${childId}_other`, `${childId}_primary`]
        )),
        setValidationStatus: { [questionId]: 'complete' },
        deleteValidationKeys: childIds,
        setTouchedQuestions: { [questionId]: true },
        deleteTouchedKeys: childIds,
        deleteExpandedKeys: childIds,
        deleteTextValidationMetaKeys: childIds,
        deleteUiDraftStateKeys: childScopes,
      }, 'conditional_cleanup', 'conditional_cleanup', questionId);
    } else {
      // Listener middleware captures the complete state after this reducer and
      // all synchronous validation/touched reducers finish.
      dispatch(setResponse({ questionId, value }));
    }

    // Textarea dirtiness invalidation: if a textarea that had a validated status is edited, mark dirty and clear its redux validation

    if (
      (q?.type === 'text' || q?.type === 'textarea') &&
      !trackedTypingQuestionsRef.current.has(questionId)
    ) {
      trackedTypingQuestionsRef.current.add(questionId);

      trackClarityEvent('pro_questionnaire_question_typing_started', {
        question_id: questionId,
        question_type: q?.type || 'unknown',
        business_domain: credentials.domain || domainParam || 'unknown'
      });
    }
    if (q?.type === 'textarea') {
      const prevStatus = validationStatus[questionId];
      const prevValue = responses[questionId] || '';
      const nextValue = value || '';
      const becameDirty = prevStatus && (prevStatus === 'complete' || prevStatus === 'needs_work') && prevValue !== nextValue;
      if (becameDirty) {
        dispatch(setTextareaDirtyMeta({ questionId, isDirty: true }));
        // Invalidate redux validation so submit-time must revalidate
        dispatch(setValidationStatus({ questionId, status: '' }));
      }
    }

    // Prepare merged snapshot for validation logic
    const newResponses = { ...responses, [questionId]: value };
    if (legacyPersistenceEnabled) queueDraftSave(questionId, newResponses);
    const eventQuestion = getQuestionById(QUESTIONS, questionId);
    let eventType = 'answer_changed';

    if (eventQuestion?.type === 'textarea' || eventQuestion?.type === 'text') {
      eventType = 'text_changed';
    } else if (eventQuestion?.type === 'radio' || eventQuestion?.type === 'checkbox' || eventQuestion?.type === 'yes_no') {
      eventType = 'selection_changed';
    } else if (questionId === '5' || eventQuestion?.type === 'multi_geographic') {
      eventType = 'location_changed';
    } else if (eventQuestion?.type === 'file_upload' || eventQuestion?.type === 'image_tagging') {
      eventType = 'file_changed';
    }

    if (legacyPersistenceEnabled) {
      queueDraftEvent({ eventType, questionId, value });
    }

    const answerMetadata = getSafeAnswerMetadata(
      value,
      newResponses?.[`${questionId}_other`]
    );

    trackClarityEvent('pro_questionnaire_answer_changed', {
      question_id: questionId,
      question_type: q?.type || 'unknown',
      business_domain: credentials.domain || domainParam || 'unknown',
      ...answerMetadata
    });

    // If an auxiliary `_other` field changed, revalidate the owning base question only when `_other` is relevant
    if (questionId.endsWith('_other')) {
      const baseId = questionId.slice(0, -6);
      const baseQuestion = getQuestionById(QUESTIONS, baseId);
      const baseVal = newResponses[baseId];

      const shouldRevalidateBase =
        baseQuestion?.type !== 'radio' ||
        baseVal === 'Other' ||
        (
          baseQuestion?.showOther &&
          baseVal &&
          Array.isArray(baseQuestion.options) &&
          !baseQuestion.options.includes(baseVal)
        );

      if (shouldRevalidateBase) {
        updateQuestionValidation(baseId, baseVal, newResponses);
      }

      // Mark the base question as touched so icons/lists reflect the latest state immediately
      dispatch(setTouchedQuestion({ questionId: baseId, touched: true }));
    } else {
      // Regular path: validate the changed question
      if (!conditionalCleanup) updateQuestionValidation(questionId, value, newResponses);
    }

    // UI feedback + touched state for the specific control that changed
    setShowAutoSave(prev => prev + 1);
    if (!conditionalCleanup) dispatch(setTouchedQuestion({ questionId, touched: true }));
  }, [
    dispatch,
    responses,
    hasTrackedStart,
    validationStatus,
    credentials.domain,
    domainParam,
    queueDraftSave,
    queueDraftEvent,
    legacyPersistenceEnabled,
    uiDraftState,
    dispatchAtomicMutation,
  ]);



  const updateValidationState = (questionId, status) => {
    // Child snapshot after applying this change
    const newStatusSnapshot = { ...validationStatus, [questionId]: status };
    const question = getQuestionById(QUESTIONS, questionId);
    const changed = setValidationStatusIfChanged(questionId, status, validationStatus);

    if (changed) {
      trackClarityEvent('pro_questionnaire_validation_status_changed', {
        question_id: questionId,
        question_type: question?.type || 'unknown',
        validation_status: status,
        business_domain: credentials.domain || domainParam || 'unknown'
      });

      createDraftEvent({
        eventType: 'validation_status_changed',
        questionId,
        value: {
          validation_status: status
        }
      });

      if (status === 'incomplete') {
        trackClarityEvent('pro_questionnaire_validation_failed', {
          question_id: questionId,
          question_type: question?.type || 'unknown',
          validation_status: 'incomplete',
          business_domain: credentials.domain || domainParam || 'unknown'
        });
      }
    }

    // If this is a child question, deterministically update parent using schema
    if (isChildQuestion(questionId)) {
      const parentId = questionId.split('.')[0];
      if (parentId) {
        const parentQuestion = getQuestionById(QUESTIONS, parentId);
        const parentAnswer = responses[parentId];
        const parentNext = computeYesNoParentStatusFromResponses(
          parentQuestion,
          parentAnswer,
          responses,
          newStatusSnapshot
        );
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
          if (!legacyPersistenceEnabled) return;
          // Parent complete and clear ALL child states generically when hidden
          setValidationStatusIfChanged(questionId, 'complete', validationStatus);
          (question.conditionalChildren || []).forEach(child => {
            // Clear validation status, response, touched, expanded
            if ((validationStatus[child.id] || '') !== '') {
              dispatch(setValidationStatus({ questionId: child.id, status: '' }));
            }
            if (responses[child.id] !== undefined) {
              dispatch(deleteResponse(child.id));
            }
            if (touchedQuestions[child.id]) {
              dispatch(setTouchedQuestion({ questionId: child.id, touched: false }));
            }
            if (expandedQuestions[child.id]) {
              dispatch(setExpandedQuestion({ questionId: child.id, expanded: false }));
            }
          });
          return;
        }
        if (value === 'yes') {
          const parentNext = computeYesNoParentStatusFromResponses(
            question,
            value,
            allResponses,
            validationStatus
          );

          const changed = setValidationStatusIfChanged(questionId, parentNext, validationStatus);

          if (changed) {
            try {
              if (devDiagEnabled && devDiagEnabled()) {
                trackParentStatusChange(questionId, parentNext, undefined);
              }
            } catch {}
          }

          break;
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
        const inOptions =
          Array.isArray(question.options) &&
          question.options.includes(value);

        const isOtherSelected =
          question.showOther &&
          (
            value === 'Other' ||
            (value && !inOptions)
          );

        if (!value) {
          newStatus = 'incomplete';
        } else if (isOtherSelected) {
          const otherText = allResponses[`${questionId}_other`];
          newStatus =
            typeof otherText === 'string' && otherText.trim().length > 0
              ? 'complete'
              : 'incomplete';
        } else if (inOptions) {
          newStatus = 'complete';
        } else {
          newStatus = 'incomplete';
        }

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

    updateValidationState(questionId, newStatus);
  };

  const resetQuestion = (questionId) => {
    if (!legacyPersistenceEnabled) {
      const scopePrefix = `question:${questionId}`;
      dispatch(resetQuestionState({
        responseKey: questionId,
        auxiliaryResponseKeys: [`${questionId}_other`, `${questionId}_primary`],
        validationKeys: [questionId],
        touchedKeys: [questionId],
        expandedKeys: [questionId],
        textValidationMetaKeys: [questionId],
        uiDraftScopeKeys: Object.keys(uiDraftState).filter((scope) => (
          scope === scopePrefix || scope.startsWith(`${scopePrefix}:`)
        )),
      }));
      setShowAutoSave(prev => prev + 1);
      return;
    }
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

      trackClarityEvent('pro_questionnaire_question_opened', {
        question_id: questionId,
        question_type: q?.type || 'unknown',
        business_domain: credentials.domain || domainParam || 'unknown'
      });

      createDraftEvent({
        eventType: 'question_opened',
        questionId,
        value: {
          status: 'opened'
        }
      });
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
    setTimeout(() => window.location.reload(), clearAllReloadDelayMs);
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
        const inOptions =
          Array.isArray(question.options) &&
          question.options.includes(answer);

        const isOtherSelected =
          question.showOther &&
          (
            answer === 'Other' ||
            (answer && !inOptions)
          );

        if (!answer) return false;

        if (isOtherSelected) {
          return typeof otherValue === 'string' && otherValue.trim().length > 0;
        }

        return inOptions;
      }
      
      case 'textarea': {
        const status = validationStatus[questionId];
        return status === 'complete';
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
        const meta = textValidationMeta[q.id];
        const isDirty = meta?.isDirty === true;
        if (isDirty || !status || status === '' || status === 'incomplete' || status === 'neutral') {
          needsValidation.push(q.id);
        }
      }
      
      // Check conditional children
      if (q.conditionalChildren && responses[q.id] === 'yes') {
        q.conditionalChildren.forEach(child => {
          if (child.type === 'textarea' && responses[child.id]) {
            const status = validationStatus[child.id];
            const meta = textValidationMeta[child.id];
            const isDirty = meta?.isDirty === true;
            if (isDirty || !status || status === '' || status === 'incomplete' || status === 'neutral') {
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
      const validationResults = await Promise.all(
        questionsToValidate.map(async (qId) => {
          try {
            const questionKey = `question_${qId.replace('.', '_')}`;

            const result = await base44.functions.invoke('validateQuestionText', {
              text: responses[qId],
              questionContext: questionKey
            });

            const status = result.data?.status || 'incomplete';
            updateValidationState(qId, status);

            const isPassingStatus = status === 'complete' || status === 'needs_work';

            dispatch(setTextareaDirtyMeta({
              questionId: qId,
              isDirty: !isPassingStatus,
              lastValidatedValue: responses[qId]
            }));

            return {
              qId,
              status,
              ok: isPassingStatus
            };
          } catch (error) {
            console.error(`Submit-time validation error for Q${qId}:`, error);

            dispatch(setValidationStatus({
              questionId: qId,
              status: 'incomplete'
            }));

            dispatch(setTextareaDirtyMeta({
              questionId: qId,
              isDirty: true,
              lastValidatedValue: responses[qId]
            }));

            return {
              qId,
              status: 'incomplete',
              ok: false,
              error
            };
          }
        })
      );

      setIsValidating(false);
      setValidatingQuestions([]);

      const failedResults = validationResults.filter((result) => !result.ok);

      if (failedResults.length > 0) {
        failedResults.forEach(({ qId, status }) => {
          if (status === 'incomplete') {
            dispatch(setValidationStatus({
              questionId: qId,
              status: 'incomplete'
            }));
          }

          dispatch(setTouchedQuestion({
            questionId: qId,
            touched: true
          }));

          trackClarityEvent('pro_questionnaire_validation_failed', {
            validation_failed_question_id: qId,
            current_question_id: qId,
            validation_status: status || 'incomplete',
            business_domain: credentials.domain || domainParam || 'unknown'
          });

          createDraftEvent({
            eventType: 'validation_status_changed',
            questionId: qId,
            value: {
              validation_status: 'incomplete',
              submit_blocked: true
            }
          });
        });

        toast.error('Please fix the highlighted responses before submitting.');
        return false;
      }

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
    const finalValidationPassed = await runFinalValidations();

    if (!finalValidationPassed) {
      setShowIncompleteList(true);
      return;
    }

    if (isFormValid()) {
      setShowIncompleteList(false);
      setShowConfirmModal(true);
    } else {
      setShowIncompleteList(true);
      toast.error('Please complete all required questions before submitting.');
    }
  };



  const handleConfirmSubmit = async (businessName, domain) => {
    if (finalSubmitInFlightRef.current) {
      if (import.meta.env.DEV) {
        console.warn('[ProQuestionnaire] Final submit blocked — already in flight.');
      }
      return;
    }

    finalSubmitInFlightRef.current = true;
    setIsSubmitting(true);

    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current);
      draftSaveTimeoutRef.current = null;
    }

    try {
      const result = await submitProQuestionnaire({
        businessName,
        domain,
        responses,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        textValidationMeta,
        credentials,
        domainParam,
        questionnaireSessionId,
        browserNamespace,
        browserStorage,
        saveDraftNow,
        createDraftEvent,
        legacyDraftPersistenceEnabled: legacyPersistenceEnabled,
        serviceOptionsGrouped: SERVICE_OPTIONS_GROUPED,
        onFinalSubmitSuccess: ({ responseSnapshot }) => {
          hasFinalSubmittedRef.current = true;

          // Preserve the exact submitted values for post-reset PDF generation.
          const submittedBusinessNameSnapshot = businessName;
          const submittedDomainSnapshot = domain;
          const submittedResponseSnapshot = responseSnapshot;

          setSubmittedBusinessName(submittedBusinessNameSnapshot);
          setSubmittedDomain(submittedDomainSnapshot);
          setSubmittedFormData(submittedResponseSnapshot);
          setShowConfirmModal(false);
          setShowThankYouModal(true);
          if (legacyPersistenceEnabled) dispatch(resetForm());
          toast.success('Questionnaire submitted successfully!');
        },
        onFinalSubmitFailure: () => {}
      });

      return result.savedSubmission;
    } catch (error) {
      const recoveryCode = error?.recoveryCode || questionnaireSessionId || 'unknown-session';
      const userMessage = `We saved your progress, but final submission could not complete.\n\nPlease try submitting again. If it still does not work, send this recovery code to support so we can recover your questionnaire: ${recoveryCode}`;
      toast.error('We saved your progress, but final submission could not complete.');
      error.userMessage = userMessage;
      throw error;
    } finally {
      finalSubmitInFlightRef.current = false;
      if (!hasFinalSubmittedRef.current) {
        setIsSubmitting(false);
      }
    }
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
              questionContext={`question_${String(question.id).replace('.', '_')}`}
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
              questionId={question.id}
              draftCaptureEnabled={draftCaptureEnabled}
              selectedLocations={responses[question.id] || []}
              primaryIndex={responses['5_primary'] || 0}
              onAdd={(location) => {
                const current = responses[question.id] || [];
                const newLocations = [...current, location];
                const min = question.limits?.min || 1;
                const max = question.limits?.max || 5;
                const newStatus = (newLocations.length >= min && newLocations.length <= max) ? 'complete' : 'incomplete';
                if (legacyPersistenceEnabled) {
                  dispatch(setResponse({ questionId: question.id, value: newLocations }));
                  dispatch(setValidationStatus({ questionId: question.id, status: newStatus }));
                } else {
                  dispatchAtomicMutation({
                    setResponses: { [question.id]: newLocations },
                    setValidationStatus: { [question.id]: newStatus },
                    setTouchedQuestions: { [question.id]: true },
                    deleteUiDraftStateKeys: [`question:${question.id}:manual-geographic`],
                  }, 'location_add', 'response_change', question.id);
                }
                setShowAutoSave(s => s + 1);
              }}
              onUpdate={(index, updatedLocation) => {
                const current = responses[question.id] || [];
                const newLocations = [...current];
                newLocations[index] = updatedLocation;
                if (legacyPersistenceEnabled) {
                  dispatch(setResponse({ questionId: question.id, value: newLocations }));
                } else {
                  dispatchAtomicMutation({
                    setResponses: { [question.id]: newLocations },
                    setValidationStatus: {
                      [question.id]: validationStatus[question.id] || 'complete',
                    },
                    setTouchedQuestions: { [question.id]: true },
                  }, 'location_update', 'response_change', question.id);
                }
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
                const min = question.limits?.min || 1;
                const max = question.limits?.max || 5;
                const newStatus = (newLocations.length >= min && newLocations.length <= max) ? 'complete' : 'incomplete';
                if (legacyPersistenceEnabled) {
                  dispatch(setResponse({ questionId: question.id, value: newLocations }));
                  dispatch(setResponse({ questionId: '5_primary', value: primaryIndex }));
                  dispatch(setValidationStatus({ questionId: question.id, status: newStatus }));
                } else {
                  dispatchAtomicMutation({
                    setResponses: {
                      [question.id]: newLocations,
                      '5_primary': newLocations.length === 0 ? 0 : primaryIndex,
                    },
                    setValidationStatus: { [question.id]: newStatus },
                    setTouchedQuestions: { [question.id]: true },
                  }, 'location_remove', 'response_change', question.id);
                }
                setShowAutoSave(s => s + 1);
              }}
              onSetPrimary={(index) => {
                if (legacyPersistenceEnabled) {
                  dispatch(setResponse({ questionId: '5_primary', value: index }));
                } else {
                  dispatchAtomicMutation({
                    setResponses: { '5_primary': index },
                    setValidationStatus: {
                      [question.id]: validationStatus[question.id] || 'complete',
                    },
                    setTouchedQuestions: { [question.id]: true },
                  }, 'location_primary_set', 'response_change', question.id);
                }
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
        return (
          <FileUploadQuestion
            {...commonProps}
            questionId={question.id}
            draftCaptureEnabled={draftCaptureEnabled}
          />
        );
      
      case 'numeric_range':
        return (
          <NumericRangeQuestion
            minValue={question.minValue}
            maxValue={question.maxValue}
            value={responses[question.id]}
            onChange={(val) => updateResponse(question.id, val)}
            questionId={question.id}
            draftCaptureEnabled={draftCaptureEnabled}
          />
        );

      case 'multi_certification':
        return (
          <MultiCertificationQuestion
            value={responses[question.id] || []}
            onChange={(val) => {
              updateResponse(question.id, val);
            }}
            max={question.limits?.max || 20}
            questionId={question.id}
            draftCaptureEnabled={draftCaptureEnabled}
          />
        );

      case 'multi_guarantee':
        return (
          <MultiGuaranteeQuestion
            value={responses[question.id] || []}
            onChange={(val) => {
              updateResponse(question.id, val);
            }}
            max={question.limits?.max || 10}
            questionId={question.id}
            draftCaptureEnabled={draftCaptureEnabled}
          />
        );

              case 'image_tagging':
            return (
              <Suspense fallback={<DeferredSectionLoader />}>
                <ImageTaggingQuestion
                  {...commonProps}
                  questionId={question.id}
                  draftCaptureEnabled={draftCaptureEnabled}
                />
              </Suspense>
            );

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
                          }, expandLinkedQuestionDelayMs);
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
      
      <main className="px-4 sm:px-6 lg:px-6 py-8 md:py-12">
        <div className={standardContentClass}>
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

              {sectionIndex === 0 && !legacyPersistenceEnabled && (
                <ProDraftRecoveryPanel />
              )}

              {sectionQuestions.map((question, qIndex) => {
                // For questions 3-5, render with background wrapper
                if (question.id === "3") {
                  const spanQuestions = sectionQuestions.filter(q => ["3", "4", "5"].includes(q.id));

                  return (
                    <div key="span-questions-wrapper" className={wideContentClass}>
                      <div className={`rounded-lg p-4 -mx-4 sm:-mx-6 lg:mx-0 ${getSpanBackgroundClass()}`}>
                        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_310px] 2xl:grid-cols-[minmax(0,1fr)_340px] lg:gap-5 xl:gap-6 lg:items-stretch">
                          <div className="min-w-0 self-start">
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
                          </div>

                          <aside className="hidden lg:block self-stretch relative">
                            <div className="sticky top-6">
                              <div className="max-h-[calc(100vh-3rem)] overflow-y-auto">
                                <SelectionSpanIndicator
                                  servicesCount={servicesCount}
                                  industriesCount={industriesCount}
                                  regionsCount={regionsCount}
                                  variant="desktopHelper"
                                  showExplainer={true}
                                  showPointer={true}
                                  isCondensed={areAllSpanQuestionsCollapsed}
                                />
                              </div>
                            </div>
                          </aside>
                        </div>

                        <div className="mt-6 lg:hidden">
                          <SelectionSpanIndicator
                            servicesCount={servicesCount}
                            industriesCount={industriesCount}
                            regionsCount={regionsCount}
                            variant="inline"
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

              <Suspense fallback={<DeferredSectionLoader />}>
                <ValidationGuide />
              </Suspense>
              {!legacyPersistenceEnabled && (
                <footer aria-label="Questionnaire draft recovery">
                  <ProDraftRecoveryPanel variant="footer" />
                </footer>
              )}
              </div>
              </div>
              </main>

      <AutoSaveIndicator
        show={legacyPersistenceEnabled ? showAutoSave : Boolean(draftSync.syncStatus?.state)}
        storageMode={questionnairePersistence.storageMode}
        getStorageDiagnostics={questionnairePersistence.getStorageDiagnostics}
        getLocalPersistenceStatus={questionnairePersistence.getLocalPersistenceStatus}
        syncState={legacyPersistenceEnabled ? null : draftSync.syncStatus?.state}
        confirmedServerRevision={draftSync.syncStatus?.confirmedServerRevision}
        lastServerSavedAt={draftSync.lastServerSavedAt}
      />
      <Suspense fallback={null}>
        <ReduxDataValidator />
      </Suspense>

      {showConfirmModal && (
        <Suspense fallback={<DeferredSectionLoader />}>
          <ConfirmModal
            formData={responses}
            onConfirm={handleConfirmSubmit}
            onCancel={() => setShowConfirmModal(false)}
            isSubmitting={isSubmitting}
            initialBusinessName={credentials.businessName || businessNameParam}
            initialDomain={credentials.domain || domainParam}
            confirmationDraft={uiDraftState.confirmationDraft?.data || null}
            onConfirmationDraftChange={(data) => (
              setScopedUiDraft('confirmationDraft', 'confirmation-draft', data)
            )}
            onConfirmationDraftClear={() => {
              if (draftCaptureEnabled) dispatch(clearUiDraftState({ scopeKey: 'confirmationDraft' }));
            }}
          />
        </Suspense>
      )}

      {showThankYouModal && (
        <Suspense fallback={<DeferredSectionLoader />}>
          <ThankYouModal 
            businessName={submittedBusinessName} 
            domain={submittedDomain}
            formData={submittedFormData}
          />
        </Suspense>
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

export default function ProQuestionnaire() {
  const durableDraftV2Enabled = isDurableDraftClientEnabled(frontendRuntimeConfig);

  if (!durableDraftV2Enabled) return <ProQuestionnaireContent />;

  return (
    <ProDraftBootstrapGate runtimeConfig={frontendRuntimeConfig}>
      <ProQuestionnaireContent legacyPersistenceEnabled={false} />
    </ProDraftBootstrapGate>
  );
}
