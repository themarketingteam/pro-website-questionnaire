import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/ensure-durable-draft-workspace.mjs');
const TAG = 'pre-durable-draft-recovery-2026-08-05';
const BACKUP_BRANCH = 'backup/pre-durable-draft-recovery-2026-08-05';
const FEATURE_BRANCH = 'feature/durable-draft-recovery';
const REQUIRED_DIRECTORIES = [
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
];
const OUTPUT_FILES = [
  'docs/durable-draft-recovery/baseline/source-baseline-manifest.md',
  'docs/durable-draft-recovery/baseline/source-baseline-validation.md',
  'docs/durable-draft-recovery/baseline/source-rollback-rehearsal.md',
];

const temporaryRoots = [];

function run(command, args, cwd, options = {}) {
  const execution = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    maxBuffer: 10 * 1024 * 1024,
  });

  if (options.expectSuccess !== false && execution.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with ${execution.status}`,
      execution.stdout,
      execution.stderr,
    ].filter(Boolean).join('\n'));
  }

  return execution;
}

function git(cwd, ...args) {
  return run('git', args, cwd).stdout.trim();
}

function write(relativePath, content, workspace) {
  const absolutePath = path.join(workspace, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function createFixture({
  completeDirectories = true,
  outputFiles = OUTPUT_FILES,
  pushTag = true,
  pushBackup = true,
  pushFeature = true,
  currentBranch = FEATURE_BRANCH,
} = {}) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'durable-workspace-test-'));
  temporaryRoots.push(temporaryRoot);
  const origin = path.join(temporaryRoot, 'origin.git');
  const workspace = path.join(temporaryRoot, 'workspace');
  mkdirSync(workspace);

  run('git', ['init', '--bare', origin], temporaryRoot);
  run('git', ['init', '-b', 'main'], workspace);
  git(workspace, 'config', 'user.name', 'Workspace Test');
  git(workspace, 'config', 'user.email', 'workspace-test@example.invalid');

  write('package.json', '{"name":"workspace-fixture","private":true,"type":"module"}\n', workspace);
  write('base44/config.jsonc', '{"name":"Workspace Fixture"}\n', workspace);
  for (const output of outputFiles) write(output, `fixture for ${path.basename(output)}\n`, workspace);
  if (completeDirectories) {
    for (const directory of REQUIRED_DIRECTORIES) {
      mkdirSync(path.join(workspace, directory), { recursive: true });
    }
  }

  git(workspace, 'add', '-A');
  git(workspace, 'commit', '-m', 'fixture baseline');
  const baselineSha = git(workspace, 'rev-parse', 'HEAD');
  git(workspace, 'tag', '-a', TAG, '-m', 'fixture baseline', baselineSha);
  git(workspace, 'branch', BACKUP_BRANCH, baselineSha);
  git(workspace, 'branch', FEATURE_BRANCH, baselineSha);
  git(workspace, 'remote', 'add', 'origin', origin);
  git(workspace, 'push', 'origin', 'main');
  if (pushTag) git(workspace, 'push', 'origin', `refs/tags/${TAG}`);
  if (pushBackup) git(workspace, 'push', 'origin', `refs/heads/${BACKUP_BRANCH}`);
  if (pushFeature) git(workspace, 'push', 'origin', `refs/heads/${FEATURE_BRANCH}`);
  git(workspace, 'switch', currentBranch);

  return { temporaryRoot, origin, workspace, baselineSha };
}

function runUtility(fixture, {
  mode = 'check',
  branch = FEATURE_BRANCH,
  baselineSha = fixture.baselineSha,
  env,
} = {}) {
  const execution = run(
    process.execPath,
    [
      SCRIPT_PATH,
      '--mode', mode,
      '--branch', branch,
      '--baseline-sha', baselineSha,
      '--json',
    ],
    fixture.workspace,
    { expectSuccess: false, env },
  );

  return {
    execution,
    result: JSON.parse(execution.stdout),
  };
}

function deleteLocalFeature(fixture) {
  git(fixture.workspace, 'switch', 'main');
  git(fixture.workspace, 'branch', '-D', FEATURE_BRANCH);
}

function createSecondCommit(fixture) {
  write('second.txt', 'second commit\n', fixture.workspace);
  git(fixture.workspace, 'add', 'second.txt');
  git(fixture.workspace, 'commit', '-m', 'second fixture commit');
  return git(fixture.workspace, 'rev-parse', 'HEAD');
}

afterEach(() => {
  while (temporaryRoots.length) {
    const temporaryRoot = temporaryRoots.pop();
    if (temporaryRoot.startsWith(path.join(os.tmpdir(), 'durable-workspace-test-'))) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
});

describe('ensure-durable-draft-workspace', () => {
  it('reports a valid complete workspace as ready', () => {
    const fixture = createFixture();
    const { execution, result } = runUtility(fixture);

    expect(execution.status).toBe(0);
    expect(result.code).toBe('WORKSPACE_READY');
    expect(result.ok).toBe(true);
    expect(result.actual.branch).toBe(FEATURE_BRANCH);
    expect(result.references.baselineTag.localSha).toBe(fixture.baselineSha);
    expect(result.references.backupBranch.localSha).toBe(fixture.baselineSha);
  });

  it('fetches a missing local baseline tag from a valid remote tag', () => {
    const fixture = createFixture();
    git(fixture.workspace, 'tag', '-d', TAG);

    const { execution, result } = runUtility(fixture, { mode: 'repair' });

    expect(execution.status).toBe(0);
    expect(git(fixture.workspace, 'rev-parse', `${TAG}^{}`)).toBe(fixture.baselineSha);
    expect(result.actions.map(({ code }) => code)).toContain('BASELINE_TAG_FETCHED');
  });

  it('creates a missing local backup branch from the valid remote branch', () => {
    const fixture = createFixture();
    git(fixture.workspace, 'branch', '-D', BACKUP_BRANCH);

    const { execution, result } = runUtility(fixture, { mode: 'repair' });

    expect(execution.status).toBe(0);
    expect(git(fixture.workspace, 'rev-parse', BACKUP_BRANCH)).toBe(fixture.baselineSha);
    expect(result.actions.map(({ code }) => code)).toContain('BACKUP_BRANCH_TRACKING_CREATED');
  });

  it('creates a missing local feature branch tracking the valid remote branch', () => {
    const fixture = createFixture();
    deleteLocalFeature(fixture);

    const { execution, result } = runUtility(fixture, { mode: 'repair' });

    expect(execution.status).toBe(0);
    expect(git(fixture.workspace, 'branch', '--show-current')).toBe(FEATURE_BRANCH);
    expect(git(fixture.workspace, 'rev-parse', FEATURE_BRANCH)).toBe(fixture.baselineSha);
    expect(result.actions.map(({ code }) => code)).toContain('FEATURE_BRANCH_TRACKING_CREATED');
  });

  it('creates a missing local and remote feature branch from the verified baseline', () => {
    const fixture = createFixture({ pushFeature: false });
    deleteLocalFeature(fixture);

    const { execution, result } = runUtility(fixture, { mode: 'repair' });

    expect(execution.status).toBe(0);
    expect(git(fixture.workspace, 'branch', '--show-current')).toBe(FEATURE_BRANCH);
    expect(git(fixture.workspace, 'rev-parse', FEATURE_BRANCH)).toBe(fixture.baselineSha);
    expect(result.actions.map(({ code }) => code)).toContain('FEATURE_BRANCH_CREATED');
    expect(git(fixture.workspace, 'ls-remote', '--heads', 'origin', FEATURE_BRANCH)).toBe('');
  });

  it('creates missing documentation directories in repair mode', () => {
    const fixture = createFixture({ completeDirectories: false, outputFiles: [] });
    const { execution, result } = runUtility(fixture, { mode: 'repair' });

    expect(execution.status).toBe(0);
    for (const directory of REQUIRED_DIRECTORIES) {
      expect(existsSync(path.join(fixture.workspace, directory))).toBe(true);
    }
    expect(result.directories.created).toEqual(REQUIRED_DIRECTORIES);
  });

  it('reports missing directories in check mode without mutating', () => {
    const fixture = createFixture({ completeDirectories: false, outputFiles: [] });
    const { execution, result } = runUtility(fixture);

    expect(execution.status).toBe(0);
    expect(result.directories.missing).toEqual(REQUIRED_DIRECTORIES);
    for (const directory of REQUIRED_DIRECTORIES) {
      expect(existsSync(path.join(fixture.workspace, directory))).toBe(false);
    }
  });

  it('is idempotent across repeated repair runs', () => {
    const fixture = createFixture({ completeDirectories: false, outputFiles: [] });
    const first = runUtility(fixture, { mode: 'repair' });
    const second = runUtility(fixture, { mode: 'repair' });

    expect(first.execution.status).toBe(0);
    expect(second.execution.status).toBe(0);
    expect(first.result.actions.filter(({ code }) => code === 'DIRECTORY_CREATED')).toHaveLength(10);
    expect(second.result.actions.filter(({ code }) => code === 'DIRECTORY_CREATED')).toHaveLength(0);
    expect(second.result.directories.created).toEqual([]);
  });

  it('fails on a baseline tag SHA conflict', () => {
    const fixture = createFixture();
    const secondSha = createSecondCommit(fixture);
    git(fixture.workspace, 'tag', '-f', TAG, secondSha);

    const { execution, result } = runUtility(fixture);

    expect(execution.status).not.toBe(0);
    expect(result.code).toBe('BASELINE_TAG_CONFLICT');
  });

  it('fails on a backup branch SHA conflict', () => {
    const fixture = createFixture();
    const secondSha = createSecondCommit(fixture);
    git(fixture.workspace, 'branch', '-f', BACKUP_BRANCH, secondSha);

    const { execution, result } = runUtility(fixture);

    expect(execution.status).not.toBe(0);
    expect(result.code).toBe('BACKUP_BRANCH_CONFLICT');
  });

  it('reports a dirty worktree without mutating or failing when no switch is needed', () => {
    const fixture = createFixture();
    write('dirty.txt', 'uncommitted work\n', fixture.workspace);

    const { execution, result } = runUtility(fixture);

    expect(execution.status).toBe(0);
    expect(result.code).toBe('WORKTREE_DIRTY_REQUIRES_RESCUE');
    expect(result.actual.dirty).toBe(true);
    expect(existsSync(path.join(fixture.workspace, 'dirty.txt'))).toBe(true);
  });

  it('fails when origin is missing', () => {
    const fixture = createFixture();
    git(fixture.workspace, 'remote', 'remove', 'origin');

    const { execution, result } = runUtility(fixture);

    expect(execution.status).not.toBe(0);
    expect(result.code).toBe('ORIGIN_MISSING');
  });

  it('fails when package.json is missing', () => {
    const fixture = createFixture();
    unlinkSync(path.join(fixture.workspace, 'package.json'));

    const { execution, result } = runUtility(fixture);

    expect(execution.status).not.toBe(0);
    expect(result.code).toBe('PACKAGE_JSON_MISSING');
  });

  it('fails when base44/config.jsonc is missing', () => {
    const fixture = createFixture();
    unlinkSync(path.join(fixture.workspace, 'base44', 'config.jsonc'));

    const { execution, result } = runUtility(fixture);

    expect(execution.status).not.toBe(0);
    expect(result.code).toBe('BASE44_CONFIG_MISSING');
  });

  it('reports a missing validation report without fabricating it', () => {
    const fixture = createFixture({
      outputFiles: [OUTPUT_FILES[0], OUTPUT_FILES[2]],
    });

    const { execution, result } = runUtility(fixture);

    expect(execution.status).toBe(0);
    expect(result.code).toBe('WORKSPACE_READY_WITH_MISSING_OUTPUTS');
    expect(result.outputs.missing).toContain(OUTPUT_FILES[1]);
    expect(existsSync(path.join(fixture.workspace, OUTPUT_FILES[1]))).toBe(false);
  });

  it('emits valid JSON without secret-like environment values', () => {
    const fixture = createFixture();
    const secretValue = 'test-secret-value-that-must-not-appear';
    const { execution, result } = runUtility(fixture, {
      env: {
        AWS_SECRET_ACCESS_KEY: secretValue,
        BASE44_ACCESS_TOKEN: `${secretValue}-base44`,
      },
    });

    expect(execution.status).toBe(0);
    expect(result.schemaVersion).toBe(1);
    expect(execution.stdout).not.toContain(secretValue);
    expect(execution.stderr).not.toContain(secretValue);
  });

  it('does not push or invoke Base44 commands during repair', () => {
    const fixture = createFixture({ completeDirectories: false, outputFiles: [] });
    const remoteBefore = git(fixture.workspace, 'ls-remote', 'origin');
    const fakeBin = path.join(fixture.temporaryRoot, 'fake-bin');
    const invocationMarker = path.join(fixture.temporaryRoot, 'base44-command-invoked');
    mkdirSync(fakeBin);

    for (const command of ['base44', 'npx']) {
      const executable = path.join(fakeBin, command);
      writeFileSync(
        executable,
        `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(invocationMarker)}, ${JSON.stringify(command)});\n`,
      );
      chmodSync(executable, 0o755);
    }

    const { execution } = runUtility(fixture, {
      mode: 'repair',
      env: { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    });
    const remoteAfter = git(fixture.workspace, 'ls-remote', 'origin');

    expect(execution.status).toBe(0);
    expect(remoteAfter).toBe(remoteBefore);
    expect(existsSync(invocationMarker)).toBe(false);
    expect(readFileSync(SCRIPT_PATH, 'utf8')).not.toMatch(/runGit\(\s*\[\s*['"]push['"]/);
  });
});
