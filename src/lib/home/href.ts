import { PAGE_IDS, type PageId } from '../../api/types';
import type { HomeTarget, HomeWindow } from '../../api/home';
import { formatHash } from '../route';
import { sitesHref, SITE_TABS, type SiteTab } from '../sites/route';
import { eventHash } from '../audit/format';

/**
 * The server's deep link (`target {page, params, anchor}`) as a kuma address.
 *
 * The server names pages the way the product talks about them (`access-review`, `api-keys`); the
 * router has its own ids. One helper, tested against the router, so a renamed page fails a test
 * rather than a click. A page the console does not know lands on Home, never on a broken hash.
 */

const PAGE_ALIASES: Record<string, PageId> = {
  'access-review': 'accessreview',
  'api-keys': 'apikeys',
  'access-check': 'accesscheck',
  'my-org': 'orgadmin',
  people: 'users',
};

const isPage = (p: string): p is PageId => (PAGE_IDS as readonly string[]).includes(p);

export function homeHref(target: HomeTarget): string {
  const params = target.params ?? {};
  const page = PAGE_ALIASES[target.page] ?? target.page;
  if (page === 'sites') return sitesTarget(params);
  if (page === 'audit') return auditTarget(params);
  if (!isPage(page)) return '#/dashboard';
  return `#${formatHash(page, null, params)}`;
}

function sitesTarget(params: Record<string, string>): string {
  const { name, tab, view, ...rest } = params;
  if (view === 'migration') return sitesHref({ view: 'migrate' });
  if (name) {
    const t = SITE_TABS.includes(tab as SiteTab) ? (tab as SiteTab) : undefined;
    // `drift` and `draft` are not tabs of their own: the status tab shows drift, review shows a draft.
    const mapped: SiteTab | undefined = t ?? (tab === 'drift' ? 'status' : tab === 'draft' ? 'review' : undefined);
    return sitesHref({ view: 'site', name, tab: mapped, query: rest });
  }
  return sitesHref({ view: 'list', query: { view, ...rest } });
}

function auditTarget(params: Record<string, string>): string {
  const { eventId, ts, window, ...rest } = params;
  if (eventId) return eventHash({ event_id: eventId, ts: ts ?? '' });
  // The audit page calls the time range `range`; its presets include both Home windows.
  return `#${formatHash('audit', null, { ...rest, range: window })}`;
}

/** Home's own address: `#/dashboard?window=7d&org=acme`, the defaults left out. */
export function homeSelfHref(window: HomeWindow, org: string | null): string {
  return `#${formatHash('dashboard', null, { window: window === '24h' ? undefined : window, org: org ?? undefined })}`;
}
