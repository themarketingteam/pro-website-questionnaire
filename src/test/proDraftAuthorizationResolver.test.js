import { describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_API_OPERATION_NAMES,
} from '../../base44/functions/_shared/proDraftApi/entry.ts';
import {
  AUTHORIZATION_SECRET_NAMES,
  PRO_DRAFT_AUTHORIZATION_VERSION,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  issueRecoverySessionToken,
  signStructuredToken,
} from '../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  PRO_DRAFT_RESOLVER_ERROR_CODES,
  authorizeDraftEvents,
  authorizeDraftRead,
  authorizeDraftWrite,
  getSafeResolvedAuthorizationDiagnostics,
  resolveDraftAuthorization,
} from '../../base44/functions/_shared/proDraftAuthorizationResolver/entry.ts';
import {
  createDraftRepository,
} from '../../base44/functions/_shared/proDraftRepository/entry.ts';
import {
  SECURITY_SECRET_NAMES,
} from '../../base44/functions/_shared/proDraftSecurity/entry.ts';

const NOW = 2_000_000_000;
const TOKEN_ID = `pdti_${'A'.repeat(43)}`;
const HASHES = {
  user: 'a'.repeat(64),
  email: 'b'.repeat(64),
  domain: 'c'.repeat(64),
  session: 'd'.repeat(64),
  identity: 'e'.repeat(64),
};
const resumeToken = 'R'.repeat(43);
const resumeTokenSecret = {
  name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
  value: 'r'.repeat(32),
};
const invitationSecret = {
  name: AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION,
  value: 'i'.repeat(32),
};
const recoverySessionSecret = {
  name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
  value: 's'.repeat(32),
};

const draft = (overrides = {}) => ({
  id: 'draft-synthetic-1',
  session_id: 'session-synthetic-1',
  status: 'active',
  server_revision: 5,
  recovery_session_version: 1,
  updated_date: '2026-08-05T12:00:00.000Z',
  ...overrides,
});
const entity = () => ({
  filter: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(draft()),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  bulkCreate: vi.fn(),
});
const setup = () => {
  const drafts = entity();
  const events = entity();
  const repository = createDraftRepository({
    asServiceRole: {
      entities: {
        ProFormDraft: drafts,
        ProFormDraftEvent: events,
      },
    },
  });
  return { repository, drafts, events };
};
const options = (repository, overrides = {}) => ({
  repository,
  environment: 'staging',
  formType: 'pro-questionnaire',
  grantVersion: 1,
  resumeTokenSecret,
  signedInvitationSecret: invitationSecret,
  recoverySessionSecret,
  clock: () => NOW,
  deriveIdentityKeyHash: vi.fn().mockResolvedValue(HASHES.identity),
  deriveSessionIdHash: vi.fn().mockResolvedValue(HASHES.session),
  ...overrides,
});
const request = (authorization, overrides = {}) => ({
  operation: PRO_DRAFT_API_OPERATION_NAMES.LOAD_DRAFT,
  authorization,
  requestedDraftId: 'draft-synthetic-1',
  ...overrides,
});
const invitationClaims = (overrides = {}) => ({
  version: PRO_DRAFT_AUTHORIZATION_VERSION,
  type: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
  scope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
  environment: 'staging',
  issuedAt: NOW,
  notBefore: NOW,
  expiresAt: NOW + 3600,
  tokenId: TOKEN_ID,
  grantVersion: 1,
  invitationId: 'invitation-synthetic-1',
  formType: 'pro-questionnaire',
  userIdHash: HASHES.user,
  recoveryEmailLookupHash: HASHES.email,
  domainIdentityHash: HASHES.domain,
  allowedAssociation: 'current_invitation',
  linkVersion: 1,
  ...overrides,
});
const recoveryToken = (scopes, overrides = {}) => issueRecoverySessionToken({
  environment: 'staging',
  draftId: 'draft-synthetic-1',
  sessionIdHash: HASHES.session,
  authorizationMethod: 'email',
  authorizedScopes: scopes,
  recoveryEmailLookupHash: HASHES.email,
  recoveryCodeVersion: 1,
  recoverySessionVersion: 1,
  grantVersion: 1,
  ...overrides,
}, {
  secret: recoverySessionSecret,
  clock: () => NOW,
  tokenIdGenerator: () => TOKEN_ID,
});

