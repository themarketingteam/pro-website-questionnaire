import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const frontendPath = path.join(
  repositoryRoot,
  'src/lib/proDraftRecoveryCodeContract.js',
);
const backendPath = path.join(
  repositoryRoot,
  'base44/functions/_shared/proDraftIdentity/entry.ts',
);
const fixturePath = path.join(
  repositoryRoot,
  'src/test/fixtures/proDraftIdentityConformance.json',
);

const frontendSource = readFileSync(frontendPath, 'utf8');
const backendSource = readFileSync(backendPath, 'utf8');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
const frontend = await import(pathToFileURL(frontendPath).href);
const transpiledBackend = ts.transpileModule(backendSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: backendPath,
  reportDiagnostics: true,
});

const failures = [];
const requireContract = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const diagnostic of transpiledBackend.diagnostics ?? []) {
  if (diagnostic.category === ts.DiagnosticCategory.Error) {
    failures.push(`backend transpilation error TS${diagnostic.code}`);
  }
}

let backend;
try {
  const encoded = Buffer.from(transpiledBackend.outputText).toString('base64');
  backend = await import(`data:text/javascript;base64,${encoded}`);
} catch {
  failures.push('backend contract module could not be evaluated');
  backend = {};
}

const contract = fixtures?.contract;
requireContract(contract && typeof contract === 'object', 'fixture contract is missing');
requireContract(
  Array.isArray(fixtures?.recoveryCodeNormalization)
    && fixtures.recoveryCodeNormalization.length > 0,
  'normalization fixtures are missing',
);
requireContract(
  Array.isArray(fixtures?.deterministicEncoding)
    && fixtures.deterministicEncoding.length > 0,
  'deterministic encoding fixtures are missing',
);
requireContract(
  Array.isArray(fixtures?.statusNormalization)
    && fixtures.statusNormalization.length > 0,
  'status-normalization fixtures are missing',
);
requireContract(
  Array.isArray(fixtures?.selections) && fixtures.selections.length > 0,
  'selection fixtures are missing',
);

for (const constant of [
  'RECOVERY_CODE_VERSION',
  'RECOVERY_CODE_ALPHABET',
  'RECOVERY_CODE_LENGTH',
  'RECOVERY_CODE_GROUP_SIZE',
  'RECOVERY_CODE_GROUP_COUNT',
]) {
  requireContract(
    frontend[constant] === backend[constant],
    `frontend/backend constant drift: ${constant}`,
  );
}

requireContract(
  frontend.RECOVERY_CODE_VERSION === contract?.recoveryCodeVersion,
  'fixture recovery-code version drift',
);
requireContract(
  frontend.RECOVERY_CODE_ALPHABET === contract?.alphabet,
  'fixture alphabet drift',
);
requireContract(
  frontend.RECOVERY_CODE_LENGTH === contract?.length,
  'fixture recovery-code length drift',
);
requireContract(
  frontend.RECOVERY_CODE_GROUP_SIZE === contract?.groupSize,
  'fixture recovery-code group-size drift',
);
requireContract(
  frontend.RECOVERY_CODE_GROUP_COUNT === contract?.groupCount,
  'fixture recovery-code group-count drift',
);
requireContract(
  frontend.RECOVERY_CODE_GROUP_SIZE * frontend.RECOVERY_CODE_GROUP_COUNT
    === frontend.RECOVERY_CODE_LENGTH,
  'group dimensions do not equal recovery-code length',
);

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
requireContract(
  sameJson(
    frontend.EMAIL_RECOVERY_ELIGIBLE_STATUSES,
    backend.EMAIL_RECOVERY_ELIGIBLE_STATUSES,
  ),
  'frontend/backend eligible-status drift',
);
requireContract(
  sameJson(
    frontend.EMAIL_RECOVERY_ELIGIBLE_STATUSES,
    contract?.emailRecoveryEligibleStatuses,
  ),
  'fixture eligible-status drift',
);
requireContract(
  sameJson(frontend.DRAFT_LIFECYCLE_STATUS_VALUES, backend.DRAFT_LIFECYCLE_STATUS_VALUES),
  'frontend/backend lifecycle-status drift',
);
requireContract(
  sameJson(frontend.DRAFT_LIFECYCLE_STATUS_VALUES, contract?.lifecycleStatuses),
  'fixture lifecycle-status drift',
);

