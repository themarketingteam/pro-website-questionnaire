import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProDraftAdminRecoveryShell } from '@/components/admin/ProDraftAdminRecoveryShell';

export default function ProDraftEventHistory({ draftId, sessionId }) {
  const { api } = useProDraftAdminRecoveryShell();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [eventType, setEventType] = useState('');
  const [showValues, setShowValues] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async ({ append = false, next = null } = {}) => {
    setLoading(true); setError('');
    try {
      const result = await api.listDraftEvents({ draftId, sessionId, pageSize: 25, cursor: next,
        eventTypes: eventType.trim() ? [eventType.trim()] : [], includeValueJson: showValues });
      setItems((current) => append ? [...current, ...(result.items || [])] : (result.items || []));
      setCursor(result.nextCursor || null);
    } catch (caught) { setError(caught?.message || 'Event history could not be loaded.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [draftId, sessionId, eventType, showValues]);

  return (
    <section className="space-y-3 rounded-lg border bg-white p-4" aria-labelledby={`events-${draftId}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 id={`events-${draftId}`} className="font-semibold">Draft event history</h3><p className="text-xs text-slate-500">Safe summaries are shown by default.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Event type filter<Input aria-label="Event type filter" value={eventType} onChange={(e) => setEventType(e.target.value)} className="mt-1 h-8" /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} />Show stored event value</label>
        </div>
      </div>
      {showValues ? <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Stored values may contain client-entered questionnaire content. Authentication and recovery values remain suppressed.</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {loading && !items.length ? <p className="text-sm text-slate-600">Loading events…</p> : null}
      {!loading && !items.length ? <p className="text-sm text-slate-600">No events found.</p> : null}
      <div className="space-y-2">
        {items.map((event) => <article key={event.event_id || event.id} className="rounded border p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{event.event_type || 'event'}</strong><span>{event.created_at_iso || '—'}</span></div>
          <p className="text-slate-600">{event.value_summary || 'No stored summary'} · revision {event.server_revision ?? '—'} · {event.redaction_level || 'unspecified'}</p>
          {showValues && event.value_json ? <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{event.value_json}</pre> : null}
        </article>)}
      </div>
      {cursor ? <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => load({ append: true, next: cursor })}>Load more events</Button> : null}
    </section>
  );
}
