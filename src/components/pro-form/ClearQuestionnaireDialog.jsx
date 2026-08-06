import { useEffect, useRef } from 'react';

export default function ClearQuestionnaireDialog({
  open,
  onCancel,
  onConfirm,
  busy = false,
  mode = 'clear_all',
}) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const startNew = mode === 'start_new';
  useEffect(() => {
    if (!open) return undefined;
    const previous = globalThis.document?.activeElement;
    cancelRef.current?.focus?.();
    const keydown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel?.();
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll?.('button:not([disabled])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && globalThis.document?.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document?.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.document?.addEventListener?.('keydown', keydown);
    return () => {
      globalThis.document?.removeEventListener?.('keydown', keydown);
      (/** @type {any} */ (previous))?.focus?.();
    };
  }, [busy, onCancel, open]);
  if (!open) return null;
  const title = startNew ? 'Create a new questionnaire?' : 'Start over with a new questionnaire?';
  const body = startNew
    ? 'Your submitted questionnaire will remain unchanged. A separate blank questionnaire and new recovery code will be created.'
    : 'Your current draft will be archived for support and will no longer be the draft automatically opened with your email. A brand-new blank draft and recovery code will be created.';
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-questionnaire-title"
        aria-describedby="clear-questionnaire-description"
        className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"
      >
        <h2 id="clear-questionnaire-title" className="text-xl font-semibold text-slate-950">{title}</h2>
        <p id="clear-questionnaire-description" className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
        {!startNew && (
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
            This clears questionnaire information stored by this website for the current draft. It does not erase your browser history.
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-11 rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {busy ? 'Creating…' : (startNew ? 'Start a New Questionnaire' : 'Create a new blank draft')}
          </button>
        </div>
      </div>
    </div>
  );
}
