import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Base44 CLI 0.3.3 ships a function's own subtree and base44/shared. A
// filesystem-resolvable sibling import can pass local tests and still be absent
// from the deployed package, so audit the actual transitive import graph.
describe('deployed Pro function package closure', () => {
  it.each([
    'syncProQuestionnaireDraft', 'submitProQuestionnaireDurable',
    'submitProQuestionnaireFallback', 'queryProQuestionnaireRecoveryRecords',
    'repairProQuestionnaireIntakeSubmission', 'retryProQuestionnaireIntakeSubmission',
    'sendToZapier', 'retryProQuestionnaireIntakeSubmission/entry', 'sendToZapier/entry'
  ])('includes every relative dependency of %s in its own deployable package', (name) => {
    const functionDir = resolve(process.cwd(), 'base44/functions', name);
    const sharedDir = resolve(process.cwd(), 'base44/shared');
    const visited = new Set();
    const inspect = (path) => {
      if (visited.has(path)) return;
      visited.add(path);
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ESNext, true);
      source.forEachChild((node) => {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
        const specifier = node.moduleSpecifier?.text;
        if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;
        const dependency = resolve(dirname(path), specifier);
        const inPackage = [functionDir, sharedDir].some((root) => dependency.startsWith(`${root}${sep}`));
        expect(inPackage, `${name}: omitted dependency ${relative(functionDir, dependency)}`).toBe(true);
        expect(existsSync(dependency), `${name}: missing dependency ${specifier}`).toBe(true);
        inspect(dependency);
      });
    };
    inspect(resolve(functionDir, 'entry.ts'));
  });
});
