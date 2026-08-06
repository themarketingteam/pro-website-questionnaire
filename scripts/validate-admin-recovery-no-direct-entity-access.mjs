import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = [
  'src/pages/ProFormDraftRecovery.jsx',
  'src/pages/QuestionnaireIntakeRecovery.jsx',
  'src/components/admin/DraftEditPanel.jsx',
  'src/components/admin/DraftRecoveryPasswordGate.jsx',
  'src/components/admin/ProDraftAdminRecoveryShell.jsx',
  'src/components/admin/ProDraftEventHistory.jsx',
  'src/components/admin/ProDraftLineagePanel.jsx',
  'src/components/admin/QuestionnaireIntakeRecovery.jsx',
];
const forbiddenEntities = [
  'ProFormDraft',
  'ProFormDraftEvent',
  'ProFormSubmissionIntake',
  'ProFormRecoverySecurityEvent',
  'ProFormEmailVerificationAttempt',
  'ProFormAdminRecoveryGrant',
  'ProFormAdminRecoveryAttempt',
];
const failures = [];

for (const file of files) {
  const source = await readFile(resolve(root, file), 'utf8');
  for (const entity of forbiddenEntities) {
    const patterns = [
      new RegExp(`base44\\s*\\.\\s*entities\\s*\\.\\s*${entity}\\b`, 'u'),
      new RegExp(`base44\\s*\\.\\s*entities\\s*\\[\\s*['\"]${entity}['\"]\\s*\\]`, 'u'),
    ];
    if (patterns.some((pattern) => pattern.test(source))) failures.push(`${file}: direct ${entity} access`);
  }
}

if (failures.length) {
  console.error('ADMIN_RECOVERY_DIRECT_ENTITY_ACCESS');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Admin recovery entity boundary verified across ${files.length} source files.`);
}
