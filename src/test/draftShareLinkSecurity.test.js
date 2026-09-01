import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('draft share-link backend security contract', () => {
  it('stores only share-token hashes and requires protected recovery access', () => {
    const querySource = readProjectFile('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts');
    const entitySource = readProjectFile('base44/entities/ProFormDraft.jsonc');

    expect(querySource.indexOf("if (!isAdmin && !hasRecoveryAccess)")).toBeLessThan(
      querySource.indexOf("action === 'create_share_link'"),
    );
    expect(querySource).toContain('shared_access_token_hashes_json: JSON.stringify(nextHashes)');
    expect(querySource).not.toContain('shared_access_token_plaintext');
    expect(entitySource).toContain('"shared_access_token_hashes_json"');
    expect(entitySource).toContain('plaintext credentials are never stored');
  });

  it('accepts primary or administrator-issued hashes without invalidating current client links', () => {
    const syncSource = readProjectFile('base44/functions/syncProQuestionnaireDraft/entry.ts');

    expect(syncSource).toContain('const draftAcceptsAccessHash');
    expect(syncSource).toContain('primaryMatches || sharedMatches');
    expect(syncSource).toContain('candidates.find((candidate)');
  });
});
