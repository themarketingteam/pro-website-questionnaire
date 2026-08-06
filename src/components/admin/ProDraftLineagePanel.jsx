import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProDraftAdminRecoveryShell } from '@/components/admin/ProDraftAdminRecoveryShell';

const Summary = ({ label, draft, onNavigate }) => draft ? (
  <div className="rounded border p-3 text-sm"><strong>{label}</strong><p>{draft.business_name || 'Unnamed'} · {draft.status || '—'}</p><p className="break-all text-xs text-slate-500">{draft.id}</p><Button type="button" variant="link" className="h-auto p-0" onClick={() => onNavigate?.(draft.id)}>Open exact draft</Button></div>
) : <div className="rounded border p-3 text-sm text-slate-500">{label}: none</div>;

export default function ProDraftLineagePanel({ draftId, onNavigate }) {
  const { api } = useProDraftAdminRecoveryShell();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; api.getDraftLineage({ draftId }).then((result) => { if (active) setData(result); }).catch((caught) => { if (active) setError(caught?.message || 'Lineage could not be loaded.'); }); return () => { active = false; }; }, [api, draftId]);
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-slate-600">Loading lineage…</p>;
  const statuses = new Set([data.current, ...(data.related || [])].map((draft) => draft?.status));
  const partitionWarning = statuses.has('submitted') && [...statuses].some((status) => status && status !== 'submitted');
  return (
    <section className="space-y-3 rounded-lg border bg-white p-4" aria-label="Draft lineage and duplicate diagnostics">
      <h3 className="font-semibold">Lineage and duplicates</h3>
      <div className="grid gap-3 md:grid-cols-2"><Summary label="Previous draft" draft={data.previous} onNavigate={onNavigate} /><Summary label="Replacement draft" draft={data.replacement} onNavigate={onNavigate} /></div>
      <p className="text-sm">Generation: {data.current?.generation ?? 0}</p>
      <p className="text-sm">Replacement transaction status: {data.transactionStatus || 'standalone'}</p>
      {data.current?.superseded_reason ? <p className="text-sm">Supersession reason: {data.current.superseded_reason}</p> : null}
      {data.current?.superseded_at ? <p className="text-sm">Superseded at: {new Date(data.current.superseded_at).toLocaleString()}</p> : null}
      <p className="text-sm">Selection recommendation: {data.diagnostic?.recommendation || 'review individually'}</p>
      {partitionWarning ? <p className="flex gap-2 rounded bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" />Submitted and active records are separate and must not be merged.</p> : null}
      {(data.related || []).length ? <div><p className="text-sm font-medium">Duplicate candidates</p><ul className="mt-1 space-y-1 text-sm">{data.related.map((draft) => <li key={draft.id}><button className="text-blue-700 underline" type="button" onClick={() => onNavigate?.(draft.id)}>{draft.id}</button> — {draft.status}</li>)}</ul></div> : <p className="text-sm text-slate-500">No duplicate candidates.</p>}
    </section>
  );
}
