import { useEffect, useMemo, useRef, useState } from 'react';

export const NEW_DRAFT_EMAIL_MESSAGES = Object.freeze({
  success: 'A copy of this new recovery code was sent to your recovery email.',
  staging_redirected: 'The staging email was redirected to the approved internal test inbox.',
  failure: 'The new draft was created, but we could not send the recovery-code email. Copy the code now and save it somewhere secure.',
  no_email: 'No recovery email is associated with this draft. Copy the code now and save it somewhere secure.',
});

export default function NewDraftRecoveryCodeDialog({
  open,
  recoveryCode,
  emailDeliveryState = 'no_email',
  maskedRecoveryEmail = null,
  onAcknowledge,
  onRetryEmail = null,
  rawCodeAvailable = Boolean(recoveryCode),
  retryBackoffMs = 2_000,
  maxRetryAttempts = 1,
}) {
  const dialogRef = useRef(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [lastRetryAt, setLastRetryAt] = useState(0);
  useEffect(() => {
    if (open) dialogRef.current?.focus?.();
  }, [open]);
  const message = NEW_DRAFT_EMAIL_MESSAGES[emailDeliveryState] || NEW_DRAFT_EMAIL_MESSAGES.failure;
  const retryAllowed = useMemo(() => (
    emailDeliveryState === 'failure' && rawCodeAvailable
    && typeof onRetryEmail === 'function' && retryAttempts < maxRetryAttempts
  ), [emailDeliveryState, maxRetryAttempts, onRetryEmail, rawCodeAvailable, retryAttempts]);
  if (!open) return null;
  const copy = async () => {
    if (!recoveryCode) return;
    await globalThis.navigator?.clipboard?.writeText?.(recoveryCode);
    setCopied(true);
  };
  const retry = async () => {
    if (!retryAllowed || retrying) return;
    const elapsed = Date.now() - lastRetryAt;
    if (lastRetryAt && elapsed < retryBackoffMs) return;
    setRetrying(true);
    setLastRetryAt(Date.now());
    setRetryAttempts((value) => value + 1);
    try { await onRetryEmail({ purpose: 'draft_replacement', recoveryCode }); } finally {
      setRetrying(false);
    }
  };
  const canClose = !recoveryCode || acknowledged;
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-draft-code-title"
        aria-describedby="new-draft-code-description"
        tabIndex={-1}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl outline-none sm:rounded-2xl sm:p-6"
      >
        <h2 id="new-draft-code-title" className="text-xl font-semibold text-slate-950">Save your new recovery code</h2>
        <p id="new-draft-code-description" className="mt-3 text-sm leading-6 text-slate-600">
          This code opens only your new blank questionnaire. Keep it somewhere secure.
        </p>
        {recoveryCode ? (
          <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4 text-center">
            <code data-testid="new-draft-recovery-code" className="break-all text-lg font-semibold tracking-wider text-slate-950">{recoveryCode}</code>
            <button type="button" onClick={copy} className="mt-3 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">
              {copied ? 'Copied' : 'Copy recovery code'}
            </button>
          </div>
        ) : (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            The new draft is ready, but the full one-time recovery code is unavailable. Contact support before leaving this page.
          </p>
        )}
        <p role="status" className="mt-4 text-sm leading-6 text-slate-700">
          {message}{maskedRecoveryEmail ? ` (${maskedRecoveryEmail})` : ''}
        </p>
        {retryAllowed && (
          <button type="button" onClick={retry} disabled={retrying} className="mt-3 min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">
            {retrying ? 'Retrying…' : 'Retry email'}
          </button>
        )}
        {recoveryCode && (
          <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-800">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
            <span>I copied or securely saved this new recovery code.</span>
          </label>
        )}
        <div className="mt-5 flex justify-end">
          <button type="button" disabled={!canClose} onClick={onAcknowledge} className="min-h-11 w-full rounded-lg bg-[#1E6BA8] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
            Continue to the new questionnaire
          </button>
        </div>
      </div>
    </div>
  );
}
