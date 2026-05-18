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
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const statusStyles = {
  received_intake: 'bg-amber-100 text-amber-800',
  retry_failed: 'bg-red-100 text-red-700',
  retry_success: 'bg-green-100 text-green-700',
  submitted: 'bg-slate-100 text-slate-700'
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

function IntakeRow({ intake, expanded, onToggle, onRetry, retrying }) {
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
            <div>
              <Badge className={statusStyles[intake.status] || 'bg-slate-100 text-slate-700'}>{intake.status || '—'}</Badge>
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

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onRetry(intake)} disabled={retrying} className="gap-2">
              {retrying ? <><Loader2 className="w-4 h-4 animate-spin" /> Retrying...</> : 'Retry Submission'}
            </Button>
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

  useEffect(() => {
    loadRecords();
  }, []);

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
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}