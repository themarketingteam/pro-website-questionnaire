import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { store, persistor } from '@/components/store/store';
import { resetForm } from '@/components/store/formSlice';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  async handleResetAndReload() {
    try {
      await persistor.purge();
      store.dispatch(resetForm());
    } catch {
      // no-op; we still try reloading
    } finally {
      // remove any reset flag from URL and hard reload
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('resetFormState');
        window.history.replaceState({}, '', url.toString());
      } catch {}
      try {
        window.location.reload();
      } catch {
        // The bounded error state remains visible if reload is unavailable.
      }
    }
  }

  componentDidCatch() {
    console.error('[ErrorBoundary] A render error was caught.');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-red-50">
          <div className="w-full max-w-xl bg-white border border-red-200 rounded-xl shadow p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-red-700">We hit a problem loading the form</h2>
                <p className="mt-1 text-sm text-slate-700">
                  We hit a problem loading this questionnaire. Your previously saved information
                  has not been intentionally deleted.
                </p>
                <p className="mt-2 text-sm text-slate-700">
                  Reload first. The delete option below permanently clears browser-saved
                  questionnaire state and should only be used if you choose to start over.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => this.handleResetAndReload()}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
              >
                Delete browser-saved questionnaire state & Reload
              </button>
              <button
                type="button"
                onClick={() => {
                  try { window.location.reload(); } catch {}
                }}
                className="flex-1 px-4 py-3 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium"
              >
                Reload without clearing
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
