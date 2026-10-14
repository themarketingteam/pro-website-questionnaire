import { describe, expect, it } from 'vitest';
import {
  createClientSubmissionFingerprint,
  createSubmissionAttemptId
} from '@/lib/submissionIdentity';

describe('submission identity and idempotency', () => {
  it('produces the same stable attempt for equivalent content regardless of key order', async () => {
    const first = await createClientSubmissionFingerprint({
      draftId: 'draft-1',
      businessName: 'Example Company',
      domain: 'https://www.example.com/path',
      payload: { userdata: { b: 2, a: { y: true, x: 'answer' } } }
    });
    const second = await createClientSubmissionFingerprint({
      draftId: 'draft-1',
      businessName: '  EXAMPLE   COMPANY ',
      domain: 'example.com',
      payload: { userdata: { a: { x: 'answer', y: true }, b: 2 } }
    });

    expect(second).toBe(first);
    expect(createSubmissionAttemptId(second)).toBe(createSubmissionAttemptId(first));
  });

  it('changes the attempt when either client identity, draft, or answers change', async () => {
    const base = {
      draftId: 'draft-1',
      businessName: 'Example Company',
      domain: 'example.com',
      rawResponses: { '1': 'yes' }
    };
    const fingerprints = await Promise.all([
      createClientSubmissionFingerprint(base),
      createClientSubmissionFingerprint({ ...base, draftId: 'draft-2' }),
      createClientSubmissionFingerprint({ ...base, businessName: 'Different Company' }),
      createClientSubmissionFingerprint({ ...base, domain: 'different.example' }),
      createClientSubmissionFingerprint({ ...base, rawResponses: { '1': 'no' } })
    ]);

    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});
