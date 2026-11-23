import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadBackend } from './utils/loadBackend';

const REQUIRED_FALLBACK_URL = 'https://hooks.zapier.com/hooks/catch/23529934/uas7p60/';
const deliveryFiles = [
  'base44/functions/sendToZapier/entry.ts',
  'base44/functions/sendToZapier/entry/entry.ts',
  'base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts',
  'base44/functions/retryProQuestionnaireIntakeSubmission/entry/entry.ts',
  'base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts',
];

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const resolveHandlerPath = (path) => {
  const source = readProjectFile(path);
  const target = source.match(/^export \{ default \} from ['"](.+)['"];\s*$/)?.[1];
  return target ? resolve(dirname(resolve(process.cwd(), path)), target) : resolve(process.cwd(), path);
};
const evaluateCanonicalResolver = (env) => {
  const { exposed } = loadBackend('base44/shared/proSubmissionRetries.ts', { env, expose: 'proRetryWebhookUrl' });
  return exposed.proRetryWebhookUrl();
};

describe('Zapier webhook fallback contract', () => {
  it.each(['sendToZapier', 'retryProQuestionnaireIntakeSubmission'])('keeps separately packaged legacy %s on the same guarded shared handler', (name) => {
    expect(resolveHandlerPath(`base44/functions/${name}/entry/entry.ts`)).toBe(resolveHandlerPath(`base44/functions/${name}/entry.ts`));
  });

  it('routes every delivery entry through the shared frozen retry ledger instead of direct HTTP', () => {
    for (const path of deliveryFiles) {
      const source = readFileSync(resolveHandlerPath(path), 'utf8');
      expect(source).toMatch(/(?:deliverProRetryJobLocked|runProTeamRetry)\(/);
      expect(source).not.toMatch(/\bfetch\(/);
    }
    const shared = readProjectFile('base44/shared/proSubmissionRetries.ts');
    expect(shared).toContain(`const WEBHOOK = '${REQUIRED_FALLBACK_URL}';`);
    expect(shared).toContain("Deno.env.get('ZAPIER_WEBHOOK_URL')");
    expect(shared).toContain('fetchImpl(proRetryWebhookUrl()');
    expect(shared).toContain('SUBMISSION_CONTENT_CONFLICT');
  });

  it('contains no obsolete Zapier account endpoint in any delivery handler or shared sender', () => {
    const source = [...deliveryFiles.map(path => readFileSync(resolveHandlerPath(path), 'utf8')), readProjectFile('base44/shared/proSubmissionRetries.ts')].join('\n');
    expect(source).not.toContain('259' + '64219');
  });

  it.each([
    ['missing', undefined],
    ['empty', '   '],
    ['not a URL', 'not-a-url'],
    ['not HTTPS', 'http://hooks.zapier.com/hooks/catch/23529934/uas7p60/'],
    ['not Zapier', 'https://example.com/hooks/catch/23529934/uas7p60/'],
    ['not a Catch Hook', 'https://hooks.zapier.com/apps/'],
    ['another valid Catch Hook', 'https://hooks.zapier.com/hooks/catch/123456/example_token'],
    ['credentials', 'https://username:password@hooks.zapier.com/hooks/catch/23529934/uas7p60/'],
    ['query', `${REQUIRED_FALLBACK_URL}?redirect=https://example.com`],
    ['fragment', `${REQUIRED_FALLBACK_URL}#another-destination`],
    ['spoofed hostname', 'https://hooks.zapier.com.example.com/hooks/catch/23529934/uas7p60/'],
  ])('uses only the required endpoint when the configured environment value is %s', (_label, configuredValue) => {
    expect(evaluateCanonicalResolver({ ZAPIER_WEBHOOK_URL: configuredValue })).toBe(REQUIRED_FALLBACK_URL);
  });

  it('uses the required endpoint when environment access itself fails', () => {
    expect(evaluateCanonicalResolver({ get ZAPIER_WEBHOOK_URL() { throw new Error('environment unavailable'); } })).toBe(REQUIRED_FALLBACK_URL);
  });

  it.each([REQUIRED_FALLBACK_URL, REQUIRED_FALLBACK_URL.slice(0, -1)])('normalizes the allowlisted endpoint %s', configuredValue => {
    expect(evaluateCanonicalResolver({ ZAPIER_WEBHOOK_URL: configuredValue })).toBe(REQUIRED_FALLBACK_URL);
  });
});
