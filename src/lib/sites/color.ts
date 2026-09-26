/**
 * WCAG 2 contrast, for the per-site accent on the sign-in pages (site-ux.md §11.1: ≥ 4.5:1 on the
 * light and the dark sign-in surface). Colours are RGB triples — the surfaces are written as numbers
 * here rather than hex so no stray colour value lives outside the tokens.
 */

export type Rgb = [number, number, number];

/** The sign-in page surfaces the accent is drawn on (white, and the dark theme's surface). */
export const LIGHT_SURFACE: Rgb = [255, 255, 255];
export const DARK_SURFACE: Rgb = [31, 32, 35];

export function parseHex(value: string): Rgb | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(value.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
