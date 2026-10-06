import { describe, expect, it } from 'vitest';
import { defaultSignUp, signUpReach } from './signup';
import type { Site } from './types';

const site = (over: Partial<Site> = {}): Site => ({
  name: 'shop', displayName: 'Shop', address: { host: 'shop.example.com' },
  upstream: { service: 'shop', namespace: 'shop', port: 8080 },
  gates: [], roles: 'standard', groups: { platform: {}, orgGrantable: {} }, orgs: [],
  routes: {
    items: [
      { id: 'health', methods: ['GET'], path: '/health', gate: 'public', access: { kind: 'public' }, source: 'manual' },
      { id: 'orders', methods: ['GET'], path: '/orders', gate: 'web', access: { kind: 'permission', permission: 'shop:read' }, source: 'manual' },
      { id: 'admin', methods: ['POST'], path: '/admin', gate: 'web', access: { kind: 'permission', permission: 'shop:delete' }, source: 'manual' },
    ],
    catchAll: { gate: 'web', access: { kind: 'signed-in' } },
  },
  ...over,
} as Site);

describe('site sign-up', () => {
  it('starts closed with the user role and a personal org', () => {
    expect(defaultSignUp(site())).toEqual({ mode: 'closed', domains: [], roles: ['user'], orgs: 'none' });
    expect(defaultSignUp(site({ organizations: { enabled: true } })).orgs).toBe('personal');
    expect(defaultSignUp(site({ roles: 'readonly' })).roles).toEqual(['viewer']);
  });

  it('says what a signed-up user reaches, route by route', () => {
    const rows = signUpReach(site(), ['user']);
    expect(rows.map((r) => [r.id, r.reach, r.via])).toEqual([
      ['health', 'everyone', []],
      ['orders', 'role', ['user']],
      ['admin', 'no', []],
      ['catch-all', 'signed-in', []],
    ]);
  });
});
