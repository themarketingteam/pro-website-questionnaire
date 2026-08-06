import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const OPERATIONS_DIRECTORY = 'docs/durable-draft-recovery/operations';
export const REQUIRED_RUNBOOKS = Object.freeze({
  'incident-severity-and-escalation.md': ['# Incident Severity and Escalation', '## SEV-1', '## SEV-2', '## SEV-3', 'Initial response:', 'Owner:', 'Escalation:', 'Communication cadence:', 'Kill-switch decision:', 'Rollback threshold:', 'Evidence preservation:', 'Resolution:'],
  'durable-draft-production-runbook.md': ['# Durable Draft Production Runbook', '## Architecture and environments', '## Feature flags and kill switch', '## Draft lifecycle and recovery', '## SES, CAPTCHA, and abuse controls', '## Admin grants and RLS', '## Migration and retention', '## Monitoring and health', '## Routine maintenance', '## Production deployment', '## Domain cutover', '## Rollback', '## Post-cutover monitoring', '## Evidence retention and contacts'],
  'client-support-playbook.md': ['# Client Support Playbook', '## Approved staff operations', '## Client has a recovery code', '## Client has email but no code', '## Client has neither code nor email', '## Client entered the wrong email', '## Multiple drafts under one email', '## Newest draft is submitted', '## Client wants an older active draft', '## Clear All created a new draft', '## Recovery-code email failed', '## Client closed the browser during upload', '## Draft is submit-failed', '## PDF unavailable', '## Browser blocks storage', '## Link opened from Outlook, Gmail, or Teams', '## Client believes answers are missing', '## Client requests deletion', '## Security or privacy concern'],
  'secret-rotation-runbook.md': ['# Secret Rotation Runbook', '## Universal procedure', '## Rotation matrix', 'Recovery-code hash', 'Email lookup', 'Resume-token', 'Recovery-session', 'Draft-link', 'Admin-grant', 'Admin password', 'Idempotency', 'Abuse hash', 'Operational fingerprint', 'Migration authorization', 'SES credentials', 'CAPTCHA', 'Zapier webhook', '## Hash-secret migration gate', '## Grant revocation'],
  'write-freeze-and-maintenance-runbook.md': ['# Write Freeze and Maintenance Runbook', '## Safety premise', '## Preconditions', '## Freeze sequence', '## Final delta and verification', '## Maintenance work', '## Unfreeze sequence', '## Rollback of freeze', '## Emergency unfreeze', '## Evidence'],
  'client-communication-templates.md': ['# Client Communication Templates', '## Planned maintenance', '## Draft saving temporarily unavailable', '## Recovery service degraded', '## Submission delayed', '## Service restored', '## Security incident acknowledgment', '## Individual recovery-code email failure', '## Domain cutover maintenance'],
  'kill-switch-decision-checklist.md': ['# Kill-Switch Decision Checklist', '## Activate immediately', '## Before restoring'],
  'domain-rollback-decision-checklist.md': ['# Domain Rollback Decision Checklist', '## Mandatory prerequisites', '## Exact stop conditions'],
  'data-migration-stop-conditions.md': ['# Data Migration Stop Conditions', '## Stop before starting', '## Stop during transfer', '## Stop before cutover', '## Stop reverse migration or rollback'],
  'support-training-certification.md': ['# Support Training Certification', '## Certification manifest', '## Certification rule'],
});

const SECRET_PATTERNS = Object.freeze([
  ['PRIVATE_KEY', /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/u],
  ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u],
  ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u],
  ['LIVE_SECRET', /\bsk_live_[A-Za-z0-9]{16,}\b/u],
  ['CREDENTIAL_URL', /https?:\/\/[^/@\s]+:[^/@\s]+@/u],
]);
const APP_ID_PATTERN = /\bapp_[a-z0-9]{8,}\b/iu;
const SUPPORTED_BASE44_COMMANDS = new Set(['whoami', 'logs', 'dashboard open', 'functions list', 'secrets list']);
const TRAINING_SCENARIOS = Object.freeze(['Recover by email', 'Recover by code', 'Multiple drafts', 'Submitted PDF', 'Clear All', 'Start New', 'Failed email', 'Failed submission', 'Admin grant', 'Retention hold', 'Security escalation', 'Browser storage blocker']);

const failure = (file, code, detail = '') => Object.freeze({file, code, detail});

