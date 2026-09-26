import { HTTP_METHODS, type HttpMethod, type Site } from './types';

/** The URL tester's pure parts (site-ux.md §6.2): its address form and the forwarded request. */

export function parseTest(q?: string): { method: HttpMethod; path: string } {
  const [m, ...rest] = (q ?? '').trim().split(/\s+/);
  const method = (HTTP_METHODS as readonly string[]).includes((m ?? '').toUpperCase()) ? (m.toUpperCase() as HttpMethod) : 'GET';
  const path = rest.join(' ') || (m && m.startsWith('/') ? m : '/');
  return { method, path: path.startsWith('/') ? path : `/${path}` };
}

/** The request the upstream sees: strip_path removed (first occurrence, as Oathkeeper does), then the upstream origin. */
export function upstreamRequest(site: Pick<Site, 'upstream'>, path: string): string {
  const u = site.upstream;
  const stripped = u.stripPath && path.includes(u.stripPath) ? path.replace(u.stripPath, '') || '/' : path;
  return `${u.scheme ?? 'http'}://${u.service}.${u.namespace}.svc.cluster.local:${u.port}${stripped.startsWith('/') ? stripped : `/${stripped}`}`;
}
