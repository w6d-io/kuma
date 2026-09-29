import { describe, it, expect } from 'vitest';
import { parseScopes, allowedScopesFrom, initialScopes, normalizeCatalog, groupBySite, expiryLabel, expiryState, scopeHint, sortScopes, mcpServerUrl, normalizePlatformScopes, scopeGroupLabel, scopeGroupOf } from './apiKeys';

describe('parseScopes', () => {
  it('splits on commas and spaces and drops duplicates', () => {
    expect(parseScopes(' api:read, api:write api:read ,')).toEqual(['api:read', 'api:write']);
    expect(parseScopes('   ')).toEqual([]);
  });
});

describe('allowedScopesFrom', () => {
  it('reads the catalogue a refused create answers with', () => {
    const err = { status: 400, details: { message: 'no', details: { allowed_scopes: ['api:read'] } } };
    expect(allowedScopesFrom(err)).toEqual(['api:read']);
  });

  it('is null when the error carries none', () => {
    expect(allowedScopesFrom(new Error('x'))).toBeNull();
  });
});

describe('initialScopes', () => {
  it('starts on the first read-only scope of the catalogue, never on one it does not hold', () => {
    expect(initialScopes(['fleet:write', 'fleet:read'])).toEqual(['fleet:read']);
    expect(initialScopes(['api:read', 'api:write'])).toEqual(['api:read']);
  });

  it('starts on nothing when no scope is read-only', () => {
    expect(initialScopes(['fleet:write', 'reports:export'])).toEqual([]);
    expect(initialScopes([])).toEqual([]);
  });
});

describe('normalizeCatalog', () => {
  it('takes the per-org entries and the older bare strings', () => {
    expect(normalizeCatalog([{ scope: 'payroll:read', sites: ['payroll'] }, 'api:read', 42, { nope: 1 }])).toEqual([
      { scope: 'payroll:read', sites: ['payroll'] },
      { scope: 'api:read', sites: [] },
    ]);
    expect(normalizeCatalog(undefined)).toEqual([]);
  });
});

describe('groupBySite', () => {
  it('groups by site, alphabetically, a shared scope under each site, site-less last', () => {
    expect(groupBySite([
      { scope: 'wiki:read', sites: ['wiki'] },
      { scope: 'payroll.runs:read', sites: ['wiki', 'payroll'] },
      { scope: 'api:read', sites: [] },
    ])).toEqual([
      { site: 'payroll', scopes: ['payroll.runs:read'] },
      { site: 'wiki', scopes: ['payroll.runs:read', 'wiki:read'] },
      { site: '', scopes: ['api:read'] },
    ]);
  });
});

describe('expiryLabel', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  it('says never, expired, or how many days are left', () => {
    expect(expiryLabel(null, now)).toBe('Never');
    expect(expiryLabel('2026-09-01T00:00:00Z', now)).toBe('Expired');
    expect(expiryLabel('2026-09-29T00:00:00Z', now)).toBe('in 1 day');
    expect(expiryLabel('2026-10-28T12:00:00Z', now)).toBe('in 30 days');
  });
});

describe('expiryState', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  it('tells never, past, within a week and later apart — and unknown on an older jinbe', () => {
    expect(expiryState(null, now)).toBe('never');
    expect(expiryState(undefined, now)).toBe('unknown');
    expect(expiryState('2026-09-27T12:00:00Z', now)).toBe('expired');
    expect(expiryState('2026-10-02T12:00:00Z', now)).toBe('soon');
    expect(expiryState('2026-12-01T12:00:00Z', now)).toBe('ok');
    expect(expiryState('garbage', now)).toBe('unknown');
  });
});

describe('scopes in the picker', () => {
  it('says what a scope lets a program do, from its verb only', () => {
    expect(scopeHint('fleet:read')).toBe('Read only');
    expect(scopeHint('fleet.runs:list')).toBe('Read only');
    expect(scopeHint('fleet:write')).toBe('Can change data');
  });

  it('puts a resource\'s read right above its write', () => {
    expect(sortScopes(['fleet:write', 'api:write', 'fleet:read', 'api:read'])).toEqual(['api:read', 'api:write', 'fleet:read', 'fleet:write']);
  });
});

describe('mcpServerUrl', () => {
  it('reads the deployment setting, and ignores an unsubstituted placeholder', () => {
    const w = window as unknown as { __MCP_SERVER_URL__?: string };
    w.__MCP_SERVER_URL__ = 'https://mcp.dev.example.com/';
    expect(mcpServerUrl()).toBe('https://mcp.dev.example.com');
    w.__MCP_SERVER_URL__ = '${MCP_SERVER_URL}';
    expect(mcpServerUrl()).toBe('');
    delete w.__MCP_SERVER_URL__;
    expect(mcpServerUrl()).toBe('');
  });
});

describe('platform scopes (personal keys)', () => {
  it('keeps jinbe\'s group, reads it off the scope when missing, and drops anything else', () => {
    expect(normalizePlatformScopes([{ scope: 'users:read', group: 'users' }, 'admin.organisation:read', { scope: 'audit:read' }, 42, { group: 'x' }])).toEqual([
      { scope: 'users:read', group: 'users' },
      { scope: 'admin.organisation:read', group: 'admin' },
      { scope: 'audit:read', group: 'audit' },
    ]);
    expect(normalizePlatformScopes(null)).toEqual([]);
    expect(scopeGroupOf('org:manage_users')).toBe('org');
  });

  it('names known resources and capitalizes the rest', () => {
    expect(scopeGroupLabel('audit')).toBe('Audit trail');
    expect(scopeGroupLabel('billing')).toBe('Billing');
  });
});
