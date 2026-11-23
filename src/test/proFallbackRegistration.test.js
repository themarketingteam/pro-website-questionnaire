import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

function loadDefaultHandler() {
  const source = readFileSync(resolve(process.cwd(), 'base44/functions/submitProQuestionnaireFallback/entry.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sdk = { asServiceRole: { entities: new Proxy({}, { get() { throw new Error('No database calls allowed in registration tests.'); } }), functions: { invoke: vi.fn() } } };
  const createClientFromRequest = vi.fn(() => sdk);
  const require = (name) => {
    if (name.startsWith('npm:@base44/sdk')) return { createClientFromRequest };
    if (name.endsWith('pageOrganizerContract.js')) return {};
    if (name.endsWith('proSubmissionRetries.ts')) return {};
    if (name.endsWith('entityLease.ts')) return {};
    throw new Error(`Unexpected import ${name}`);
  };
  const exports = {};
  // A default-export runtime need not provide the Deno.serve interception used
  // by the old test harness. Loading must expose a callable handler regardless.
  new Function('require', 'exports', 'Deno', compiled)(require, exports, { env: { get: () => '' } });
  return { handler: exports.default, createClientFromRequest, sdk };
}

describe('hosted Pro fallback registration', () => {
  it('exports a callable handler without a Deno.serve registration shim', () => {
    expect(loadDefaultHandler().handler).toBeTypeOf('function');
  });
  it('rejects malformed JSON before creating a client or accessing data', async () => {
    const f = loadDefaultHandler();
    const response = await f.handler(new Request('https://example.test/fallback', { method: 'POST', body: '{' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, received: false, error: { code: 'INVALID_JSON_REQUEST' } });
    expect(f.createClientFromRequest).not.toHaveBeenCalled();
  });
  it('rejects missing secured submission context without delivery or writes', async () => {
    const f = loadDefaultHandler();
    const response = await f.handler(new Request('https://example.test/fallback', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ received: false, error: { code: 'MISSING_DRAFT_CONTEXT' } });
    expect(f.sdk.asServiceRole.functions.invoke).not.toHaveBeenCalled();
  });
});
