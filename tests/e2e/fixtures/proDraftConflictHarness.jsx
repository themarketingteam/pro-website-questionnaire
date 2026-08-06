import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProDraftConflictDialog from '@/components/pro-form/ProDraftConflictDialog';
import {
  DRAFT_MERGE_RESULTS,
  applyConflictChoices,
  mergeCanonicalDraftStates,
} from '@/lib/proDraftConflictMerge';
import { createProDraftTabCoordinator } from '@/lib/proDraftTabCoordinator';
import { createEmptyCanonicalDraftState } from '@/lib/questionnaireDraftState';
import '@/index.css';

const parameters = new URLSearchParams(globalThis.location.search);
const draftKey = parameters.get('draft') || 'synthetic-draft-a';
const tabName = parameters.get('tab') || 'tab-a';
const storageKey = `e2e-conflict-server:${draftKey}`;
const namespace = `ns_e2e_${draftKey.replace(/[^A-Za-z0-9_-]/gu, '')}`;

const emptyState = () => ({
  ...createEmptyCanonicalDraftState(),
  draftId: draftKey,
  sessionId: `session-${draftKey}`,
  responses: {},
});

const readServer = () => {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : emptyState();
  } catch {
    return emptyState();
  }
};

const writeServer = (state) => {
  globalThis.localStorage.setItem(storageKey, JSON.stringify(state));
};

function Harness() {
  const initial = useMemo(readServer, []);
  const baseRef = useRef(initial);
  const [local, setLocal] = useState(initial);
  const [pendingMerge, setPendingMerge] = useState(null);
  const [status, setStatus] = useState('ready');
  const [acceptedRevision, setAcceptedRevision] = useState(initial.serverRevision);
  const coordinator = useMemo(() => createProDraftTabCoordinator({
    namespace,
    sourceTabId: `tab_${tabName.replace(/[^A-Za-z0-9_.:-]/gu, '')}`,
  }), []);

  useEffect(() => {
    coordinator.start();
    const unsubscribe = coordinator.subscribe((message) => {
      if (message.type === 'server_revision_accepted') {
        setAcceptedRevision(message.serverRevision);
      }
      if (message.type === 'draft_submitted') setStatus('submitted-elsewhere');
    });
    return () => { unsubscribe(); coordinator.stop(); };
  }, [coordinator]);

  const edit = (questionId, value) => setLocal((current) => ({
    ...current,
    clientRevision: current.clientRevision + 1,
    responses: { ...current.responses, [questionId]: value },
    currentQuestionId: questionId,
    lastChangedQuestionId: questionId,
  }));

  const accept = (state) => {
    const currentServer = readServer();
    const accepted = {
      ...state,
      serverRevision: currentServer.serverRevision + 1,
      draftStatus: currentServer.draftStatus === 'submitted' ? 'submitted' : state.draftStatus,
    };
    writeServer(accepted);
    baseRef.current = accepted;
    setLocal(accepted);
    setAcceptedRevision(accepted.serverRevision);
    setStatus(accepted.draftStatus === 'submitted' ? 'submitted' : 'saved');
    coordinator.broadcast({
      type: accepted.draftStatus === 'submitted' ? 'draft_submitted' : 'server_revision_accepted',
      serverRevision: accepted.serverRevision,
      clientRevision: accepted.clientRevision,
      status: accepted.draftStatus === 'submitted' ? 'submitted' : 'saved',
    });
  };

  const save = async () => {
    const server = readServer();
    const merge = await mergeCanonicalDraftStates({
      localState: local,
      serverState: server,
      baseState: baseRef.current,
    });
    if (merge.result === DRAFT_MERGE_RESULTS.USER_CHOICE_REQUIRED) {
      setPendingMerge(merge);
      setStatus('conflict');
      return;
    }
    if (merge.result === DRAFT_MERGE_RESULTS.SERVER_WINS && server.draftStatus === 'submitted') {
      baseRef.current = server;
      setLocal(server);
      setStatus('submitted');
      return;
    }
    accept(merge.mergedState);
  };

  const submit = () => accept({ ...local, draftStatus: 'submitted' });
  const applyChoices = async (choices) => {
    const applied = await applyConflictChoices(pendingMerge, choices);
    setPendingMerge(null);
    accept(applied.mergedState);
  };

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Synthetic draft conflict harness</h1>
      <p data-testid="status">{status}</p>
      <p data-testid="accepted-revision" data-accepted-revision={acceptedRevision}>
        Revision {acceptedRevision}
      </p>
      {['qA', 'qB'].map((questionId) => (
        <label key={questionId} className="block">
          <span>{questionId}</span>
          <input
            data-testid={`answer-${questionId}`}
            value={local.responses[questionId] || ''}
            onChange={(event) => edit(questionId, event.target.value)}
            className="mt-1 block w-full border p-2"
          />
        </label>
      ))}
      <div className="flex gap-2">
        <button type="button" data-testid="save" onClick={save}>Save</button>
        <button type="button" data-testid="submit" onClick={submit}>Submit</button>
        <button type="button" data-testid="reload-server" onClick={() => setLocal(readServer())}>
          Reload server
        </button>
      </div>
      <pre data-testid="server-state">{JSON.stringify(readServer().responses)}</pre>
      <ProDraftConflictDialog controller={{
        isOpen: Boolean(pendingMerge),
        conflicts: pendingMerge?.conflicts || [],
        applyChoices,
        cancelAndKeepReviewing: () => setPendingMerge(null),
      }} />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
