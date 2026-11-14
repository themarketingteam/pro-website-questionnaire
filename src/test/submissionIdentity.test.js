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

  it('treats historical rich mapped pages and compact pages as one submission while retaining hierarchy and priority', async () => {
    const page = (id, label) => ({ id, label, source: 'custom', catalogId: null, children: [] });
    const rich = { format: 'page-tree-v1', pages: [page('one', 'First'), page('two', 'Second')] };
    const compact = { format: 'page-tree-v1', pages: [{ label: 'First', source: 'custom' }, { label: 'Second', source: 'custom' }] };
    const base = { draftId: 'draft-1', businessName: 'Example', domain: 'example.test' };
    const first = await createClientSubmissionFingerprint({ ...base, payload: { userdata: { service_offerings_structure: rich } } });
    const second = await createClientSubmissionFingerprint({ ...base, payload: { userdata: { service_offerings_structure: compact } } });
    expect(first).toBe(second);
    compact.pages.reverse();
    expect(await createClientSubmissionFingerprint({ ...base, payload: { userdata: { service_offerings_structure: compact } } })).not.toBe(first);
  });
});
