import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useProDraftCredentials } from '@/contexts/ProDraftCredentialContext';
import { useQuestionnairePersistence } from '@/components/store/QuestionnairePersistenceContext';
import {
  formatSafeDraftStatus,
  formatSafeSavedTime,
  getRecoveryCodeDisplayState,
  maskRecoveryEmail,
} from '@/lib/proDraftDisplaySafety';

const storageLabel = (mode) => ({
  indexeddb: 'Persistent browser storage available',
  localstorage: 'Persistent browser storage available',
  memory_only: 'Page memory only — copy the recovery code before closing',
  unavailable: 'Persistent browser storage unavailable',
}[mode] || 'Browser storage status unavailable');

const syncLabel = (state) => ({
  local_saving: 'Saving in this browser',
  local_saved: 'Saved in this browser',
  server_saving: 'Saving securely',
  server_saved: 'Saved securely',
  offline_local_only: 'Offline — browser copy is waiting to sync',
  retrying: 'Secure sync is retrying',
  conflict: 'Changes from another tab require review',
  error: 'Secure save has not been confirmed',
  superseded: 'This draft was replaced',
}[state] || null);

export default function ProDraftRecoveryPanel({ variant = 'primary' }) {
  const form = useSelector((state) => (/** @type {any} */ (state))?.form || {});
  const persistence = useQuestionnairePersistence();
  const credentials = useProDraftCredentials();
  const [copyStatus, setCopyStatus] = useState('');
  const codeState = getRecoveryCodeDisplayState({
    fullCode: credentials.getRecoveryCodeForDisplay(),
    hint: credentials.getRecoveryCodeHint(),
  });
  const maskedEmail = maskRecoveryEmail(form.credentials?.recoveryEmail);
  const draftStatus = form.draftContext?.draftStatus;
  const sync = form.draftSyncStatus || {};
  const readOnly = draftStatus === 'submitted' || sync.state === 'submitted';
  const credentialMode = credentials.getCredentialStorageMode();
  const mode = credentialMode && credentialMode !== 'unknown'
    ? credentialMode
    : (persistence.storageMode || 'unknown');

  const copyCode = async () => {
    if (!codeState.canCopy || !codeState.fullCode) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(codeState.fullCode);
      setCopyStatus('Recovery code copied');
    } catch {
      setCopyStatus('Copy was not available. Select and copy the recovery code manually.');
    }
  };

  if (variant === 'footer') {
    return (
      <details
        data-testid="pro-draft-recovery-footer"
        className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm"
      >
        <summary className="cursor-pointer font-semibold text-slate-900">
          Draft recovery information
        </summary>
        <div className="mt-3 space-y-2 text-slate-700">
          <p>{formatSafeDraftStatus(draftStatus, { readOnly })}</p>
          <p>{storageLabel(mode)}</p>
          <Link className="inline-flex min-h-11 items-center font-medium text-blue-700 underline" to="/recover-draft">
            Open draft recovery page
          </Link>
        </div>
      </details>
    );
  }

  return (
    <aside
      aria-labelledby="draft-recovery-heading"
      data-testid="pro-draft-recovery-panel"
      className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5"
    >
      <div className="space-y-4">
        <div>
          <h2 id="draft-recovery-heading" className="text-lg font-bold text-slate-900">Draft recovery</h2>
          <p className="mt-1 text-sm text-slate-700">
            Keep this information somewhere safe so you can return to this questionnaire.
          </p>
        </div>

        <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          {maskedEmail && <div><dt className="font-medium">Recovery email</dt><dd>{maskedEmail}</dd></div>}
          <div><dt className="font-medium">Draft status</dt><dd>{formatSafeDraftStatus(draftStatus, { readOnly })}</dd></div>
          {syncLabel(sync.state) && (
            <div><dt className="font-medium">Sync status</dt><dd>{syncLabel(sync.state)}</dd></div>
          )}
          <div><dt className="font-medium">Browser storage</dt><dd>{storageLabel(mode)}</dd></div>
          {formatSafeSavedTime(sync.lastLocalSavedAt) && (
            <div><dt className="font-medium">Last browser save</dt><dd>{formatSafeSavedTime(sync.lastLocalSavedAt)}</dd></div>
          )}
          {formatSafeSavedTime(sync.lastServerSavedAt) && (
            <div><dt className="font-medium">Last secure save</dt><dd>{formatSafeSavedTime(sync.lastServerSavedAt)}</dd></div>
          )}
        </dl>

        {codeState.mode === 'full' && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-900">Recovery code</p>
            <code
              aria-label="Recovery code"
              className="block select-all overflow-x-auto rounded-lg border border-blue-300 bg-white p-3 text-center font-mono font-bold tracking-wide text-slate-900"
            >
              {codeState.fullCode}
            </code>
            <button
              type="button"
              onClick={copyCode}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2 font-medium text-blue-800"
            >
              {copyStatus === 'Recovery code copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              Copy recovery code
            </button>
          </div>
        )}
        {codeState.mode === 'hint' && (
          <p className="rounded-lg bg-white p-3 text-sm text-slate-700">
            Recovery code ending: <span className="font-mono font-semibold">{codeState.hint}</span>
          </p>
        )}
        {codeState.mode === 'unavailable' && (
          <p className="rounded-lg bg-white p-3 text-sm text-slate-700">
            The full recovery code is not available in this browser.
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-slate-700">{copyStatus}</p>

        <nav aria-label="Draft recovery actions" className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1E6BA8] px-4 py-2 font-medium text-white" to="/recover-draft">
            Recover a different questionnaire
          </Link>
          <Link className="inline-flex min-h-11 items-center justify-center px-4 py-2 font-medium text-blue-700 underline" to="/recover-draft">
            Open draft recovery page
          </Link>
        </nav>
      </div>
    </aside>
  );
}
