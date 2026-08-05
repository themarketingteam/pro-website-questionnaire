#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULTS = Object.freeze({
  mode: 'check',
  branch: 'feature/durable-draft-recovery',
  baselineSha: '27ddc347d55db00796a0e3e19ac343245519b01e',
  baselineTag: 'pre-durable-draft-recovery-2026-08-05',
  backupBranch: 'backup/pre-durable-draft-recovery-2026-08-05',
  json: false,
});

const REQUIRED_DIRECTORIES = Object.freeze([
  'docs/durable-draft-recovery',
  'docs/durable-draft-recovery/baseline',
  'docs/durable-draft-recovery/architecture',
  'docs/durable-draft-recovery/audit',
  'docs/durable-draft-recovery/environments',
  'docs/durable-draft-recovery/release',
  'docs/durable-draft-recovery/runbooks',
  'docs/durable-draft-recovery/migration',
  'docs/durable-draft-recovery/testing',
  'docs/durable-draft-recovery/deployment',
]);

const EXPECTED_OUTPUTS = Object.freeze([
  'docs/durable-draft-recovery/baseline/source-baseline-manifest.md',
  'docs/durable-draft-recovery/baseline/source-baseline-validation.md',
  'docs/durable-draft-recovery/baseline/source-rollback-rehearsal.md',
]);

