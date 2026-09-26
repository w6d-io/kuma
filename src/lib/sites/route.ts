/**
 * Addresses inside Sites (site-ux.md §3). The console's router knows the page (`sites`) and one
 * param; everything below that — the tab, the step, the selected route, the tester input — is read
 * here from the hash, so every screen state is a link that can go into a ticket.
 *
 *   #/sites                                 list
 *   #/sites?filter=attention                list, filtered
 *   #/sites/new?step=address|kind|access|review
 *   #/sites/migrate?step=preview|parity|dualrun|cutover|done   (also #/sites/migration)
 *   #/sites/<name>[/<tab>][?query]
 */

export const SITE_TABS = ['overview', 'routes', 'gates', 'access', 'login', 'status', 'history', 'settings', 'review'] as const;
export type SiteTab = (typeof SITE_TABS)[number];

export const WIZARD_STEPS = ['address', 'kind', 'access', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const MIGRATION_STEPS = ['preview', 'parity', 'dualrun', 'cutover', 'done'] as const;
export type MigrationStep = (typeof MIGRATION_STEPS)[number];

export type SitesView =
  | { view: 'list'; query: Record<string, string> }
  | { view: 'new'; step: WizardStep; query: Record<string, string> }
  | { view: 'migrate'; step: MigrationStep | null; query: Record<string, string> }
  | { view: 'site'; name: string; tab: SiteTab; query: Record<string, string> };

const pick = <T extends string>(list: readonly T[], v: string | undefined, fallback: T): T =>
  (list as readonly string[]).includes(v ?? '') ? (v as T) : fallback;

function decode(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
}

export function parseSitesHash(hash: string): SitesView {
  const raw = hash.replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const parts = (q < 0 ? raw : raw.slice(0, q)).split('/').filter(Boolean);
  const query = q < 0 ? {} : Object.fromEntries(new URLSearchParams(raw.slice(q + 1)));
  const [, second, third] = parts;
  if (!second) return { view: 'list', query };
  if (second === 'new') return { view: 'new', step: pick(WIZARD_STEPS, query.step, 'address'), query };
  if (second === 'migrate' || second === 'migration') {
    return { view: 'migrate', step: query.step ? pick(MIGRATION_STEPS, query.step, 'preview') : null, query };
  }
  const name = decode(second);
  if (!name) return { view: 'list', query };
  return { view: 'site', name, tab: pick(SITE_TABS, third, 'overview'), query };
}

function qs(query: Record<string, string | undefined> = {}): string {
  const s = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
}

export function sitesHref(v: { view: 'list'; query?: Record<string, string | undefined> }
  | { view: 'new'; step?: WizardStep; query?: Record<string, string | undefined> }
  | { view: 'migrate'; step?: MigrationStep }
  | { view: 'site'; name: string; tab?: SiteTab; query?: Record<string, string | undefined> }): string {
  switch (v.view) {
    case 'list': return `#/sites${qs(v.query)}`;
    case 'new': return `#/sites/new${qs({ ...v.query, step: v.step && v.step !== 'address' ? v.step : undefined })}`;
    case 'migrate': return `#/sites/migrate${qs({ step: v.step })}`;
    case 'site': {
      const tab = v.tab && v.tab !== 'overview' ? `/${v.tab}` : '';
      return `#/sites/${encodeURIComponent(v.name)}${tab}${qs(v.query)}`;
    }
  }
}

/** Go there. The app's own hashchange listener keeps the page and param in step. */
export function goSites(href: string): void {
  if (window.location.hash !== href) window.location.hash = href;
}
