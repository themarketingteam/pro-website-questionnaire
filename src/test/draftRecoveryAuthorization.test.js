import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const paths = [
  'base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts',
  'base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts',
];

describe.each(paths)('%s persistent admin authorization boundary', (path) => {
  const source = readFileSync(resolve(process.cwd(), path), 'utf8');

  it('uses the shared persistent-grant verifier', () => {
    expect(source).toContain('authorizeAdminRecoveryRequest');
    expect(source).toContain('recordAdminOperationEvent');
  });

  it('does not use a Base44 admin session or role override', () => {
    expect(source).not.toContain('.auth.me(');
    expect(source).not.toMatch(/role\s*===\s*['"]admin/);
  });

  it('does not read the shared recovery password', () => {
    expect(source).not.toContain('DRAFT_RECOVERY_PASSWORD');
    expect(source).not.toContain('recoveryGrant');
  });

  it('forces no-store responses', () => {
    expect(source).toContain("Cache-Control', 'no-store, max-age=0");
  });
});