describe('draft authorization resolver', () => {
  it('normalizes, hashes, and resolves an exact resume token', async () => {
    const { repository, drafts } = setup();
    drafts.filter.mockResolvedValue([draft()]);
    const resolved = await resolveDraftAuthorization(
      request({ resumeToken }),
      options(repository),
    );
    expect(resolved).toMatchObject({
      method: 'resume_token',
      draftId: 'draft-synthetic-1',
      createsNewDraft: false,
      internalReasonCode: 'RESUME_TOKEN_MATCHED',
    });
    expect(drafts.filter).toHaveBeenCalledWith(
      { resume_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/u) },
      '-updated_date',
      2,
      0,
    );
    expect(JSON.stringify(getSafeResolvedAuthorizationDiagnostics(resolved)))
      .not.toContain(resumeToken);
  });

  it('rejects duplicate resume-token matches and wrong draft bindings', async () => {
    const { repository, drafts } = setup();
    drafts.filter.mockResolvedValue([draft(), draft({ id: 'draft-synthetic-2' })]);
    await expect(resolveDraftAuthorization(
      request({ resumeToken }),
      options(repository),
    )).rejects.toMatchObject({
      code: PRO_DRAFT_RESOLVER_ERROR_CODES.MULTIPLE_DRAFTS,
    });
    drafts.filter.mockResolvedValue([draft()]);
    await expect(resolveDraftAuthorization(
      request({ resumeToken }, { requestedDraftId: 'draft-wrong' }),
      options(repository),
    )).rejects.toMatchObject({
      code: PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID,
    });
  });

  it('verifies signed invitation claims and queries only the derived identity hash', async () => {
    const { repository, drafts } = setup();
    drafts.filter.mockResolvedValue([draft()]);
    const token = await signStructuredToken(invitationClaims(), {
      secret: invitationSecret,
    });
    const resolverOptions = options(repository);
    const resolved = await resolveDraftAuthorization(
      request({ signedDraftAccessToken: token }),
      resolverOptions,
    );
    expect(resolverOptions.deriveIdentityKeyHash).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: 'invitation-synthetic-1' }),
    );
    expect(drafts.filter).toHaveBeenCalledWith(
      { identity_key_hash: HASHES.identity },
      '-updated_date',
      25,
      0,
    );
    expect(resolved.internalReasonCode).toBe('SIGNED_INVITATION_IDENTITY_MATCHED');
  });

  it('allows a verified signed invitation to bootstrap a new association only', async () => {
    const { repository } = setup();
    const token = await signStructuredToken(invitationClaims({
      allowedAssociation: 'new_draft',
    }), { secret: invitationSecret });
    const resolved = await resolveDraftAuthorization(request(
      { signedDraftAccessToken: token },
      {
        operation: PRO_DRAFT_API_OPERATION_NAMES.BOOTSTRAP_DRAFT,
        requestedDraftId: undefined,
      },
    ), options(repository));
    expect(resolved).toMatchObject({
      createsNewDraft: true,
      draftId: null,
      scopes: ['draft:create'],
    });
    await expect(resolveDraftAuthorization(
      request({ signedDraftAccessToken: token }),
      options(repository),
    )).rejects.toMatchObject({
      code: PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_NOT_FOUND,
    });
  });

  it('forces a changed signed email into a new bootstrap association', async () => {
    const { repository, drafts } = setup();
    drafts.filter.mockResolvedValue([draft()]);
    const token = await signStructuredToken(invitationClaims(), {
      secret: invitationSecret,
    });
    const resolved = await resolveDraftAuthorization(request(
      { signedDraftAccessToken: token },
      {
        operation: PRO_DRAFT_API_OPERATION_NAMES.BOOTSTRAP_DRAFT,
        requestedDraftId: undefined,
        associationIntent: 'changed_signed_email',
      },
    ), options(repository));
    expect(resolved).toMatchObject({
      createsNewDraft: true,
      internalReasonCode: 'SIGNED_EMAIL_CHANGED_NEW_ASSOCIATION',
    });
    expect(drafts.filter).not.toHaveBeenCalled();
  });

  it('verifies a recovery session against its exact record and read scope', async () => {
    const { repository, drafts } = setup();
    drafts.get.mockResolvedValue(draft());
    const token = await recoveryToken([SIGNED_TOKEN_SCOPES.DRAFT_READ]);
    const resolved = await authorizeDraftRead(
      request({ recoverySessionToken: token }),
      options(repository),
    );
    expect(drafts.get).toHaveBeenCalledWith('draft-synthetic-1');
    expect(resolved).toMatchObject({
      method: 'recovery_session',
      draftId: 'draft-synthetic-1',
      scopes: ['draft:read'],
    });
  });

  it('rejects wrong recovery-session scope and requested draft', async () => {
    const { repository } = setup();
    const token = await recoveryToken([SIGNED_TOKEN_SCOPES.DRAFT_READ]);
    await expect(authorizeDraftWrite(
      request({ recoverySessionToken: token }, {
        operation: PRO_DRAFT_API_OPERATION_NAMES.SAVE_DRAFT,
      }),
      options(repository),
    )).rejects.toMatchObject({
      code: PRO_DRAFT_RESOLVER_ERROR_CODES.SCOPE_MISSING,
    });
    await expect(authorizeDraftRead(
      request({ recoverySessionToken: token }, {
        requestedDraftId: 'draft-wrong',
      }),
      options(repository),
    )).rejects.toMatchObject({
      code: PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID,
    });
  });

  it('rejects a recovery session whose session fingerprint is not exact', async () => {
    const { repository } = setup();
    const token = await recoveryToken([SIGNED_TOKEN_SCOPES.DRAFT_READ]);
    await expect(authorizeDraftRead(
      request({ recoverySessionToken: token }),
      options(repository, {
        deriveSessionIdHash: vi.fn().mockResolvedValue('f'.repeat(64)),
      }),
    )).rejects.toMatchObject({
      code: PRO_DRAFT_RESOLVER_ERROR_CODES.DRAFT_BINDING_INVALID,
    });
  });

  it('permits events through a recovery-session write scope', async () => {
    const { repository } = setup();
    const token = await recoveryToken([SIGNED_TOKEN_SCOPES.DRAFT_WRITE]);
    await expect(authorizeDraftEvents(
      request({ recoverySessionToken: token }, {
        operation: PRO_DRAFT_API_OPERATION_NAMES.APPEND_EVENTS,
      }),
      options(repository),
    )).resolves.toMatchObject({ draftId: 'draft-synthetic-1' });
  });

  it('requires submitted-read scope when the resolved record is submitted', async () => {
    const { repository, drafts } = setup();
    drafts.get.mockResolvedValue(draft({ status: 'submitted' }));
    const readToken = await recoveryToken([SIGNED_TOKEN_SCOPES.DRAFT_READ]);
    await expect(authorizeDraftRead(
      request({ recoverySessionToken: readToken }),
      options(repository),
    )).rejects.toMatchObject({
      code: PRO_DRAFT_RESOLVER_ERROR_CODES.SCOPE_MISSING,
    });
    const submittedToken = await recoveryToken([
      SIGNED_TOKEN_SCOPES.DRAFT_SUBMITTED_READ,
    ]);
    await expect(authorizeDraftRead(
      request({ recoverySessionToken: submittedToken }),
      options(repository),
    )).resolves.toMatchObject({ draftId: 'draft-synthetic-1' });
  });

  it('permits new anonymous authorization only for bootstrap create', async () => {
    const { repository } = setup();
    await expect(resolveDraftAuthorization(request({}, {
      operation: PRO_DRAFT_API_OPERATION_NAMES.BOOTSTRAP_DRAFT,
      requestedDraftId: undefined,
    }), options(repository))).resolves.toMatchObject({
      method: 'new_anonymous_draft',
      scopes: ['draft:create'],
      createsNewDraft: true,
    });
    await expect(resolveDraftAuthorization(request({}), options(repository)))
      .rejects.toMatchObject({
        code: PRO_DRAFT_RESOLVER_ERROR_CODES.NEW_DRAFT_OPERATION_INVALID,
      });
  });

  it('never treats raw email or user ID as authorization', async () => {
    const { repository } = setup();
    for (const authorization of [
      { recoveryEmail: 'synthetic@example.test' },
      { userId: 'synthetic-user' },
    ]) {
      await expect(resolveDraftAuthorization(
        request(authorization),
        options(repository),
      )).rejects.toBeTruthy();
    }
  });

  it('returns a generic public authorization failure', () => {
    const { repository } = setup();
    return resolveDraftAuthorization(request({ resumeToken: 'short' }), options(repository))
      .catch((error) => {
        expect(error.toSafeResponse()).toEqual({
          success: false,
          errorCode: 'AUTHORIZATION_DENIED',
          message: 'Authorization could not be verified.',
        });
        expect(JSON.stringify(error.toSafeResponse())).not.toMatch(/hash|token|email/iu);
      });
  });
});
