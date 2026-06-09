import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ChevronDown, ChevronUp, Loader2, Copy, Stethoscope, Wrench, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const statusStyles = {
  received_intake: 'bg-amber-100 text-amber-800',
  retry_failed: 'bg-red-100 text-red-700',
  retry_success: 'bg-green-100 text-green-700',
  submitted: 'bg-slate-100 text-slate-700'
};

const aiStatusStyles = {
  diagnosed: 'bg-blue-100 text-blue-700',
  repair_ready: 'bg-indigo-100 text-indigo-700',
  retry_success: 'bg-green-100 text-green-700',
  retry_failed: 'bg-red-100 text-red-700',
  needs_human_review: 'bg-amber-100 text-amber-800',
  running: 'bg-slate-100 text-slate-600'
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const parseJson = (value) => {
  try {
    if (!value) return null;
    if (typeof value === 'object') return value;
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const copyText = async (text, label) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Copy failed');
  }
};

function AiRepairSection({ intake }) {
  const report = parseJson(intake.ai_repair_report_json);
  const repairError = parseJson(intake.ai_repair_error_json);
  const retryResult = parseJson(intake.ai_repair_retry_result_json);

  if (!intake.ai_repair_status && !report) return null;

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
      <p className="text-sm font-semibold text-indigo-900">AI Repair Status</p>

      <div className="grid gap-2 md:grid-cols-2 text-sm">
        {intake.ai_repair_status && (
          <p><span className="font-medium">Status:</span>{' '}
            <Badge className={aiStatusStyles[intake.ai_repair_status] || 'bg-slate-100 text-slate-700'}>
              {intake.ai_repair_status}
            </Badge>
          </p>
        )}
        {intake.last_ai_repair_at && (
          <p><span className="font-medium">Last Repair:</span> {formatDate(intake.last_ai_repair_at)}</p>
        )}
        {intake.ai_repair_attempt_count != null && (
          <p><span className="font-medium">Attempt Count:</span> {intake.ai_repair_attempt_count}</p>
        )}
        <p><span className="font-medium">Repair Applied:</span> {intake.ai_repair_applied ? '✓ Yes' : 'No'}</p>
        <p><span className="font-medium">Retry Attempted:</span> {intake.ai_repair_retry_attempted ? '✓ Yes' : 'No'}</p>
      </div>

      {report && (
        <div className="space-y-2 text-sm">
          <p><span className="font-medium">Decision:</span> <code className="bg-white px-1 rounded">{report.decision}</code></p>
          <p><span className="font-medium">Confidence:</span> {typeof report.confidence === 'number' ? `${Math.round(report.confidence * 100)}%` : '—'}</p>
          {report.diagnosis && <p><span className="font-medium">Diagnosis:</span> {report.diagnosis}</p>}
          {Array.isArray(report.repair_summary) && report.repair_summary.length > 0 && (
            <div>
              <p className="font-medium">Repair Summary:</p>
              <ul className="ml-3 list-disc text-slate-700">
                {report.repair_summary.slice(0, 10).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(report.changed_paths) && report.changed_paths.length > 0 && (
            <div>
              <p className="font-medium">Changed Paths ({report.changed_paths.length}):</p>
              <ul className="ml-3 list-disc text-slate-700 text-xs">
                {report.changed_paths.slice(0, 15).map((cp, i) => (
                  <li key={i}><code>{cp.path}</code>: {cp.before_type} → {cp.after_type} ({cp.reason})</li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(report.warnings) && report.warnings.length > 0 && (
            <div>
              <p className="font-medium text-amber-700">Warnings ({report.warnings.length}):</p>
              <ul className="ml-3 list-disc text-amber-700 text-xs">
                {report.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {repairError && (
        <div className="text-xs text-red-700 bg-red-50 rounded p-2">
          <span className="font-semibold">Repair Error:</span> {repairError.message || JSON.stringify(repairError)}
        </div>
      )}

      {retryResult && (
        <div className="text-xs rounded p-2 bg-white border">
          <span className="font-semibold">Retry Result:</span> {retryResult.linkedSubmissionId ? `Submission: ${retryResult.linkedSubmissionId}` : (retryResult.message || JSON.stringify(retryResult))}
        </div>
      )}

      {intake.ai_repair_report_json && (
        <details className="text-xs">
          <summary className="cursor-pointer text-indigo-700 font-medium">Raw AI report JSON</summary>
          <pre className="mt-2 bg-white rounded p-2 overflow-auto max-h-60 whitespace-pre-wrap break-words text-slate-700">
            {JSON.stringify(report, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function IntakeRow({ intake, expanded, onToggle, onRetry, retrying, onAiAction, aiRunning }) {
  const diagnostics = parseJson(intake.diagnostics_json);
  const retryError = parseJson(intake.retry_error_json);

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full text-left hover:bg-slate-50 transition-colors">
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[1.1fr_1fr_1.1fr_auto_1fr_1fr] items-start">
            <div>
              <p className="font-medium text-slate-900">{intake.business_name || 'Unnamed business'}</p>
              <p className="text-sm text-slate-500 break-all">{intake.business_domain || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Session</p>
              <p className="text-xs text-slate-900 break-all">{intake.questionnaire_session_id || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Created</p>
              <p className="text-sm text-slate-900">{formatDate(intake.created_at_server || intake.created_date)}</p>
            </div>
            <div className="space-y-1">
              <Badge className={statusStyles[intake.status] || 'bg-slate-100 text-slate-700'}>{intake.status || '—'}</Badge>
              {intake.ai_repair_status && (
                <Badge className={aiStatusStyles[intake.ai_repair_status] || 'bg-slate-100 text-slate-600'}>
                  AI: {intake.ai_repair_status}
                </Badge>
              )}
            </div>
            <div>
              <p className="text-sm text-slate-500">Primary Failure</p>
              <p className="text-sm text-slate-900">{intake.primary_failure_kind || '—'}</p>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-500">Linked Submission</p>
                <p className="text-xs text-slate-900 break-all">{intake.linked_submission_id || '—'}</p>
              </div>
              {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 mt-1" /> : <ChevronDown className="w-4 h-4 text-slate-500 mt-1" />}
            </div>
          </div>
        </CardContent>
      </button>

      {expanded && (
        <div className="border-t bg-slate-50/70 p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <p><span className="font-medium">Retry Count:</span> {intake.retry_count ?? 0}</p>
            <p><span className="font-medium">Last Retry:</span> {formatDate(intake.last_retry_at)}</p>
            <p><span className="font-medium">Intake Reason:</span> {intake.intake_reason || '—'}</p>
            <p><span className="font-medium">Fallback Failure:</span> {intake.fallback_failure_kind || '—'}</p>
          </div>

          <div className="rounded-lg border bg-white p-3 text-sm space-y-1">
            <p className="font-medium text-slate-900">Diagnostics Summary</p>
            <p className="text-slate-600">Browser online: {String(diagnostics?.browserOnline ?? 'unknown')}</p>
            <p className="text-slate-600">Payload size: {diagnostics?.payloadSizeChars ?? '—'}</p>
            <p className="text-slate-600">Fallback attempted: {String(diagnostics?.fallbackAttempted ?? 'unknown')}</p>
            {retryError?.message ? <p className="text-red-700">Last retry error: {retryError.message}</p> : null}
          </div>

          {/* AI Repair status panel */}
          <AiRepairSection intake={intake} />

          {/* Action buttons */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</p>
            <div className="flex flex-wrap gap-2">
              {/* Existing retry */}
              <Button
                size="sm"
                onClick={() => onRetry(intake)}
                disabled={retrying || aiRunning}
                className="gap-2"
              >
                {retrying ? <><Loader2 className="w-3 h-3 animate-spin" /> Retrying...</> : <><RefreshCw className="w-3 h-3" /> Retry Submission</>}
              </Button>

              {/* AI Diagnose */}
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                disabled={retrying || aiRunning}
                onClick={() => onAiAction(intake, 'diagnose_only')}
              >
                {aiRunning === 'diagnose_only' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stethoscope className="w-3 h-3" />}
                AI Diagnose
              </Button>

              {/* AI Repair Only */}
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                disabled={retrying || aiRunning}
                onClick={() => onAiAction(intake, 'repair_only')}
              >
                {aiRunning === 'repair_only' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                AI Repair Only
              </Button>

              {/* AI Repair + Retry — clearly labeled as creates submission */}
              <Button
                size="sm"
                className="gap-2 bg-indigo-700 hover:bg-indigo-800 text-white"
                disabled={retrying || aiRunning}
                onClick={() => onAiAction(intake, 'repair_and_retry')}
                title="This will attempt to create a final ProFormSubmission if repair succeeds"
              >
                {aiRunning === 'repair_and_retry' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                AI Repair + Retry ⚡
              </Button>
            </div>
            <p className="text-xs text-slate-400">⚡ AI Repair + Retry will create a final ProFormSubmission if repair succeeds.</p>
          </div>

          <details className="rounded-lg border bg-white p-3 text-xs">
            <summary className="cursor-pointer font-medium text-slate-800">Admin raw JSON</summary>
            <pre className="mt-3 overflow-auto max-h-80 whitespace-pre-wrap break-words text-slate-700">{JSON.stringify({
              id: intake.id,
              questionnaire_session_id: intake.questionnaire_session_id,
              status: intake.status,
              linked_submission_id: intake.linked_submission_id,
              diagnostics,
              retry_error: retryError
            }, null, 2)}</pre>
          </details>
        </div>
      )}
    </Card>
  );
}

export default function QuestionnaireIntakeRecovery() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('received_intake');
  const [expandedId, setExpandedId] = useState('');
  const [retryingId, setRetryingId] = useState('');
  // aiRunningId: { id: string, mode: string } | null
  const [aiRunning, setAiRunning] = useState(null);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.ProFormSubmissionIntake.list();
      const sorted = [...(Array.isArray(data) ? data : [])].sort((a, b) => {
        const aTime = new Date(a.created_at_server || a.created_date || 0).getTime();
        const bTime = new Date(b.created_at_server || b.created_date || 0).getTime();
        return bTime - aTime;
      });
      setRecords(sorted);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecords(); }, []);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return records;
    return records.filter((record) => record.status === statusFilter);
  }, [records, statusFilter]);

  const handleRetry = async (intake) => {
    try {
      setRetryingId(intake.id);
      const response = await base44.functions.invoke('retryProQuestionnaireIntakeSubmission', {
        intakeId: intake.id,
        questionnaireSessionId: intake.questionnaire_session_id,
        forceRetry: false
      });
      const data = response?.data;
      if (data?.success) {
        toast.success(data?.alreadySubmitted ? 'Already linked to a submission' : 'Submission retry completed');
      } else {
        toast.error(data?.error?.message || 'Retry failed');
      }
      await loadRecords();
    } catch (error) {
      toast.error(error?.message || 'Retry failed');
    } finally {
      setRetryingId('');
    }
  };

  const handleAiAction = async (intake, mode) => {
    setAiRunning({ id: intake.id, mode });
    // Keep row expanded while running
    setExpandedId(intake.id);
    try {
      const modeLabels = { diagnose_only: 'Diagnosis', repair_only: 'Repair', repair_and_retry: 'Repair + Retry' };
      const response = await base44.functions.invoke('repairProQuestionnaireIntakeSubmission', {
        intakeId: intake.id,
        questionnaireSessionId: intake.questionnaire_session_id,
        mode,
        autoRetry: mode === 'repair_and_retry',
        forceRetry: false
      });
      const data = response?.data;
      if (data?.success) {
        if (data?.linkedSubmissionId) {
          toast.success(`AI Repair + Retry succeeded — Submission: ${data.linkedSubmissionId}`);
        } else {
          toast.success(`${modeLabels[mode]} completed`);
        }
      } else {
        toast.error(data?.error?.message || data?.errors?.[0] || `${modeLabels[mode]} failed`);
      }
      await loadRecords();
    } catch (err) {
      toast.error(err?.message || 'AI action failed');
    } finally {
      setAiRunning(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Questionnaire Intake Recovery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="received_intake">received_intake</SelectItem>
                <SelectItem value="retry_failed">retry_failed</SelectItem>
                <SelectItem value="retry_success">retry_success</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="text-sm text-slate-600">Loading intake records...</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-slate-600">No intake records found for this status.</div>
          ) : (
            <div className="space-y-4">
              {filtered.map((intake) => (
                <IntakeRow
                  key={intake.id}
                  intake={intake}
                  expanded={expandedId === intake.id}
                  onToggle={() => setExpandedId(expandedId === intake.id ? '' : intake.id)}
                  onRetry={handleRetry}
                  retrying={retryingId === intake.id}
                  onAiAction={handleAiAction}
                  aiRunning={aiRunning?.id === intake.id ? aiRunning.mode : null}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}