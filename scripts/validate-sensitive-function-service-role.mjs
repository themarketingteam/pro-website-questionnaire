#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const CRUD_OPERATIONS = new Set([
  'create', 'bulkCreate', 'read', 'get', 'list', 'filter', 'update',
  'updateMany', 'bulkUpdate', 'delete', 'deleteMany', 'subscribe',
]);
const DEFAULT_POLICY = 'config/sensitive-entity-access-policy.json';
const FUNCTION_ROOT = 'base44/functions';
const FRONTEND_ROOT = 'src';
const MIGRATION_ROOT = 'scripts/migrations';
const DRAFT_RECOVERY_ENTITIES = new Set([
  'ProFormDraft',
  'ProFormDraftEvent',
  'ProFormRecoverySecurityEvent',
  'ProFormEmailVerificationAttempt',
]);
const AUTHORIZATION_MARKER = /\b(?:authorize[A-Z]\w*|verify(?:PersistentAdminRecoveryGrant|RecoverySessionToken|StructuredToken|EmailSession|RecoveryCaptcha)|validate\w*Request)\s*\(/u;
const SAFE_REQUEST_MARKER = /\b(?:readBoundedJsonBody|validateRequestMethod|validateJsonContentType|validate\w*Request)\s*\(/u;

const normalizePath = (value) => value.split(path.sep).join('/').replace(/^\.\//u, '');

const scriptKindFor = (file) => {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
};

const propertyName = (node) => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
};

const memberChain = (node) => {
  const output = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    output.unshift(propertyName(current));
    current = current.expression;
  }
  if (ts.isIdentifier(current)) output.unshift(current.text);
  return output.filter((entry) => typeof entry === 'string');
};

const lineFor = (sourceFile, node) => (
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
);

const nearestFunction = (node) => {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
};

const isExplicitMigrationPath = (file) => normalizePath(file).startsWith(`${MIGRATION_ROOT}/`);

export const hasExplicitMigrationPolicy = (policy) => (
  (policy.allowedLocations || []).some((entry) => (
    entry.pattern === `${MIGRATION_ROOT}/**`
    && entry.rule === 'approved-migration-only'
    && Array.isArray(entry.operations)
    && entry.operations.length > 0
  ))
);

const isAuditedDelegationBoundary = (file) => [
  'base44/functions/_shared/proDraftRepository/entry.ts',
  'base44/functions/_shared/proDraftAdminService/entry.ts',
].includes(normalizePath(file));

const markerBefore = (source, functionNode, node, marker) => {
  const start = functionNode?.body?.getStart?.() ?? 0;
  const prefix = source.slice(start, node.getStart());
  return marker.test(prefix);
};

export function scanSensitiveServiceRoleSource({
  file,
  source,
  sensitiveEntities,
  frontend = normalizePath(file).startsWith(`${FRONTEND_ROOT}/`)
    && !normalizePath(file).startsWith(`${FRONTEND_ROOT}/test/`),
}) {
  if (normalizePath(file).startsWith(`${FRONTEND_ROOT}/test/`)) return [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const sensitive = new Set(sensitiveEntities);
  const findings = [];
  const seen = new Set();
  const add = (node, operation, rule) => {
    const line = lineFor(sourceFile, node);
    const key = `${line}:${operation}:${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file: normalizePath(file), line, operation, rule });
  };

  const visit = (node) => {
    if (frontend && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      if (propertyName(node) === 'asServiceRole') {
        add(node, 'asServiceRole', 'no-frontend-service-role');
      }
    }

    if (ts.isCallExpression(node)
      && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
      const operation = propertyName(node.expression) || 'dynamic_operation';
      const entityExpression = node.expression.expression;
      if (ts.isPropertyAccessExpression(entityExpression)
        || ts.isElementAccessExpression(entityExpression)) {
        const chain = memberChain(entityExpression);
        const entity = chain.at(-1);
        if (sensitive.has(entity) && CRUD_OPERATIONS.has(operation)) {
          const serviceRoleIndex = chain.lastIndexOf('asServiceRole');
          const entitiesIndex = chain.lastIndexOf('entities');
          const usesServiceRole = serviceRoleIndex >= 0 && entitiesIndex === serviceRoleIndex + 1;
          if (!usesServiceRole && !isExplicitMigrationPath(file)) {
            add(node, operation, 'sensitive-entity-must-use-service-role');
          } else if (usesServiceRole && !frontend && !isExplicitMigrationPath(file)) {
            const functionNode = nearestFunction(node);
            const securityAudit = entity === 'ProFormRecoverySecurityEvent';
            const authorized = markerBefore(
              source,
              functionNode,
              node,
              securityAudit ? SAFE_REQUEST_MARKER : AUTHORIZATION_MARKER,
            );
            const delegatedHelper = functionNode && functionNode !== sourceFile
              && !functionNode.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
              && AUTHORIZATION_MARKER.test(source);
            if (!authorized && !delegatedHelper && !isAuditedDelegationBoundary(file)) {
              add(node, operation, securityAudit
                ? 'security-event-access-before-safe-request-setup'
                : 'protected-access-before-authorization');
            }
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return findings;
}

const listFiles = async (root, relativeDirectory) => {
  const absolute = path.resolve(root, relativeDirectory);
  if (!existsSync(absolute)) return [];
  const output = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        output.push(normalizePath(path.relative(root, candidate)));
      }
    }
  };
  await visit(absolute);
  return output;
};

const importTargets = (file, source) => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const imports = [];
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const specifier = node.moduleSpecifier.text;
    if (!specifier.startsWith('.')) return;
    const candidate = normalizePath(path.join(path.dirname(file), specifier));
    imports.push(candidate);
  });
  return imports;
};

const resolveImport = (candidate, sourceByFile) => {
  if (sourceByFile.has(candidate)) return candidate;
  for (const extension of SOURCE_EXTENSIONS) {
    if (sourceByFile.has(`${candidate}${extension}`)) return `${candidate}${extension}`;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const entry = `${candidate}/entry${extension}`;
    if (sourceByFile.has(entry)) return entry;
  }
  return null;
};

const reachableFiles = (entry, sourceByFile) => {
  const found = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || found.has(file)) continue;
    found.add(file);
    for (const candidate of importTargets(file, sourceByFile.get(file) || '')) {
      const resolved = resolveImport(candidate, sourceByFile);
      if (resolved && resolved.startsWith(`${FUNCTION_ROOT}/`)) queue.push(resolved);
    }
  }
  return found;
};

export async function validateSensitiveFunctionServiceRole({
  root = process.cwd(),
  policyPath = DEFAULT_POLICY,
} = {}) {
  const policy = JSON.parse(await readFile(path.resolve(root, policyPath), 'utf8'));
  const sensitiveEntities = (policy.sensitiveEntities || [])
    .filter((entity) => DRAFT_RECOVERY_ENTITIES.has(entity));
  const files = [
    ...await listFiles(root, FRONTEND_ROOT),
    ...await listFiles(root, FUNCTION_ROOT),
    ...await listFiles(root, MIGRATION_ROOT),
  ];
  const sourceByFile = new Map();
  for (const file of files) {
    sourceByFile.set(file, await readFile(path.resolve(root, file), 'utf8'));
  }

  const findings = [];
  if (!hasExplicitMigrationPolicy(policy)) {
    findings.push({
      file: policyPath,
      line: 1,
      operation: 'migration-exception',
      rule: 'migration-access-requires-explicit-policy',
    });
  }
  for (const [file, source] of sourceByFile) {
    findings.push(...scanSensitiveServiceRoleSource({ file, source, sensitiveEntities }));
  }

  const functionEntries = files.filter((file) => (
    file.startsWith(`${FUNCTION_ROOT}/`)
    && !file.startsWith(`${FUNCTION_ROOT}/_shared/`)
    && /\/entry\.(?:js|jsx|ts|tsx)$/u.test(file)
  ));
  for (const entry of functionEntries) {
    const closure = reachableFiles(entry, sourceByFile);
    const closureSource = [...closure].map((file) => sourceByFile.get(file) || '').join('\n');
    const touchesSensitiveEntity = sensitiveEntities.some((entity) => closureSource.includes(entity))
      || closureSource.includes('createDraftRepository(');
    if (!touchesSensitiveEntity) continue;
    const entrySource = sourceByFile.get(entry) || '';
    if (!/\bcreateClientFromRequest\b/u.test(entrySource)) {
      findings.push({
        file: entry,
        line: 1,
        operation: 'createClientFromRequest',
        rule: 'public-sensitive-function-requires-request-client',
      });
    }
    if (!AUTHORIZATION_MARKER.test(closureSource)) {
      findings.push({
        file: entry,
        line: 1,
        operation: 'authorization',
        rule: 'public-sensitive-function-requires-authorization-helper',
      });
    }
  }

  const repositorySource = sourceByFile.get('base44/functions/_shared/proDraftRepository/entry.ts') || '';
  for (const entity of ['ProFormDraft', 'ProFormDraftEvent']) {
    if (!repositorySource.includes(`asServiceRole.entities.${entity}`)) {
      findings.push({
        file: 'base44/functions/_shared/proDraftRepository/entry.ts',
        line: 1,
        operation: entity,
        rule: 'draft-repository-must-bind-service-role-entity',
      });
    }
  }

  return { findings, sensitiveEntities };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await validateSensitiveFunctionServiceRole();
  if (result.findings.length > 0) {
    console.error('SENSITIVE_FUNCTION_SERVICE_ROLE_VALIDATION_FAILED');
    for (const finding of result.findings) {
      console.error(`${finding.file}:${finding.line} ${finding.operation} [${finding.rule}]`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Sensitive function service-role policy passed for ${result.sensitiveEntities.length} entities.`);
  }
}
