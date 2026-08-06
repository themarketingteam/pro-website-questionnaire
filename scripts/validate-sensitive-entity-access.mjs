#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const DEFAULT_POLICY = 'config/sensitive-entity-access-policy.json';

const normalizePath = (value) => value.split(path.sep).join('/').replace(/^\.\//u, '');

const globPattern = (pattern) => {
  const normalized = normalizePath(pattern);
  let output = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*' && normalized[index + 1] === '*') {
      output += '.*';
      index += 1;
    } else if (char === '*') output += '[^/]*';
    else if (char === '?') output += '[^/]';
    else output += char.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`${output}$`, 'u');
};

const matches = (file, pattern) => globPattern(pattern).test(normalizePath(file));
const operationAllowed = (operations = [], operation) => (
  operations.includes('*') || operations.includes(operation)
);

const scriptKindFor = (file) => {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
};

const propertyName = (node, strings) => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return evaluateString(node.argumentExpression, strings);
  return null;
};

function evaluateString(node, strings) {
  if (!node) return null;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return strings.get(node.text) ?? null;
  if (ts.isParenthesizedExpression(node)) return evaluateString(node.expression, strings);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateString(node.left, strings);
    const right = evaluateString(node.right, strings);
    return left === null || right === null ? null : `${left}${right}`;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = evaluateString(span.expression, strings);
      if (expression === null) return null;
      value += expression + span.literal.text;
    }
    return value;
  }
  return null;
}

const walk = (node, visit) => {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
};

export function scanSourceText({ file, source, sensitiveEntities }) {
  const sensitive = new Set(sensitiveEntities);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const strings = new Map();
  const baseAliases = new Set(['base44']);
  const entityContainers = new Set();
  const entityAliases = new Map();

  const isBaseExpression = (node) => ts.isIdentifier(node) && baseAliases.has(node.text);
  const isContainerExpression = (node) => {
    if (ts.isIdentifier(node) && entityContainers.has(node.text)) return true;
    return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && isBaseExpression(node.expression)
      && propertyName(node, strings) === 'entities';
  };
  const resolveEntity = (node) => {
    if (ts.isIdentifier(node)) return entityAliases.get(node.text) || null;
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && isContainerExpression(node.expression)) {
      const name = propertyName(node, strings);
      return sensitive.has(name) ? name : null;
    }
    return null;
  };

  // Resolve simple constants and aliases to a fixed point before inspecting operations.
  for (let pass = 0; pass < 5; pass += 1) {
    walk(sourceFile, (node) => {
      if (ts.isImportSpecifier(node)) {
        const imported = node.propertyName?.text || node.name.text;
        if (imported === 'base44') baseAliases.add(node.name.text);
        if (sensitive.has(imported)) entityAliases.set(node.name.text, imported);
      }
      if (!ts.isVariableDeclaration(node) || !node.initializer) return;
      if (ts.isIdentifier(node.name)) {
        const name = node.name.text;
        const stringValue = evaluateString(node.initializer, strings);
        if (stringValue !== null) strings.set(name, stringValue);
        if (isBaseExpression(node.initializer)) baseAliases.add(name);
        if (isContainerExpression(node.initializer)) entityContainers.add(name);
        const entity = resolveEntity(node.initializer);
        if (entity) entityAliases.set(name, entity);
        return;
      }
      if (!ts.isObjectBindingPattern(node.name)) return;
      if (isBaseExpression(node.initializer)) {
        for (const element of node.name.elements) {
          const imported = element.propertyName?.getText(sourceFile) || element.name.getText(sourceFile);
          if (imported === 'entities' && ts.isIdentifier(element.name)) {
            entityContainers.add(element.name.text);
          }
        }
      }
      if (isContainerExpression(node.initializer)) {
        for (const element of node.name.elements) {
          const imported = element.propertyName?.getText(sourceFile) || element.name.getText(sourceFile);
          if (sensitive.has(imported) && ts.isIdentifier(element.name)) {
            entityAliases.set(element.name.text, imported);
          }
        }
      }
    });
  }

  const findings = [];
  const seen = new Set();
  const add = (node, entity, operation, rule) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const key = `${line}:${entity}:${operation}:${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file: normalizePath(file), line, entity, operation, rule });
  };

  walk(sourceFile, (node) => {
    if (ts.isElementAccessExpression(node) && isContainerExpression(node.expression)) {
      const entityName = propertyName(node, strings);
      if (entityName === null) add(node, '<dynamic>', 'dynamic_lookup', 'dynamic-sensitive-entity-lookup');
    }
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return;
    const entity = resolveEntity(node.expression);
    if (entity) {
      add(node, entity, propertyName(node, strings) || 'dynamic_operation', 'sensitive-entity-operation');
      return;
    }
    const directEntity = resolveEntity(node);
    if (!directEntity) return;
    const parentConsumesEntity = (
      (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
      && node.parent.expression === node
    );
    if (!parentConsumesEntity) add(node, directEntity, 'access', 'sensitive-entity-access');
  });

  return findings;
}

export function scanBuiltText({ file, source, sensitiveEntities }) {
  const escaped = sensitiveEntities.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  const entity = `(?:${escaped.join('|')})`;
  const patterns = [
    new RegExp(`/(?:api/)?(?:apps/[^/]+/)?entities/${entity}(?:/|[?"'])`, 'giu'),
    new RegExp(`\\.entities(?:\\.${entity}|\\[["']${entity}["']\\])`, 'gu'),
    new RegExp(`entities\\s*\\[\\s*["']${entity}["']\\s*\\]`, 'gu'),
  ];
  const findings = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      findings.push({
        file: normalizePath(file),
        line,
        entity: '<built-sensitive-entity>',
        operation: 'built_endpoint_or_sdk_access',
        rule: 'no-sensitive-entity-access-in-built-output',
      });
    }
  }
  return findings;
}

