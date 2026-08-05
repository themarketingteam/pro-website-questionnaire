const createStorageError = (message, name = 'SecurityError') => {
  if (typeof DOMException === 'function') return new DOMException(message, name);
  const error = new Error(message);
  error.name = name;
  return error;
};

export const createMemoryStorage = (initialValues = {}) => {
  const storage = {};

  Object.defineProperties(storage, {
    length: {
      configurable: true,
      get: () => Object.keys(storage).length,
    },
    clear: {
      configurable: true,
      value: () => {
        Object.keys(storage).forEach((key) => delete storage[key]);
      },
    },
    getItem: {
      configurable: true,
      value: (key) => (
        Object.prototype.hasOwnProperty.call(storage, String(key))
          ? storage[String(key)]
          : null
      ),
    },
    key: {
      configurable: true,
      value: (index) => Object.keys(storage)[index] ?? null,
    },
    removeItem: {
      configurable: true,
      value: (key) => delete storage[String(key)],
    },
    setItem: {
      configurable: true,
      value: (key, value) => {
        Object.defineProperty(storage, String(key), {
          configurable: true,
          enumerable: true,
          writable: true,
          value: String(value),
        });
      },
    },
  });

  for (const [key, value] of Object.entries(initialValues)) {
    storage.setItem(key, value);
  }

  return storage;
};

export const installStorageDescriptor = (name, descriptor) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);

  Object.defineProperty(globalThis, name, {
    configurable: true,
    ...descriptor,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, name, originalDescriptor);
    } else {
      delete globalThis[name];
    }
  };
};

export const installNormalStorage = (name = 'localStorage', initialValues = {}) => {
  const storage = createMemoryStorage(initialValues);
  const restore = installStorageDescriptor(name, { value: storage });
  return { storage, restore };
};

export const installStorageGetterThrows = (
  name = 'localStorage',
  error = createStorageError('Synthetic storage property access denied'),
) => installStorageDescriptor(name, {
  get() {
    throw error;
  },
});

export const installStorageReadThrows = (
  name = 'localStorage',
  error = createStorageError('Synthetic storage read denied'),
) => {
  const storage = createMemoryStorage();
  Object.defineProperties(storage, {
    getItem: { configurable: true, value: () => { throw error; } },
    key: { configurable: true, value: () => { throw error; } },
    length: { configurable: true, get: () => { throw error; } },
  });
  const restore = installStorageDescriptor(name, { value: storage });
  return { storage, restore };
};

export const installStorageWriteThrows = (
  name = 'localStorage',
  error = createStorageError('Synthetic storage write denied'),
) => {
  const storage = createMemoryStorage();
  const throwWriteError = () => { throw error; };
  Object.defineProperties(storage, {
    clear: { configurable: true, value: throwWriteError },
    removeItem: { configurable: true, value: throwWriteError },
    setItem: { configurable: true, value: throwWriteError },
  });
  const restore = installStorageDescriptor(name, { value: storage });
  return { storage, restore };
};

export const installStorageQuotaError = (name = 'localStorage') => {
  const storage = createMemoryStorage();
  const quotaError = createStorageError(
    'Synthetic storage quota exceeded',
    'QuotaExceededError',
  );
  Object.defineProperty(storage, 'setItem', {
    configurable: true,
    value: () => { throw quotaError; },
  });
  const restore = installStorageDescriptor(name, { value: storage });
  return { storage, restore };
};

export const installNormalTestStorage = () => ({
  local: installNormalStorage('localStorage'),
  session: installNormalStorage('sessionStorage'),
});
