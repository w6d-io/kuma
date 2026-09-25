/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The semantic colours hold WCAG AA in both themes.
 *
 * Read from the stylesheets themselves — the vendored Strada block and the token file on top of it —
 * so a value changed in either is checked as it will be painted, not as somebody remembers it.
 * Resolves `var()`, hex, `rgb()`/`rgba()` and `color-mix(in srgb, …)`, which is everything the token
 * file is allowed to use. A translucent colour is laid over the ground it sits on.
 */

type RGBA = [number, number, number, number];
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const strada = read('./vendor/strada-tokens.css');
const tokens = read('./tokens.css');

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function block(css: string, selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no ${selector} block`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unterminated ${selector}`);
}

const light = { ...declarations(block(strada, ':root')), ...declarations(block(tokens, ':root,\n[data-theme="light"]')) };
const dark = { ...light, ...declarations(block(tokens, ':root[data-theme="dark"]')) };

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parse(value: string, vars: Record<string, string>): RGBA {
  const v = value.trim();
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    if (!(ref[1] in vars)) throw new Error(`undefined ${ref[1]}`);
    return parse(vars[ref[1]], vars);
  }
  if (v === 'black') return [0, 0, 0, 1];
  if (v === 'white') return [255, 255, 255, 1];
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const rgb = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  const mix = v.match(/^color-mix\(in srgb,\s*([\s\S]+)\)$/);
  if (mix) {
    const [a, b] = splitArgs(mix[1]);
    const pa = a.match(/^(.*?)\s+([\d.]+)%$/);
    const colA = parse(pa ? pa[1] : a, vars);
    const colB = parse(b.replace(/\s+[\d.]+%$/, ''), vars);
    const w = pa ? Number(pa[2]) / 100 : 0.5;
    return colA.map((c, i) => c * w + colB[i] * (1 - w)) as RGBA;
  }
  throw new Error(`cannot resolve "${v}"`);
}

function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1) as RGBA;
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fgName: string, bgName: string, vars: Record<string, string>, base = '--color-surface'): number {
  const ground = parse(`var(${base})`, vars);
  const bg = over(parse(`var(${bgName})`, vars), ground);
  const fg = over(parse(`var(${fgName})`, vars), bg);
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['--color-text', '--color-bg'],
  ['--color-text', '--color-surface-2'],
  ['--color-text-muted', '--color-surface'],
  ['--color-text-muted', '--color-surface-2'],
  ['--color-text-subtle', '--color-surface'],
  ['--color-text-subtle', '--color-surface-2'],
  ['--color-accent', '--color-surface'],
  ['--color-accent', '--color-accent-soft'],
  ['--color-on-primary', '--color-primary'],
  ['--color-on-accent', '--color-accent'],
  ['--color-on-danger', '--color-danger'],
  ['--color-success', '--color-surface'],
  ['--color-success', '--color-success-soft'],
  ['--color-warning', '--color-surface'],
  ['--color-warning', '--color-warning-soft'],
  ['--color-danger', '--color-surface'],
  ['--color-danger', '--color-danger-soft'],
  ['--color-info', '--color-surface'],
  ['--color-info', '--color-info-soft'],
];

describe.each([['light', light], ['dark', dark]] as const)('%s theme', (_name, vars) => {
  it.each(TEXT_PAIRS)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg, vars)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws a focus ring that stands out 3:1 from the surface', () => {
    expect(contrast('--color-focus-ring', '--color-surface', vars)).toBeGreaterThanOrEqual(3);
  });
});

describe('the dark theme', () => {
  it('is the same whether chosen or inherited from the machine', () => {
    const inherited = declarations(block(tokens, ':root:not([data-theme="light"])'));
    const chosen = declarations(block(tokens, ':root[data-theme="dark"]'));
    expect(inherited).toEqual(chosen);
  });
});
