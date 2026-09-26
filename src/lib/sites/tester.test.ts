import { describe, it, expect } from 'vitest';
import { parseTest, upstreamRequest } from './tester';

describe('parseTest', () => {
  it('reads "METHOD /path" from the address', () => {
    expect(parseTest('POST /api/x')).toEqual({ method: 'POST', path: '/api/x' });
    expect(parseTest('/only/path')).toEqual({ method: 'GET', path: '/only/path' });
    expect(parseTest(undefined)).toEqual({ method: 'GET', path: '/' });
    expect(parseTest('bogus x')).toEqual({ method: 'GET', path: '/x' });
  });
});

describe('upstreamRequest', () => {
  const up = { service: 'api', namespace: 'pay', port: 3000 };
  it('builds the in-cluster URL', () => {
    expect(upstreamRequest({ upstream: up }, '/a')).toBe('http://api.pay.svc.cluster.local:3000/a');
  });
  it('removes strip_path like Oathkeeper (substring, first occurrence)', () => {
    expect(upstreamRequest({ upstream: { ...up, stripPath: '/api' } }, '/api/items')).toBe('http://api.pay.svc.cluster.local:3000/items');
    expect(upstreamRequest({ upstream: { ...up, stripPath: '/api' } }, '/api')).toBe('http://api.pay.svc.cluster.local:3000/');
  });
});
