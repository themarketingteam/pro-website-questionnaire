import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ClearQuestionnaireDialog from '@/components/pro-form/ClearQuestionnaireDialog';
import NewDraftRecoveryCodeDialog from '@/components/pro-form/NewDraftRecoveryCodeDialog';
import '@/index.css';

const params = new URLSearchParams(globalThis.location.search);
const sourceStatus = params.get('status') === 'submitted' ? 'submitted' : 'active';
const delivery = params.get('delivery') || 'success';
const partial = params.get('partial') === 'true';
const memoryOnly = params.get('memory') === 'true';
const stateKey = `e2e-replacement:${sourceStatus}:${delivery}:${partial}:${memoryOnly}`;
const clientBKey = 'e2e-replacement:client-b';
const initial = {
  currentDraftId: 'draft-old-a',
  namespace: 'namespace-old-a',
  sourceStatus,
  sourceRetained: true,
  answer: sourceStatus === 'submitted' ? 'Submitted answer' : 'Old active answer',
  recoverySelection: 'draft-old-a',
  code: null,
  oldCredentialsPresent: true,
  staleSaveApplied: false,
  hardReloads: 0,
};

const read = () => {
  if (memoryOnly) return initial;
  try { return JSON.parse(localStorage.getItem(stateKey)) || initial; } catch { return initial; }
};

function Harness() {
  const [state, setState] = useState(read);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(Boolean(read().code));
  const [busy, setBusy] = useState(false);
  const [historyView, setHistoryView] = useState('current');
  useEffect(() => {
    if (!memoryOnly) localStorage.setItem(stateKey, JSON.stringify(state));
    localStorage.setItem(clientBKey, JSON.stringify({ answer: 'Client B untouched' }));
  }, [state]);
  useEffect(() => {
    const pop = () => setHistoryView(state.sourceStatus === 'submitted' ? 'submitted' : 'superseded');
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, [state.sourceStatus]);

  const replace = async () => {
    if (busy) return;
    setBusy(true);
    await Promise.resolve();
    history.replaceState({ draftId: 'draft-old-a', readOnly: true }, '');
    history.pushState({ draftId: 'draft-new-a', readOnly: false }, '');
    setState((current) => ({
      ...current,
      currentDraftId: 'draft-new-a',
      namespace: 'namespace-new-a',
      answer: '',
      sourceStatus: current.sourceStatus === 'submitted' ? 'submitted' : 'cleared_superseded',
      recoverySelection: 'draft-new-a',
      code: 'ABCD-EFGH-JKMP',
      oldCredentialsPresent: current.sourceStatus === 'submitted',
      partialRecovered: partial,
      staleSaveApplied: false,
    }));
    setConfirmOpen(false);
    setCodeOpen(true);
    setBusy(false);
  };

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1>Draft replacement synthetic harness</h1>
      <p data-testid="draft-id">{state.currentDraftId}</p>
      <p data-testid="namespace">{state.namespace}</p>
      <p data-testid="source-status">{state.sourceStatus}</p>
      <p data-testid="source-retained">{String(state.sourceRetained)}</p>
      <p data-testid="old-credentials">{String(state.oldCredentialsPresent)}</p>
      <p data-testid="recovery-selection">{state.recoverySelection}</p>
      <p data-testid="storage-mode">{memoryOnly ? 'memory_only' : 'indexeddb'}</p>
      <p data-testid="partial-recovered">{String(state.partialRecovered === true)}</p>
      <p data-testid="stale-save-applied">{String(state.staleSaveApplied)}</p>
      <p data-testid="hard-reloads">{String(state.hardReloads)}</p>
      <p data-testid="history-view">{historyView}</p>
      <label>Question 1<input aria-label="Question 1" value={state.answer} onChange={(event) => setState((current) => ({ ...current, answer: event.target.value }))} /></label>
      <button type="button" onClick={() => setConfirmOpen(true)}>
        {sourceStatus === 'submitted' ? 'Start a New Questionnaire' : 'Clear All'}
      </button>
      <ClearQuestionnaireDialog
        open={confirmOpen}
        mode={sourceStatus === 'submitted' ? 'start_new' : 'clear_all'}
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={replace}
      />
      <NewDraftRecoveryCodeDialog
        open={codeOpen}
        recoveryCode={state.code}
        emailDeliveryState={delivery}
        maskedRecoveryEmail="o****@example.com"
        onAcknowledge={() => setCodeOpen(false)}
      />
      <output data-testid="client-b">{JSON.parse(localStorage.getItem(clientBKey) || '{}').answer}</output>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
