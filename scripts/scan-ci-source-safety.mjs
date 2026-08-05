import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

const CONTENT_RULES = Object.freeze([
  {
    code: 'PRIVATE_KEY_MATERIAL',
    pattern: /-----BEGIN (?:DSA |EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/,
  },
  {
    code: 'AWS_ACCESS_KEY_ID',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    code: 'AWS_SECRET_ACCESS_KEY',
    pattern: /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{32,}/i,
  },
  {
    code: 'COMMON_ACCESS_TOKEN',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
  },
  {
    code: 'HARDCODED_ACCESS_TOKEN',
    pattern: /\b(?:access[_-]?token|auth[_-]?token)\s*[:=]\s*["'][^"'${}<\s]{16,}["']/i,
  },
  {
    code: 'HARDCODED_ZAPIER_URL',
    pattern: /https:\/\/hooks\.zapier\.com\/hooks\/catch\//i,
  },
]);

const toRepositoryPath = (value) => path
  .relative(repositoryRoot, value)
  .split(path.sep)
  .join('/');

const isInsideRepository = (value) => {
  const relative = path.relative(repositoryRoot, value);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..';
};

export const sensitivePathCode = (repositoryPath) => {
  const name = path.posix.basename(String(repositoryPath || ''));
  if (name === '.app.jsonc') return 'BASE44_APP_LINK_FILE';
  if (/^\.env(?:\.|$)/.test(name) && !name.endsWith('.example')) {
    return 'ENVIRONMENT_FILE';
  }
  return null;
};

export const contentFindingCodes = (content) => CONTENT_RULES
  .filter(({ pattern }) => pattern.test(String(content || '')))
  .map(({ code }) => code);

const parseArguments = (argumentsList) => {
  const options = { base: '', directories: [], head: 'HEAD' };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--base') {
      options.base = argumentsList[index + 1] || '';
      index += 1;
    } else if (argument === '--head') {
      options.head = argumentsList[index + 1] || '';
      index += 1;
    } else if (argument === '--directory') {
      options.directories.push(argumentsList[index + 1] || '');
      index += 1;
    } else {
      throw new Error('INVALID_SOURCE_SAFETY_ARGUMENT');
    }
  }

  if (!options.base && options.directories.length === 0) {
    throw new Error('SOURCE_SAFETY_SCAN_TARGET_REQUIRED');
  }
  return options;
};

const git = (argumentsList, { allowFailure = false } = {}) => {
  const result = spawnSync('git', argumentsList, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0 && !allowFailure) throw new Error('SOURCE_SAFETY_GIT_FAILED');
  return result;
};

const validRef = (value) => {
  if (!value || /^0+$/.test(value)) return false;
  return git(['rev-parse', '--verify', `${value}^{commit}`], { allowFailure: true }).status === 0;
};

const changedFiles = (base, head) => {
  const resolvedBase = validRef(base) ? base : 'origin/main';
  if (!validRef(resolvedBase) || !validRef(head)) {
    throw new Error('SOURCE_SAFETY_GIT_REF_UNAVAILABLE');
  }
  const result = git([
    'diff',
    '--name-only',
    '--diff-filter=ACMRT',
    '-z',
    `${resolvedBase}...${head}`,
  ]);
  return result.stdout.split('\0').filter(Boolean);
};

const directoryFiles = (directory) => {
  const absoluteDirectory = path.resolve(repositoryRoot, directory);
  if (!isInsideRepository(absoluteDirectory) || !existsSync(absoluteDirectory)) {
    throw new Error('SOURCE_SAFETY_DIRECTORY_UNAVAILABLE');
  }

  const files = [];
  const visit = (candidate) => {
    for (const entry of readdirSync(candidate, { withFileTypes: true })) {
      const absolutePath = path.join(candidate, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(toRepositoryPath(absolutePath));
    }
  };
  visit(absoluteDirectory);
  return files;
};

const scanFiles = (repositoryPaths) => {
  const findings = [];
  let scannedFiles = 0;

  for (const repositoryPath of [...new Set(repositoryPaths)].sort()) {
    const absolutePath = path.resolve(repositoryRoot, repositoryPath);
    if (!isInsideRepository(absolutePath) || !existsSync(absolutePath)) continue;
    if (!statSync(absolutePath).isFile()) continue;

    const pathCode = sensitivePathCode(repositoryPath);
    if (pathCode) findings.push({ code: pathCode, file: repositoryPath });

    const content = readFileSync(absolutePath);
    if (content.includes(0)) continue;
    scannedFiles += 1;
    for (const code of contentFindingCodes(content.toString('utf8'))) {
      findings.push({ code, file: repositoryPath });
    }
  }
  return { findings, scannedFiles };
};

export const runSourceSafetyScan = (argumentsList = process.argv.slice(2)) => {
  const options = parseArguments(argumentsList);
  const paths = [
    ...(options.base ? changedFiles(options.base, options.head) : []),
    ...options.directories.flatMap(directoryFiles),
  ];
  const result = scanFiles(paths);

  if (result.findings.length === 0) {
    process.stdout.write(`status=PASS\nscanned_files=${result.scannedFiles}\n`);
    return 0;
  }

  process.stdout.write(
    `status=FAIL\nscanned_files=${result.scannedFiles}\nfinding_count=${result.findings.length}\n`,
  );
  for (const finding of result.findings) {
    process.stdout.write(`${finding.code} ${finding.file}\n`);
  }
  return 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = runSourceSafetyScan();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'SOURCE_SAFETY_FAILED'}\n`);
    process.exitCode = 2;
  }
}
