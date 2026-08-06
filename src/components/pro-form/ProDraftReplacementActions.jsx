import { useMemo, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { useQuestionnairePersistence } from '@/components/store/QuestionnairePersistenceContext';
import { useProDraftSync } from '@/hooks/useProDraftSync';
import { createProDraftCredentialVault } from '@/lib/proDraftCredentialVault';
import { createProDraftReplacementController } from '@/lib/proDraftReplacementController';
import { frontendRuntimeConfig } from '@/lib/proDraftRuntimeConfig';
import ClearQuestionnaireDialog from './ClearQuestionnaireDialog';
import NewDraftRecoveryCodeDialog from './NewDraftRecoveryCodeDialog';

export default function ProDraftReplacementActions({ mode = 'clear_all' }) {
  const store = useStore();
  const persistence = useQuestionnairePersistence();
  const draftSync = useProDraftSync();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const completedControllerRef = useRef(null);
  const controller = useMemo(() => {
    if (!draftSync.replacementLifecycle || !persistence.storage || !persistence.namespace) return null;
    const credentialVault = createProDraftCredentialVault({
      storage: persistence.storage,
      environment: frontendRuntimeConfig.environment,
      browserNamespace: persistence.namespace,
    });
    return createProDraftReplacementController({
      syncManager: draftSync.replacementLifecycle,
      store,
      storage: persistence.storage,
      namespace: (/** @type {any} */ (store.getState()))?.form?.draftContext?.namespace
        || persistence.namespace,
      credentialVault,
      canonicalCache: persistence.canonicalCacheAdapter,
      localPersistence: persistence.localPersistence,
      environment: frontendRuntimeConfig.environment,
      historyAdapter: globalThis.history,
      onNamespaceChange: persistence.switchDraftRuntime,
    });
  }, [
    draftSync.replacementLifecycle,
    persistence.canonicalCacheAdapter,
    persistence.localPersistence,
    persistence.namespace,
    persistence.storage,
    persistence.switchDraftRuntime,
    store,
  ]);

  const confirm = async () => {
    if (!controller || busy) return;
    setBusy(true);
    setErrorMessage('');
    try {
      const next = mode === 'start_new'
        ? await controller.executeStartNew()
        : await controller.executeClearAll();
      completedControllerRef.current = controller;
      setResult(next);
      setConfirmationOpen(false);
    } catch (error) {
      setErrorMessage(error?.message || 'The new questionnaire could not be created safely.');
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = () => {
    completedControllerRef.current?.acknowledgeRecoveryCode?.();
    completedControllerRef.current = null;
    setResult(null);
    globalThis.requestAnimationFrame?.(() => {
      const firstQuestion = globalThis.document?.querySelector?.(
        '[data-question-id="1"], #question-1',
      );
      if (firstQuestion?.scrollIntoView) firstQuestion.scrollIntoView({ block: 'start' });
      else globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmationOpen(true)}
        disabled={!controller || busy}
        className={mode === 'start_new'
          ? 'min-h-[52px] w-full rounded bg-[#1E6BA8] px-8 py-4 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#185a8d] sm:w-auto'
          : 'min-h-[52px] w-full rounded border-2 border-[#4A5F8C] bg-white px-8 py-4 text-sm font-bold uppercase tracking-wide text-[#4A5F8C] hover:bg-[#F0F2F5] sm:w-auto sm:px-12'}
      >
        {mode === 'start_new' ? 'Start a New Questionnaire' : 'Clear All'}
      </button>
      {errorMessage && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {errorMessage}
        </p>
      )}
      <ClearQuestionnaireDialog
        open={confirmationOpen}
        mode={mode}
        busy={busy}
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={confirm}
      />
      <NewDraftRecoveryCodeDialog
        open={Boolean(result)}
        recoveryCode={result?.recoveryCode || ''}
        emailDeliveryState={result?.emailDeliveryState}
        maskedRecoveryEmail={result?.maskedRecoveryEmail}
        rawCodeAvailable={Boolean(result?.recoveryCode)}
        onAcknowledge={acknowledge}
      />
    </>
  );
}
