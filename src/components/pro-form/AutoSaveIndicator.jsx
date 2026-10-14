import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Loader2 } from 'lucide-react';
import { getDraftReturnUrl } from '@/lib/sessionId';

export default function AutoSaveIndicator({
  show,
  status = 'idle',
  lastSavedAt = '',
  lastConfirmedRevision = 0,
  hasLocalRecoveryCopy = null
}) {
  const activeStatus = ['pending', 'saving', 'retrying', 'error'].includes(status);
  const [visible, setVisible] = useState(activeStatus);
  const [copied, setCopied] = useState(false);
  const isTestMode = import.meta.env.MODE === 'test';

  useEffect(() => {
    if (['pending', 'saving', 'retrying', 'error'].includes(status)) {
      setVisible(true);
      return undefined;
    }
    if (status !== 'saved' || !show) return undefined;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), isTestMode ? 0 : 4500);
    return () => clearTimeout(timer);
  }, [show, status, isTestMode]);

  const copyReturnLink = async () => {
    try {
      await navigator.clipboard.writeText(getDraftReturnUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), isTestMode ? 0 : 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!visible) return null;

  const isSaving = status === 'saving';
  const isPending = status === 'pending';
  const isRetrying = status === 'retrying';
  const isError = status === 'error';
  const savedTime = lastSavedAt && Number.isFinite(Date.parse(lastSavedAt))
    ? new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <div
      className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm border shadow-lg rounded-xl px-4 py-3 z-50 bg-white ${
        isError ? 'border-amber-300' : 'border-slate-200'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-none ${
          isError ? 'bg-amber-100' : 'bg-blue-100'
        }`}>
          {isSaving || isPending || isRetrying ? (
            <Loader2 className="w-4 h-4 text-blue-700 animate-spin" />
          ) : isError ? (
            <AlertTriangle className="w-4 h-4 text-amber-700" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-blue-700" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 text-sm">
            {isPending
              ? 'Waiting to save…'
              : isRetrying
                ? 'Retrying secure backup…'
                : isSaving
                  ? 'Saving answers…'
                  : isError
                    ? 'Unable to save'
                    : 'Database backup confirmed'}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            {isPending
              ? 'Your latest change is queued and has not been confirmed by the database yet.'
              : isRetrying
                ? hasLocalRecoveryCopy
                  ? 'The database has not confirmed this change yet. A temporary browser copy is retained while automatic retries continue.'
                  : 'The database has not confirmed this change, and browser storage is unavailable. Keep this page open while retries continue.'
                : isError
              ? hasLocalRecoveryCopy
                ? 'The database has not confirmed this change. A temporary browser copy is retained; keep this page open and edit any answer to try again.'
                : 'The database has not confirmed this change, and this browser blocked the temporary backup. Keep this page open and edit any answer to try again.'
              : `Saved securely to the database${savedTime ? ` at ${savedTime}` : ''}.`}
          </p>
          {!isSaving && !isPending && !isRetrying && !isError && lastConfirmedRevision > 0 && (
            <p className="mt-1 text-[11px] text-slate-500">Confirmed revision {lastConfirmedRevision}</p>
          )}
          {!isSaving && !isPending && !isRetrying && !isError && (
            <button
              type="button"
              onClick={copyReturnLink}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E6BA8] hover:text-[#154f7d]"
            >
              <Link2 className="w-3.5 h-3.5" />
              {copied ? 'Return link copied' : 'Copy return link for another device'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
