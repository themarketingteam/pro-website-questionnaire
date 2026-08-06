import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { CheckCircle2, AlertCircle, Database } from 'lucide-react';
import { QUESTIONS } from '@/components/pro-form/questionData';
import { getAllQuestionIds, getQuestionById } from '@/components/pro-form/questionUtils';
import { useQuestionnairePersistence } from '@/components/store/QuestionnairePersistenceContext';

/** @param {any} state */
const selectValidatorForm = (state) => state?.form || {};

export default function ReduxDataValidator() {
  const isDev = import.meta.env.DEV;
  const questionnairePersistence = useQuestionnairePersistence();

  // Check if redux-data=true is in URL
  const urlParams = new URLSearchParams(window.location.search);
  const isEnabled = urlParams.get('redux-data') === 'true';
  
  const [isVisible, setIsVisible] = useState(false);
  const [validationResults, setValidationResults] = useState(null);
  
  const formState = useSelector(selectValidatorForm);
  const responses = formState.responses;
  const validationStatus = formState.validationStatus;
  const touchedQuestions = formState.touchedQuestions;
  const expandedQuestions = formState.expandedQuestions;
  const credentials = formState.credentials;
  
  // Global hotkey — stable listener; actual validation runs in the reactive effect below
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isEnabled) return;
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        setIsVisible(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEnabled]);

  // When panel is visible or data changes, (re)run validation using latest state
  useEffect(() => {
    if (isEnabled && isVisible) {
      runValidation();
    }
  }, [isEnabled, isVisible, responses, validationStatus, touchedQuestions, expandedQuestions, credentials]);

  const runValidation = () => {
    const results = {
      timestamp: new Date().toISOString(),
      checks: []
    };

    // Check 1: Redux state structure
    results.checks.push({
      name: 'Redux Store Structure',
      passed: !!(responses && validationStatus && touchedQuestions && expandedQuestions && credentials),
      details: 'All required Redux slices are present'
    });

    // Check 2: Responses object
    const responsesCount = Object.keys(responses || {}).length;
    results.checks.push({
      name: 'Responses Storage',
      passed: responsesCount >= 0,
      details: `${responsesCount} question responses stored`
    });

    // Check 3: Validation status
    const validationCount = Object.keys(validationStatus || {}).length;
    results.checks.push({
      name: 'Validation Status',
      passed: validationCount >= 0,
      details: `${validationCount} validation statuses tracked`
    });

    // Check 4: Touched questions
    const touchedCount = Object.keys(touchedQuestions || {}).length;
    results.checks.push({
      name: 'Touched Questions',
      passed: touchedCount >= 0,
      details: `${touchedCount} questions have been interacted with`
    });

    // Check 5: Expanded questions
    const expandedCount = Object.keys(expandedQuestions || {}).length;
    results.checks.push({
      name: 'Expanded Questions State',
      passed: expandedCount >= 0,
      details: `${expandedCount} question states tracked`
    });

    // Check 6: Credentials
    const hasCredentials = credentials && Object.keys(credentials).length > 0;
    results.checks.push({
      name: 'Credentials Storage',
      passed: hasCredentials || true, // Optional
      details: hasCredentials ? `${Object.keys(credentials).length} credential fields stored` : 'No credentials stored (optional)'
    });

    // Check 7: scoped adapter durability. Do not inspect persisted answer bytes.
    try {
      const diagnostics = questionnairePersistence.getStorageDiagnostics?.();
      const storageMode = diagnostics?.storageMode
        || questionnairePersistence.storageMode
        || 'unknown';
      const durable = Boolean(diagnostics?.durable ?? questionnairePersistence.durable);
      results.checks.push({
        name: 'Scoped Browser Persistence',
        passed: durable,
        details: durable
          ? `Scoped adapter mode: ${storageMode}`
          : `Page-only or unavailable adapter mode: ${storageMode}`
      });
    } catch {
      results.checks.push({
        name: 'Scoped Browser Persistence',
        passed: false,
        details: 'Safe persistence diagnostics unavailable'
      });
    }

    // Check 8: Complex data types
    const hasArrayData = Object.values(responses || {}).some(val => Array.isArray(val));
    const hasObjectData = Object.values(responses || {}).some(val => val && typeof val === 'object' && !Array.isArray(val));
    results.checks.push({
      name: 'Complex Data Types',
      passed: true,
      details: `Arrays: ${hasArrayData ? '✓' : '✗'}, Objects: ${hasObjectData ? '✓' : '✗'}`
    });

    // Check 9: Data integrity
    const hasInvalidData = Object.entries(responses || {}).some(([key, val]) => {
      return val === null || val === undefined;
    });
    results.checks.push({
      name: 'Data Integrity',
      passed: !hasInvalidData,
      details: hasInvalidData ? 'Found null/undefined values' : 'All data valid'
    });

    // Check 10: Specific question types
    const questionTypeChecks = [];
    if (responses['3'] && Array.isArray(responses['3'])) {
      questionTypeChecks.push('Q3 (checkbox array) ✓');
    }
    if (responses['5'] && Array.isArray(responses['5'])) {
      questionTypeChecks.push('Q5 (geo locations) ✓');
    }
    if (responses['2.2'] && typeof responses['2.2'] === 'object') {
      questionTypeChecks.push('Q2.2 (image tagging) ✓');
    }
    if (responses['12.1'] && Array.isArray(responses['12.1'])) {
      questionTypeChecks.push('Q12.1 (certifications) ✓');
    }
    if (responses['14.1'] && Array.isArray(responses['14.1'])) {
      questionTypeChecks.push('Q14.1 (guarantees) ✓');
    }
    
    results.checks.push({
      name: 'Question Type Samples',
      passed: questionTypeChecks.length > 0 || Object.keys(responses || {}).length === 0,
      details: questionTypeChecks.length > 0 ? questionTypeChecks.join(', ') : 'No complex question data yet'
    });

    // New hardening checks
    const allIds = getAllQuestionIds(QUESTIONS);

    // A) Radio main values validity (invalid if not in options and not 'Other')
    const invalidRadios = [];
    allIds.forEach((id) => {
      const q = getQuestionById(QUESTIONS, id);
      if (!q || q.type !== 'radio') return;
      const val = responses?.[id];
      if (val == null || val === '') return; // empty not flagged here
      const opts = q.options || [];
      const showOther = !!q.showOther;
      const isValid = opts.includes(val) || (showOther && val === 'Other');
      if (!isValid) invalidRadios.push(`Q${id}='${String(val)}'`);
    });
    results.checks.push({
      name: 'Radio Main Values Valid',
      passed: invalidRadios.length === 0,
      details: invalidRadios.length === 0 ? 'All radio values valid' : `Invalid radios: ${invalidRadios.join(', ')}`
    });

    // B) Hidden child questions must not have active validation
    const hiddenValidated = [];
    QUESTIONS.forEach((parent) => {
      if (!Array.isArray(parent.conditionalChildren)) return;
      const parentVal = responses?.[parent.id];
      if (parentVal === 'yes') return;
      parent.conditionalChildren.forEach((child) => {
        const vs = validationStatus?.[child.id];
        if (vs && vs !== '') hiddenValidated.push(child.id);
      });
    });
    results.checks.push({
      name: 'Hidden Children Have No Active Validation',
      passed: hiddenValidated.length === 0,
      details: hiddenValidated.length === 0 ? 'OK' : `Has active status: ${hiddenValidated.join(', ')}`
    });

    // C) Legacy certification mirrors absent
    const legacyFieldsPresent = [];
    ['1.2', '1.2.1'].forEach((k) => {
      if (responses && Object.prototype.hasOwnProperty.call(responses, k)) legacyFieldsPresent.push(`responses.${k}`);
      if (validationStatus && Object.prototype.hasOwnProperty.call(validationStatus, k)) legacyFieldsPresent.push(`validationStatus.${k}`);
      if (touchedQuestions && Object.prototype.hasOwnProperty.call(touchedQuestions, k)) legacyFieldsPresent.push(`touchedQuestions.${k}`);
      if (expandedQuestions && Object.prototype.hasOwnProperty.call(expandedQuestions, k)) legacyFieldsPresent.push(`expandedQuestions.${k}`);
    });
    results.checks.push({
      name: 'Legacy Certification Fields Removed',
      passed: legacyFieldsPresent.length === 0,
      details: legacyFieldsPresent.length === 0 ? 'No legacy fields present' : `Found: ${legacyFieldsPresent.join(', ')}`
    });

    // D) Shared radio names across different question containers (DOM scan)
    const sharedRadioNames = (() => {
      try {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const map = new Map(); // name -> Set(containerId)
        radios.forEach((el) => {
          const name = el.getAttribute('name') || '';
          const container = el.closest('[id^="question-"]');
          const containerId = container?.id || 'unknown';
          if (!map.has(name)) map.set(name, new Set());
          map.get(name).add(containerId);
        });
        const offenders = [];
        map.forEach((set, name) => {
          if (set.size > 1) offenders.push(name);
        });
        // Also flag any default 'radio' name usage
        if (Array.from(map.keys()).includes('radio')) offenders.push('radio');
        return offenders;
      } catch (e) {
        return [];
      }
    })();
    results.checks.push({
      name: 'No Shared Radio Group Names',
      passed: sharedRadioNames.length === 0,
      details: sharedRadioNames.length === 0 ? 'All radio groups isolated' : `Shared names: ${sharedRadioNames.join(', ')}`
    });

    setValidationResults(results);

    if (import.meta.env.DEV) {
      console.log('========================================');
      console.log('🔍 REDUX DATA VALIDATION REPORT');
      console.log('========================================');
      console.log('Timestamp:', results.timestamp);
      console.log('');
      results.checks.forEach(check => {
        console.log(check.passed ? '✅' : '❌', check.name);
        console.log('   └─', check.details);
      });
      console.log('');
      console.log('Response count:', Object.keys(responses).length);
      console.log('Validation status count:', Object.keys(validationStatus).length);
      console.log('Touched question count:', Object.keys(touchedQuestions).length);
      console.log('Expanded question count:', Object.keys(expandedQuestions).length);
      console.log('Credentials summary:', {
        hasBusinessName: Boolean(credentials?.businessName),
        hasDomain: Boolean(credentials?.domain),
        hasUserId: Boolean(credentials?.userId),
        hasUserEmail: Boolean(credentials?.userEmail)
      });

      console.log('========================================');
    }
  };

  if (!isDev || !isEnabled) {
    return null;
  }

  if (!isVisible) {
    return (
      <button
        onClick={() => {
          setIsVisible(true);
        }}
        className="fixed bottom-4 right-4 z-[9999] p-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg transition-all"
        title="Data Validator (Ctrl+Shift+V)"
      >
        <Database className="w-5 h-5" />
      </button>
    );
  }

  const allPassed = validationResults?.checks?.every(c => c.passed) ?? false;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] bg-white rounded-xl shadow-2xl border-2 border-purple-200 max-w-md w-full max-h-[600px] overflow-auto">
      <div className="sticky top-0 bg-purple-600 text-white p-4 flex items-center justify-between rounded-t-xl">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5" />
          <h3 className="font-bold">Redux Data Validator</h3>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="text-white hover:text-purple-200 transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="p-4">
        <div className={`flex items-center gap-2 mb-4 p-3 rounded-lg ${
          allPassed ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'
        }`}>
          {allPassed ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="font-semibold">All checks passed!</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <span className="font-semibold">Some checks need attention</span>
            </>
          )}
        </div>

        <div className="space-y-2 mb-4">
          {validationResults?.checks.map((check, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border ${
                check.passed 
                  ? 'bg-green-50 border-green-200' 
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-start gap-2">
                {check.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900">{check.name}</div>
                  <div className="text-xs text-gray-600 mt-1 break-words">{check.details}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={runValidation}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Re-run Validation
          </button>
          <button
            onClick={() => {
              console.clear();
              runValidation();
            }}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Clear Console
          </button>
        </div>

        <div className="mt-3 text-xs text-gray-500 text-center">
          Press <kbd className="px-2 py-1 bg-gray-200 rounded">Ctrl+Shift+V</kbd> to toggle
        </div>
      </div>
    </div>
  );
}
