import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import AdminQuestionnairePdfSection from '@/components/admin/AdminQuestionnairePdfSection';
import RecoveryLifecycleActions from '@/components/admin/RecoveryLifecycleActions';
import { getRecoveryRecord, listRecoveryRecords } from '@/lib/draftRecoveryApi';

const PAGE_SIZE = 25;

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '—';
};

function SubmissionRow({ summary, expanded, onToggle, recoveryGrant, onChanged }) {
  const [record, setRecord] = useState(summary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setRecord(summary), [summary]);

  useEffect(() => {
    if (!expanded) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    getRecoveryRecord({ recoveryGrant, recordType: 'submission', recordId: summary.id })
      .then((data) => { if (active) setRecord(data.record); })
      .catch((loadError) => { if (active) setError(loadError?.message || 'Unable to load this submission.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [expanded, recoveryGrant, summary.id]);

  const metadata = record?.metadata || {};
  const isLegacySubmission = Boolean(record?.responses && Object.keys(record?.userdata || {}).length === 0);
  const submissionPayload = isLegacySubmission
    ? record
    : { metadata, userdata: record?.userdata || {} };
  const submissionDate = metadata.submission_datetime || record.created_date;

  return (
    <Card className={`brand-record-card ${expanded ? 'brand-record-card--expanded' : ''}`}>
      <button type="button" onClick={onToggle} className="brand-record-trigger w-full text-left transition-colors">
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_auto_1fr_auto] items-start">
            <div>
              <p className="font-medium text-slate-900">{metadata.business_name || 'Unnamed business'}</p>
              <p className="text-sm text-slate-500 break-all">{metadata.businessDomain || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Submitted</p>
              <p className="text-sm text-slate-900">{formatDate(submissionDate)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="brand-status-badge brand-status-badge--submitted">submitted</Badge>
              {record.archived_at && <Badge className="brand-status-badge brand-status-badge--archived">archived</Badge>}
              {record.soft_deleted_at && <Badge className="brand-status-badge brand-status-badge--danger">deleted</Badge>}
            </div>
            <div>
              <p className="text-sm text-slate-500">Retention Active Until</p>
              <p className="text-sm text-slate-900">{formatDate(record.retention_until)}</p>
            </div>
            {expanded ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
          </div>
        </CardContent>
      </button>

      {expanded && loading && (
        <div className="brand-expanded-panel flex items-center gap-2 p-4 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading submission details…
        </div>
      )}
      {expanded && !loading && error && <div className="brand-expanded-panel p-4 text-sm text-red-700">{error}</div>}
      {expanded && !loading && !error && (
        <div className="brand-expanded-panel p-4 space-y-4">
          {record.archived_at && (
            <div className="brand-archive-notice rounded-lg border p-3 text-sm">
              <p className="font-semibold">Archived final submission</p>
              <p>This submission remains retained and downloadable.</p>
            </div>
          )}
          {record.soft_deleted_at && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">Deleted Records</p>
              <p>This is a reversible soft deletion. No questionnaire data has been erased.</p>
              <p className="mt-1">Reason: {record.soft_delete_reason || '—'}</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 text-sm">
            <div className="space-y-2">
              <p><span className="font-medium">Business Name:</span> {metadata.business_name || '—'}</p>
              <p><span className="font-medium">Domain:</span> {metadata.businessDomain || '—'}</p>
              <p><span className="font-medium">Submission ID:</span> {record.id}</p>
            </div>
            <div className="space-y-2">
              <p><span className="font-medium">Submitted At:</span> {formatDate(submissionDate)}</p>
              <p><span className="font-medium">Archived At:</span> {formatDate(record.archived_at)}</p>
              <p><span className="font-medium">Retention Active Until:</span> {formatDate(record.retention_until)}</p>
            </div>
          </div>

          <AdminQuestionnairePdfSection
            sourceType="submission"
            sourceId={record.id}
            sessionId={metadata.questionnaire_session_id || ''}
            payload={submissionPayload}
            fallbackResponses={isLegacySubmission ? record.responses : undefined}
            businessName={metadata.business_name}
            domain={metadata.businessDomain}
            submissionDate={submissionDate}
            recoveryGrant={recoveryGrant}
          />

          {isLegacySubmission && (
            <div className="brand-archive-notice rounded-lg border p-3 text-sm">
              <p className="font-semibold">Legacy submission format</p>
              <p>The original response fields are retained below. PDF output may contain only fields that map to the current questionnaire template.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="brand-button-secondary gap-2"
              onClick={async (event) => {
                event.stopPropagation();
                await navigator.clipboard.writeText(JSON.stringify(submissionPayload, null, 2));
                toast.success('Final submission payload copied.');
              }}
            >
              <Copy className="h-3 w-3" /> Copy Payload
            </Button>
            <RecoveryLifecycleActions
              recordType="submission"
              record={record}
              recoveryGrant={recoveryGrant}
              onChanged={() => onChanged?.()}
            />
          </div>

          <section className="brand-payload-card" aria-label="Stored Final Submission Payload">
            <div className="brand-payload-card__header">
              <h3 className="brand-payload-card__title">Stored Final Submission Payload</h3>
              <span className="brand-payload-card__status brand-payload-card__status--valid">retained</span>
            </div>
            <div className="brand-payload-card__source">
              <p><span className="brand-payload-card__meta-label">Source:</span> <code>ProFormSubmission</code></p>
              <span className="brand-payload-card__usage">Historical standalone submission</span>
            </div>
            <pre className="brand-payload-card__json">{JSON.stringify(submissionPayload, null, 2)}</pre>
          </section>
        </div>
      )}
    </Card>
  );
}

export default function StandaloneSubmissionRecovery({
  recoveryGrant,
  archiveState,
  search,
  refreshKey,
}) {
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    setPage(1);
    setExpandedId('');
  }, [archiveState, search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listRecoveryRecords({
        recoveryGrant,
        recordType: 'submission',
        page,
        pageSize: PAGE_SIZE,
        status: 'submitted',
        archiveState,
        search,
      });
      setRecords(Array.isArray(data.records) ? data.records : []);
      setHasMore(Boolean(data.hasMore));
    } catch (loadError) {
      setError(loadError?.message || 'Unable to load final submissions.');
    } finally {
      setLoading(false);
    }
  }, [archiveState, localRefresh, page, recoveryGrant, refreshKey, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="space-y-4" aria-labelledby="standalone-submissions-title">
      <div className="draft-recovery-brand__list-heading">
        <div>
          <h2 id="standalone-submissions-title">Standalone Final Submissions</h2>
          <p className="mt-1 text-sm">Historical submissions without a linked draft remain fully recoverable here.</p>
        </div>
        <p>Page {page}</p>
      </div>
      {error && <Card className="border-red-200 bg-red-50"><CardContent className="p-6 text-red-700">{error}</CardContent></Card>}
      {loading ? (
        <Card className="brand-loading-card"><CardContent className="p-6 text-slate-600">Loading final submissions…</CardContent></Card>
      ) : records.length === 0 ? (
        <Card className="brand-loading-card"><CardContent className="p-6 text-slate-600">No matching standalone final submissions found.</CardContent></Card>
      ) : (
        <>
          {records.map((record) => (
            <SubmissionRow
              key={record.id}
              summary={record}
              expanded={expandedId === record.id}
              onToggle={() => setExpandedId(expandedId === record.id ? '' : record.id)}
              recoveryGrant={recoveryGrant}
              onChanged={() => { setExpandedId(''); setLocalRefresh((value) => value + 1); }}
            />
          ))}
          <div className="flex items-center justify-between gap-3 pt-1" aria-label="Final submission pagination">
            <Button type="button" variant="outline" className="brand-button-secondary" disabled={page === 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
            <span className="text-sm text-white">Page {page}</span>
            <Button type="button" variant="outline" className="brand-button-secondary" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        </>
      )}
    </section>
  );
}
