import { ClipboardList, Loader2, TriangleAlert, X } from 'lucide-react';

export function StartFreshWarningModal({ onCancel, onConfirm, isWorking = false }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-fresh-warning-title"
        aria-describedby="start-fresh-warning-description"
        className="w-full max-w-3xl overflow-hidden rounded-[28px] bg-white shadow-2xl"
      >
        <div className="flex items-center gap-4 border-b border-slate-200 px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-50 sm:h-16 sm:w-16">
            <TriangleAlert aria-hidden="true" className="h-8 w-8 text-red-600 sm:h-9 sm:w-9" strokeWidth={2.25} />
          </div>
          <h2 id="start-fresh-warning-title" className="min-w-0 flex-1 text-2xl font-bold tracking-tight text-[#0D172B] sm:text-3xl">
            Start a completely new client?
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isWorking}
            aria-label="Close and return to the questionnaire"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E6BA8] disabled:opacity-50"
          >
            <X aria-hidden="true" className="h-7 w-7" />
          </button>
        </div>

        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <p id="start-fresh-warning-description" className="text-lg leading-8 text-[#34445F] sm:text-[22px] sm:leading-[1.55]">
            This creates an entirely new client card and a separate blank server draft. It does not delete the current client or their saved answers. To clear answers while staying with this client, cancel and use Clear All Answers beside the Submit button.
          </p>
        </div>

        <div className="grid gap-3 border-t border-slate-200 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <button
            type="button"
            onClick={onCancel}
            disabled={isWorking}
            className="min-h-[56px] rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E6BA8] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isWorking}
            className="flex min-h-[56px] items-center justify-center rounded-xl bg-[#E5242A] px-5 py-3 text-base font-bold text-white shadow-sm transition-colors hover:bg-[#C91F25] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5242A] disabled:cursor-wait disabled:opacity-65"
          >
            {isWorking ? (
              <>
                <Loader2 aria-hidden="true" className="mr-2 h-5 w-5 animate-spin" />
                Confirming current draft…
              </>
            ) : 'Create New Client & Start Fresh'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NewClientIdentityModal({
  identity,
  onChange,
  onSkip,
  onSave,
  isSaving = false
}) {
  const canSave = Boolean(identity.businessName.trim()) && !isSaving;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-client-identity-title"
        aria-describedby="new-client-identity-description"
        className="w-full max-w-3xl overflow-hidden rounded-[28px] bg-white shadow-2xl"
      >
        <div className="flex items-start gap-4 border-b border-slate-200 px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-100 sm:h-16 sm:w-16">
            <ClipboardList aria-hidden="true" className="h-8 w-8 text-[#255BC7] sm:h-9 sm:w-9" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h2 id="new-client-identity-title" className="text-2xl font-bold tracking-tight text-[#0D172B] sm:text-3xl">
              New client draft created
            </h2>
            <p id="new-client-identity-description" className="mt-2 text-base leading-7 text-[#4A5B75] sm:text-lg">
              Add the client identity now, or skip and complete it later when you submit.
            </p>
          </div>
        </div>

        <div className="space-y-5 px-6 py-7 sm:px-10 sm:py-9">
          <label className="block text-base font-bold text-[#1C2940]">
            Business Name
            <input
              autoFocus
              type="text"
              value={identity.businessName}
              onChange={(event) => onChange({ ...identity, businessName: event.target.value })}
              className="mt-2.5 min-h-[54px] w-full rounded-xl border-2 border-slate-300 px-4 py-3 font-normal text-slate-900 outline-none transition focus:border-[#255BC7] focus:ring-4 focus:ring-blue-100"
            />
          </label>
          <label className="block text-base font-bold text-[#1C2940]">
            Website Domain <span className="font-normal text-slate-500">(optional)</span>
            <input
              type="text"
              value={identity.domain}
              onChange={(event) => onChange({ ...identity, domain: event.target.value })}
              placeholder="example.com"
              className="mt-2.5 min-h-[54px] w-full rounded-xl border border-slate-300 px-4 py-3 font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#255BC7] focus:ring-4 focus:ring-blue-100"
            />
          </label>
        </div>

        <div className="grid gap-3 border-t border-slate-200 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <button
            type="button"
            onClick={onSkip}
            disabled={isSaving}
            className="min-h-[56px] rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-bold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#255BC7] disabled:opacity-50"
          >
            Skip for Now
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="flex min-h-[56px] items-center justify-center rounded-xl bg-[#255BC7] px-5 py-3 text-base font-bold text-white transition-colors hover:bg-[#1E4FAA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#255BC7] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSaving ? (
              <>
                <Loader2 aria-hidden="true" className="mr-2 h-5 w-5 animate-spin" />
                Saving…
              </>
            ) : 'Save & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
