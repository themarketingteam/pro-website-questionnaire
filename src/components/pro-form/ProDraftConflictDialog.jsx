import { useEffect, useMemo, useRef, useState } from 'react';
import { useProDraftConflict } from '@/contexts/ProDraftConflictContext';

const titleId = 'pro-draft-conflict-title';
const descriptionId = 'pro-draft-conflict-description';

const safeFieldLabel = (fieldPath) => {
  const text = String(fieldPath || 'Answer').replace(/[._-]+/gu, ' ').trim();
  return text ? text.replace(/\b\w/gu, (letter) => letter.toUpperCase()) : 'Answer';
};

export default function ProDraftConflictDialog({ controller = null }) {
  const contextController = useProDraftConflict();
  const {
    isOpen,
    conflicts,
    applyChoices,
    cancelAndKeepReviewing,
  } = controller || contextController;
  const [choices, setChoices] = useState({});
  const [applying, setApplying] = useState(false);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const conflictKey = useMemo(
    () => conflicts.map((conflict) => conflict.conflictId).join('|'),
    [conflicts],
  );

  useEffect(() => setChoices({}), [conflictKey]);
  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = globalThis.document?.activeElement;
    dialogRef.current?.focus();
    return () => previousFocusRef.current?.focus?.();
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelAndKeepReviewing();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll?.(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) || [])];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = globalThis.document?.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.document?.addEventListener?.('keydown', onKeyDown);
    return () => globalThis.document?.removeEventListener?.('keydown', onKeyDown);
  }, [cancelAndKeepReviewing, isOpen]);

  if (!isOpen) return null;
  const complete = conflicts.every((conflict) => Boolean(choices[conflict.conflictId]));
  const submit = async () => {
    if (!complete || applying) return;
    setApplying(true);
    try { await applyChoices(choices); } finally { setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl outline-none sm:max-w-2xl sm:rounded-2xl sm:p-7"
      >
        <h2 id={titleId} className="text-xl font-semibold text-slate-950">
          We found changes from another browser tab
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">
          Some answers were changed in more than one place. Review the conflicting answers before we save again.
        </p>
        <div className="mt-6 space-y-5">
          {conflicts.map((conflict) => (
            <fieldset key={conflict.conflictId} className="rounded-xl border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-900">
                {safeFieldLabel(conflict.fieldPath)}
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {[
                  ['keep_local', 'This browser', conflict.localPreview],
                  ['keep_server', 'Other saved version', conflict.serverPreview],
                ].map(([choice, label, preview]) => (
                  <label key={choice} className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-[#1E6BA8] has-[:checked]:bg-blue-50">
                    <input
                      type="radio"
                      name={conflict.conflictId}
                      value={choice}
                      checked={choices[conflict.conflictId] === choice}
                      onChange={() => setChoices((current) => ({
                        ...current, [conflict.conflictId]: choice,
                      }))}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">{label}</span>
                      <span className="mt-1 block break-words text-sm text-slate-600">
                        {preview || 'Value hidden for security'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={cancelAndKeepReviewing}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800"
          >
            Cancel and keep reviewing
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!complete || applying}
            className="rounded-lg bg-[#1E6BA8] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply my choices
          </button>
        </div>
      </div>
    </div>
  );
}
