import { describe, expect, it } from 'vitest';
import {
  QUESTIONNAIRE_STORAGE_KEY_VERSIONS,
  buildQuestionnaireStorageKey,
  deriveNamespaceSeed,
  deriveQuestionnaireBrowserNamespace,
  hashNamespaceSeed,
  normalizeQuestionnaireDomain,
  normalizeQuestionnaireEmailForNamespace,
  readQuestionnaireIdentityFromUrl,
} from '@/lib/questionnaireBrowserNamespace';

describe('questionnaire browser namespaces', () => {
  it.each([
    ['HTTPS://WWW.Example.COM/path?x=1', 'example.com'],
    ['example.com/', 'example.com'],
    ['  Sub.Example.COM:443  ', 'sub.example.com'],
    ['', ''],
  ])('normalizes domain %s', (input, expected) => {
    expect(normalizeQuestionnaireDomain(input)).toBe(expected);
  });

  it('normalizes email only for namespace derivation', () => {
    expect(normalizeQuestionnaireEmailForNamespace(' Person+Tag@Example.TEST '))
      .toBe('person+tag@example.test');
  });

  it('reads the current existing-flow identity parameters safely', () => {
    expect(readQuestionnaireIdentityFromUrl({
      href: 'https://questionnaire.example.test/?userId=user-1&userEmail=person%40example.test&businessName=Example%20Co&domainName=www.example.test',
    })).toMatchObject({
      userId: 'user-1',
      userEmail: 'person@example.test',
      businessName: 'Example Co',
      domainName: 'www.example.test',
    });
  });

  it('uses invitation, user, business/domain, email, then anonymous seed precedence', () => {
    expect(deriveNamespaceSeed({ signedInvitationId: 'invite', userId: 'user' }))
      .toBe('invitation:invite');
    expect(deriveNamespaceSeed({ userId: 'user', userEmail: 'person@example.test' }))
      .toBe('user:user');
    expect(deriveNamespaceSeed({
      domainName: 'WWW.Example.TEST',
      businessName: ' Example  Company ',
      userEmail: 'person@example.test',
    })).toBe('business:example.test|example company');
    expect(deriveNamespaceSeed({ userEmail: ' Person@Example.TEST ' }))
      .toBe('email:person@example.test');
    expect(deriveNamespaceSeed({}, { anonymousLaunchId: 'launch-1' }))
      .toBe('anonymous:launch-1');
  });

  it('derives the same namespace for equivalent identities', () => {
    const first = deriveQuestionnaireBrowserNamespace({ userId: 'synthetic-user-a' });
    const second = deriveQuestionnaireBrowserNamespace({
      userId: 'synthetic-user-a',
      userEmail: 'ignored@example.test',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^ns_[a-f\d]{32}$/);
    expect(hashNamespaceSeed('same-seed')).toBe(hashNamespaceSeed('same-seed'));
  });

  it('builds versioned keys without raw PII', () => {
    const identity = {
      userId: 'raw-user-123',
      userEmail: 'raw.person@example.test',
      businessName: 'Raw Example Company',
      domainName: 'raw-example.test',
    };
    const namespace = deriveQuestionnaireBrowserNamespace(identity);
    const keys = [
      'redux-state',
      'legacy-session',
      'draft-cache',
      'failure-backup',
      'migration-marker',
      'submitted-receipt',
    ].map((purpose) => buildQuestionnaireStorageKey({ namespace, purpose }));

    for (const key of keys) {
      expect(key).toMatch(/^pro-questionnaire:v4:ns_[a-f\d]{32}:/);
      expect(key).not.toContain(identity.userId);
      expect(key).not.toContain(identity.userEmail);
      expect(key).not.toContain(identity.businessName);
      expect(key).not.toContain(identity.domainName);
    }
    expect(QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT).toBe('v4');
  });
});
