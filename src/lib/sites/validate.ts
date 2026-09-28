import { contrastRatio, DARK_SURFACE, INK, LIGHT_SURFACE, parseHex, type Rgb } from './color';
import { orgParamProblem, pathProblem } from './paths';
import type { Route } from './types';

/**
 * Instant field checks (site-ux.md §12), format only — each mirrors a rule jinbe enforces, so the
 * form says it before the save does. Every answer is a sentence or null.
 */

// System sites, plus the names jinbe reserves for its own static paths.
const SYSTEM_NAMES = new Set(['jinbe', 'kuma', 'global', 'migration', 'requests', 'sign-in', 'platform', 'deleted', 'zones', 'preview', 'match', 'render', 'probe']);
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function nameProblem(name: string): string | null {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) return 'Lowercase letters, digits and dashes, 2–40 characters, starting with a letter.';
  if (SYSTEM_NAMES.has(name)) return `"${name}" is reserved by the platform.`;
  return null;
}

export function labelProblem(label: string): string | null {
  if (label.includes('.')) return 'Use one label (the part before the zone), like payroll.';
  if (!DNS_LABEL.test(label)) return 'Lowercase letters, digits and dashes; not starting or ending with a dash.';
  return null;
}

export function serviceProblem(v: string): string | null {
  return /^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(v) ? null : 'A Kubernetes Service name: lowercase letters, digits and dashes.';
}

export function namespaceProblem(v: string): string | null {
  return DNS_LABEL.test(v) ? null : 'A namespace name: lowercase letters, digits and dashes.';
}

export function portProblem(v: string): string | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : 'A port between 1 and 65535.';
}

export function welcomeProblem(v: string): string | null {
  if (v.length > 80) return 'At most 80 characters.';
  if (/[<>]/.test(v)) return 'Plain text only — no markup.';
  if (/https?:\/\/|www\./i.test(v)) return 'No links in the welcome line; use the help link.';
  return null;
}

export function helpUrlProblem(v: string): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? null : 'The help link must be an https:// address.';
  } catch {
    return 'The help link must be an https:// address.';
  }
}

// What jinbe stores (PUT /:name/logo, raw bytes): PNG or WebP.
export const LOGO_TYPES = ['image/png', 'image/webp'];
export const LOGO_MAX_BYTES = 256 * 1024;

export function logoProblem(file: { type: string; size: number }): string | null {
  if (file.type === 'image/svg+xml') return 'SVG is refused (it can carry scripts). Use PNG or WebP.';
  if (!LOGO_TYPES.includes(file.type)) return 'Use a PNG or WebP image.';
  if (file.size > LOGO_MAX_BYTES) return 'The logo must be 256 KB or smaller.';
  return null;
}

/**
 * The accent rule of the sign-in pages, exactly as kratos-login-ui applies it (accentPassesContrast):
 * the button label — white or ink, whichever reads better — reaches 4.5:1 on the accent, and links
 * and focus rings stay visible at 3:1 on the light card and 2.5:1 on the dark one (what the platform
 * default accent achieves there). A refusal names the part that fails and its ratio.
 */
export const ACCENT_MIN = { label: 4.5, light: 3, dark: 2.5 } as const;

export interface AccentCheck { label: number; light: number; dark: number; labelColour: Rgb; problem: string | null }

export function accentProblem(v: string): AccentCheck {
  const rgb = parseHex(v);
  if (!rgb) return { label: 0, light: 0, dark: 0, labelColour: LIGHT_SURFACE, problem: 'Write the colour as #rrggbb.' };
  const onWhite = contrastRatio(rgb, LIGHT_SURFACE);
  const labelColour = onWhite >= contrastRatio(rgb, INK) ? LIGHT_SURFACE : INK;
  const label = contrastRatio(rgb, labelColour);
  const light = onWhite;
  const dark = contrastRatio(rgb, DARK_SURFACE);
  const fails = [
    label < ACCENT_MIN.label && `button text ${label.toFixed(1)}:1 (needs ${ACCENT_MIN.label}:1)`,
    light < ACCENT_MIN.light && `light page ${light.toFixed(1)}:1 (needs ${ACCENT_MIN.light}:1)`,
    dark < ACCENT_MIN.dark && `dark page ${dark.toFixed(1)}:1 (needs ${ACCENT_MIN.dark}:1)`,
  ].filter(Boolean);
  return { label, light, dark, labelColour, problem: fails.length ? `Too little contrast: ${fails.join(', ')}.` : null };
}

/** Per route id, the first thing wrong with it: methods, path, duplicates within the site, org param. */
export function routeProblems(routes: readonly Route[]): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Map<string, number>();
  routes.forEach((r, i) => {
    const problem =
      (r.methods.length === 0 && 'Pick at least one method.')
      || pathProblem(r.path)
      || (r.orgParam && orgParamProblem(r.path, r.orgParam))
      || (r.access.kind === 'permission' && !/^[a-z][a-z0-9_.-]*:[a-z*][a-z0-9_*-]*$/.test(r.access.permission) && 'A permission looks like resource:verb.')
      || null;
    if (problem) { out[r.id] = problem; return; }
    for (const m of r.methods) {
      const key = `${m} ${r.path}`;
      const first = seen.get(key);
      if (first !== undefined) { out[r.id] = `Same as row #${first + 1} (${key}).`; return; }
      seen.set(key, i);
    }
  });
  return out;
}

/** A value that looks like a credential — never allowed in a rule (readable inside the cluster). */
export function secretLooking(v: string): boolean {
  if (/\{\{.*\}\}/.test(v) && !/(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{6,}/.test(v)) return false;
  return /(^|\s)(Bearer|Basic)\s+\S{6,}/i.test(v)
    || /(password|passwd|secret|api[_-]?key|token)\s*[=:]/i.test(v)
    || /^[A-Za-z0-9+/=_-]{32,}$/.test(v.trim());
}

// The platform's identity headers (global header mutator): a gate may not re-declare them.
const PLATFORM_HEADERS = ['x-user-id', 'x-user-email', 'x-user-groups', 'x-user-name'];

export function headerNameProblem(name: string, existing: readonly string[]): string | null {
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) return 'A header name: letters, digits and dashes, no spaces.';
  const lower = name.toLowerCase();
  if (PLATFORM_HEADERS.includes(lower)) return 'This is a platform identity header; it is always sent.';
  if (existing.some((e) => e.toLowerCase() === lower)) return 'This gate already sends that header (names are case-insensitive).';
  return null;
}
