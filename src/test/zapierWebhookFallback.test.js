import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_FALLBACK_URL = 'https://hooks.zapier.com/hooks/catch/23529934/uas7p60/';
const deliveryFiles = [
  'base44/functions/sendToZapier/entry.ts',
  'base44/functions/sendToZapier/entry/entry.ts',
  'base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts',
  'base44/functions/retryProQuestionnaireIntakeSubmission/entry/entry.ts',
  'base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts',
];

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const evaluateCanonicalResolver = (getEnv) => {
  const source = readProjectFile('base44/functions/sendToZapier/entry.ts');
  const resolverSource = source.slice(0, source.indexOf('Deno.serve'));
  const evaluate = new Function(
    'Deno',
    `${resolverSource}\nreturn { fallback: ZAPIER_WEBHOOK_FALLBACK_URL, resolved: ZAPIER_WEBHOOK_URL };`,
  );

  return evaluate({ env: { get: getEnv } });
};

describe('Zapier webhook fallback contract', () => {
  it.each(deliveryFiles)('%s has the validated hardcoded fallback', (path) => {
    const source = readProjectFile(path);

    expect(source).toContain(`const ZAPIER_WEBHOOK_FALLBACK_URL = '${REQUIRED_FALLBACK_URL}';`);
    expect(source).toContain("Deno.env.get('ZAPIER_WEBHOOK_URL')");
    expect(source).toContain('normalizedUrl === ZAPIER_WEBHOOK_FALLBACK_URL');
    expect(source).toContain('if (!isValidZapierWebhookUrl(configuredUrl)) return ZAPIER_WEBHOOK_FALLBACK_URL;');
  });

  it('contains no obsolete Zapier account endpoint in backend functions', () => {
    const source = deliveryFiles.map(readProjectFile).join('\n');
    const obsoleteAccountId = '259' + '64219';

    expect(source).not.toContain(obsoleteAccountId);
  });

  it('keeps the canonical send function executable and diagnostic', () => {
    const source = readProjectFile('base44/functions/sendToZapier/entry.ts');

    expect(source).toContain('Deno.serve(async (req) => {');
    expect(source).toContain('fetch(ZAPIER_WEBHOOK_URL');
    expect(source).toContain('zapierEndpoint: ZAPIER_WEBHOOK_URL');
  });

  it.each([
    ['missing', undefined],
    ['empty', '   '],
    ['not a URL', 'not-a-url'],
    ['not HTTPS', 'http://hooks.zapier.com/hooks/catch/123/token/'],
    ['not Zapier', 'https://example.com/hooks/catch/123/token/'],
    ['not a Catch Hook', 'https://hooks.zapier.com/apps/'],
  ])('uses the hardcoded fallback when the environment value is %s', (_label, configuredValue) => {
    const result = evaluateCanonicalResolver(() => configuredValue);

    expect(result.fallback).toBe(REQUIRED_FALLBACK_URL);
    expect(result.resolved).toBe(REQUIRED_FALLBACK_URL);
  });

  it('uses the fallback when environment access itself fails', () => {
    const result = evaluateCanonicalResolver(() => {
      throw new Error('environment unavailable');
    });

    expect(result.resolved).toBe(REQUIRED_FALLBACK_URL);
  });

  it('rejects a different valid Zapier Catch Hook and uses the hardcoded endpoint', () => {
    const result = evaluateCanonicalResolver(
      () => 'https://hooks.zapier.com/hooks/catch/123456/example_token',
    );

    expect(result.resolved).toBe(REQUIRED_FALLBACK_URL);
  });

  it('accepts the required endpoint without a trailing slash and normalizes it', () => {
    const result = evaluateCanonicalResolver(
      () => REQUIRED_FALLBACK_URL.slice(0, -1),
    );

    expect(result.resolved).toBe(REQUIRED_FALLBACK_URL);
  });
});
