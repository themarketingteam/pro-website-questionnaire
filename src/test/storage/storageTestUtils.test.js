import {
  createMemoryStorage,
  installNormalStorage,
  installStorageGetterThrows,
  installStorageQuotaError,
  installStorageReadThrows,
  installStorageWriteThrows,
} from '@/test/utils/storage';

describe('storage test utilities', () => {
  it('implements the Web Storage value and enumeration contract in memory', () => {
    const storage = createMemoryStorage({ seeded: 7 });

    storage.setItem('answer', 42);

    expect(storage.getItem('seeded')).toBe('7');
    expect(storage.getItem('answer')).toBe('42');
    expect(storage.length).toBe(2);
    expect(Object.keys(storage)).toEqual(['seeded', 'answer']);
    expect(storage.key(1)).toBe('answer');

    storage.removeItem('seeded');
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it('installs and restores normal storage', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const { storage, restore } = installNormalStorage('localStorage', { draft: 'safe' });

    expect(localStorage).toBe(storage);
    expect(localStorage.getItem('draft')).toBe('safe');

    restore();
    expect(Object.getOwnPropertyDescriptor(globalThis, 'localStorage')).toEqual(original);
  });

  it('models property, read, write, and quota failures', () => {
    const restoreGetter = installStorageGetterThrows();
    expect(() => localStorage).toThrowError(/property access denied/);
    restoreGetter();

    const read = installStorageReadThrows();
    expect(() => localStorage.getItem('draft')).toThrowError(/read denied/);
    read.restore();

    const write = installStorageWriteThrows();
    expect(() => localStorage.setItem('draft', 'value')).toThrowError(/write denied/);
    write.restore();

    const quota = installStorageQuotaError();
    expect(() => localStorage.setItem('draft', 'value')).toThrowError(
      expect.objectContaining({ name: 'QuotaExceededError' }),
    );
    quota.restore();
  });
});