export function parseTrainingManifest(markdown) {
  const rows = [];
  for (const line of String(markdown).split('\n')) {
    if (!line.startsWith('|') || /^\|[-:| ]+\|$/u.test(line)) continue;
    const fields = line.slice(1, -1).split('|').map((field) => field.trim());
    if (fields[0] === 'Scenario') continue;
    if (TRAINING_SCENARIOS.includes(fields[0])) rows.push(Object.freeze({scenario: fields[0], fields: Object.freeze(fields)}));
  }
  return Object.freeze(rows);
}

export function validateRunbookText(file, markdown, requiredSections = []) {
  const text = String(markdown); const failures = [];
  for (const section of requiredSections) if (!text.includes(section)) failures.push(failure(file, 'REQUIRED_SECTION_MISSING', section));
  if (/\b(?:TODO|TBD)\b/iu.test(text)) failures.push(failure(file, 'UNASSIGNED_RELEASE_PLACEHOLDER'));
  for (const [name, pattern] of SECRET_PATTERNS) if (pattern.test(text)) failures.push(failure(file, 'SECRET_PATTERN', name));
  if (APP_ID_PATTERN.test(text)) failures.push(failure(file, 'RAW_APP_ID'));
  for (const line of text.split('\n')) {
    const lower = line.toLowerCase();
    if (/disable\s+(?:the\s+)?rls/u.test(lower) && !/(?:do not|don't|never|must not|without disabling)/u.test(lower)) failures.push(failure(file, 'UNSAFE_RLS_INSTRUCTION'));
    if (/(?:git\s+push\s+(?:origin\s+)?main|push\s+directly\s+to\s+production)/u.test(lower) && !/(?:do not|don't|never|must not)/u.test(lower)) failures.push(failure(file, 'UNSAFE_PRODUCTION_PUSH'));
    if (/\s+$/u.test(line)) failures.push(failure(file, 'TRAILING_WHITESPACE'));
  }
  for (const match of text.matchAll(/npx\s+base44\s+([a-z-]+)(?:\s+([a-z-]+))?/giu)) {
    const command = [match[1], match[2]].filter(Boolean).join(' ').toLowerCase();
    if (!SUPPORTED_BASE44_COMMANDS.has(command)) failures.push(failure(file, 'UNSUPPORTED_BASE44_COMMAND', command));
  }
  if (!text.endsWith('\n')) failures.push(failure(file, 'MISSING_FINAL_NEWLINE'));
  if (file.includes('domain-rollback') || file.includes('production-runbook')) {
    if (!/dashboard\/manual action/iu.test(text)) failures.push(failure(file, 'DOMAIN_ACTION_NOT_MARKED_MANUAL'));
  }
  return Object.freeze(failures);
}

export function validateOperationsRunbooks(options = {}) {
  const root = options.root ?? process.cwd(); const readFile = options.readFile ?? ((file) => fs.readFileSync(file, 'utf8')); const exists = options.exists ?? fs.existsSync; const failures = [];
  for (const [name, sections] of Object.entries(REQUIRED_RUNBOOKS)) {
    const relative = path.join(OPERATIONS_DIRECTORY, name); const absolute = path.join(root, relative);
    if (!exists(absolute)) { failures.push(failure(relative, 'REQUIRED_FILE_MISSING')); continue; }
    let text; try { text = readFile(absolute); } catch { failures.push(failure(relative, 'READ_FAILED')); continue; }
    failures.push(...validateRunbookText(relative, text, sections));
    if (name === 'support-training-certification.md') {
      const rows = parseTrainingManifest(text); const seen = new Set(rows.map((row) => row.scenario));
      if (rows.length !== TRAINING_SCENARIOS.length || TRAINING_SCENARIOS.some((scenario) => !seen.has(scenario))) failures.push(failure(relative, 'TRAINING_SCENARIOS_INVALID'));
      if (rows.some((row) => row.fields.length !== 8)) failures.push(failure(relative, 'TRAINING_FIELDS_INVALID'));
      if (rows.some((row) => row.fields[5] !== 'PENDING')) failures.push(failure(relative, 'TRAINING_FALSELY_CERTIFIED'));
    }
  }
  return Object.freeze({ok: failures.length === 0, filesChecked: Object.keys(REQUIRED_RUNBOOKS).length, failures: Object.freeze(failures)});
}

function main() {
  const result = validateOperationsRunbooks();
  if (!result.ok) {
    for (const item of result.failures) process.stderr.write(`${item.file}: ${item.code}${item.detail ? ` (${item.detail})` : ''}\n`);
    process.stderr.write(`operations_runbooks=FAILED failures=${result.failures.length}\n`); process.exitCode = 1; return;
  }
  process.stdout.write(`operations_runbooks=PASS files=${result.filesChecked} training=NOT_CERTIFIED deployment=NONE\n`);
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) main();
