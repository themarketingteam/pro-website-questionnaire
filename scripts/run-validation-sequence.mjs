import { spawnSync } from 'node:child_process';

const sequences = {
  'test-all': ['test:unit', 'test:baseline-characterization'],
  check: ['lint', 'typecheck', 'test:ci', 'build'],
};

const sequenceName = process.argv[2];
const steps = sequences[sequenceName];

if (!steps) {
  console.error(`Unknown validation sequence: ${sequenceName || '(missing)'}`);
  process.exit(2);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const results = [];

for (const step of steps) {
  console.log(`\n[validation] npm run ${step}`);
  const result = spawnSync(npmCommand, ['run', step], {
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: 'inherit',
  });

  const status = typeof result.status === 'number' ? result.status : 1;
  results.push({ step, status });
}

console.log('\n[validation] summary');
for (const { step, status } of results) {
  console.log(`${status === 0 ? 'PASS' : 'FAIL'} ${step} (exit ${status})`);
}

if (results.some(({ status }) => status !== 0)) {
  process.exitCode = 1;
}