function parseArguments(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--mode' || argument === '--branch' || argument === '--baseline-sha') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${argument}`);
      }
      index += 1;
      if (argument === '--mode') options.mode = value;
      if (argument === '--branch') options.branch = value;
      if (argument === '--baseline-sha') options.baselineSha = value.toLowerCase();
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!['check', 'repair'].includes(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}`);
  }
  if (!/^[0-9a-f]{40}$/.test(options.baselineSha)) {
    throw new Error('Expected baseline SHA must be a full 40-character hexadecimal commit SHA');
  }

  return options;
}

function runGit(argumentsList, cwd) {
  const execution = spawnSync('git', argumentsList, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    ok: execution.status === 0,
    status: execution.status ?? 1,
    stdout: (execution.stdout ?? '').trimEnd(),
  };
}

function resolveLocalCommit(repositoryRoot, reference) {
  const resolution = runGit(['rev-parse', '--verify', '--quiet', `${reference}^{commit}`], repositoryRoot);
  return resolution.ok ? resolution.stdout : null;
}

function queryRemoteTag(repositoryRoot, tagName) {
  const directReference = `refs/tags/${tagName}`;
  const peeledReference = `${directReference}^{}`;
  const query = runGit(['ls-remote', '--tags', 'origin', directReference, peeledReference], repositoryRoot);
  if (!query.ok) return { available: false, exists: false, sha: null };

  const entries = new Map(
    query.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/\s+/, 2).reverse()),
  );

  return {
    available: true,
    exists: entries.has(directReference),
    sha: entries.get(peeledReference) ?? entries.get(directReference) ?? null,
  };
}

function queryRemoteBranch(repositoryRoot, branchName) {
  const reference = `refs/heads/${branchName}`;
  const query = runGit(['ls-remote', '--heads', 'origin', reference], repositoryRoot);
  if (!query.ok) return { available: false, exists: false, sha: null };

  const match = query.stdout.split('\n').find((line) => line.endsWith(`\t${reference}`));
  return {
    available: true,
    exists: Boolean(match),
    sha: match ? match.split(/\s+/, 1)[0] : null,
  };
}

function parseDirtyPaths(statusOutput) {
  return statusOutput
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function createResult(options) {
  return {
    schemaVersion: 1,
    code: 'WORKSPACE_READY',
    ok: true,
    mode: options.mode,
    repositoryRoot: null,
    expected: {
      branch: options.branch,
      baselineSha: options.baselineSha,
      baselineTag: options.baselineTag,
      backupBranch: options.backupBranch,
    },
    actual: {
      branch: null,
      head: null,
      dirty: false,
      dirtyPaths: [],
    },
    references: {
      baselineTag: { localSha: null, remoteSha: null, remoteVerified: false },
      backupBranch: { localSha: null, remoteSha: null, remoteVerified: false },
      featureBranch: { localSha: null, remoteSha: null, remoteVerified: false },
    },
    directories: { missing: [], created: [] },
    outputs: { missing: [], present: [] },
    actions: [],
    warnings: [],
    errors: [],
  };
}

function addAction(result, code, message) {
  result.actions.push({ code, message });
}

function addWarning(result, code, message) {
  if (!result.warnings.some((warning) => warning.code === code && warning.message === message)) {
    result.warnings.push({ code, message });
  }
}

function failure(result, code, message) {
  result.code = code;
  result.ok = false;
  result.errors.push({ code, message });
  return { result, exitCode: 1 };
}

function ensureValidBranchName(repositoryRoot, branchName) {
  return runGit(['check-ref-format', '--branch', branchName], repositoryRoot).ok;
}

function inspectWorkspace(options) {
  const result = createResult(options);
  const rootLookup = runGit(['rev-parse', '--show-toplevel'], process.cwd());
  if (!rootLookup.ok || !rootLookup.stdout) {
    return failure(result, 'REPOSITORY_INVALID', 'The current directory is not inside a Git repository.');
  }

  const repositoryRoot = path.resolve(rootLookup.stdout);
  result.repositoryRoot = repositoryRoot;
  if (!existsSync(path.join(repositoryRoot, '.git'))) {
    return failure(result, 'REPOSITORY_INVALID', 'The repository root does not contain a .git entry.');
  }
  if (!existsSync(path.join(repositoryRoot, 'package.json'))) {
    return failure(result, 'PACKAGE_JSON_MISSING', 'package.json is required at the repository root.');
  }
  if (!existsSync(path.join(repositoryRoot, 'base44', 'config.jsonc'))) {
    return failure(result, 'BASE44_CONFIG_MISSING', 'base44/config.jsonc is required at the repository root.');
  }
  if (!ensureValidBranchName(repositoryRoot, options.branch)) {
    return failure(result, 'ARGUMENT_INVALID', 'The expected branch name is not a valid Git branch name.');
  }

  const originCheck = runGit(['remote', 'get-url', 'origin'], repositoryRoot);
  if (!originCheck.ok) {
    return failure(result, 'ORIGIN_MISSING', 'The Git remote named origin is required.');
  }

  const currentBranch = runGit(['branch', '--show-current'], repositoryRoot);
  const currentHead = runGit(['rev-parse', 'HEAD'], repositoryRoot);
  const status = runGit(['status', '--porcelain'], repositoryRoot);
  if (!currentHead.ok || !status.ok) {
    return failure(result, 'REPOSITORY_INVALID', 'Git could not read the current HEAD or working-tree status.');
  }

  result.actual.branch = currentBranch.ok ? currentBranch.stdout : '';
  result.actual.head = currentHead.stdout;
  result.actual.dirty = Boolean(status.stdout);
  result.actual.dirtyPaths = parseDirtyPaths(status.stdout);

  const tagReference = `refs/tags/${options.baselineTag}`;
  const backupReference = `refs/heads/${options.backupBranch}`;
  const featureReference = `refs/heads/${options.branch}`;
  const tagWasMissing = !resolveLocalCommit(repositoryRoot, tagReference);
  const backupWasMissing = !resolveLocalCommit(repositoryRoot, backupReference);
  const featureWasMissing = !resolveLocalCommit(repositoryRoot, featureReference);

  if (options.mode === 'repair') {
    const fetch = runGit(['fetch', '--all', '--tags', '--prune'], repositoryRoot);
    if (fetch.ok) {
      addAction(result, 'FETCH_COMPLETED', 'Fetched branches and tags from configured remotes.');
    } else {
      addWarning(result, 'FETCH_UNAVAILABLE', 'Remote fetch was unavailable; verification continued with accessible references.');
    }
  }

  let remoteTag = queryRemoteTag(repositoryRoot, options.baselineTag);
  let localTagSha = resolveLocalCommit(repositoryRoot, tagReference);
  if (tagWasMissing && localTagSha) {
    addAction(result, 'BASELINE_TAG_FETCHED', `Fetched the local ${options.baselineTag} tag from origin.`);
  }
  if (!localTagSha && options.mode === 'repair' && remoteTag.available && remoteTag.exists) {
    const fetchTag = runGit(
      ['fetch', 'origin', `${tagReference}:${tagReference}`],
      repositoryRoot,
    );
    if (fetchTag.ok) {
      localTagSha = resolveLocalCommit(repositoryRoot, tagReference);
      if (localTagSha) addAction(result, 'BASELINE_TAG_FETCHED', `Fetched the local ${options.baselineTag} tag from origin.`);
    }
  }
  remoteTag = queryRemoteTag(repositoryRoot, options.baselineTag);
  result.references.baselineTag = {
    localSha: localTagSha,
    remoteSha: remoteTag.sha,
    remoteVerified: remoteTag.available && remoteTag.exists,
  };

  if (localTagSha && localTagSha !== options.baselineSha) {
    return failure(result, 'BASELINE_TAG_CONFLICT', 'The local baseline tag does not match the expected baseline SHA.');
  }
  if (remoteTag.available && remoteTag.exists && remoteTag.sha !== options.baselineSha) {
    return failure(result, 'BASELINE_TAG_CONFLICT', 'The remote baseline tag does not match the expected baseline SHA.');
  }
  if (remoteTag.available && !remoteTag.exists) {
    return failure(result, 'BASELINE_TAG_MISSING', 'The baseline tag is missing from origin and cannot be recreated by this utility.');
  }
  if (!remoteTag.available) {
    addWarning(result, 'REMOTE_TAG_VERIFICATION_UNAVAILABLE', 'The remote baseline tag could not be queried.');
  }
  if (!localTagSha) {
    if (options.mode === 'repair') {
      return failure(result, 'BASELINE_TAG_MISSING', 'The baseline tag is unavailable locally and could not be fetched safely.');
    }
    addWarning(result, 'BASELINE_TAG_MISSING', 'The local baseline tag is missing; run repair mode to fetch it.');
  }

  let remoteBackup = queryRemoteBranch(repositoryRoot, options.backupBranch);
  let localBackupSha = resolveLocalCommit(repositoryRoot, backupReference);
  if (remoteBackup.available && remoteBackup.exists && remoteBackup.sha !== options.baselineSha) {
    return failure(result, 'BACKUP_BRANCH_CONFLICT', 'The remote backup branch does not match the expected baseline SHA.');
  }
  if (remoteBackup.available && !remoteBackup.exists) {
    return failure(result, 'BACKUP_BRANCH_MISSING', 'The backup branch is missing from origin and cannot be recreated by this utility.');
  }
  if (!remoteBackup.available) {
    addWarning(result, 'REMOTE_BACKUP_VERIFICATION_UNAVAILABLE', 'The remote backup branch could not be queried.');
  }

  if (!localBackupSha && options.mode === 'repair' && remoteBackup.available && remoteBackup.exists) {
    let remoteTrackingSha = resolveLocalCommit(
      repositoryRoot,
      `refs/remotes/origin/${options.backupBranch}`,
    );
    if (!remoteTrackingSha) {
      runGit(
        ['fetch', 'origin', `refs/heads/${options.backupBranch}:refs/remotes/origin/${options.backupBranch}`],
        repositoryRoot,
      );
      remoteTrackingSha = resolveLocalCommit(
        repositoryRoot,
        `refs/remotes/origin/${options.backupBranch}`,
      );
    }
    if (remoteTrackingSha) {
      const createBackup = runGit(
        ['branch', '--track', options.backupBranch, `origin/${options.backupBranch}`],
        repositoryRoot,
      );
      if (createBackup.ok) {
        localBackupSha = resolveLocalCommit(repositoryRoot, backupReference);
        addAction(result, 'BACKUP_BRANCH_TRACKING_CREATED', `Created local tracking branch ${options.backupBranch}.`);
      }
    }
  }

  remoteBackup = queryRemoteBranch(repositoryRoot, options.backupBranch);
  localBackupSha = resolveLocalCommit(repositoryRoot, backupReference);
  result.references.backupBranch = {
    localSha: localBackupSha,
    remoteSha: remoteBackup.sha,
    remoteVerified: remoteBackup.available && remoteBackup.exists,
  };
  if (localBackupSha && localBackupSha !== options.baselineSha) {
    return failure(result, 'BACKUP_BRANCH_CONFLICT', 'The local backup branch does not match the expected baseline SHA.');
  }
  if (!localBackupSha) {
    if (options.mode === 'repair') {
      return failure(result, 'BACKUP_BRANCH_MISSING', 'The local backup branch could not be created from its verified remote reference.');
    }
    addWarning(result, 'BACKUP_BRANCH_MISSING', 'The local backup branch is missing; run repair mode to create its tracking branch.');
  }
  if (backupWasMissing && localBackupSha && options.mode === 'repair' && !result.actions.some(({ code }) => code === 'BACKUP_BRANCH_TRACKING_CREATED')) {
    addAction(result, 'BACKUP_BRANCH_TRACKING_CREATED', `Created local tracking branch ${options.backupBranch}.`);
  }

  let remoteFeature = queryRemoteBranch(repositoryRoot, options.branch);
  let localFeatureSha = resolveLocalCommit(repositoryRoot, featureReference);
  if (!localFeatureSha && options.mode === 'repair') {
    if (remoteFeature.available && remoteFeature.exists) {
      let remoteTrackingSha = resolveLocalCommit(repositoryRoot, `refs/remotes/origin/${options.branch}`);
      if (!remoteTrackingSha) {
        runGit(
          ['fetch', 'origin', `refs/heads/${options.branch}:refs/remotes/origin/${options.branch}`],
          repositoryRoot,
        );
        remoteTrackingSha = resolveLocalCommit(repositoryRoot, `refs/remotes/origin/${options.branch}`);
      }
      if (remoteTrackingSha) {
        const createTracking = runGit(
          ['branch', '--track', options.branch, `origin/${options.branch}`],
          repositoryRoot,
        );
        if (createTracking.ok) {
          localFeatureSha = resolveLocalCommit(repositoryRoot, featureReference);
          addAction(result, 'FEATURE_BRANCH_TRACKING_CREATED', `Created local tracking branch ${options.branch}.`);
        }
      }
    } else if (localTagSha === options.baselineSha) {
      const createFeature = runGit(['branch', options.branch, tagReference], repositoryRoot);
      if (createFeature.ok) {
        localFeatureSha = resolveLocalCommit(repositoryRoot, featureReference);
        addAction(result, 'FEATURE_BRANCH_CREATED', `Created ${options.branch} from the verified baseline tag.`);
      }
    }
  }

  remoteFeature = queryRemoteBranch(repositoryRoot, options.branch);
  localFeatureSha = resolveLocalCommit(repositoryRoot, featureReference);
  result.references.featureBranch = {
    localSha: localFeatureSha,
    remoteSha: remoteFeature.sha,
    remoteVerified: remoteFeature.available && remoteFeature.exists,
  };
  if (!localFeatureSha) {
    addWarning(result, 'FEATURE_BRANCH_MISSING', `The local ${options.branch} branch is missing; run repair mode to create it safely.`);
  }
  if (featureWasMissing && localFeatureSha && options.mode === 'repair' && !result.actions.some(({ code }) => code.startsWith('FEATURE_BRANCH_'))) {
    addAction(result, 'FEATURE_BRANCH_CREATED', `Created ${options.branch} from a verified source.`);
  }

  if (result.actual.branch !== options.branch && options.mode === 'repair' && localFeatureSha) {
    if (result.actual.dirty) {
      return failure(
        result,
        'WORKTREE_DIRTY_REQUIRES_RESCUE',
        `The working tree is dirty and must be rescued before switching from ${result.actual.branch || 'detached HEAD'} to ${options.branch}.`,
      );
    }
    const switchBranch = runGit(['switch', options.branch], repositoryRoot);
    if (!switchBranch.ok) {
      return failure(result, 'REPOSITORY_INVALID', `Git could not switch safely to ${options.branch}.`);
    }
    addAction(result, 'EXPECTED_BRANCH_SWITCHED', `Switched to ${options.branch}.`);
    result.actual.branch = options.branch;
    result.actual.head = runGit(['rev-parse', 'HEAD'], repositoryRoot).stdout;
  } else if (result.actual.branch !== options.branch) {
    addWarning(result, 'EXPECTED_BRANCH_NOT_ACTIVE', `The current branch is not ${options.branch}; repair mode can switch when the worktree is clean.`);
  }

  if (result.actual.dirty) {
    addWarning(
      result,
      'WORKTREE_DIRTY_REQUIRES_RESCUE',
      'The working tree is dirty. Inventory and rescue unknown changes deliberately before unrelated work.',
    );
  }

  for (const directory of REQUIRED_DIRECTORIES) {
    const absoluteDirectory = path.join(repositoryRoot, directory);
    if (existsSync(absoluteDirectory)) continue;
    if (options.mode === 'repair') {
      mkdirSync(absoluteDirectory, { recursive: true });
      result.directories.created.push(directory);
      addAction(result, 'DIRECTORY_CREATED', `Created ${directory}.`);
    } else {
      result.directories.missing.push(directory);
      addWarning(result, 'MISSING_DIRECTORY', `${directory} is missing; repair mode can create it.`);
    }
  }

  for (const output of EXPECTED_OUTPUTS) {
    if (existsSync(path.join(repositoryRoot, output))) {
      result.outputs.present.push(output);
    } else {
      result.outputs.missing.push(output);
      addWarning(result, 'MISSING_OUTPUT_RESOURCE', `${output} is missing and must be created by an evidence-producing prompt.`);
    }
  }

  const repairRequiredCode = result.warnings.find(({ code }) => [
    'BASELINE_TAG_MISSING',
    'BACKUP_BRANCH_MISSING',
    'FEATURE_BRANCH_MISSING',
    'WORKTREE_DIRTY_REQUIRES_RESCUE',
  ].includes(code))?.code;

  if (repairRequiredCode) {
    result.code = repairRequiredCode;
    result.ok = false;
  } else if (result.outputs.missing.length || result.directories.missing.length) {
    result.code = 'WORKSPACE_READY_WITH_MISSING_OUTPUTS';
  } else {
    result.code = 'WORKSPACE_READY';
  }

  return { result, exitCode: 0 };
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/ensure-durable-draft-workspace.mjs [options]',
    '',
    'Options:',
    '  --mode check|repair       Inspect only or safely repair local resources (default: check)',
    '  --branch <name>           Expected feature branch',
    '  --baseline-sha <sha>      Expected full baseline commit SHA',
    '  --json                    Emit machine-readable JSON',
    '  --help                    Show this help',
    '',
  ].join('\n'));
}

function emitResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const lines = [
    `${result.code}: ${result.ok ? 'ready' : 'attention required'}`,
    `mode=${result.mode}`,
    `repository=${result.repositoryRoot ?? 'unavailable'}`,
    `branch=${result.actual.branch ?? 'unavailable'}`,
    `head=${result.actual.head ?? 'unavailable'}`,
    `dirty=${result.actual.dirty ? 'yes' : 'no'}`,
  ];
  if (result.actions.length) {
    lines.push('actions:');
    for (const action of result.actions) lines.push(`- ${action.code}: ${action.message}`);
  }
  if (result.warnings.length) {
    lines.push('warnings:');
    for (const warning of result.warnings) lines.push(`- ${warning.code}: ${warning.message}`);
  }
  if (result.errors.length) {
    lines.push('errors:');
    for (const error of result.errors) lines.push(`- ${error.code}: ${error.message}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  const result = createResult(DEFAULTS);
  result.code = 'ARGUMENT_INVALID';
  result.ok = false;
  result.errors.push({ code: 'ARGUMENT_INVALID', message: error.message });
  emitResult(result, process.argv.includes('--json'));
  process.exitCode = 2;
}

if (options?.help) {
  printHelp();
} else if (options) {
  const { result, exitCode } = inspectWorkspace(options);
  emitResult(result, options.json);
  process.exitCode = exitCode;
}
