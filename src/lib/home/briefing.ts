import type {
  Attention, ChangeItem, Me, HealthComponent, HealthId, HealthState, HomeResponse, HomeWindow, Module, QuickAction, QuickActionId,
} from '../../api/home';

/**
 * What the Home decides on the client: who is looking, the one-line summary, the health strip in
 * request order, and which quick actions make the cut. Pure functions, so every rule is a test.
 */

// ── persona ─────────────────────────────────────────────────────────────────

export type Persona = 'platform' | 'org_admin' | 'support' | 'none';

const shown = (m: Module<unknown> | undefined) => !!m && m.status !== 'forbidden';

/**
 * A hint for composition only: the server already scoped every module. Platform readers see the
 * platform; an org admin has org ids and no platform; support sees people without the platform; the
 * rest see their own recertification inbox and nothing else.
 */
export function personaOf(res: Pick<HomeResponse, 'scope' | 'modules'>): Persona {
  if (res.scope.platform) return 'platform';
  if (res.scope.orgs.length > 0) return 'org_admin';
  const m = res.modules;
  const anyEnabled = (m.actions.data?.items ?? []).some((a) => a.enabled || a.reason === 'mfa_required');
  if (shown(m.people) || anyEnabled) return 'support';
  return 'none';
}

// ── health strip ────────────────────────────────────────────────────────────

export interface HealthRow {
  key: string;
  label: string;
  tip: string;
  state: HealthState;
  summary: string;
  since?: string;
  link?: HealthComponent['link'];
  /** What breaks while this is down. */
  consequence: string;
  /** Parts of a merged row that are not deployed here, said beside it rather than as its state. */
  notes?: string[];
}

/** The path a request and a change travel, in that order (home-design §4.2). */
const STRIP: Array<{ key: string; ids: HealthId[]; label: string; tip: string; consequence: string }> = [
  { key: 'waf', ids: ['waf'], label: 'WAF', tip: 'Live sites behind the Envoy Gateway’s WAF (Coraza), with no nginx Ingress left around it.', consequence: 'sites answer without WAF inspection or IP bans.' },
  { key: 'gateway', ids: ['gateway'], label: 'Gateway', tip: 'Oathkeeper — checks who is calling before a request reaches a site.', consequence: 'sites behind it are unreachable.' },
  { key: 'gateway_rules', ids: ['gateway_rules'], label: 'Gateway rules', tip: 'The rules the gateway loads. It re-reads them every 5 seconds; this is when they were last served and whether they compiled.', consequence: 'rule changes are not reaching the gateway.' },
  { key: 'opa', ids: ['opa'], label: 'Policy engine', tip: 'OPA — decides whether a signed-in person may call a route.', consequence: 'every request that needs a permission is denied.' },
  { key: 'opal_data', ids: ['opal_data'], label: 'Policy sync', tip: 'OPAL — pushes roles, groups and routes to the policy engine. Time since the last update was received.', consequence: "access changes aren't reaching the gateway." },
  { key: 'kratos', ids: ['kratos'], label: 'Sign-in', tip: 'Kratos — accounts, passwords, passkeys and sessions.', consequence: 'nobody can sign in; people already signed in keep working until their session expires.' },
  { key: 'jinbe', ids: ['jinbe'], label: 'Console API', tip: 'jinbe — the API behind this console.', consequence: 'this console cannot read or change anything.' },
  { key: 'redis', ids: ['redis'], label: 'Data store', tip: 'Redis — where roles, groups, routes and org grants are stored.', consequence: "you can't change access; the policy engine keeps the last data it received." },
  { key: 'audit', ids: ['audit_store', 'audit_archive'], label: 'Audit log', tip: 'Where every change is recorded (Loki), and how far the tamper-evident archive is behind.', consequence: 'recent changes and sign-in figures may be incomplete; changes are still queued for it.' },
  { key: 'certificates', ids: ['certificates'], label: 'Certificates', tip: 'HTTPS certificates for the platform and site addresses. Days until the soonest one expires.', consequence: 'sites may stop answering over HTTPS.' },
];

const RANK: Record<HealthState, number> = { ok: 0, not_deployed: 1, unknown: 2, degraded: 3, down: 4 };

