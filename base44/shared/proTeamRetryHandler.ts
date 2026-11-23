import { createClientFromRequest } from 'npm:@base44/sdk@0.8.61';
import { authorizeRecoveryRequest } from './draftRecoveryAuthorization.ts';
import { runProTeamRetry } from './proSubmissionRetries.ts';

export default async function(req: Request) {
  if (req.method !== 'POST') return Response.json({ success: false }, { status: 405 });
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const authorization = await authorizeRecoveryRequest(base44, body);
    if (!authorization.authorized) return Response.json({ success: false, error: { message: 'Administrator or verified recovery access is required.' } }, { status: 403 });
    if (body.useAiRepair === true) return Response.json({ success: false, error: { message: 'Use the separate repair workflow for an explicit team repair.' } }, { status: 400 });
    const result = await runProTeamRetry(base44, body);
    return Response.json(result, { status: result.success ? 200 : result.held ? 409 : 502 });
  } catch (error: any) { return Response.json({ success: false, code: error.code || '', error: { message: String(error.message || 'The retry failed.').slice(0, 500) } }, { status: Number(error.status) || 503 }); }
}
