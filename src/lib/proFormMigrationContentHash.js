const HASH_VERSION = 1;
const HEX = [...Array(256)].map((_, value) => value.toString(16).padStart(2, '0'));

const isRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableValue(value[key])]),
  );
};

const splitPath = (path) => String(path)
  .replace(/\[\]/gu, '')
  .split('.')
  .filter(Boolean);

const replacePath = (root, path, replacement) => {
  const parts = splitPath(path);
  if (parts.length === 0) return;
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!isRecord(cursor?.[parts[index]])) return;
    cursor = cursor[parts[index]];
  }
  const leaf = parts.at(-1);
  if (leaf && Object.hasOwn(cursor, leaf)) cursor[leaf] = replacement;
};

const deepClone = (value) => {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined && typeof child !== 'function')
      .map(([key, child]) => [key, deepClone(child)]),
  );
};

const excludedFieldSet = (policy) => new Set([
  ...(Array.isArray(policy.serverManagedFields) ? policy.serverManagedFields : []),
  ...(Array.isArray(policy.excludedFields) ? policy.excludedFields : []),
  ...(Array.isArray(policy.contentHashExcludedFields) ? policy.contentHashExcludedFields : []),
]);

export function buildMigratableEntityProjection(record, policy, options = {}) {
  if (!isRecord(record) || !isRecord(policy)) {
    throw new TypeError('Migration projection requires a record and entity policy.');
  }
  const excluded = excludedFieldSet(policy);
  const projection = Object.fromEntries(
    Object.entries(record)
      .filter(([key, value]) => !excluded.has(key)
        && value !== undefined
        && typeof value !== 'function')
      .map(([key, value]) => [key, deepClone(value)]),
  );

  const suppliedIdentities = isRecord(options.relationshipIdentities)
    ? options.relationshipIdentities
    : {};
  for (const relationship of Array.isArray(policy.relationshipFields)
    ? policy.relationshipFields
    : []) {
    if (!isRecord(relationship) || typeof relationship.path !== 'string') continue;
    const supplied = suppliedIdentities[relationship.path];
    if (typeof supplied === 'string' && supplied.trim() !== '') {
      replacePath(projection, relationship.path, Object.freeze({
        logicalRelationshipIdentity: supplied.trim(),
        targetEntity: relationship.targetEntity ?? null,
      }));
    }
  }

  return stableValue(projection);
}
export function stableSerializeMigratableRecord(record, policy, options = {}) {
  return JSON.stringify(buildMigratableEntityProjection(record, policy, options));
}

const sha256Hex = async (value, cryptoProvider) => {
  const cryptoImpl = cryptoProvider ?? globalThis.crypto;
  if (!cryptoImpl?.subtle) throw new Error('SHA-256 provider unavailable.');
  const digest = await cryptoImpl.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) => HEX[byte]).join('');
};

export async function hashMigratableRecord(record, policy, options = {}) {
  return sha256Hex(
    stableSerializeMigratableRecord(record, policy, options),
    options.cryptoProvider,
  );
}

export async function compareMigratableRecords(
  sourceRecord,
  destinationRecord,
  policy,
  options = {},
) {
  const [sourceHash, destinationHash] = await Promise.all([
    hashMigratableRecord(sourceRecord, policy, options.source ?? options),
    hashMigratableRecord(destinationRecord, policy, options.destination ?? options),
  ]);
  return Object.freeze({
    equal: sourceHash === destinationHash,
    sourceHash,
    destinationHash,
  });
}

export function getSafeMigrationHashDiagnostics(input = {}) {
  const sourceHash = typeof input.sourceHash === 'string' ? input.sourceHash : null;
  const destinationHash = typeof input.destinationHash === 'string'
    ? input.destinationHash
    : null;
  return Object.freeze({
    version: HASH_VERSION,
    entityName: typeof input.entityName === 'string' ? input.entityName : null,
    compared: sourceHash !== null && destinationHash !== null,
    equal: sourceHash !== null && destinationHash !== null
      ? sourceHash === destinationHash
      : false,
    sourceHash,
    destinationHash,
    warnings: Object.freeze(Array.isArray(input.warnings)
      ? input.warnings.filter((warning) => typeof warning === 'string').slice(0, 20)
      : []),
  });
}