const plural2 = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * The WAF row's words from its counts: how many live sites are NOT behind the WAF, and on how many
 * distinct hosts when that differs (several sites can share one host) — "4 sites (3 hosts) not behind
 * the WAF". Without counts (an older jinbe) the server's own summary stands.
 */
export function wafSummary(c: HealthComponent): string {
  const m = c.metrics;
  if (!m || typeof m.total !== 'number') return c.summary;
  if (m.total === 0) return 'no live sites';
  const unprotected = m.unprotected ?? m.total - (m.waf ?? 0) - (m.unknown ?? 0);
  const unknown = m.unknown ? ` · ${plural2(m.unknown, 'site', 'sites')} unknown` : '';
  if (unprotected <= 0) return m.unknown ? `${m.waf ?? 0}/${m.total} sites behind the WAF${unknown}` : `all ${plural2(m.total, 'site', 'sites')} behind the WAF`;
  const hosts = m.unprotectedHosts;
  const where = hosts && hosts !== unprotected ? ` (${plural2(hosts, 'host', 'hosts')})` : '';
  return `${plural2(unprotected, 'site', 'sites')}${where} not behind the WAF${unknown}`;
}

/** Labels for the parts of a merged row, when one of them is only noted. */
const PART_LABEL: Partial<Record<HealthId, string>> = { audit_store: 'Audit log', audit_archive: 'Archive' };

/**
 * The strip's rows, one per item in request order; the two audit components merge, worst wins. A part
 * that is not deployed here (no archiver configured) does not win over one that is: it is a choice of
 * this deployment, said as a note, never drawn as the row's state.
 */
export function healthRows(components: HealthComponent[]): HealthRow[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const rows: HealthRow[] = [];
  for (const s of STRIP) {
    const parts = s.ids.map((id) => byId.get(id)).filter((c): c is HealthComponent => !!c);
    if (parts.length === 0) continue;
    const deployed = parts.filter((p) => p.state !== 'not_deployed');
    const pool = deployed.length > 0 ? deployed : parts;
    const worst = pool.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
    const notes = deployed.length > 0 && deployed.length < parts.length
      ? parts.filter((p) => p.state === 'not_deployed').map((p) => `${PART_LABEL[p.id] ?? p.id}: ${p.summary}`)
      : undefined;
    rows.push({
      key: s.key, label: s.label, tip: s.tip, consequence: s.consequence, state: worst.state,
      summary: worst.id === 'waf' ? wafSummary(worst) : worst.summary, since: worst.since, link: worst.link,
      ...(notes?.length ? { notes } : {}),
    });
  }
  return rows;
}

export const HEALTH_WORD: Record<HealthState, string> = {
  ok: 'ok', degraded: 'degraded', down: 'down', unknown: 'unknown', not_deployed: 'not deployed',
};

// ── summary sentence ────────────────────────────────────────────────────────

export interface Clause { text: string; anchor: string; tone?: 'danger' }

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const windowWords = (w: HomeWindow) => (w === '7d' ? 'the last 7 days' : 'the last 24 h');

function needsYou(att: Module<Attention>): Clause | null {
  if (att.status !== 'ok' || !att.data) return null;
  const n = att.data.items.length;
  const partial = Object.values(att.sources ?? {}).some((s) => s.state !== 'ok');
  if (n === 0) return { text: partial ? 'Nothing needs you in what we could check' : 'Nothing needs you', anchor: 'home-attention' };
  return { text: `${plural(n, 'thing needs', 'things need')} you`, anchor: 'home-attention' };
}

/**
 * The line under the title, at most three clauses, in the order of home-design §4.1: a component
 * that is down overrides everything; then what needs you; then platform health; then sign-ins.
 */
