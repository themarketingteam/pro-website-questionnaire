import { base44 } from '@/api/base44Client';

describe('shared test harness contract', () => {
  it('exposes only the Base44 entity methods used by current production code', () => {
    for (const entity of Object.values(base44.entities)) {
      expect(Object.keys(entity).sort()).toEqual(['create', 'filter', 'list', 'update']);
    }
  });

  it('provides deterministic safe defaults for known calls', async () => {
    await expect(base44.entities.ProFormDraft.list()).resolves.toEqual([]);
    await expect(base44.functions.invoke('validateQuestionText', {})).resolves.toEqual({
      data: { status: 'complete' },
    });
  });

  it('rejects unknown Base44 function names', async () => {
    await expect(
      base44.functions.invoke('unregisteredSyntheticFunction', {}),
    ).rejects.toThrow('Unexpected Base44 function invocation in test');
  });
});
