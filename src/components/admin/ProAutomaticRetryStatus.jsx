import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
const date = value => value ? new Date(value).toLocaleString(undefined, { timeZone: 'America/Chicago' }) : '—';
const message = value => { try { return JSON.parse(value || '{}').message || ''; } catch { return ''; } };
export default function ProAutomaticRetryStatus({ recordType = 'draft', recordId, recoveryGrant }) {
  const [state, setState] = useState({ jobs: [], error: '', loading: true });
  useEffect(() => {
    let active = true;
    if (!recordId) { setState({ jobs: [], error: 'This historical version has no linked retry source.', loading: false }); return undefined; }
    setState({ jobs: [], error: '', loading: true });
    base44.functions.invoke('queryProQuestionnaireRecoveryRecords', { action: 'retry_jobs', recordType, recordId, recoveryGrant })
      .then(response => { if (active) setState({ jobs: response?.data?.jobs || [], error: '', loading: false }); })
      .catch(() => { if (active) setState({ jobs: [], error: 'Automatic retry status could not be loaded.', loading: false }); });
    return () => { active = false; };
  }, [recordType, recordId, recoveryGrant]);
  return <section aria-label="Automatic submission retries" className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
    <h3 className="font-semibold">Automatic submission retries</h3>
    {state.loading ? <p className="mt-2 text-slate-600">Loading retry status…</p> : state.error ? <p className="mt-2 text-amber-800">{state.error}</p> : state.jobs.length === 0 ? <p className="mt-2 text-slate-600">No automatic retry is queued for this questionnaire.</p> : state.jobs.slice(0, 3).map(job => <div key={job.id} className="mt-3 space-y-1 border-t border-slate-100 pt-3">
      <p><strong>Status:</strong> {String(job.status || '').replaceAll('_', ' ')} · {job.stage === 'delivery' ? 'Webhook delivery' : 'Final submission'}</p>
      <p><strong>Next retry:</strong> {date(job.next_retry_at)} {job.next_retry_at ? '(America/Chicago)' : ''}</p>
      <p><strong>Attempts:</strong> {job.attempt_count || 0} · <strong>Last attempt:</strong> {date(job.last_attempt_at)}</p>
      {message(job.last_error_json) && <p className="text-amber-900">{message(job.last_error_json)}</p>}
      {job.status === 'delivery_unknown' && <p className="text-amber-900">Delivery may already have been accepted. Automatic resending is held for your team to review.</p>}
    </div>)}
  </section>;
}
