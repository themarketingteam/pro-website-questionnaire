import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const toRepositoryPath = (value) => path
  .relative(repositoryRoot, value)
  .split(path.sep)
  .join('/');

const ignoredDirectories = new Set([
  '.git',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const walk = (directory) => {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolutePath));
    } else if (entry.isFile()) {
      files.push(toRepositoryPath(absolutePath));
    }
  }

  return files;
};

const failures = [];
const requireCondition = (condition, message) => {
  if (!condition) failures.push(message);
};

const packagePath = path.join(repositoryRoot, 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const scripts = packageJson.scripts || {};
const requiredFoundationFiles = [
  '.github/workflows/durable-draft-quality.yml',
  '.github/workflows/durable-draft-staging-e2e.yml',
  '.node-version',
  'scripts/build-ci-summary.mjs',
  'scripts/scan-ci-source-safety.mjs',
  'src/lib/resilientStorage.js',
  'src/lib/questionnaireBrowserNamespace.js',
  'src/lib/questionnaireCanonicalDraftCache.js',
  'src/lib/legacyQuestionnaireStorage.js',
  'src/lib/sessionId.js',
  'src/components/store/QuestionnairePersistenceContext.jsx',
  'src/components/store/store.jsx',
  'src/components/store/localCanonicalDraftPersistence.js',
  'src/test/storage/resilientStorage.test.js',
  'src/test/questionnaireStore.test.jsx',
  'src/test/questionnaireCanonicalDraftCache.test.js',
  'src/test/localCanonicalDraftPersistence.test.js',
  'src/test/questionnaireLocalBootstrap.test.js',
  'src/test/questionnaireBrowserNamespace.test.js',
  'src/test/questionnaireSessionId.test.js',
  'src/test/legacyQuestionnaireStorage.test.js',
  'src/test/draftFailureBackup.test.js',
  'src/test/autoSaveIndicatorSafety.test.jsx',
  'docs/durable-draft-recovery/architecture/browser-storage-resilience.md',
  'docs/durable-draft-recovery/architecture/browser-namespace-and-legacy-key-policy.md',
  'docs/durable-draft-recovery/architecture/local-canonical-draft-cache.md',
  'src/components/common/AppInitializationError.jsx',
  'src/test/appParamsSafety.test.js',
  'src/test/base44ClientInitialization.test.js',
  'src/test/authContextSafety.test.jsx',
  'src/test/appInitializationError.test.jsx',
  'src/test/errorBoundarySafety.test.jsx',
  'tests/e2e/draft-v2/storage-recovery.spec.js',
  'tests/e2e/draft-v2/client-isolation.spec.js',
  'tests/e2e/draft-v2/identity-boundary.spec.js',
];

for (const file of requiredFoundationFiles) {
  requireCondition(
    existsSync(path.join(repositoryRoot, file)),
    `required CI foundation file is missing: ${file}`,
  );
}

const nodeVersionPath = path.join(repositoryRoot, '.node-version');
if (existsSync(nodeVersionPath)) {
  requireCondition(
    readFileSync(nodeVersionPath, 'utf8').trim() === '22.23.1',
    '.node-version must pin the approved Node 22 LTS patch',
  );
}

const qualityWorkflowPath = path.join(
  repositoryRoot,
  '.github/workflows/durable-draft-quality.yml',
);
if (existsSync(qualityWorkflowPath)) {
  const qualityWorkflow = readFileSync(qualityWorkflowPath, 'utf8');
  for (const jobId of [
    'source-safety',
    'unit-quality',
    'build',
    'e2e-harness',
    'pending-requirements-report',
  ]) {
    requireCondition(
      qualityWorkflow.includes(`  ${jobId}:`),
      `quality workflow is missing required job: ${jobId}`,
    );
  }
  for (const command of [
    'npm run lint',
    'npm run typecheck',
    'npm run test:ci',
    'npm run test:baseline-characterization',
    'npm run test:e2e:harness',
    'npm run test:base44-target',
    'npm run test:manifest',
  ]) {
    requireCondition(
      qualityWorkflow.includes(command),
      `quality workflow is missing authoritative command: ${command}`,
    );
  }
  requireCondition(
    !qualityWorkflow.includes('continue-on-error'),
    'quality workflow must not use continue-on-error',
  );
  requireCondition(
    !/\b(?:npx base44 deploy|npm run deploy:base44)/.test(qualityWorkflow),
    'quality workflow must never deploy Base44',
  );
  requireCondition(
    !qualityWorkflow.includes('test:e2e:pending-strict'),
    'strict pending enforcement is deferred from foundation CI',
  );
}

const stagingWorkflowPath = path.join(
  repositoryRoot,
  '.github/workflows/durable-draft-staging-e2e.yml',
);
if (existsSync(stagingWorkflowPath)) {
  const stagingWorkflow = readFileSync(stagingWorkflowPath, 'utf8');
  const triggerSection = stagingWorkflow.split('\npermissions:')[0];
  requireCondition(
    triggerSection.includes('  workflow_dispatch:'),
    'staging E2E workflow must support manual dispatch',
  );
  requireCondition(
    !/\n  (?:pull_request|push|schedule):/.test(triggerSection),
    'staging E2E workflow must remain manual-only',
  );
  requireCondition(
    stagingWorkflow.includes('secrets.PRO_DRAFT_STAGING_URL'),
    'staging E2E URL must come from the approved GitHub secret',
  );
  requireCondition(
    !stagingWorkflow.includes("E2E_ALLOW_WRITES: 'true'"),
    'staging E2E writes must remain disabled in foundation CI',
  );
  requireCondition(
    !/mspsuccesswebsites\.com|qtrypzzcjebvfcihiynt\.supabase\.co/.test(
      stagingWorkflow,
    ),
    'staging E2E workflow must not contain a production hostname',
  );
  requireCondition(
    !/\b(?:npx base44 deploy|npm run deploy:base44)/.test(stagingWorkflow),
    'staging E2E workflow must never deploy Base44',
  );
}
const requiredScripts = [
  'test',
  'test:watch',
  'test:unit',
  'test:all',
  'test:submit-hardening',
  'test:baseline-characterization',
  'test:storage',
  'test:runtime-config',
  'test:identity-contract',
  'test:ci',
  'test:manifest',
  'test:e2e',
  'test:e2e:smoke',
  'test:e2e:staging',
  'test:e2e:headed',
  'test:e2e:debug',
  'test:e2e:install',
  'test:e2e:edge',
  'test:e2e:harness',
  'test:e2e:pending-report',
  'test:e2e:pending-strict',
  'check',
];

for (const scriptName of requiredScripts) {
  requireCondition(
    typeof scripts[scriptName] === 'string' && scripts[scriptName].trim().length > 0,
    `package.json is missing the required ${scriptName} script`,
  );
}

for (const [scriptName, command] of Object.entries(scripts)) {
  requireCondition(
    !command.includes('--passWithNoTests'),
    `${scriptName} must not use --passWithNoTests`,
  );
}

requireCondition(
  scripts.test?.includes('--config src/vitest.config.js'),
  'test must use src/vitest.config.js',
);
requireCondition(
  scripts['test:watch']?.includes('--config src/vitest.config.js'),
  'test:watch must use src/vitest.config.js',
);
requireCondition(
  scripts['test:baseline-characterization']?.includes(
    '--config src/vitest.baseline-characterization.config.js',
  ),
  'test:baseline-characterization must use the characterization config',
);
requireCondition(
  scripts['test:ci']?.includes('--config src/vitest.config.js'),
  'test:ci must use src/vitest.config.js',
);
requireCondition(
  scripts['test:manifest'] === 'node scripts/validate-test-manifest.mjs',
  'test:manifest must execute scripts/validate-test-manifest.mjs',
);
requireCondition(
  scripts['test:identity-contract']
    === 'node scripts/validate-pro-draft-identity-contract.mjs',
  'test:identity-contract must execute the cross-runtime drift validator',
);
requireCondition(
  scripts.check === 'node scripts/run-validation-sequence.mjs check',
  'check must use the complete validation sequence',
);
requireCondition(
  scripts['test:e2e'] === 'playwright test',
  'test:e2e must use the fail-closed Playwright config',
);
requireCondition(
  scripts['test:e2e:staging'] === 'node scripts/run-e2e.mjs staging',
  'test:e2e:staging must use the staging preflight runner',
);
requireCondition(
  scripts['test:e2e:install'] === 'playwright install',
  'test:e2e:install must install browsers only when explicitly invoked',
);
requireCondition(
  scripts['test:e2e:pending-report']
    === 'node scripts/report-pending-draft-v2-tests.mjs',
  'test:e2e:pending-report must use the pending V2 reporter',
);
requireCondition(
  scripts['test:e2e:pending-strict']
    === 'node scripts/report-pending-draft-v2-tests.mjs --fail-on-pending',
  'test:e2e:pending-strict must fail when V2 scenarios remain pending',
);
requireCondition(
  typeof packageJson.devDependencies?.['@playwright/test'] === 'string',
  '@playwright/test must be a root development dependency',
);
requireCondition(
  typeof packageJson.devDependencies?.['fake-indexeddb'] === 'string',
  'fake-indexeddb must be a root development dependency for storage tests',
);
requireCondition(
  scripts['test:storage']?.includes('src/test/storage'),
  'test:storage must execute the resilient storage test directory',
);
requireCondition(
  !existsSync(path.join(repositoryRoot, 'src/package.json')),
  'src/package.json competes with the authoritative root package.json',
);

const requiredDirectories = [
  'src/lib/__tests__',
  'src/test',
  'src/test/fixtures',
  'src/test/storage',
  'src/test/utils',
  'tests/e2e',
  'tests/e2e/fixtures',
  'tests/e2e/draft-v2',
  'tests/e2e/harness',
  'tests/e2e/helpers',
  'tests/e2e/smoke',
];

for (const directory of requiredDirectories) {
  const absolutePath = path.join(repositoryRoot, directory);
  requireCondition(
    existsSync(absolutePath) && statSync(absolutePath).isDirectory(),
    `required test directory is missing: ${directory}`,
  );
}

const normalConfigPath = path.join(repositoryRoot, 'src/vitest.config.js');
const characterizationConfigPath = path.join(
  repositoryRoot,
  'src/vitest.baseline-characterization.config.js',
);
const playwrightConfigPath = path.join(repositoryRoot, 'playwright.config.js');
requireCondition(existsSync(normalConfigPath), 'src/vitest.config.js is missing');
requireCondition(
  existsSync(characterizationConfigPath),
  'src/vitest.baseline-characterization.config.js is missing',
);
requireCondition(existsSync(playwrightConfigPath), 'playwright.config.js is missing');

if (existsSync(normalConfigPath)) {
  const normalConfig = readFileSync(normalConfigPath, 'utf8');
  requireCondition(
    normalConfig.includes("'src/**/*.test.{js,jsx}'"),
    'normal Vitest config must explicitly include src unit tests',
  );
  requireCondition(
    normalConfig.includes("'scripts/**/*.test.{js,jsx}'"),
    'normal Vitest config must explicitly include script unit tests',
  );
  requireCondition(
    normalConfig.includes("'**/*.baseline-characterization.test.*'"),
    'normal Vitest config must exclude characterization tests',
  );
  requireCondition(
    normalConfig.includes("'tests/e2e/**'"),
    'normal Vitest config must exclude Playwright tests',
  );
}

if (existsSync(playwrightConfigPath)) {
  const playwrightConfig = readFileSync(playwrightConfigPath, 'utf8');
  requireCondition(
    playwrightConfig.includes("testDir: './tests/e2e'"),
    'Playwright must collect only tests/e2e',
  );
  requireCondition(
    playwrightConfig.includes('resolveE2ETarget(process.env)'),
    'Playwright config must validate target safety before launch',
  );
  requireCondition(
    playwrightConfig.includes("video: 'retain-on-failure'"),
    'Playwright config must retain failure video',
  );
}

if (existsSync(characterizationConfigPath)) {
  const characterizationConfig = readFileSync(characterizationConfigPath, 'utf8');
  requireCondition(
    characterizationConfig.includes(
      "'src/test/baseline-characterization/**/*.baseline-characterization.test.{js,jsx}'",
    ),
    'characterization config must use the required naming convention',
  );
  requireCondition(
    !characterizationConfig.includes('baseline-characterization.spec'),
    'characterization config must not collect .spec files',
  );
}

const repositoryFiles = walk(repositoryRoot).sort();
const testLikeFiles = repositoryFiles.filter((file) =>
  /\.(?:test|spec)\.(?:js|jsx|ts|tsx)$/.test(file),
);
const characterizationFiles = testLikeFiles.filter((file) =>
  /\.baseline-characterization\.test\.(?:js|jsx)$/.test(file),
);
const playwrightFiles = testLikeFiles.filter((file) =>
  file.startsWith('tests/e2e/') && /\.spec\.js$/.test(file),
);
const normalTestFiles = testLikeFiles.filter((file) =>
  !characterizationFiles.includes(file)
  && !playwrightFiles.includes(file)
  && /\.test\.(?:js|jsx)$/.test(file),
);

for (const file of testLikeFiles) {
  const isCharacterization = characterizationFiles.includes(file)
    && file.startsWith('src/test/baseline-characterization/');
  const isPlaywright = playwrightFiles.includes(file);
  const isNormal = normalTestFiles.includes(file)
    && (file.startsWith('src/') || file.startsWith('scripts/'));

  requireCondition(
    isCharacterization || isPlaywright || isNormal,
    `test file violates repository naming/location conventions: ${file}`,
  );
}

requireCondition(normalTestFiles.length > 0, 'no normal Vitest test files found');
requireCondition(
  characterizationFiles.length > 0,
  'no baseline characterization test files found',
);
requireCondition(playwrightFiles.length > 0, 'no Playwright smoke specs found');

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log(`normal_test_files=${normalTestFiles.length}`);
console.log(`characterization_test_files=${characterizationFiles.length}`);
console.log(`playwright_spec_files=${playwrightFiles.length}`);
console.log('status=PASS');
