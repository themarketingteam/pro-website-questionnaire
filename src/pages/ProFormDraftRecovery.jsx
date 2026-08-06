import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Copy, Loader2, Pencil, RefreshCw, Stethoscope, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DraftEditPanel from '@/components/admin/DraftEditPanel';
import ProDraftEventHistory from '@/components/admin/ProDraftEventHistory';
import ProDraftLineagePanel from '@/components/admin/ProDraftLineagePanel';
import QuestionnaireIntakeRecovery from '@/components/admin/QuestionnaireIntakeRecovery';
import { useProDraftAdminRecoveryShell } from '@/components/admin/ProDraftAdminRecoveryShell';

const SEARCH_MODES = [
  ['draft_id','Draft ID'], ['session_id','Session ID'], ['final_submission_id','Final submission ID'],
  ['recovery_email','Recovery email'], ['business_domain','Domain'],
];
const formatDate = (value) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : '—';

function JsonBlock({ title, value }) {
  if (!value) return null;
  return <details className="rounded border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">{title}</summary><pre className="mt-3 max-h-[32rem] overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100 whitespace-pre-wrap break-words">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></details>;
}

function DraftDetail({ summary, onUpdated, openExactDraft }) {
  const { api } = useProDraftAdminRecoveryShell();
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState('detail');
  const [working, setWorking] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { const result = await api.getDraft({ draftId: summary.id, includeCanonicalState: true, includeCompatibilityJson: true, includeMigrationMetadata: true }); setDraft(result.draft); }
    catch (caught) { setError(caught?.message || 'Draft detail could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [summary.id]);

  const action = async (mode) => {
    setWorking(mode);
    try {
      const result = mode === 'retry'
        ? await api.retrySubmission({ draftId: summary.id, questionnaireSessionId: summary.session_id, forceRetry: false })
        : await api.repairSubmission({ draftId: summary.id, mode, autoRetry: mode === 'repair_and_retry', forceRetry: false });
      if (result.zapierSuppressed) toast.info('Completed; external delivery was suppressed by environment policy.');
      else if (result.zapierRedirected) toast.success('Completed and delivered to the staging destination.');
      else toast.success(mode === 'retry' ? 'Submission retry completed.' : 'AI recovery action completed.');
      await load(); onUpdated?.();
    } catch (caught) { toast.error(caught?.message || 'Administrative action failed.'); }
    finally { setWorking(''); }
  };

  if (loading) return <p className="p-4 text-sm text-slate-600"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading draft detail…</p>;
  if (error) return <p role="alert" className="p-4 text-sm text-red-700">{error}</p>;
  if (!draft) return null;

  return <div className="space-y-4 border-t bg-slate-50/70 p-4">
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant={view === 'detail' ? 'default' : 'outline'} onClick={() => setView('detail')}>Detail</Button>
      <Button type="button" size="sm" variant={view === 'events' ? 'default' : 'outline'} onClick={() => setView('events')}>Events</Button>
      <Button type="button" size="sm" variant={view === 'lineage' ? 'default' : 'outline'} onClick={() => setView('lineage')}>Lineage</Button>
    </div>
    {view === 'events' ? <ProDraftEventHistory draftId={draft.id} sessionId={draft.session_id} /> : null}
    {view === 'lineage' ? <ProDraftLineagePanel draftId={draft.id} onNavigate={openExactDraft} /> : null}
    {view === 'detail' ? <>
      <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-3">
        <p><strong>Status:</strong> {draft.status || '—'}</p><p><strong>Server revision:</strong> {draft.server_revision ?? '—'}</p><p><strong>Client revision:</strong> {draft.client_revision ?? '—'}</p>
        <p><strong>Business:</strong> {draft.business_name || '—'}</p><p><strong>Domain:</strong> {draft.domain || '—'}</p><p><strong>Recovery email:</strong> {draft.recovery_email || '—'} ({draft.recovery_email_verification_status || 'unverified'})</p>
        <p><strong>Final submission:</strong> {draft.final_submission_id || '—'}</p><p><strong>Last saved:</strong> {formatDate(draft.last_saved_at)}</p><p><strong>Retention hold:</strong> {draft.retention_hold ? 'Yes' : 'No'}</p>
      </div>
      {editing ? <DraftEditPanel draft={draft} computedPayload={draft.jsonDiagnostics?.mapped_payload_json?.parsed} onCancel={() => setEditing(false)} onSaved={(updated) => { setDraft(updated); onUpdated?.(); }} /> : null}
      <div className="flex flex-wrap gap-2">
        {!editing ? <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="h-3 w-3" />Edit Draft</Button> : null}
        <Button type="button" size="sm" disabled={!!working} onClick={() => action('retry')}><RefreshCw className="h-3 w-3" />Retry Submission</Button>
        <Button type="button" variant="outline" size="sm" disabled={!!working} onClick={() => action('diagnose_only')}><Stethoscope className="h-3 w-3" />AI Diagnose</Button>
        <Button type="button" variant="outline" size="sm" disabled={!!working} onClick={() => action('repair_only')}><Wrench className="h-3 w-3" />AI Repair Only</Button>
        <Button type="button" size="sm" disabled={!!working} onClick={() => action('repair_and_retry')}><Wrench className="h-3 w-3" />AI Repair + Retry</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(draft.mapped_payload_json || draft.draft_state_json || '{}')}><Copy className="h-3 w-3" />Copy approved payload</Button>
      </div>
      <JsonBlock title="Mapped submission payload" value={draft.mapped_payload_json} />
      <JsonBlock title="Canonical draft state" value={draft.draft_state_json} />
      <JsonBlock title="Raw responses" value={draft.responses_json} />
      <JsonBlock title="AI repair report" value={draft.ai_repair_report_json} />
      {draft.submit_error ? <p className="rounded bg-red-50 p-3 text-sm text-red-700">Submit error: {draft.submit_error}</p> : null}
    </> : null}
  </div>;
}

function DraftRow({ draft, expanded, onToggle, onUpdated, openExactDraft }) {
  return <Card className="overflow-hidden"><button type="button" onClick={onToggle} className="w-full p-4 text-left hover:bg-slate-50" aria-expanded={expanded}>
    <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_auto_1fr_1fr_auto]">
      <div><p className="font-medium">{draft.business_name || 'Unnamed business'}</p><p className="text-sm text-slate-500">{draft.domain || '—'}</p></div>
      <div><p className="text-xs text-slate-500">Session ID</p><p className="break-all text-xs">{draft.session_id || '—'}</p></div>
      <Badge>{draft.status || 'active'}</Badge><div><p className="text-xs text-slate-500">Last saved</p><p className="text-sm">{formatDate(draft.last_saved_at)}</p></div>
      <div><p className="text-xs text-slate-500">Recovery email</p><p className="text-sm">{draft.recovery_email || '—'}</p></div>
      <div className="flex gap-2">{draft.superseded ? <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Superseded draft" /> : null}{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
    </div>
  </button>{expanded ? <DraftDetail summary={draft} onUpdated={onUpdated} openExactDraft={openExactDraft} /> : null}</Card>;
}

export default function ProFormDraftRecovery() {
  const { api } = useProDraftAdminRecoveryShell();
  const [drafts, setDrafts] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); const [environmentFilter, setEnvironmentFilter] = useState('all');
  const [pageSize, setPageSize] = useState(25); const [cursor, setCursor] = useState(null); const [nextCursor, setNextCursor] = useState(null); const [history, setHistory] = useState([]);
  const [searchMode, setSearchMode] = useState('draft_id'); const [searchInput, setSearchInput] = useState(''); const [searchReady, setSearchReady] = useState(true); const [search, setSearch] = useState(null);
  const [expandedId, setExpandedId] = useState(''); const [refresh, setRefresh] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setSearchReady(true), 300); return () => clearTimeout(timer); }, [searchInput]);
  useEffect(() => { let active = true; setLoading(true); setError(''); api.listDrafts({ pageSize, cursor, sort: 'last_saved_at_desc', filters: { ...(statusFilter !== 'all' ? { status: statusFilter } : {}), ...(environmentFilter !== 'all' ? { environment: environmentFilter } : {}) }, ...(search?.value ? { search } : {}) }).then((result) => { if (active) { setDrafts(result.items || []); setNextCursor(result.nextCursor || null); } }).catch((caught) => { if (active) setError(caught?.message || 'Drafts could not be loaded.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [api, cursor, environmentFilter, pageSize, refresh, search, statusFilter]);
  const resetPaging = () => { setCursor(null); setHistory([]); setExpandedId(''); };
  const submitSearch = (event) => { event.preventDefault(); const value = searchInput.trim(); resetPaging(); setSearch(value ? { mode: searchMode, value } : null); };
  const openExactDraft = (id) => { setSearchMode('draft_id'); setSearchInput(id); setSearchReady(true); setSearch({ mode: 'draft_id', value: id }); resetPaging(); };
  return <main className="p-4 md:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <div><h1 className="text-3xl font-bold">Pro Form Draft Recovery</h1><p className="text-slate-600">Backend-authorized draft support, diagnostics, and recovery.</p></div>
    <Card><CardHeader><CardTitle>Server-side filters and exact search</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPaging(); }}><SelectTrigger aria-label="Status filter"><SelectValue /></SelectTrigger><SelectContent>{['all','active','submit_attempted','submit_failed','submitted','cleared_superseded'].map((v) => <SelectItem value={v} key={v}>{v}</SelectItem>)}</SelectContent></Select>
        <Select value={environmentFilter} onValueChange={(v) => { setEnvironmentFilter(v); resetPaging(); }}><SelectTrigger aria-label="Environment filter"><SelectValue /></SelectTrigger><SelectContent>{['all','local','test','staging','production'].map((v) => <SelectItem value={v} key={v}>{v}</SelectItem>)}</SelectContent></Select>
        <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); resetPaging(); }}><SelectTrigger aria-label="Page size"><SelectValue /></SelectTrigger><SelectContent>{[25,50,100].map((v) => <SelectItem key={v} value={String(v)}>{v} per page</SelectItem>)}</SelectContent></Select>
      </div>
      <form onSubmit={submitSearch} className="grid gap-3 sm:grid-cols-[220px_1fr_auto]">
        <Select value={searchMode} onValueChange={setSearchMode}><SelectTrigger aria-label="Search mode"><SelectValue /></SelectTrigger><SelectContent>{SEARCH_MODES.map(([v,l]) => <SelectItem value={v} key={v}>{l}</SelectItem>)}</SelectContent></Select>
        <Input aria-label="Exact search value" value={searchInput} onChange={(e) => { setSearchReady(false); setSearchInput(e.target.value); }} placeholder="Enter an exact value" />
        <Button type="submit" disabled={!searchReady}>Search</Button>
      </form>
    </CardContent></Card>
    <QuestionnaireIntakeRecovery />
    {error ? <Card className="border-red-200"><CardContent className="p-4 text-red-700" role="alert">{error}</CardContent></Card> : null}
    {loading ? <Card><CardContent className="p-6">Loading drafts…</CardContent></Card> : null}
    {!loading && !drafts.length ? <Card><CardContent className="p-6">No matching drafts found.</CardContent></Card> : null}
    <div className="space-y-3">{drafts.map((draft) => <DraftRow key={draft.id} draft={draft} expanded={expandedId === draft.id} onToggle={() => setExpandedId((id) => id === draft.id ? '' : draft.id)} onUpdated={() => setRefresh((v) => v + 1)} openExactDraft={openExactDraft} />)}</div>
    <div className="flex justify-between"><Button type="button" variant="outline" disabled={!history.length || loading} onClick={() => { const copy = [...history]; const previous = copy.pop(); setHistory(copy); setCursor(previous || null); }}>Previous page</Button><Button type="button" variant="outline" disabled={!nextCursor || loading} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(nextCursor); }}>Next page</Button></div>
  </div></main>;
}
