import { GETS, PASS, WHO } from './presets';
import type { Gate, Route, Site } from './types';

/**
 * The wizard's Kind step (site-ux.md §4.2): a template turns a name, an address and an upstream into
 * a complete intent — gates, routes, a catch-all, standard roles. Built only from handlers the
 * sandbox gateway runs (noop, cookie_session, bearer_token, oauth2_introspection / allow, deny,
 * remote_json / noop, header / json, redirect).
 *
 * Every template has a catch-all, so going live never leaves a site answering 404 everywhere
 * (legacy stumble #1, §18).
 */

export type TemplateId = 'web-api' | 'app' | 'api' | 'spa-api' | 'public' | 'empty';

export interface TemplateInfo { id: TemplateId; label: string; hint: string; gates: string; routes: string; errors: string }

export const TEMPLATES: TemplateInfo[] = [
  { id: 'web-api', label: 'Web app + API', hint: 'People sign in with their browser. /api/* also accepts API tokens. Permissions per route.', gates: 'Public (assets, health) · Browser · API', routes: '4 public · /api/* signed-in · catch-all Signed-in', errors: 'browsers → sign-in page; API → JSON' },
  { id: 'app', label: 'Signed-in web app', hint: 'Browser sign-in for everything. Permissions per route.', gates: 'Public (assets, health) · Browser', routes: '4 public · catch-all Signed-in', errors: 'sign-in page, errors as pages' },
  { id: 'api', label: 'API', hint: 'Tokens only (session tokens, OAuth2 clients). JSON errors, no redirects.', gates: 'Public (health) · API + pre-flight', routes: '1 public · catch-all needs read permission', errors: 'JSON' },
  { id: 'spa-api', label: 'Single-page app + API', hint: 'The app shell is served to signed-in people; the API takes the same session cookie or tokens.', gates: 'Public · Browser (shell) · API', routes: 'shell signed-in · /api/* signed-in', errors: 'browsers → sign-in page; API → JSON' },
  { id: 'public', label: 'Public website', hint: 'No sign-in. Anyone can read.', gates: 'Public', routes: 'catch-all Public (GET, HEAD)', errors: 'platform default' },
  { id: 'empty', label: 'Start empty', hint: 'Just the address and one sign-in gate; you add routes yourself.', gates: 'Browser', routes: 'catch-all Signed-in', errors: 'sign-in page' },
];

const PUBLIC_GATE: Gate = {
  id: 'public', label: 'Public', authenticators: WHO.anyone, authorizer: PASS.everyone, mutators: GETS.nothing, errors: 'platform', methods: ['GET', 'HEAD'],
};
const BROWSER_GATE: Gate = {
  id: 'browser', label: 'Browser', authenticators: WHO['signed-in'], authorizer: 'policy', mutators: GETS.identity, errors: 'website',
};
const API_GATE: Gate = {
  id: 'api', label: 'API', authenticators: WHO.tokens, authorizer: 'policy', mutators: GETS.identity, errors: 'api', preflight: true,
};

const publicRoute = (id: string, path: string): Route => ({ id, methods: ['GET', 'HEAD'], path, gate: 'public', access: { kind: 'public' }, source: 'template' });

const ASSETS: Route[] = [
  publicRoute('assets', '/assets/:any*'),
  publicRoute('favicon', '/favicon.ico'),
  publicRoute('health', '/health'),
  publicRoute('robots', '/robots.txt'),
];

const apiRoute = (prefix: string): Route => ({
  id: 'api', methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], path: `${prefix}/api/:any*`, gate: 'api', access: { kind: 'signed-in' }, source: 'template',
});

export interface SiteBasics {
  name: string;
  displayName: string;
  host: string;
  pathPrefix?: string;
  service: string;
  namespace: string;
  port: number;
}

/** Prefix every template path with the site's path prefix (a site sharing its host). */
const under = (prefix: string | undefined, r: Route): Route => (prefix ? { ...r, path: r.path === '/' ? prefix : `${prefix}${r.path}` } : r);

