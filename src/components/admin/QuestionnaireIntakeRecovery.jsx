import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Stethoscope, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProDraftAdminRecoveryShell } from '@/components/admin/ProDraftAdminRecoveryShell';

const formatDate = (value) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : '—';
const parsed = (diagnostic) => diagnostic?.valid ? diagnostic.parsed : null;

function IntakeDetail({ summary, refreshList }) {
  const { api } = useProDraftAdminRecoveryShell();
  const [intake, setIntake] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { const result = await api.getIntake({ intakeId: summary.id }); setIntake(result.intake); }
    catch (caught) { setError(caught?.message || 'Intake detail could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [summary.id]);

  const act = async (mode) => {
    setWorking(mode);
    try {
      const payload = { intakeId: summary.id, questionnaireSessionId: summary.questionnaire_session_id, forceRetry: false };
      const result = mode === 'retry'
        ? await api.retrySubmission(payload)
        : await api.repairSubmission({ ...payload, mode, autoRetry: mode === 'repair_and_retry' });
      if (result.zapierSuppressed) toast.info('Completed; external delivery was suppressed by environment policy.');
      else if (result.zapierRedirected) toast.success('Completed and delivered to the staging destination.');
      else toast.success(mode === 'retry' ? 'Submission retry completed.' : 'Recovery action completed.');
      await load(); refreshList();
    } catch (caught) { toast.error(caught?.message || 'Intake recovery action failed.'); }
    finally { setWorking(''); }
  };

  if (loading) return <div className="border-t p-4 text-sm text-slate-600"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading intake detail…</div>;
  if (error) return <div className="border-t p-4 text-sm text-red-700" role="alert">{error}</div>;
  if (!intake) return null;
  const diagnostics = parsed(intake.jsonDiagnostics?.diagnostics_json);
  const retryError = parsed(intake.jsonDiagnostics?.retry_error_json);
  const report = parsed(intake.jsonDiagnostics?.ai_repair_report_json);

  return <div className="space-y-4 border-t bg-slate-50/70 p-4">
    <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
      <p><strong>Retry count:</strong> {intake.retry_count ?? 0}</p>
      <p><strong>Last retry:</strong> {formatDate(intake.last_retry_at)}</p>
      <p><strong>Intake reason:</strong> {intake.intake_reason || '—'}</p>
      <p><strong>Fallback failure:</strong> {intake.fallback_failure_kind || '—'}</p>
    </div>
    <div className="rounded border bg-white p-3 text-sm">
      <p className="font-medium">Diagnostics summary</p>
      <p>Browser online: {String(diagnostics?.browserOnline ?? 'unknown')}</p>
      <p>Payload size: {diagnostics?.payloadSizeChars ?? '—'}</p>
      <p>Fallback attempted: {String(diagnostics?.fallbackAttempted ?? 'unknown')}</p>
      {retryError?.message ? <p className="text-red-700">Last retry error: {retryError.message}</p> : null}
    </div>
    {intake.ai_repair_status || report ? <div className="rounded border border-indigo-200 bg-indigo-50 p-3 text-sm">
      <p className="font-medium">AI repair status: {intake.ai_repair_status || '—'}</p>
      {report?.decision ? <p>Decision: {report.decision}</p> : null}
      {report?.diagnosis ? <p>Diagnosis: {report.diagnosis}</p> : null}
    </div> : null}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={!!working} onClick={() => act('retry')}><RefreshCw className="h-3 w-3" />Retry Submission</Button>
      <Button size="sm" variant="outline" disabled={!!working} onClick={() => act('diagnose_only')}><Stethoscope className="h-3 w-3" />Diagnose Structure</Button>
      <Button size="sm" variant="outline" disabled={!!working} onClick={() => act('repair_only')}><Wrench className="h-3 w-3" />AI Repair Only</Button>
      <Button size="sm" disabled={!!working} onClick={() => act('repair_and_retry')}><Wrench className="h-3 w-3" />AI Repair + Retry</Button>
    </div>
    <p className="text-xs text-slate-500">AI Repair + Retry can create a final ProFormSubmission if repair succeeds.</p>
    <details className="rounded border bg-white p-3 text-xs"><summary className="cursor-pointer font-medium">Admin diagnostic JSON</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify({ diagnostics, retry_error: retryError, ai_repair_report: report }, null, 2)}</pre></details>
  </div>;
}

function IntakeRow({ intake, expanded, onToggle, refreshList }) {
  return <Card className="overflow-hidden">
    <button type="button" onClick={onToggle} className="w-full p-4 text-left hover:bg-slate-50" aria-expanded={expanded}>
      <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_auto_1fr_1fr_auto]">
        <div><p className="font-medium">{intake.business_name || 'Unnamed business'}</p><p className="text-sm text-slate-500">{intake.business_domain || '—'}</p></div>
        <div><p className="text-xs text-slate-500">Session</p><p className="break-all text-xs">{intake.questionnaire_session_id || '—'}</p></div>
        <Badge>{intake.status || '—'}</Badge>
        <div><p className="text-xs text-slate-500">Created</p><p className="text-sm">{formatDate(intake.created_at_server || intake.created_date)}</p></div>
        <div><p className="text-xs text-slate-500">Linked submission</p><p className="break-all text-xs">{intake.linked_submission_id || '—'}</p></div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </div>
    </button>
    {expanded ? <IntakeDetail summary={intake} refreshList={refreshList} /> : null}
  </Card>;
}

export default function QuestionnaireIntakeRecovery() {
  const { api } = useProDraftAdminRecoveryShell();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('received_intake');
  const [expandedId, setExpandedId] = useState('');
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [history, setHistory] = useState([]);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api.listIntakes({ pageSize: 25, cursor, filters: statusFilter === 'all' ? {} : { status: statusFilter } })
      .then((result) => { if (active) { setRecords(result.items || []); setNextCursor(result.nextCursor || null); } })
      .catch((caught) => { if (active) setError(caught?.message || 'Intake records could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, cursor, refresh, statusFilter]);

  const reset = () => { setCursor(null); setHistory([]); setExpandedId(''); };
  return <Card><CardHeader><CardTitle>Questionnaire Intake Recovery</CardTitle></CardHeader><CardContent className="space-y-4">
    <div className="max-w-xs"><Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); reset(); }}><SelectTrigger aria-label="Intake status filter"><SelectValue /></SelectTrigger><SelectContent>{['all','received_intake','retry_failed','retry_success','submitted'].map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></div>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {loading ? <p className="text-sm text-slate-600">Loading intake records…</p> : null}
    {!loading && !records.length ? <p className="text-sm text-slate-600">No intake records found for this status.</p> : null}
    <div className="space-y-3">{records.map((intake) => <IntakeRow key={intake.id} intake={intake} expanded={expandedId === intake.id} onToggle={() => setExpandedId((id) => id === intake.id ? '' : intake.id)} refreshList={() => setRefresh((value) => value + 1)} />)}</div>
    <div className="flex justify-between"><Button variant="outline" disabled={!history.length || loading} onClick={() => { const copy = [...history]; const previous = copy.pop(); setHistory(copy); setCursor(previous || null); }}>Previous intake page</Button><Button variant="outline" disabled={!nextCursor || loading} onClick={() => { setHistory((values) => [...values, cursor]); setCursor(nextCursor); }}>Next intake page</Button></div>
  </CardContent></Card>;
}