const alphabet = frontend.RECOVERY_CODE_ALPHABET ?? '';
requireContract(alphabet.length === 31, 'alphabet must contain exactly 31 symbols');
requireContract(new Set(alphabet).size === alphabet.length, 'alphabet symbols must be unique');
requireContract(!/[01ILO]/u.test(alphabet), 'alphabet contains an ambiguous symbol');
const entropyBits = frontend.RECOVERY_CODE_LENGTH * Math.log2(alphabet.length);
requireContract(
  entropyBits >= (contract?.minimumEntropyBits ?? 96),
  'recovery-code format entropy is below the required minimum',
);

for (const fixture of fixtures.recoveryCodeNormalization ?? []) {
  const frontResult = frontend.normalizeRecoveryCodeInput?.(fixture.input);
  const backResult = backend.normalizeRecoveryCodeInput?.(fixture.input);
  for (const result of [frontResult, backResult]) {
    requireContract(
      result?.valid === fixture.valid
        && result?.normalizedCode === fixture.normalizedCode
        && result?.errorCode === fixture.errorCode,
      `normalization fixture mismatch: ${fixture.name}`,
    );
  }
}

for (const fixture of fixtures.deterministicEncoding ?? []) {
  try {
    requireContract(
      backend.encodeRecoveryCodeFromRandomValues?.(Uint8Array.from(fixture.bytes))
        === fixture.normalizedCode,
      `encoding fixture mismatch: ${fixture.name}`,
    );
  } catch {
    failures.push(`encoding fixture threw: ${fixture.name}`);
  }
}

for (const fixture of fixtures.statusNormalization ?? []) {
  requireContract(
    backend.normalizeLegacyDraftStatus?.(fixture.input, {
      isValidLegacyDraft: fixture.isValidLegacyDraft,
    }) === fixture.expected,
    `status fixture mismatch: ${String(fixture.input)}`,
  );
}

for (const fixture of fixtures.selections ?? []) {
  const result = backend.selectNewestEligibleDraft?.(fixture.records, fixture.options);
  requireContract(
    result?.selected?.id === fixture.selectedId
      && result?.eligibleCount === fixture.eligibleCount
      && sameJson(result?.diagnostics?.warnings, fixture.warnings),
    `selection fixture mismatch: ${fixture.name}`,
  );
}

for (const [name, source] of [
  ['frontend', frontendSource],
  ['backend', backendSource],
]) {
  requireContract(
    !/Math\s*\.\s*random\s*\(/u.test(source),
    `${name} contract contains a random-number generator`,
  );
  requireContract(
    !/console\s*\./u.test(source),
    `${name} contract contains console logging`,
  );
  requireContract(
    !/(?:log|warn|error|debug|info)\s*\([^)]*(?:normalizedCode|rawCode|recoveryCode|hint)/u.test(source),
    `${name} contract contains a possible raw-code logging pattern`,
  );
}

requireContract(
  !/(?:getRandomValues|randomBytes|subtle\s*\.\s*digest|createHash|createHmac)/u
    .test(frontendSource),
  'frontend contract must not generate or hash recovery codes',
);
requireContract(
  !/(?:@base44\/sdk|base44Client|createClientFromRequest)/u.test(frontendSource),
  'frontend contract must not call Base44',
);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `PRO_DRAFT_IDENTITY_CONTRACT_PASS entropy_bits=${entropyBits.toFixed(4)} `
  + `normalization_fixtures=${fixtures.recoveryCodeNormalization.length} `
  + `selection_fixtures=${fixtures.selections.length}\n`,
);
