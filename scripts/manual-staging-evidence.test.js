import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CONTRACTS,
  validateManualStagingEvidenceDocuments,
} from './validate-manual-staging-evidence.mjs';
import {
  assertNoBlockingAxeViolations,
  safeAxeSummary,
} from '../tests/e2e/helpers/accessibility.js';

const COMMIT = 'a'.repeat(40);
const escapeCell = (value) => String(value).replaceAll('|', '/');

const documentFor = (contract, { commit = COMMIT, omitId = '', row = {}, extra = '' } = {}) => {
  const headers = contract.requiredHeaders;
  const rows = contract.requiredIds.filter((id) => id !== omitId).map((id) => ({
    ...Object.fromEntries(headers.map((header) => [header, `${header} value`])),
    ID: id,
    Result: 'PASS',
    Tester: 'Synthetic Tester',
    'UTC timestamp': '2026-08-06T12:00:00.000Z',
    'Evidence reference': 'SAFE-EVIDENCE-001',
    ...(row.id === id ? row.values : {}),
  }));
  return [
    '# Evidence',
    `- Candidate commit: \`${commit}\``,
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((values) => `| ${headers.map((header) => escapeCell(values[header])).join(' | ')} |`),
    extra,
  ].join('\n');
};

const validDocuments = () => Object.fromEntries(Object.entries(EVIDENCE_CONTRACTS).map(([name, contract]) => [name, documentFor(contract)]));
const validate = (documents = validDocuments()) => validateManualStagingEvidenceDocuments({ currentCommit: COMMIT, documents });

describe('axe accessibility helper', () => {
  it('creates a safe moderate-finding summary', () => {
    expect(safeAxeSummary({ violations: [{ id: 'landmark-unique', impact: 'moderate', nodes: [{}, {}] }], passes: [{}, {}] }))
      .toMatchObject({ moderate: [{ id: 'landmark-unique', nodeCount: 2 }], passes: 2 });
  });

  it('fails serious violations', () => {
    expect(() => assertNoBlockingAxeViolations({ violations: [{ id: 'label', impact: 'serious', nodes: [{}] }] }))
      .toThrow('ACCESSIBILITY_BLOCKING_VIOLATIONS:serious:label');
  });
});

describe('manual staging evidence validator', () => {
  it('passes a complete manifest', () => expect(validate().verdict).toBe('PASS'));

  it('rejects a missing tester', () => {
    const documents = validDocuments();
    documents.accessibility = documentFor(EVIDENCE_CONTRACTS.accessibility, { row: { id: 'A11Y-MAN-001', values: { Tester: '' } } });
    expect(validate(documents).failureCodes).toContain('MANUAL_EVIDENCE_TESTER_MISSING');
  });

  it('rejects a missing device row', () => {
    const documents = validDocuments();
    documents.devices = documentFor(EVIDENCE_CONTRACTS.devices, { omitId: 'DEVICE-IOS-MAIL' });
    expect(validate(documents).failureCodes).toContain('MANUAL_EVIDENCE_REQUIRED_ROW_MISSING');
  });

  it('rejects evidence for another commit', () => {
    const documents = validDocuments();
    documents.email = documentFor(EVIDENCE_CONTRACTS.email, { commit: 'b'.repeat(40) });
    expect(validate(documents).failureCodes).toContain('MANUAL_EVIDENCE_STALE_COMMIT');
  });

  it('rejects a production URL', () => {
    const documents = validDocuments();
    documents.devices += '\nhttps://forms.mspsuccesswebsites.com/recover-draft';
    expect(validate(documents).failureCodes).toContain('MANUAL_EVIDENCE_PRODUCTION_URL');
  });

  it('rejects a credential-bearing link', () => {
    const documents = validDocuments();
    documents.devices += '\nhttps://staging.example.test/recover-draft?recoveryCode=redacted';
    expect(validate(documents).failureCodes).toContain('MANUAL_EVIDENCE_LINK_CREDENTIAL_QUERY');
  });

  it('validates the PDF report contract', () => {
    const documents = validDocuments();
    documents.pdf = documentFor(EVIDENCE_CONTRACTS.pdf, { omitId: 'PDF-UNICODE' });
    expect(validate(documents).failures).toContainEqual(expect.objectContaining({ detail: 'pdf:PDF-UNICODE' }));
  });

  it('validates the email-rendering report contract', () => {
    const documents = validDocuments();
    documents.email = documentFor(EVIDENCE_CONTRACTS.email, { omitId: 'EMAIL-IOS-MAIL' });
    expect(validate(documents).failures).toContainEqual(expect.objectContaining({ detail: 'email:EMAIL-IOS-MAIL' }));
  });
});
