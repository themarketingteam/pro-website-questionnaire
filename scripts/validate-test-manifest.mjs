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
const requiredScripts = [
  'test',
  'test:watch',
  'test:unit',
  'test:all',
  'test:submit-hardening',
  'test:baseline-characterization',
  'test:storage',
  'test:runtime-config',
  'test:ci',
  'test:manifest',
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
  scripts.check === 'node scripts/run-validation-sequence.mjs check',
  'check must use the complete validation sequence',
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
requireCondition(existsSync(normalConfigPath), 'src/vitest.config.js is missing');
requireCondition(
  existsSync(characterizationConfigPath),
  'src/vitest.baseline-characterization.config.js is missing',
);

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

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log(`normal_test_files=${normalTestFiles.length}`);
console.log(`characterization_test_files=${characterizationFiles.length}`);
console.log(`playwright_spec_files=${playwrightFiles.length}`);
console.log('status=PASS');
