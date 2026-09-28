/**
 * WCAG 2 contrast, for the per-site accent on the sign-in pages. The colours are the ones
 * kratos-login-ui draws with (src/lib/branding.ts) — kuma must accept exactly what the sign-in pages
 * show. They are RGB triples rather than hex so no stray colour value lives outside the tokens.
 */

export type Rgb = [number, number, number];

/** White: the light card, and one of the two button labels (login-ui WHITE). */
export const LIGHT_SURFACE: Rgb = [255, 255, 255];
/** The other button label (login-ui INK). */
export const INK: Rgb = [14, 21, 37];
/** The dark card (login-ui DARK_SURFACE — globals.css [data-dark] --bg-elevated). */
export const DARK_SURFACE: Rgb = [17, 21, 29];

export const rgbCss = ([r, g, b]: Rgb): string => `rgb(${r} ${g} ${b})`;

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
