import { describe, it, expect } from 'vitest';
import { detectPaste, describePaste } from './paste';

const zones = ['dev.stairling.com', 'authdev.dev.stairling.com'];

describe('detectPaste', () => {
  it('reads a public address under a zone, most specific zone first', () => {
    expect(detectPaste('https://payroll.dev.stairling.com/v2', zones)).toEqual({
      kind: 'public', host: 'payroll.dev.stairling.com', label: 'payroll', zone: 'dev.stairling.com', pathPrefix: '/v2',
    });
    expect(detectPaste('https://x.authdev.dev.stairling.com', zones)).toMatchObject({ label: 'x', zone: 'authdev.dev.stairling.com' });
  });
  it('reads an in-cluster address with or without scheme, port default 80', () => {
    expect(detectPaste('payroll-ui.payroll:8080', zones)).toEqual({ kind: 'upstream', service: 'payroll-ui', namespace: 'payroll', port: 8080, scheme: 'http' });
    expect(detectPaste('http://api.shop.svc.cluster.local', zones)).toMatchObject({ service: 'api', namespace: 'shop', port: 80 });
  });
  it('reads an OpenAPI link and its origin', () => {
    expect(detectPaste('http://payroll-api.payroll:3000/api/openapi.json', zones)).toMatchObject({
      kind: 'openapi', upstream: { service: 'payroll-api', namespace: 'payroll', port: 3000 },
    });
  });
  it('prefers the zone over the in-cluster shape', () => {
    expect(detectPaste('https://demo.dev.stairling.com', zones)).toMatchObject({ kind: 'public', label: 'demo' });
  });
  it('reads a bare word as a name', () => {
    expect(detectPaste('payroll', zones)).toEqual({ kind: 'name', name: 'payroll' });
  });
  it('says when a host is outside every zone', () => {
    expect(detectPaste('https://shop.example.com', zones)).toEqual({ kind: 'outside', host: 'shop.example.com' });
    expect(describePaste({ kind: 'outside', host: 'shop.example.com' })).toMatch(/no platform zone/);
  });
  it('gives up politely', () => {
    expect(detectPaste('', zones)).toEqual({ kind: 'unknown' });
    expect(detectPaste('%%%', zones)).toEqual({ kind: 'unknown' });
  });
});
