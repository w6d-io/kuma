import { describe, expect, it } from 'vitest';
import type { SignInProtection } from '../api/client';
import { draftProblems, fromDraft, parseEntries, protectionWarnings, sameProtection, splitAllowList, toDraft } from './signInProtection';

const base = (): SignInProtection => ({
  captcha: { flows: { registration: false, login: false, recovery: false, verification: false }, failMode: 'closed' },
  registration: { mode: 'open', allowEmails: [], allowDomains: [], denyDomains: [], blockDisposable: false },
});

describe('sign-in protection form', () => {
  it('reads one entry per line or comma, lowercased, de-duplicated; @domain is the domain', () => {
    expect(parseEntries(' Corp.IO\n@lab.io, corp.io ;\n\n')).toEqual(['corp.io', 'lab.io']);
  });

  it('splits the allow-list box into addresses and domains, and names what is neither', () => {
    expect(splitAllowList('corp.io\n*.lab.io\nBob@Gmail.com\nnot a domain\nx@\nhttp://x.io')).toEqual({
      emails: ['bob@gmail.com'], domains: ['corp.io', '*.lab.io'], invalid: ['not a domain', 'x@', 'http://x.io'],
    });
  });

  it('round-trips the stored settings through the draft', () => {
    const s = base();
    s.registration = { mode: 'allowlist', allowEmails: ['a@b.io'], allowDomains: ['corp.io'], denyDomains: ['spam.example'], blockDisposable: true };
    s.captcha = { flows: { registration: true, login: false, recovery: true, verification: false }, failMode: 'open' };
    expect(sameProtection(fromDraft(toDraft(s)), s)).toBe(true);
  });

  it('refuses to save an empty allow-list, bad entries, bad deny domains', () => {
    const d = toDraft(base());
    expect(draftProblems({ ...d, mode: 'allowlist' }).allow).toMatch(/at least one/);
    expect(draftProblems({ ...d, mode: 'allowlist', allowText: 'corp.io\nnope' }).allow).toBe('Not an email address or a domain: nope');
    expect(draftProblems({ ...d, denyText: 'a@b.io' }).deny).toBe('Not a domain: a@b.io');
    expect(draftProblems({ ...d, mode: 'allowlist', allowText: 'corp.io' })).toEqual({});
    // Entries typed while Open are validated too, but an empty list is fine outside allow-list.
    expect(draftProblems(d)).toEqual({});
  });

  it('warns before saving what locks people out or checks nothing', () => {
    const s = base();
    const ok = { configured: true, testKeys: false };
    expect(protectionWarnings(s, { configured: false, testKeys: false })).toEqual([]);
    s.captcha.flows.login = true;
    expect(protectionWarnings(s, ok)).toEqual(['login-fail-closed']);
    s.captcha.failMode = 'open';
    expect(protectionWarnings(s, ok)).toEqual(['fail-open']);
    expect(protectionWarnings(s, { configured: true, testKeys: true })).toContain('test-keys');
    expect(protectionWarnings(s, { configured: false, testKeys: false })).toContain('provider-lost');
  });
});
