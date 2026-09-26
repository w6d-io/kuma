import { PAGE_IDS, type PageId } from '../api/types';

/**
 * The hash, read as a page and an optional thing on it: `#/people/<id>`, `#/organizations/<id>`.
 *
 * No router library — the console has one level of addressing and the hash already carries the
 * page. A second segment names what the page has open, so a link to a person or an organisation can
 * be pasted into a ticket and land on the same screen.
 */
export interface Route {
  page: PageId;
  param: string | null;
  /** `?a=1&b=2` after the page, for a screen whose state is a form (the access checker). */
  query?: Record<string, string>;
}

// A public name for a page whose internal id predates it. Both are accepted; links are written with
// the public one.
const ALIASES: Record<string, PageId> = { people: 'users', 'access-check': 'accesscheck' };
// Screens that were retired or folded into another: a bookmark lands on what replaced them, with the
// query that picks the right view there. A query in the link itself wins over the default.
const REDIRECTS: Record<string, { page: PageId; query?: Record<string, string> }> = {
  simulator: { page: 'accesscheck' },
  services: { page: 'sites' },
  routes: { page: 'roles', query: { tab: 'permissions' } },
  rules: { page: 'gateway' },
  apis: { page: 'gateway' },
  enforced: { page: 'gateway' },
};
const PUBLIC: Partial<Record<PageId, string>> = { users: 'people', accesscheck: 'access-check' };
// Pages with no older bare link to keep: written with the public name even without a param.
const ALWAYS_PUBLIC: ReadonlySet<PageId> = new Set<PageId>(['accesscheck']);

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const [head = '', rawParam] = (q < 0 ? raw : raw.slice(0, q)).split('/');
  const redirect = REDIRECTS[head];
  const name = redirect?.page ?? ALIASES[head] ?? head;
  // PAGE_IDS is the same array PageId is derived from — a page added to the type is automatically
  // routable (a hand-copied list here once missed one).
  if (!(PAGE_IDS as readonly string[]).includes(name)) return { page: 'dashboard', param: null };
  let param: string | null = null;
  if (rawParam) {
    try { param = decodeURIComponent(rawParam); } catch { param = null; }
  }
  const route: Route = { page: name as PageId, param: param || null };
  const query = {
    ...redirect?.query,
    ...(q >= 0 ? Object.fromEntries(new URLSearchParams(raw.slice(q + 1))) : {}),
  };
  if (Object.keys(query).length > 0) route.query = query;
  return route;
}

export function formatHash(page: PageId, param?: string | null, query?: Record<string, string | undefined>): string {
  const name = param || ALWAYS_PUBLIC.has(page) ? PUBLIC[page] ?? page : page;
  const base = param ? `/${name}/${encodeURIComponent(param)}` : `/${name}`;
  const qs = new URLSearchParams(
    Object.entries(query ?? {}).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  return qs ? `${base}?${qs}` : base;
}
