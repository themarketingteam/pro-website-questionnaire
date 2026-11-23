import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { vi } from 'vitest';
export function loadBackend(relativePath, { base44 = {}, fetchImpl = vi.fn(async () => { throw new Error('Network disabled in backend tests'); }), modules = {}, expose = '', env = {} } = {}) {
  const cache = new Map(), root = resolve(process.cwd(), relativePath); let registered;
  const evaluate = file => {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const require = name => {
      if (modules[name]) return modules[name];
      if (name.startsWith('npm:@base44/sdk')) return { createClientFromRequest: () => base44 };
      if (name.startsWith('.')) return evaluate(resolve(dirname(file), name));
      throw new Error(`Unexpected backend dependency ${name}`);
    };
    const source = readFileSync(file, 'utf8') + (file === root && expose ? `\nexport const organizerTest = { ${expose} };` : '');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require','exports','Deno','crypto','fetch','console',compiled)(require,exports,{ serve: handler => { registered = handler; }, env: { get: key => env[key] || '' } },webcrypto,fetchImpl,{ error: vi.fn(),warn: vi.fn(),info: vi.fn() });
    return exports;
  };
  const entry = evaluate(root), handler = entry.default || registered;
  return { handler, exposed: entry.organizerTest, fetch: fetchImpl, async send(body, { malformed = false } = {}) {
    const response = await handler(new Request('http://unit.test/backend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: malformed ? '{bad' : JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  } };
}
