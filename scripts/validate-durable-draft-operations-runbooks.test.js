import { describe, expect, it } from 'vitest';
import { OPERATIONS_DIRECTORY, REQUIRED_RUNBOOKS, parseTrainingManifest, validateOperationsRunbooks, validateRunbookText } from './validate-durable-draft-operations-runbooks.mjs';
import fs from 'node:fs';
import path from 'node:path';

describe('durable draft operations runbook validator', () => {
  it('accepts the complete committed runbook set and required sections', () => {
    const result = validateOperationsRunbooks({root: process.cwd()});
    expect(result).toMatchObject({ok: true, filesChecked: 10, failures: []});
    for (const name of Object.keys(REQUIRED_RUNBOOKS)) expect(fs.existsSync(path.join(OPERATIONS_DIRECTORY, name))).toBe(true);
  });

  it('rejects a missing file', () => {
    const result = validateOperationsRunbooks({root: '/synthetic-root', exists: () => false, readFile: () => ''});
    expect(result.ok).toBe(false); expect(result.failures.every((item) => item.code === 'REQUIRED_FILE_MISSING')).toBe(true);
  });

  it('rejects secret patterns, raw app IDs, unassigned placeholders, and trailing whitespace', () => {
    const syntheticAppId = ['app', '12345678'].join('_');
    const syntheticAwsKey = ['AKIA', '1234567890ABCDEF'].join('');
    const text = `# Safe\nTODO\n${syntheticAppId}\n${syntheticAwsKey}\nunsafe   \n`;
    const codes = validateRunbookText('synthetic.md', text).map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(['UNASSIGNED_RELEASE_PLACEHOLDER', 'RAW_APP_ID', 'SECRET_PATTERN', 'TRAILING_WHITESPACE']));
  });

  it('rejects unsupported Base44 commands and unsafe RLS or production-push instructions', () => {
    const failures = validateRunbookText('synthetic.md', '# Unsafe\nDisable RLS now.\nnpx base44 domain move\ngit push origin main\n');
    expect(failures.map((item) => item.code)).toEqual(expect.arrayContaining(['UNSAFE_RLS_INSTRUCTION', 'UNSUPPORTED_BASE44_COMMAND', 'UNSAFE_PRODUCTION_PUSH']));
  });

  it('requires domain operations to be explicitly dashboard/manual', () => {
    expect(validateRunbookText('domain-rollback-decision-checklist.md', '# Domain\n')).toContainEqual(expect.objectContaining({code: 'DOMAIN_ACTION_NOT_MARKED_MANUAL'}));
  });

  it('parses all pending training rows with eight fields and no false certification', () => {
    const text = fs.readFileSync(path.join(OPERATIONS_DIRECTORY, 'support-training-certification.md'), 'utf8'); const rows = parseTrainingManifest(text);
    expect(rows).toHaveLength(12); expect(rows.every((row) => row.fields.length === 8 && row.fields[5] === 'PENDING')).toBe(true);
  });

  it('validates plain-language communication templates and security exclusions', () => {
    const text = fs.readFileSync(path.join(OPERATIONS_DIRECTORY, 'client-communication-templates.md'), 'utf8');
    for (const heading of REQUIRED_RUNBOOKS['client-communication-templates.md']) expect(text).toContain(heading);
    expect(text).toContain('does not verify identity'); expect(text).not.toMatch(/AKIA[0-9A-Z]{16}|-----BEGIN .*PRIVATE KEY-----/u);
  });
});
