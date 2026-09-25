#!/usr/bin/env node
// How far the console is from its design system, as numbers control.sh can track.
//
// Counted over src/ minus the kit itself (src/components/ui), the token file and the vendored
// design system — the three places a raw control, a hex code or a radius is allowed to live.
//
//   rawButtons    `<button` written by hand instead of the kit's Button / ButtonBase
//   strayHex      hex colours outside the tokens (CSS and TS/TSX alike)
//   radii         every distinct border-radius value still written; the goal is tokens only
//   inlineStyles  `style={` props in TSX
//
// Prints one JSON object. `--check` exits 1 unless buttons and hex are 0 and every radius is a token.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = join(root, 'src');
const EXCLUDED = ['components/ui/', 'styles/vendor/', 'styles/tokens.css'];
const RADIUS_TOKENS = new Set(['0', 'var(--radius-sm)', 'var(--radius-md)', 'var(--radius-pill)']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(src)
  .map((p) => ({ p, rel: relative(src, p).split(sep).join('/') }))
  .filter(({ rel }) => /\.(tsx?|css)$/.test(rel) && !/\.test\.tsx?$/.test(rel))
  .filter(({ rel }) => !EXCLUDED.some((x) => rel.startsWith(x)));

const counts = { rawButtons: 0, strayHex: 0, radii: [], inlineStyles: 0 };
const radii = new Set();
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

for (const { p, rel } of files) {
  const text = readFileSync(p, 'utf8');
  if (rel.endsWith('.tsx')) {
    counts.rawButtons += (text.match(/<button\b/g) ?? []).length;
    counts.inlineStyles += (text.match(/\bstyle=\{/g) ?? []).length;
    for (const m of text.matchAll(/borderRadius:\s*((?:[^,}()\n]|\([^)]*\))+)/g)) radii.add(m[1].trim());
  }
  // Hex inside a string or a CSS value; `&#123;` entities and `#/page` hashes are not colours.
  const stripped = text.replace(/&#x?[0-9a-fA-F]+;/g, '');
  counts.strayHex += [...stripped.matchAll(HEX)].filter((m) => !/[\w/]/.test(stripped[m.index - 1] ?? '')).length;
  if (rel.endsWith('.css')) {
    for (const m of text.matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*([^;}]+)/g)) {
      for (const v of m[1].trim().split(/\s+(?![^(]*\))/)) radii.add(v);
    }
  }
}

counts.radii = [...radii].sort();

console.log(JSON.stringify(counts));

if (process.argv.includes('--check')) {
  const badRadii = counts.radii.filter((r) => !RADIUS_TOKENS.has(r));
  const ok = counts.rawButtons === 0 && counts.strayHex === 0 && badRadii.length === 0;
  if (!ok) {
    console.error(`ui-counts: raw buttons ${counts.rawButtons}, stray hex ${counts.strayHex}, radii outside tokens: ${badRadii.join(' ') || 'none'}`);
    process.exit(1);
  }
}