export function summaryClauses(res: HomeResponse, persona: Persona, orgName?: string | null): Clause[] {
  const m = res.modules;
  const rows = m.health.status === 'ok' && m.health.data ? healthRows(m.health.data.components) : [];
  const down = rows.find((r) => r.state === 'down');
  if (down) return [{ text: `${down.label} is down — ${down.consequence}`, anchor: 'home-health', tone: 'danger' }];

  const out: Clause[] = [];
  if (persona === 'none') {
    // Someone with no rights is told so on the page; "Nothing needs you" would only confuse.
    const q = needsYou(m.attention);
    return q && (m.attention.data?.items.length ?? 0) > 0 ? [q] : [];
  }
  if (persona === 'org_admin') {
    const orgs = m.people.data?.byOrg ?? [];
    const members = orgs.reduce((n, o) => n + o.members, 0);
    if (orgName) out.push({ text: orgName, anchor: 'home-people' });
    if (m.people.status === 'ok') out.push({ text: plural(members, 'member', 'members'), anchor: 'home-people' });
    const q = needsYou(m.attention);
    if (q) out.push(q);
    return out;
  }
  if (persona === 'support') {
    const sessions = m.people.data?.sessionsActive?.count;
    if (sessions != null) out.push({ text: plural(sessions, 'active session', 'active sessions'), anchor: 'home-people' });
    const inbox = m.me.data?.recertPending ?? 0;
    if (inbox > 0) out.push({ text: `${plural(inbox, 'recertification', 'recertifications')} waiting on you`, anchor: 'home-attention' });
    else { const q = needsYou(m.attention); if (q) out.push(q); }
    return out;
  }
  const q = needsYou(m.attention);
  if (q) out.push(q);
  if (rows.length) {
    const degraded = rows.filter((r) => r.state === 'degraded').length;
    out.push({ text: degraded ? `${plural(degraded, 'system', 'systems')} degraded` : 'platform healthy', anchor: 'home-health' });
  }
  if (m.activity.status === 'ok' && m.activity.data) {
    out.push({ text: `${plural(m.activity.data.signIns.succeeded, 'sign-in', 'sign-ins')} in ${windowWords(res.window)}`, anchor: 'home-activity' });
  }
  return out.slice(0, 3);
}

// ── quick actions ───────────────────────────────────────────────────────────

const PRIORITY: QuickActionId[] = [
  'review_requests', 'new_site', 'invite_user', 'grant_access', 'check_access', 'find_user',
  'open_audit', 'start_recert', 'org_api_key', 'revoke_sessions', 'send_recovery', 'open_gateway',
];

/**
 * The tiles to draw: enabled ones, and the ones that only need a fresh second factor (they run the
 * step-up first). Anything refused for a permission, a missing component or nothing to do is absent,
 * not greyed. Six at most, in the priority order of home-design §4.4.
 */
export function visibleActions(items: QuickAction[]): QuickAction[] {
  return items
    .filter((a) => a.enabled || a.reason === 'mfa_required')
    .filter((a) => a.id !== 'review_requests' || a.count == null || a.count > 0)
    .sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id))
    .slice(0, 6);
}

// ── numbers ─────────────────────────────────────────────────────────────────

export interface Delta { text: string; aria: string }

/** "−8% vs previous 24 h"; null when there is nothing to compare with. */
export function deltaOf(current: number, prev: number, window: HomeWindow): Delta | null {
  if (prev <= 0) return null;
  const pct = Math.round(((current - prev) / prev) * 100);
  const span = window === '7d' ? '7 days' : '24 h';
  if (pct === 0) return { text: `same as previous ${span}`, aria: `unchanged from the previous ${span}` };
  const sign = pct > 0 ? '+' : '−';
  return { text: `${sign}${Math.abs(pct)}% vs previous ${span}`, aria: `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)} percent from the previous ${span}` };
}

/** How long ago, short: "40 s", "12 min", "2 h", "3 d". */
export function ageOf(iso: string | null | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

// ── recent changes, access request ──────────────────────────────────────────

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Newest first, filed under "Today", "Yesterday", "Tue 22 Sep". */
export function byDay(items: ChangeItem[], now: number = Date.now()): Array<{ label: string; items: ChangeItem[] }> {
  const today = dayKey(new Date(now));
  const yesterday = dayKey(new Date(now - 86_400_000));
  const out: Array<{ key: string; label: string; items: ChangeItem[] }> = [];
  for (const it of items) {
    const d = new Date(it.ts);
    const key = dayKey(d);
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: key === today ? 'Today' : key === yesterday ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

/** The text a person without access copies to ask for it: who they are, what for, when. */
export function accessRequestText(me: Pick<Me, 'name' | 'subject'>, at: Date = new Date()): string {
  return [
    'Requesting access to kuma (the access console).',
    `Name: ${me.name ?? 'Unknown user'}`,
    `Account id: ${me.subject}`,
    `Asked: ${at.toISOString()}`,
  ].join('\n');
}
