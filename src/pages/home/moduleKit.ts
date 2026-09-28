import { useCallback, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AttentionItem, Module, QuickAction, QuickActionId } from '../../api/home';
import { useApp } from '../../contexts/AppContext';
import { I } from '../../components/ui';
import type { Persona } from '../../lib/home/briefing';

/** What the Home modules share that is not a component: source names, the query adapter, the tiles. */

const SOURCE_WORDS: Record<string, string> = {
  loki: 'the audit log (Loki)', audit: 'the audit log', kratos: 'Sign-in (Kratos)', redis: 'the data store (Redis)',
  kube: 'Kubernetes', kubernetes: 'Kubernetes', prometheus: 'Prometheus', opa: 'the policy engine', opal: 'Policy sync',
  certificates: 'certificates', jinbe: 'the console API', oathkeeper: 'the gateway',
};
export const sourceWords = (s: string) => SOURCE_WORDS[s] ?? s;

/** A module query as the frame's props. */
export function fromQuery<T>(q: UseQueryResult<Module<T>, Error>) {
  return { module: q.data, loading: q.isFetching, error: q.error, onRetry: () => { void q.refetch(); } };
}

interface Tile { icon: ReactNode; verb: (a: QuickAction, p?: Persona) => string; key?: string; hint?: string; href?: (p: Persona) => string | null }

export const TILES: Record<QuickActionId, Tile> = {
  review_requests: { icon: I.check, verb: (a) => (a.count ? `Review requests (${a.count})` : 'Review requests'), href: () => '#/sites?view=requests' },
  new_site: { icon: I.plus, verb: () => 'Plug a site', key: 'n', href: () => '#/sites/new' },
  invite_user: { icon: I.users, verb: (_a, p) => (p === 'org_admin' ? 'Invite a member' : 'Invite a user'), key: 'i', href: (p) => (p === 'org_admin' ? '#/orgadmin' : null) },
  grant_access: { icon: I.shield, verb: (_a, p) => (p === 'org_admin' ? 'Give access' : 'Grant access'), key: 'g', href: (p) => (p === 'org_admin' ? '#/orgadmin' : null) },
  check_access: { icon: I.search, verb: () => 'Check access', key: 'c', href: () => '#/access-check' },
  find_user: { icon: I.search, verb: () => 'Find a person', key: '/' },
  open_audit: { icon: I.audit, verb: () => 'Audit trail', href: () => '#/audit' },
  start_recert: { icon: I.clock, verb: () => 'Start a recertification', href: () => '#/recertification' },
  org_api_key: { icon: I.key, verb: () => 'Org API key', href: () => '#/apikeys' },
  revoke_sessions: { icon: I.lock, verb: () => 'Sign someone out', hint: 'Find the person first' },
  send_recovery: { icon: I.sync, verb: () => 'Send recovery link', hint: 'Find the person first' },
  open_gateway: { icon: I.gate, verb: () => 'Gateway', href: () => '#/gateway' },
};

/** ⌘K is the console's person picker; the shell listens for its shortcut. */
export function openFinder() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
}

/** What a tile (or its key) does when it is not a plain link. */
export function useRunAction(persona: Persona) {
  const { setGrant, setUserDrawer } = useApp();
  return useCallback((id: QuickActionId) => {
    const href = TILES[id].href?.(persona);
    if (href) { window.location.hash = href; return; }
    if (id === 'invite_user') setUserDrawer({ mode: 'create' });
    else if (id === 'grant_access') setGrant({});
    else openFinder();
  }, [persona, setGrant, setUserDrawer]);
}

/**
 * Kinds the console words itself, from their counts, with an icon that says what they are about.
 * Every other kind is drawn from the server's title and detail (the list is open).
 */
const KINDS: Record<string, { label: string; icon: ReactNode; title?: (m: Record<string, number>) => string | null; detail?: string }> = {
  audit_outbox_near_cap: {
    label: 'Audit outbox',
    icon: I.box,
    title: (m) => (typeof m.count === 'number' && typeof m.cap === 'number' ? `Audit outbox nearly full: ${m.count.toLocaleString()} of ${m.cap.toLocaleString()} events` : null),
    detail: 'No archiver is configured, so the oldest events are dropped once it is full. The audit log itself is unaffected.',
  },
};

/** An item's title, detail and icon: the console's words for a kind it knows, the server's otherwise. */
export function presentItem(it: AttentionItem): { title: string; detail?: string; icon?: ReactNode; label?: string } {
  const k = KINDS[it.kind];
  if (!k) return { title: it.title, detail: it.detail };
  return { title: (it.metrics && k.title?.(it.metrics)) || it.title, detail: k.detail ?? it.detail, icon: k.icon, label: k.label };
}
