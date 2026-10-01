import { describe, it, expect } from 'vitest';
import {
  nameProblem, labelProblem, serviceProblem, namespaceProblem, portProblem, welcomeProblem, helpUrlProblem,
  logoProblem, routeProblems, secretLooking, headerNameProblem, accentProblem, COOKIE_RESERVED,
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
    expect(helpUrlProblem('https://x.dev.example.com/help')).toBeNull();
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
  it('accepts #2F6FEB and a mid-range palette', () => {
    for (const hex of ['#2F6FEB', '#2256C4', '#0F766E', '#15803D', '#B45309', '#C2410C', '#BE185D', '#7C3AED', '#4F46E5', '#0369A1']) {
      expect([hex, accentProblem(hex).problem]).toEqual([hex, null]);
    }
    // #2F6FEB carries white text, like the button on the sign-in page.
    expect(accentProblem('#2F6FEB').labelColour).toEqual([255, 255, 255]);
  });

  it('refuses pale yellow, near-white and near-black, naming the part that fails with its ratio', () => {
    expect(accentProblem('#FFF7AE').problem).toMatch(/light page 1\.\d:1 \(needs 3:1\)/);
    expect(accentProblem('#F5F5F5').problem).toMatch(/light page/);
    const black = accentProblem('#111111').problem;
    expect(black).toMatch(/dark page 1\.\d:1 \(needs 2\.5:1\)/);
    expect(black).not.toMatch(/light page/);
    // A mid grey: readable on both pages, but neither label reaches 4.5:1 on it.
    expect(accentProblem('#7A7A7A').problem).toMatch(/button text \d\.\d:1 \(needs 4\.5:1\)/);
    expect(accentProblem('nope').problem).toMatch(/#rrggbb/);
  });

  it('decides every colour exactly as kratos-login-ui accentPassesContrast does', () => {
    // login-ui src/lib/branding.ts, transcribed: label white or ink (#0E1525) ≥ 4.5, ≥ 3 on white,
    // ≥ 2.5 on #11151D. Any drift between the two makes kuma accept what the sign-in pages refuse.
    const hex = (c: number[]) => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
    const WHITE = [255, 255, 255], INK = [0x0e, 0x15, 0x25], DARK = [0x11, 0x15, 0x1d];
    const cr = (a: number[], b: number[]) => contrastRatio(a as [number, number, number], b as [number, number, number]);
    const loginUi = (c: number[]) => {
      const label = cr(c, WHITE) >= cr(c, INK) ? WHITE : INK;
      return cr(c, label) >= 4.5 && cr(c, WHITE) >= 3 && cr(c, DARK) >= 2.5;
    };
    let passing = 0;
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
      const ok = accentProblem(hex([r, g, b])).problem === null;
      expect(ok).toBe(loginUi([r, g, b]));
      if (ok) passing++;
    }
    expect(passing).toBeGreaterThan(100);
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
  it('Cookie is reserved, in any case', () => {
    for (const n of ['Cookie', 'cookie', 'COOKIE', 'CooKie']) expect(headerNameProblem(n, [])).toBe(COOKIE_RESERVED);
    expect(headerNameProblem('X-Cookie-Consent', [])).toBeNull();
  });
});
