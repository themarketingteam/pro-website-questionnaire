import fc from 'fast-check';

export const DEFAULT_SECURITY_PROPERTY_SEED = 20_260_806;
export const DEFAULT_SECURITY_PROPERTY_RUNS = 100;

const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
};

export const getPropertyTestOptions = (overrides = {}) => Object.freeze({
  seed: boundedInteger(
    overrides.seed ?? process.env.SECURITY_PROPERTY_SEED,
    DEFAULT_SECURITY_PROPERTY_SEED,
    -0x80000000,
    0x7fffffff,
  ),
  numRuns: boundedInteger(
    overrides.numRuns ?? process.env.SECURITY_PROPERTY_RUNS,
    DEFAULT_SECURITY_PROPERTY_RUNS,
    1,
    1_000,
  ),
  endOnFailure: true,
});

export const safePropertyFailureMetadata = (result, options) => Object.freeze({
  seed: Number.isSafeInteger(result?.seed) ? result.seed : options.seed,
  path: typeof result?.counterexamplePath === 'string'
    ? result.counterexamplePath.slice(0, 160)
    : '',
  numRuns: Number.isSafeInteger(result?.numRuns) ? result.numRuns : 0,
  numSkips: Number.isSafeInteger(result?.numSkips) ? result.numSkips : 0,
  interrupted: Boolean(result?.interrupted),
  containsCounterexample: false,
});

export const assertSeededProperty = async (property, overrides = {}) => {
  const options = getPropertyTestOptions(overrides);
  const result = await fc.check(property, options);
  if (!result.failed) return Object.freeze({ ...options, failed: false });

  const metadata = safePropertyFailureMetadata(result, options);
  throw new Error(
    `SECURITY_PROPERTY_FAILED seed=${metadata.seed} path=${metadata.path || '<root>'}`
      + ` runs=${metadata.numRuns} skips=${metadata.numSkips}`,
  );
};

export { fc };
