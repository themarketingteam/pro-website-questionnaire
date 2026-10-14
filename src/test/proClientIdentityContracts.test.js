import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('server-side client identity contracts', () => {
  it('hashes new-client request ids and reuses the matching draft idempotently', () => {
    const source = readProjectFile('base44/functions/syncProQuestionnaireDraft/entry.ts');
    expect(source).toContain("hashToken(`pro-new-client:${requestId}`)");
    expect(source).toContain('{ new_client_request_hash: requestHash }');
    expect(source).toContain("code: 'NEW_CLIENT_REQUEST_IDENTITY_CONFLICT'");
    expect(source).toContain('newClientRequestConfirmed: true');
  });

  it('requires an identity decision before a secured draft can accept conflicting URL identity', () => {
    const source = readProjectFile('base44/functions/syncProQuestionnaireDraft/entry.ts');
    expect(source).toContain("cleanText(body?.identityDecision, 40) !== 'continue_existing'");
    expect(source).toContain('requiresIdentityDecision: true');
    expect(source).toContain("event_type: 'client_identity_conflict'");
  });

  it('authorizes submissions against an unguessable credential and rejects cross-client reuse', () => {
    const durable = readProjectFile('base44/functions/submitProQuestionnaireDurable/entry.ts');
    const authorization = readProjectFile('base44/functions/_shared/proDraftSubmissionAuthorization.ts');
    expect(durable).toContain("code: 'SUBMISSION_ATTEMPT_CONFLICT'");
    expect(durable).toContain("code: 'SUBMISSION_CONTENT_CONFLICT'");
    expect(authorization).toContain("code: 'SUBMISSION_IDENTITY_CONFLICT'");
    expect(authorization).toContain('constantTimeEqual');
    expect(authorization).not.toContain('console.log(resumeCredential');
  });

  it('does not convert identity conflicts into a recoverable intake for another client', () => {
    const source = readProjectFile('base44/functions/submitProQuestionnaireFallback/entry.ts');
    expect(source).toContain("conflictCode.startsWith('SUBMISSION_')");
    expect(source).toContain("failureKind: 'identity'");
    expect(source).toContain('received: false');
  });
});
