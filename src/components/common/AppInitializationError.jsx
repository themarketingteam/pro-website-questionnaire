import { AlertTriangle, RefreshCw, RotateCw } from 'lucide-react';

const safeReload = () => {
  try {
    if (typeof window === 'undefined' || typeof window?.location?.reload !== 'function') {
      return false;
    }
    window.location.reload();
    return true;
  } catch {
    return false;
  }
};

export default function AppInitializationError({ onRetry }) {
  const retry = () => {
    try {
      if (typeof onRetry === 'function') {
        onRetry();
        return;
      }
    } catch {
      // Reload remains available as a separate safe recovery action.
    }
    safeReload();
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-xl rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              We could not initialize the questionnaire
            </h1>
            <p className="mt-2 text-sm text-slate-700">
              Your previously saved information has not been intentionally deleted. This can be
              caused by a temporary connection or application-configuration problem.
            </p>
            <p className="mt-2 text-sm text-slate-700">
              Try again or reload the page. If the problem continues, contact support and mention
              that the questionnaire could not initialize.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={retry}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-3 font-medium text-white hover:bg-blue-800"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
          <button
            type="button"
            onClick={safeReload}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-3 font-medium text-white hover:bg-slate-800"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Reload page
          </button>
        </div>
      </section>
    </main>
  );
}
