import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBackend } from './utils/loadBackend';
import { memoryEntity } from './utils/memoryEntities';

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
    const authorization = readProjectFile('base44/shared/proDraftSubmissionAuthorization.ts');
    const receipts = readProjectFile('base44/shared/proSubmissionRetries.ts');
    expect(durable).toContain('authorizeDraftSubmission');
    expect(durable).toContain('await createProRetryReceiptLocked(');
    expect(receipts).toContain("retryFault('SUBMISSION_ATTEMPT_CONFLICT'");
    expect(durable).toContain("code: 'SUBMISSION_CONTENT_CONFLICT'");
    expect(authorization).toContain("code: 'SUBMISSION_IDENTITY_CONFLICT'");
    expect(authorization).toContain('constantTimeEqual');
    expect(authorization).not.toContain('console.log(resumeCredential');
  });

  it('rejects invalid credentials, cross-draft credentials and cross-client payloads with the actual authorizer', async () => {
    const { exposed } = loadBackend('base44/shared/proDraftSubmissionAuthorization.ts', {
      expose: 'authorizeDraftSubmission, hashDraftSubmissionValue',
    });
    const sessionId = 'identity_contract_session_123456';
    const secret = 'identity_contract_secret_abcdefghijklmnopqrstuvwxyz';
    const draft = { id: 'identity-source', session_id: sessionId, access_token_hash: await exposed.hashDraftSubmissionValue(secret), business_name: 'Saved Client', domain: 'saved-client.net' };
    const base44 = { asServiceRole: { entities: { ProFormDraft: memoryEntity('draft', [draft]) } } };
    const valid = { base44, resumeCredential: `${sessionId}.${secret}`, expectedDraftId: draft.id, payload: { metadata: { business_name: 'Saved Client', businessDomain: 'https://www.saved-client.net/' } } };
    await expect(exposed.authorizeDraftSubmission(valid)).resolves.toMatchObject({ authorized: true });
    await expect(exposed.authorizeDraftSubmission({ ...valid, resumeCredential: `${sessionId}.${secret}invalid` })).resolves.toMatchObject({ authorized: false, status: 401 });
    await expect(exposed.authorizeDraftSubmission({ ...valid, expectedDraftId: 'another-client-draft' })).resolves.toMatchObject({ authorized: false, status: 401 });
    await expect(exposed.authorizeDraftSubmission({ ...valid, payload: { metadata: { business_name: 'Another Client', businessDomain: 'another-client.net' } } })).resolves.toMatchObject({ authorized: false, status: 409, code: 'SUBMISSION_IDENTITY_CONFLICT' });
  });

  it('does not convert identity conflicts into a recoverable intake for another client', () => {
    const source = readProjectFile('base44/functions/submitProQuestionnaireFallback/entry.ts');
    expect(source).toContain("conflictCode.startsWith('SUBMISSION_')");
    expect(source).toContain("failureKind: 'identity'");
    expect(source).toContain('received: false');
  });
});
