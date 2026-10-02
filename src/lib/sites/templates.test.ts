import { describe, it, expect } from 'vitest';
import { buildSite, kindOf, summarySentence, TEMPLATES, orgGrantableFor } from './templates';
import { GETS, GETS_LABEL, WHO, presetsOf, withPreset, isCustomized, allowsAnonymous, missingHandlers, passesNoIdentity, SANDBOX_ENABLED } from './presets';

const basics = { name: 'payroll', displayName: 'Payroll', host: 'payroll.dev.example.com', service: 'payroll-ui', namespace: 'payroll', port: 8080 };

describe('buildSite', () => {
  it('every template has a catch-all on a declared gate', () => {
    for (const t of TEMPLATES) {
      const s = buildSite(t.id, basics);
      expect(s.gates.map((g) => g.id)).toContain(s.routes.catchAll.gate);
      for (const r of s.routes.items) expect(s.gates.map((g) => g.id)).toContain(r.gate);
    }
  });
  it('public routes sit on a gate that lets anonymous callers in', () => {
    for (const t of TEMPLATES) {
      const s = buildSite(t.id, basics);
      for (const r of s.routes.items.filter((x) => x.access.kind === 'public')) {
        expect(allowsAnonymous(s.gates.find((g) => g.id === r.gate)!)).toBe(true);
      }
    }
  });
  it('uses only handlers the sandbox gateway runs', () => {
    for (const t of TEMPLATES) {
      for (const g of buildSite(t.id, basics).gates) {
        expect(missingHandlers(g.authenticators, SANDBOX_ENABLED.authenticators)).toEqual([]);
        expect(missingHandlers(g.mutators, SANDBOX_ENABLED.mutators)).toEqual([]);
      }
    }
  });
  it('every gate that identifies people passes the identity, with or without a public shell', () => {
    for (const t of TEMPLATES) {
      for (const shellPublic of [false, true]) {
        for (const g of buildSite(t.id, basics, { shellPublic }).gates) expect(passesNoIdentity(g)).toBe(false);
      }
    }
  });
  it('keeps the visitor\'s domain on every template', () => {
    for (const t of TEMPLATES) expect(buildSite(t.id, basics).upstream.preserveHost).toBe(true);
  });
  it('promises groups from every preset that sends the identity headers, and only from those', () => {
    for (const k of Object.keys(GETS) as (keyof typeof GETS)[]) {
      const headers = GETS[k].some((h) => h.handler === 'header');
      expect(/X-User-Groups|groups included/.test(GETS_LABEL[k])).toBe(headers);
    }
  });
  it('prefixes paths for a shared host', () => {
    const s = buildSite('web-api', { ...basics, pathPrefix: '/payroll' });
    expect(s.address.pathPrefix).toBe('/payroll');
    expect(s.routes.items.every((r) => r.path.startsWith('/payroll/'))).toBe(true);
  });
  it('API template needs the read permission on the catch-all', () => {
    expect(buildSite('api', basics).routes.catchAll.access).toEqual({ kind: 'permission', permission: 'payroll:read' });
  });
  it('SPA shell can be public', () => {
    expect(buildSite('spa-api', basics, { shellPublic: true }).routes.catchAll).toEqual({ gate: 'public', access: { kind: 'public' } });
  });
  it('reads the kind back', () => {
    expect(kindOf(buildSite('web-api', basics))).toBe('Web app + API');
    expect(kindOf(buildSite('public', basics))).toBe('Public website');
  });
});

