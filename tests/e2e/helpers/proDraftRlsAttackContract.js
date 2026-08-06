const DIRECT_DENIAL_ACTORS = Object.freeze(['anonymous', 'authenticated_non_admin']);

const directDenialCases = DIRECT_DENIAL_ACTORS.flatMap((actor) => ([
  ['ProFormDraft', 'create'],
  ['ProFormDraft', 'read'],
  ['ProFormDraft', 'list'],
  ['ProFormDraft', 'filter'],
  ['ProFormDraft', 'update'],
  ['ProFormDraft', 'delete'],
  ['ProFormDraftEvent', 'create'],
  ['ProFormDraftEvent', 'read'],
  ['ProFormRecoverySecurityEvent', 'read'],
].map(([entity, operation]) => Object.freeze({
  id: `${actor}:${entity}:${operation}`,
  actor,
  transport: 'direct_entity',
  entity,
  operation,
  expected: 'denied',
  liveOnly: true,
}))));

const backendSuccessCases = [
  ['anonymous', 'bootstrapProFormDraft'],
  ['authorized_draft', 'saveProFormDraft'],
  ['authorized_recovery', 'recoverProFormDraftByCode'],
  ['password_grant_admin', 'listProFormDraftsForRecovery'],
].map(([actor, functionName]) => Object.freeze({
  id: `${actor}:function:${functionName}`,
  actor,
  transport: 'backend_function',
  functionName,
  expected: 'allowed',
  liveOnly: true,
}));

export const proDraftRlsAttackContract = Object.freeze({
  version: 1,
  executionPhase: 'prompt-4-live-staging-only',
  directDenialCases: Object.freeze(directDenialCases),
  backendSuccessCases: Object.freeze(backendSuccessCases),
});

export function assertValidProDraftRlsAttackContract(contract = proDraftRlsAttackContract) {
  const ids = [
    ...contract.directDenialCases,
    ...contract.backendSuccessCases,
  ].map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_RLS_ATTACK_CASE');
  if (contract.directDenialCases.some((entry) => (
    entry.transport !== 'direct_entity'
    || entry.expected !== 'denied'
    || entry.liveOnly !== true
  ))) throw new Error('INVALID_DIRECT_RLS_ATTACK_CASE');
  if (contract.backendSuccessCases.some((entry) => (
    entry.transport !== 'backend_function'
    || entry.expected !== 'allowed'
    || entry.liveOnly !== true
  ))) throw new Error('INVALID_BACKEND_RLS_ATTACK_CASE');
  return true;
}
