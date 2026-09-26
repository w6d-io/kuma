import { describe, it, expect } from 'vitest';
import {
  nameProblem, labelProblem, serviceProblem, namespaceProblem, portProblem, welcomeProblem, helpUrlProblem,
  logoProblem, routeProblems, secretLooking, headerNameProblem, accentProblem,
} from './validate';
import { contrastRatio, parseHex } from './color';
import type { Route } from './types';

describe('site fields', () => {
  it('name follows jinbe and refuses system names', () => {
    expect(nameProblem('payroll')).toBeNull();
    expect(nameProblem('P')).not.toBeNull();
    expect(nameProblem('1abc')).not.toBeNull();
    expect(nameProblem('kuma')).toMatch(/reserved/);
    expect(nameProblem('migration')).toMatch(/reserved/);
  });
  it('address label is one DNS label', () => {
    expect(labelProblem('payroll')).toBeNull();
    expect(labelProblem('a.b')).toMatch(/one label/);
    expect(labelProblem('-a')).not.toBeNull();
  });
  it('upstream parts', () => {
    expect(serviceProblem('payroll-ui')).toBeNull();
    expect(serviceProblem('Payroll')).not.toBeNull();
    expect(namespaceProblem('payroll')).toBeNull();
    expect(portProblem('8080')).toBeNull();
    expect(portProblem('0')).not.toBeNull();
    expect(portProblem('x')).not.toBeNull();
  });
});

describe('login fields', () => {
  it('welcome is short plain text', () => {
    expect(welcomeProblem('Sign in to continue')).toBeNull();
    expect(welcomeProblem('x'.repeat(81))).toMatch(/80/);
    expect(welcomeProblem('<b>hi</b>')).toMatch(/plain text/i);
    expect(welcomeProblem('go to https://evil.example')).toMatch(/link/);
  });
  it('help link must be https', () => {
    expect(helpUrlProblem('')).toBeNull();
    expect(helpUrlProblem('https://x.dev.stairling.com/help')).toBeNull();
    expect(helpUrlProblem('http://x')).toMatch(/https/);
    expect(helpUrlProblem('javascript:alert(1)')).toMatch(/https/);
  });
  it('logo: png/webp only (what jinbe stores), 256 KB', () => {
    expect(logoProblem({ type: 'image/jpeg', size: 10 })).toMatch(/PNG or WebP/);
    expect(logoProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/SVG/);
    expect(logoProblem({ type: 'image/gif', size: 10 })).toMatch(/PNG/);
    expect(logoProblem({ type: 'image/webp', size: 300 * 1024 })).toMatch(/256/);
  });
});

describe('accent contrast', () => {
  it('parses a hex colour', () => {
    expect(parseHex('#ffffff')).toEqual([255, 255, 255]);
    expect(parseHex('fff')).toBeNull();
  });
  it('computes WCAG contrast', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });
  it('refuses an accent that fails 4.5:1 on light or dark', () => {
    // A mid blue reads on white but not on the dark surface.
    const mid = accentProblem('#2f6feb');
    expect(mid.light).toBeGreaterThan(4.5);
    expect(accentProblem('#ffff00').problem).toMatch(/light/);
    expect(accentProblem('#000080').problem).toMatch(/dark/);
    expect(accentProblem('nope').problem).toMatch(/#rrggbb/);
  });
});

describe('routes', () => {
  const r = (over: Partial<Route>): Route => ({ id: 'r1', methods: ['GET'], path: '/a', gate: 'browser', access: { kind: 'signed-in' }, ...over });
  it('flags empty methods, bad paths, duplicates and org params', () => {
    const problems = routeProblems([
      r({ id: 'r1', methods: [] }),
      r({ id: 'r2', path: 'x' }),
      r({ id: 'r3', path: '/b' }),
      r({ id: 'r4', path: '/b' }),
      r({ id: 'r5', path: '/c', orgParam: 'orgId' }),
    ]);
    expect(problems.r1).toMatch(/method/);
    expect(problems.r2).toMatch(/start with/);
    expect(problems.r4).toMatch(/Same as/);
    expect(problems.r3).toBeUndefined();
    expect(problems.r5).toMatch(/:orgId/);
  });
});

describe('secrets and headers', () => {
  it('spots secret-looking values', () => {
    expect(secretLooking('Bearer abc.def')).toBe(true);
    expect(secretLooking('Basic dXNlcjpwYXNz')).toBe(true);
    expect(secretLooking('password=hunter2')).toBe(true);
    expect(secretLooking('a'.repeat(40))).toBe(true);
    expect(secretLooking('{{ print .Subject }}')).toBe(false);
  });
  it('header names: token charset, no case duplicate, no platform header', () => {
    expect(headerNameProblem('X-Payroll-Org', [])).toBeNull();
    expect(headerNameProblem('X Bad', [])).not.toBeNull();
    expect(headerNameProblem('x-payroll-org', ['X-Payroll-Org'])).toMatch(/already/);
    expect(headerNameProblem('X-User-Id', [])).toMatch(/platform/);
  });
});