export function buildSite(template: TemplateId, b: SiteBasics, opts: { shellPublic?: boolean } = {}): Site {
  const prefix = b.pathPrefix || undefined;
  const base: Omit<Site, 'gates' | 'routes'> = {
    name: b.name,
    displayName: b.displayName || b.name,
    address: { host: b.host, ...(prefix ? { pathPrefix: prefix } : {}) },
    upstream: { service: b.service, namespace: b.namespace, port: b.port },
    exposure: { mode: 'zone' },
    roles: 'standard',
    groups: { platform: {}, orgGrantable: {} },
    orgs: [],
    login: { twoFactor: { scope: 'none', clients: 'exempt' }, reach: 'granted' },
    state: 'active',
  };
  const items = (rs: Route[]) => rs.map((r) => under(prefix, r));
  switch (template) {
    case 'public':
      return { ...base, upstream: { ...base.upstream, preserveHost: true }, gates: [PUBLIC_GATE], routes: { items: [], catchAll: { gate: 'public', access: { kind: 'public' } } } };
    case 'app':
      return { ...base, gates: [PUBLIC_GATE, BROWSER_GATE], routes: { items: items(ASSETS), catchAll: { gate: 'browser', access: { kind: 'signed-in' } } } };
    case 'api':
      return {
        ...base,
        gates: [{ ...PUBLIC_GATE, errors: 'api' }, API_GATE],
        routes: { items: items([publicRoute('health', '/health')]), catchAll: { gate: 'api', access: { kind: 'permission', permission: `${b.name}:read` } } },
      };
    case 'web-api':
      return { ...base, gates: [PUBLIC_GATE, BROWSER_GATE, API_GATE], routes: { items: [...items(ASSETS), apiRoute(prefix ?? '')], catchAll: { gate: 'browser', access: { kind: 'signed-in' } } } };
    case 'spa-api': {
      const api: Gate = { ...API_GATE, authenticators: WHO['signed-in-or-tokens'] };
      const catchAll = opts.shellPublic
        ? { gate: 'public', access: { kind: 'public' } as const }
        : { gate: 'browser', access: { kind: 'signed-in' } as const };
      return { ...base, gates: [PUBLIC_GATE, BROWSER_GATE, api], routes: { items: [...items(ASSETS), apiRoute(prefix ?? '')], catchAll } };
    }
    case 'empty':
      return { ...base, gates: [BROWSER_GATE], routes: { items: [], catchAll: { gate: 'browser', access: { kind: 'signed-in' } } } };
  }
}

/** The kind a site most looks like, for the list's Kind column (null when hand-built). */
export function kindOf(site: Pick<Site, 'gates'>): string {
  const ids = site.gates.map((g) => g.id).sort().join(',');
  if (ids === 'public') return 'Public website';
  if (ids === 'browser,public') return 'Signed-in app';
  if (ids === 'api,public') return 'API';
  if (ids === 'api,browser,public') return 'Web app + API';
  return 'Custom';
}

export const STANDARD_GROUPS: Record<string, string> = { admins: 'admin', devs: 'editor', viewers: 'viewer' };

/** Org-grantable groups created for the site (span only it, never the `*` admin role). */
export function orgGrantableFor(name: string, displayName: string): Site['groups']['orgGrantable'] {
  return {
    [`${name}-editors`]: { label: `${displayName} editors`, roles: ['editor'] },
    [`${name}-viewers`]: { label: `${displayName} viewers`, roles: ['viewer'] },
  };
}

/** One sentence about the site, the top of every Review (§4.4). */
export function summarySentence(site: Site, people?: number | null): string {
  const addr = `${site.address.host}${site.address.pathPrefix ?? ''}`;
  const up = `${site.upstream.service}.${site.upstream.namespace}:${site.upstream.port}`;
  const ca = site.routes.catchAll.access.kind;
  const who = ca === 'public' ? 'everyone' : ca === 'deny' ? 'nobody by default' : 'signed-in people';
  const api = site.gates.some((g) => g.id === 'api') ? ' /api also accepts API tokens.' : '';
  const groups = Object.keys(site.groups.platform).length;
  const reach = people != null ? `${people} people get access through ${groups} group${groups === 1 ? '' : 's'}.` : `${groups} group${groups === 1 ? '' : 's'} mapped.`;
  const orgs = site.orgs.length === 0 ? 'No organizations.' : `${site.orgs.length} organization${site.orgs.length === 1 ? '' : 's'}.`;
  return `${addr} will send ${who} to ${up}.${api} ${reach} ${orgs}`;
}
