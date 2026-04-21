import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { store, persistor } from '@/components/store/store';
import { resetForm } from '@/components/store/formSlice';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  async handleResetAndReload() {
    try {
      await persistor.purge();
      store.dispatch(resetForm());
    } catch (e) {
      // no-op; we still try reloading
    } finally {
      // remove any reset flag from URL and hard reload
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('resetFormState');
        window.history.replaceState({}, '', url.toString());
      } catch {}
      window.location.reload();
    }
  }

  componentDidCatch(error, errorInfo) {
    // You can log to an error reporting service here
    // Save details for dev display
    this.setState({ error, errorInfo });
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const isDev = (() => {
        try { return import.meta && import.meta.env && import.meta.env.DEV; } catch { return false; }
      })();

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-red-50">
          <div className="w-full max-w-xl bg-white border border-red-200 rounded-xl shadow p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-red-700">We hit a problem loading the form</h2>
                <p className="mt-1 text-sm text-slate-700">
                  Your saved questionnaire data may be corrupted. You can reset it and reload to continue.
                </p>
              </div>
            </div>

            {isDev && (
              <div className="mt-4 p-3 rounded bg-slate-900 text-slate-100 text-xs overflow-auto max-h-60">
                <div className="font-semibold mb-1">Dev details:</div>
                {this.state.error && (
                  <pre className="whitespace-pre-wrap">
                    {String(this.state.error.stack || this.state.error.toString())}
                  </pre>
                )}
                {this.state.errorInfo?.componentStack && (
                  <pre className="whitespace-pre-wrap opacity-80 mt-2">{this.state.errorInfo.componentStack}</pre>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => this.handleResetAndReload()}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
              >
                Reset saved questionnaire state & Reload
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
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