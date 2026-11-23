import { createClientFromRequest } from 'npm:@base44/sdk@0.8.61';
import { discoverProRetrySources, processProRetryJob, retryJobSummary } from '../../shared/proSubmissionRetries.ts';

export default async function(req: Request) {
  if (req.method !== 'POST') return Response.json({ success: false }, { status: 405 });
  const base44 = createClientFromRequest(req);
  let user: any;
  try { user = await base44.auth.me(); } catch { user = null; }
  if (!user) return Response.json({ success: false, error: 'Authentication is required.' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ success: false, error: 'Administrator authentication is required.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const args = body?.args && typeof body.args === 'object' ? body.args : body;
  const dryRun = args?.dryRun !== false;
  const limit = Math.min(30, Math.max(1, Number(args?.limit) || 30));
  try {
    const inventory = await discoverProRetrySources(base44, { dryRun, limit });
    const due: any[] = [], now = new Date().toISOString();
    for (let skip = 0; skip < 500; skip += 100) {
      const batch = await base44.asServiceRole.entities.ProSubmissionRetryJob.filter({ status: { $in: ['queued','retry_waiting','processing'] }, next_retry_at: { $lte: now, $ne: '' } }, 'next_retry_at', 100, skip);
      due.push(...(Array.isArray(batch) ? batch : []));
      if (!batch || batch.length < 100) break;
    }
    const selected = due.slice(0, limit);
    if (dryRun) return Response.json({ success: true, dryRun: true, inventory, dueCount: due.length, wouldProcess: selected.length, jobs: selected.map(retryJobSummary) });
    const results: any[] = [], deadline = Date.now() + 180_000;
    for (const job of selected) {
      if (Date.now() > deadline) break;
      try { results.push(await processProRetryJob(base44, job.id)); }
      catch (error: any) { results.push({ success: false, code: error.code || 'RETRY_WORKER_FAILED', message: String(error.message || '').slice(0, 300) }); }
    }
    console.info('[Pro automatic submission retries]', { processed: results.length, dueCount: due.length, inventory });
    return Response.json({ success: true, dryRun: false, inventory, dueCount: due.length, processed: results.length, remaining: Math.max(0, due.length - results.length), results });
  } catch (error: any) { return Response.json({ success: false, error: String(error.message || 'The retry worker could not read its queue.').slice(0, 500) }, { status: 503 }); }
}
