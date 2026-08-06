import { createClientFromRequest } from 'npm:@base44/sdk';
import { getRetentionPolicy } from '../_shared/proDraftRetention/entry.ts';
import { createRetentionRepository } from '../_shared/proDraftRetentionRepository/entry.ts';
import { runScheduledRetention } from '../_shared/proDraftRetentionService/entry.ts';

Deno.serve(async (request) => {
  const environment = Deno.env.get('PRO_DRAFT_ENVIRONMENT') ?? 'unknown';
  const month = new Date().toISOString().slice(0, 7).replace('-', '');
  const client = createClientFromRequest(request);
  const repository = createRetentionRepository(client.asServiceRole.entities as Record<string, unknown>);
  const policy = getRetentionPolicy((name) => Deno.env.get(name));
  const result = await runScheduledRetention(repository, {
    environment, batchId: `retention-v1-${environment}-${month}`,
    requestId: `scheduled-retention-${environment}-${month}`,
  }, { policy, environmentValues: (name: string) => Deno.env.get(name) });
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
});