const listFiles = async (root, relativeDirectory, extensions) => {
  const absolute = path.resolve(root, relativeDirectory);
  if (!existsSync(absolute)) return [];
  const output = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (extensions.has(path.extname(entry.name))) output.push(normalizePath(path.relative(root, candidate)));
    }
  };
  await visit(absolute);
  return output;
};

const exemptionResult = (finding, policy, today) => {
  for (const exemption of policy.exemptions || []) {
    if (!matches(finding.file, exemption.pattern)) continue;
    if (exemption.entity !== '*' && exemption.entity !== finding.entity) continue;
    if (!operationAllowed(exemption.operations, finding.operation)) continue;
    if (!exemption.reason || !exemption.owner || !exemption.removeBy) return 'invalid';
    if (String(exemption.removeBy) < today) return 'expired';
    return 'approved';
  }
  return 'none';
};

const policyDecision = (finding, policy, today) => {
  const allowed = (policy.allowedLocations || []).find((rule) => (
    matches(finding.file, rule.pattern) && operationAllowed(rule.operations, finding.operation)
  ));
  if (allowed) return { allowed: true, rule: allowed.rule };
  const exemption = exemptionResult(finding, policy, today);
  if (exemption === 'approved') return { allowed: true, rule: 'approved-expiring-exemption' };
  if (exemption !== 'none') return { allowed: false, rule: `${exemption}-exemption` };
  const forbidden = (policy.forbiddenLocations || []).find((rule) => (
    matches(finding.file, rule.pattern) && operationAllowed(rule.operations, finding.operation)
  ));
  return { allowed: false, rule: forbidden?.rule || finding.rule };
};

export async function validateSensitiveEntityAccess({
  root = process.cwd(),
  policyPath = DEFAULT_POLICY,
  buildDirectory = undefined,
  sourceOnly = false,
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const policy = JSON.parse(await readFile(path.resolve(root, policyPath), 'utf8'));
  const malformedExemptions = (policy.exemptions || []).filter((entry) => (
    !entry.reason || !entry.owner || !entry.removeBy || String(entry.removeBy) < today
  ));
  const findings = [];
  for (const sourceRoot of policy.sourceRoots || []) {
    for (const file of await listFiles(root, sourceRoot, SOURCE_EXTENSIONS)) {
      const source = await readFile(path.resolve(root, file), 'utf8');
      for (const finding of scanSourceText({ file, source, sensitiveEntities: policy.sensitiveEntities })) {
        const decision = policyDecision(finding, policy, today);
        if (!decision.allowed) findings.push({ ...finding, rule: decision.rule });
      }
    }
  }
  if (!sourceOnly) {
    const directory = buildDirectory || policy.builtOutput?.directory;
    const extensions = new Set(policy.builtOutput?.extensions || ['.js', '.html']);
    for (const file of await listFiles(root, directory, extensions)) {
      const source = await readFile(path.resolve(root, file), 'utf8');
      findings.push(...scanBuiltText({ file, source, sensitiveEntities: policy.sensitiveEntities }));
    }
  }
  for (const exemption of malformedExemptions) {
    findings.push({
      file: normalizePath(exemption.pattern || '<policy>'),
      line: 1,
      entity: exemption.entity || '<unknown>',
      operation: 'exemption',
      rule: String(exemption.removeBy) < today ? 'expired-exemption' : 'invalid-exemption',
    });
  }
  return { findings, policy };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const sourceOnly = process.argv.includes('--source-only');
  const result = await validateSensitiveEntityAccess({ sourceOnly });
  if (result.findings.length > 0) {
    console.error('SENSITIVE_ENTITY_ACCESS_POLICY_FAILED');
    for (const finding of result.findings) {
      console.error(`${finding.file}:${finding.line} ${finding.operation} [${finding.rule}]`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Sensitive entity access policy passed for ${result.policy.sensitiveEntities.length} entities.`);
  }
}
