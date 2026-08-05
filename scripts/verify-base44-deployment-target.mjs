#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  FAILURE_CODES,
  fingerprintOnlyResult,
  formatVerificationOutput,
  parseDeploymentFiles,
  validateDeploymentTarget
} from './lib/base44-deployment-target.js';

function parseArguments(argv) {
  const options = {
    allowDirtyReadOnly: false,
    fingerprintOnly: false,
    requiredEnvironment: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--read-only') {
      options.allowDirtyReadOnly = true;
    } else if (argument === '--fingerprint-only') {
      options.fingerprintOnly = true;
    } else if (argument === '--required-environment') {
      options.requiredEnvironment = argv[index + 1] || '';
      index += 1;
    } else if (argument.startsWith('--required-environment=')) {
      options.requiredEnvironment = argument.slice('--required-environment='.length);
    } else {
      return { ok: false };
    }
  }

  if (
    options.fingerprintOnly &&
    (options.allowDirtyReadOnly || options.requiredEnvironment)
  ) {
    return { ok: false };
  }

  if (
    options.requiredEnvironment &&
    !['staging', 'production'].includes(options.requiredEnvironment)
  ) {
    return { ok: false };
  }

  return { ok: true, options };
}

function findRepositoryRoot(startPath) {
  let candidate = path.resolve(startPath);
  while (true) {
    if (
      existsSync(path.join(candidate, 'package.json')) &&
      existsSync(path.join(candidate, 'base44'))
    ) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) return '';
    candidate = parent;
  }
}

async function readIfPresent(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function runGit(repositoryRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error('git command failed');
  }

  return result.status === 0 ? result.stdout.trim() : '';
}

function readGitState(repositoryRoot) {
  const branch = runGit(
    repositoryRoot,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { allowFailure: true }
  );
  const isDetachedHead = !branch;
  const exactGitTag = isDetachedHead
    ? runGit(repositoryRoot, ['describe', '--tags', '--exact-match', 'HEAD'], {
        allowFailure: true
      })
    : '';
  const status = runGit(repositoryRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all'
  ]);

  return {
    gitBranch: branch,
    exactGitTag,
    isDetachedHead,
    isDirty: Boolean(status)
  };
}

function emitAndExit(result, exitCode) {
  process.stdout.write(`${formatVerificationOutput(result)}\n`);
  process.exitCode = exitCode;
}

const argumentResult = parseArguments(process.argv.slice(2));
if (!argumentResult.ok) {
  emitAndExit(
    {
      ok: false,
      code: FAILURE_CODES.INVALID_ARGUMENT,
      environment: 'UNSET',
      appName: 'UNAVAILABLE',
      localAppId: '',
      gitBranch: 'UNAVAILABLE'
    },
    2
  );
} else {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = findRepositoryRoot(scriptDirectory);

  if (!repositoryRoot) {
    emitAndExit(
      {
        ok: false,
        code: FAILURE_CODES.REPOSITORY_ROOT_NOT_FOUND,
        environment: process.env.PRO_DEPLOY_ENVIRONMENT || 'UNSET',
        appName: 'UNAVAILABLE',
        localAppId: '',
        gitBranch: 'UNAVAILABLE'
      },
      2
    );
  } else {
    try {
      const gitState = readGitState(repositoryRoot);
      const [configText, appText] = await Promise.all([
        readIfPresent(path.join(repositoryRoot, 'base44', 'config.jsonc')),
        readIfPresent(path.join(repositoryRoot, 'base44', '.app.jsonc'))
      ]);
      const parsedFiles = parseDeploymentFiles({ configText, appText });

      if (!parsedFiles.ok) {
        emitAndExit(
          {
            ok: false,
            code: parsedFiles.code,
            environment: process.env.PRO_DEPLOY_ENVIRONMENT || 'UNSET',
            appName: parsedFiles.appName || 'UNAVAILABLE',
            localAppId: '',
            gitBranch:
              gitState.gitBranch ||
              (gitState.exactGitTag
                ? `DETACHED@${gitState.exactGitTag}`
                : 'DETACHED')
          },
          1
        );
      } else if (argumentResult.options.fingerprintOnly) {
        emitAndExit(
          fingerprintOnlyResult({
            appName: parsedFiles.appName,
            localAppId: parsedFiles.localAppId,
            gitBranch:
              gitState.gitBranch ||
              (gitState.exactGitTag
                ? `DETACHED@${gitState.exactGitTag}`
                : 'DETACHED')
          }),
          0
        );
      } else {
        const verification = validateDeploymentTarget({
          ...parsedFiles,
          ...gitState,
          environment: process.env.PRO_DEPLOY_ENVIRONMENT,
          expectedAppId: process.env.BASE44_EXPECTED_APP_ID,
          productionAppId: process.env.BASE44_PRODUCTION_APP_ID,
          stagingAppId: process.env.BASE44_STAGING_APP_ID,
          allowProductionDeploy: process.env.ALLOW_PRODUCTION_DEPLOY,
          expectedGitBranch: process.env.EXPECTED_GIT_BRANCH,
          frontendEnvironment: process.env.VITE_APP_ENVIRONMENT,
          allowDirtyReadOnly: argumentResult.options.allowDirtyReadOnly,
          requiredEnvironment: argumentResult.options.requiredEnvironment
        });

        emitAndExit(verification, verification.ok ? 0 : 1);
      }
    } catch {
      emitAndExit(
        {
          ok: false,
          code: FAILURE_CODES.VERIFICATION_INPUT_UNREADABLE,
          environment: process.env.PRO_DEPLOY_ENVIRONMENT || 'UNSET',
          appName: 'UNAVAILABLE',
          localAppId: '',
          gitBranch: 'UNAVAILABLE'
        },
        2
      );
    }
  }
}
