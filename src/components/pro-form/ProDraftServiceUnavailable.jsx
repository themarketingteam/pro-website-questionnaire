import { useState } from 'react';

const RECOVERY_PATH = '/recover-draft';

export default function ProDraftServiceUnavailable({
  recoveryCode = '',
  onRetry = undefined,
  onOpenRecovery = undefined,
  clipboard = globalThis.navigator?.clipboard,
}) {
  const [copyStatus, setCopyStatus] = useState('idle');
  const canCopyRecoveryCode = typeof recoveryCode === 'string' && recoveryCode.length > 0;

  const retry = () => {
    if (typeof onRetry === 'function') {
      onRetry();
      return;
    }
    globalThis.location?.reload?.();
  };

  const copyRecoveryCode = async () => {
    if (!canCopyRecoveryCode || typeof clipboard?.writeText !== 'function') {
      setCopyStatus('error');
      return;
    }
    try {
      await clipboard.writeText(recoveryCode);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <section
        aria-labelledby="draft-service-unavailable-title"
        className="mx-auto max-w-2xl rounded-lg border border-amber-300 bg-white p-6 shadow-sm sm:p-8"
      >
        <h1
          id="draft-service-unavailable-title"
          className="text-2xl font-bold text-slate-900"
        >
          Questionnaire Saving Is Temporarily Unavailable
        </h1>
        <p className="mt-4 text-slate-700">
          Your information saved in this browser has not been intentionally deleted. Please keep this page open or return using your recovery code after service is restored.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Editing and new server writes are paused while durable questionnaire saving is unavailable.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={retry}
            className="min-h-11 rounded bg-[#1E6BA8] px-5 py-3 font-semibold text-white hover:bg-[#175783]"
          >
            Retry
          </button>
          {typeof onOpenRecovery === 'function' ? (
            <button
              type="button"
              onClick={onOpenRecovery}
              className="min-h-11 rounded border border-[#1E6BA8] px-5 py-3 font-semibold text-[#1E6BA8]"
            >
              Open Draft Recovery
            </button>
          ) : (
            <a
              href={RECOVERY_PATH}
              className="inline-flex min-h-11 items-center justify-center rounded border border-[#1E6BA8] px-5 py-3 font-semibold text-[#1E6BA8]"
            >
              Open Draft Recovery
            </a>
          )}
          {canCopyRecoveryCode && (
            <button
              type="button"
              onClick={copyRecoveryCode}
              className="min-h-11 rounded border border-slate-400 px-5 py-3 font-semibold text-slate-800"
            >
              Copy Recovery Code
            </button>
          )}
        </div>

        <p role="status" aria-live="polite" className="mt-4 text-sm text-slate-700">
          {copyStatus === 'copied' && 'Recovery code copied.'}
          {copyStatus === 'error' && 'Recovery code could not be copied. Please try again.'}
        </p>
      </section>
    </main>
  );
}
