import type { SavedQuery } from '../../api/audit';
import { fromServerFilters } from './filters';

/**
 * Saved views: the defaults every reader gets (audit-tab.md §5.1), the reader's own from jinbe's
 * saved-queries, and — while that endpoint does not exist yet — the reader's own kept in this
 * browser. A view is a name and the filter params of `#/audit?…`.
 */
export interface SavedView {
  id: string;
  name: string;
  params: Record<string, string>;
  origin: 'default' | 'server' | 'local';
  shared?: boolean;
  /** False for a view shared by somebody else: only its owner may delete it. */
  mine?: boolean;
}

export const DEFAULT_VIEWS: SavedView[] = [
  { id: 'default:high-risk', name: 'High-risk changes', params: { severity: 'high' }, origin: 'default' },
  { id: 'default:denied', name: 'Denied access', params: { result: 'denied' }, origin: 'default' },
  { id: 'default:logins-failed', name: 'Logins failed', params: { event: 'auth.login.failed' }, origin: 'default' },
  { id: 'default:api-keys', name: 'API keys', params: { event: 'apikey.*' }, origin: 'default' },
  { id: 'default:grants-week', name: 'Grants this week', params: { event: 'org.grants.*', range: '7d' }, origin: 'default' },
];

const KEY = 'kuma.audit.views';

export function fromServer(q: SavedQuery): SavedView {
  return { id: q.id, name: q.name, params: fromServerFilters(q.filters), origin: 'server', shared: q.shared, mine: q.mine !== false };
}

export function readLocalViews(): SavedView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((v) => v && typeof v.id === 'string' && typeof v.name === 'string' && v.params && typeof v.params === 'object')
        .map((v) => ({ ...v, origin: 'local' as const }))
      : [];
  } catch { return []; }
}

export function writeLocalViews(views: SavedView[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(views.filter((v) => v.origin === 'local'))); } catch { /* not kept */ }
}

export function addLocalView(views: SavedView[], name: string, params: Record<string, string>, now = Date.now()): SavedView[] {
  const clean = name.trim().slice(0, 80);
  if (!clean) return views;
  return [...views.filter((v) => v.name !== clean), { id: `local:${now}`, name: clean, params, origin: 'local' }];
}

/** Which view the current params are, if any — so the picker can show it as selected. */
export function matchView(views: SavedView[], params: Record<string, string>): SavedView | undefined {
  const same = (a: Record<string, string>, b: Record<string, string>) => {
    const ka = Object.keys(a).filter((k) => k !== 'range');
    const kb = Object.keys(b).filter((k) => k !== 'range');
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  };
  return views.find((v) => same(v.params, params));
}
