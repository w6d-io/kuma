import { HTTP_METHODS, type HttpMethod } from './types';

/**
 * Route paths without regex (site-ux.md §6.1). A path is literal segments, `:param` segments (one
 * segment each) and an optional trailing `:any*` (the rest of the path) — the same grammar jinbe's
 * schema accepts and the route map matches. People type `*`; it is stored as `:any*`.
 *
 * Format only. Whether a gateway pattern built from these compiles or overlaps is gatekit's answer.
 */

export type Segment = { kind: 'exact' | 'param' | 'rest'; value: string };

const LITERAL = /^[A-Za-z0-9._~@-]+$/;
const PARAM = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ORG_NAMES = new Set(['orgId', 'org', 'organizationId', 'organisationId', 'tenantId']);

/** What someone typed, in the stored form: leading slash, `{id}` → `:id`, trailing `*` → `/:any*`. */
export function normalizePath(input: string): string {
  let p = input.trim().replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, ':$1');
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/{2,}/g, '/');
  if (p.endsWith('*') && !p.endsWith(':any*')) p = `${p.slice(0, -1).replace(/\/$/, '')}/:any*`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export function parseSegments(path: string): Segment[] {
  return path.split('/').filter(Boolean).map((s): Segment => {
    if (s === ':any*') return { kind: 'rest', value: 'any' };
    if (s.startsWith(':')) return { kind: 'param', value: s.slice(1) };
    return { kind: 'exact', value: s };
  });
}

export function formatSegments(segs: Segment[]): string {
  if (segs.length === 0) return '/';
  return `/${segs.map((s) => (s.kind === 'rest' ? ':any*' : s.kind === 'param' ? `:${s.value}` : s.value)).join('/')}`;
}

/** Why jinbe would refuse the path, in words, or null. */
export function pathProblem(path: string): string | null {
  if (!path.startsWith('/')) return 'A path must start with /.';
  if (/[?#]/.test(path)) return 'Leave the query string out; routes match the path only.';
  if (path.length > 512) return 'A path is at most 512 characters.';
  const raw = path.split('/').slice(1);
  if (path === '/') return null;
  for (const [i, s] of raw.entries()) {
    if (s === '') return 'A path cannot contain an empty part (//) or end with /.';
    if (s === ':any*' || s === '*') {
      if (i !== raw.length - 1) return 'The * (rest of the path) may only end a path.';
      if (s === '*') return 'Write * as the last part only; it is saved as :any*.';
      continue;
    }
    if (s.includes('*')) return `"${s}" — * is only valid as a whole last part (use /files/*).`;
    if (s.startsWith(':')) {
      if (!PARAM.test(s.slice(1))) return `${s} is not a valid part name (letters, digits, _; not starting with a digit).`;
      continue;
    }
    if (!LITERAL.test(s)) return `"${s}" has characters a route path cannot hold (letters, digits, . _ ~ @ - only).`;
  }
  return null;
}

export function pathParams(path: string): string[] {
  return parseSegments(path).filter((s) => s.kind === 'param').map((s) => s.value);
}

/** The param that names the organization, when the path makes it obvious (platform default). */
export function guessOrgParam(path: string): string | undefined {
  const segs = parseSegments(path);
  const named = segs.find((s) => s.kind === 'param' && ORG_NAMES.has(s.value));
  if (named) return named.value;
  const at = segs.findIndex((s, i) => s.kind === 'exact' && s.value === 'organizations' && segs[i - 1]?.value === 'api');
  const next = at >= 0 ? segs[at + 1] : undefined;
  return next?.kind === 'param' ? next.value : undefined;
}

/** Mirrors jinbe's assertOrgParams: the org id comes from exactly one part of the path. */
export function orgParamProblem(path: string, orgParam: string): string | null {
  const n = pathParams(path).filter((p) => p === orgParam).length;
  if (n === 0) return `Add :${orgParam} to the path to make it org-scoped.`;
  if (n > 1) return `The organization must come from exactly one part of the path. :${orgParam} appears ${n} times.`;
  return null;
}

/** A URL path that this route matches — for the tester and "matches e.g." lines. */
export function examplePath(path: string, samples: Record<string, string> = {}): string {
  const segs = parseSegments(path).map((s) => {
    if (s.kind === 'rest') return samples.any ?? 'x';
    if (s.kind === 'param') return samples[s.value] ?? (ORG_NAMES.has(s.value) ? '3f0c' : '42');
    return s.value;
  });
  return `/${segs.join('/')}`;
}

/** How a path is shown: `*` for the rest, never `:any*`. */
export function displayPath(path: string): string {
  return path.replace(/:any\*$/, '*');
}

/** Whether a request path is matched by a route path — the route map's rule, for instant feedback. */
export function matchesPath(pattern: string, path: string): boolean {
  const p = pattern.split('/');
  const u = path.split('/');
  if (p.at(-1) === ':any*') {
    const fixed = p.slice(0, -1);
    return u.length >= fixed.length && fixed.every((s, i) => s.startsWith(':') ? !!u[i] : s === u[i]);
  }
  return p.length === u.length && p.every((s, i) => (s.startsWith(':') ? !!u[i] : s === u[i]));
}

export const METHOD_PRESETS: Record<'read' | 'write' | 'all', HttpMethod[]> = {
  read: ['GET', 'HEAD'],
  write: ['POST', 'PUT', 'PATCH', 'DELETE'],
  all: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
};

export const WRITE_METHODS: ReadonlySet<string> = new Set(METHOD_PRESETS.write);

export function toggleMethod(methods: readonly HttpMethod[], m: HttpMethod): HttpMethod[] {
  const set = new Set(methods);
  if (set.has(m)) set.delete(m); else set.add(m);
  return HTTP_METHODS.filter((x) => set.has(x));
}
