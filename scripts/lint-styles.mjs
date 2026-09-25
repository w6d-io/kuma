#!/usr/bin/env node
// The stylesheet half of the design-system lint (ESLint covers the TSX half).
//
// Outside the token file and the vendored design system, a stylesheet may not write:
//   - a hex colour           → use a --color-* token
//   - a border-radius that is not a radius token (or 0)
//   - a font-size in px/rem  → use a --text-* token
//
// Exits 1 with one line per offence, file:line.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const styles = join(root, 'src', 'styles');
const ALLOWED = ['tokens.css', 'vendor/'];
const RADIUS_OK = /^(0|var\(--radius-(sm|md|pill)\))(\s+(0|var\(--radius-(sm|md|pill)\)))*$/;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const problems = [];
for (const file of walk(styles).filter((p) => p.endsWith('.css'))) {
  const rel = relative(styles, file).split(sep).join('/');
  if (ALLOWED.some((a) => rel.startsWith(a))) continue;
  const lines = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).split('\n');
  lines.forEach((line, i) => {
    const at = `src/styles/${rel}:${i + 1}`;
    if (/#[0-9a-fA-F]{3,8}\b/.test(line)) problems.push(`${at}  raw hex colour — use a --color-* token`);
    const r = line.match(/border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*([^;}]+)/);
    if (r && !RADIUS_OK.test(r[1].trim())) problems.push(`${at}  radius "${r[1].trim()}" — use --radius-sm, --radius-md or --radius-pill`);
    const f = line.match(/font-size:\s*([^;}]+)/);
    if (f && /\d(px|rem|em)\b/.test(f[1])) problems.push(`${at}  font-size "${f[1].trim()}" — use a --text-* token`);
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\nlint-styles: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('lint-styles: ok');
