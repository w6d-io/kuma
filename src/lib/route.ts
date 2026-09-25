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
}

// A public name for a page whose internal id predates it. Both are accepted; links are written with
// the public one.
const ALIASES: Record<string, PageId> = { people: 'users' };
const PUBLIC: Partial<Record<PageId, string>> = { users: 'people' };

export function parseHash(hash: string): Route {
  const [head = '', rawParam] = hash.replace(/^#\/?/, '').split('/');
  const name = ALIASES[head] ?? head;
  // PAGE_IDS is the same array PageId is derived from — a page added to the type is automatically
  // routable (a hand-copied list here once missed one).
  if (!(PAGE_IDS as readonly string[]).includes(name)) return { page: 'dashboard', param: null };
  let param: string | null = null;
  if (rawParam) {
    try { param = decodeURIComponent(rawParam); } catch { param = null; }
  }
  return { page: name as PageId, param: param || null };
}

export function formatHash(page: PageId, param?: string | null): string {
  if (!param) return `/${page}`;
  return `/${PUBLIC[page] ?? page}/${encodeURIComponent(param)}`;
}
