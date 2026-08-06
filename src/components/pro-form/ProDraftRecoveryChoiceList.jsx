import ProDraftRecoveryChoiceCard from './ProDraftRecoveryChoiceCard';

export default function ProDraftRecoveryChoiceList({
  choices = [],
  loading = false,
  error = '',
  selectingDraftId = null,
  onSelect,
}) {
  return (
    <section
      aria-busy={loading || Boolean(selectingDraftId)}
      aria-labelledby="pro-draft-choice-heading"
      data-testid="pro-draft-recovery-choice-list"
      className="space-y-4"
    >
      <div>
        <h2 id="pro-draft-choice-heading" className="text-xl font-bold text-slate-900">
          Recover a different questionnaire
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose from questionnaires authorized by your successful email recovery.
        </p>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-slate-700">
        {loading && 'Loading authorized questionnaire choices…'}
        {!loading && selectingDraftId && 'Opening the selected questionnaire…'}
        {!loading && !selectingDraftId && !error && choices.length === 0
          && 'No other eligible questionnaires are available.'}
      </p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!loading && choices.length > 0 && (
        <div className="grid gap-3">
          {choices.map((choice) => (
            <ProDraftRecoveryChoiceCard
              key={choice.draftId}
              choice={choice}
              disabled={Boolean(selectingDraftId)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}
