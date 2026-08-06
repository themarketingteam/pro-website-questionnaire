import { formatSafeDraftStatus, formatSafeSavedTime } from '@/lib/proDraftDisplaySafety';

export default function ProDraftRecoveryChoiceCard({
  choice,
  disabled = false,
  onSelect,
}) {
  const created = formatSafeSavedTime(choice?.createdAt);
  const saved = formatSafeSavedTime(choice?.lastSavedAt);
  const status = formatSafeDraftStatus(choice?.status, { readOnly: choice?.readOnly });

  return (
    <article
      data-testid="pro-draft-recovery-choice-card"
      className={`rounded-xl border p-4 ${
        choice?.isCurrentSelection ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h3 className="break-words font-semibold text-slate-900">
            {choice?.businessNameDisplay || 'Questionnaire draft'}
          </h3>
          <dl className="grid gap-1 text-sm text-slate-600">
            {created && <div><dt className="inline font-medium">Created:</dt> <dd className="inline">{created}</dd></div>}
            {saved && <div><dt className="inline font-medium">Last saved:</dt> <dd className="inline">{saved}</dd></div>}
            <div><dt className="inline font-medium">Status:</dt> <dd className="inline">{status}</dd></div>
          </dl>
          {choice?.isCurrentSelection && (
            <p className="text-sm font-medium text-blue-800">Current selection</p>
          )}
        </div>
        <button
          type="button"
          disabled={disabled || choice?.isCurrentSelection}
          onClick={() => onSelect?.(choice?.draftId)}
          className="min-h-11 shrink-0 rounded-lg bg-[#1E6BA8] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {choice?.isCurrentSelection ? 'Currently open' : 'Open this questionnaire'}
        </button>
      </div>
    </article>
  );
}