describe('presets', () => {
  const s = buildSite('web-api', basics);
  const browser = s.gates.find((g) => g.id === 'browser')!;
  it('reads a template gate as presets', () => {
    expect(presetsOf(browser)).toEqual({ who: 'signed-in', pass: 'policy', gets: 'identity', fails: 'website' });
    expect(isCustomized(browser)).toBe(false);
  });
  it('reads the API template gate as the tokens preset', () => {
    expect(presetsOf(buildSite('api', basics).gates.find((g) => g.id === 'api')!).who).toBe('tokens');
  });
  it('marks a hand-built chain as custom', () => {
    const g = { ...browser, authenticators: [{ handler: 'cookie_session', config: { only: ['x'] } }] };
    expect(presetsOf(g).who).toBe('custom');
    expect(isCustomized(g)).toBe(true);
    expect(isCustomized({ ...browser, expert: { matchUrl: '<.*>' } })).toBe(true);
  });
  it('Anyone forces a non-policy authorizer and no identity headers', () => {
    const g = withPreset(browser, 'who', 'anyone');
    expect(g.authorizer).toEqual({ handler: 'allow' });
    expect(g.mutators).toEqual([{ handler: 'noop' }]);
  });
});

describe('summary', () => {
  it('says where, who and how many', () => {
    const s = { ...buildSite('web-api', basics), groups: { platform: { admins: ['admin'] }, orgGrantable: orgGrantableFor('payroll', 'Payroll') } };
    expect(summarySentence(s, 23)).toBe(
      'payroll.dev.example.com will send signed-in people to payroll-ui.payroll:8080. /api also accepts API tokens. 23 people get access through 1 group. No organizations.',
    );
  });
});

// echo-mfa's "Signed in" gate forwarded nothing and the app got every X-User-* header empty.
describe('sign-in gates pass the identity', () => {
  const anyone = withPreset({ id: 'g', label: 'G', authenticators: WHO['signed-in'], authorizer: 'policy', mutators: GETS.identity, errors: 'website' }, 'who', 'anyone');
  it('Anyone forwards nothing; switching back to a sign-in moves Gets to identity', () => {
    expect(anyone.mutators).toEqual(GETS.nothing);
    for (const who of ['signed-in', 'signed-in-or-tokens', 'tokens', 'machines', 'optional'] as const) {
      expect(withPreset(anyone, 'who', who).mutators).toEqual(GETS.identity);
    }
  });
  it('a sign-in switch keeps a Gets that already passes something', () => {
    const enrich = { ...anyone, authenticators: WHO['signed-in'], mutators: GETS.enrich };
    expect(withPreset(enrich, 'who', 'tokens').mutators).toEqual(GETS.enrich);
  });
  it('says nothing about a gate nobody signs in through', () => {
    expect(passesNoIdentity(anyone)).toBe(false);
    expect(passesNoIdentity({ ...anyone, authenticators: WHO.optional })).toBe(true);
    expect(passesNoIdentity({ ...anyone, authenticators: WHO['signed-in'], mutators: [] })).toBe(true);
  });
});

// Opt-in role headers: only a policy gate may pass them, and nothing sets them for you.
describe('passRoles', () => {
  const policy = { id: 'g', label: 'Web', authenticators: WHO['signed-in'], authorizer: 'policy' as const, mutators: GETS.identity, errors: 'website' as const, passRoles: true };
  it('no template sets it', () => {
    for (const t of TEMPLATES) for (const g of buildSite(t.id, basics).gates) expect(g.passRoles).toBeUndefined();
  });
  it('leaving the policy drops it; staying keeps it', () => {
    expect(withPreset(policy, 'pass', 'everyone').passRoles).toBeUndefined();
    expect(withPreset(policy, 'who', 'anyone').passRoles).toBeUndefined();
    expect(withPreset(policy, 'pass', 'policy').passRoles).toBe(true);
    expect(withPreset(policy, 'gets', 'enrich').passRoles).toBe(true);
  });
  it('the summary says which gates pass them', () => {
    const site = buildSite('app', basics);
    site.gates = site.gates.map((g) => (g.authorizer === 'policy' ? { ...g, passRoles: true } : g));
    expect(summarySentence(site)).toMatch(/also pass(es)? each person's roles and permissions to the app/);
  });
});
