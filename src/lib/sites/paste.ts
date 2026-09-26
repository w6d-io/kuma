/**
 * The wizard's single smart field (site-ux.md §4.1): paste a public URL, an internal address, an
 * OpenAPI link or a bare word, and we say what it was understood as. Client-side classification
 * only; the host check and the probe answer whether it works.
 */

export type Pasted =
  | { kind: 'public'; host: string; label: string; zone: string; pathPrefix?: string }
  | { kind: 'upstream'; service: string; namespace: string; port: number; scheme: 'http' | 'https' }
  | { kind: 'openapi'; url: string; upstream?: { service: string; namespace: string; port: number; scheme: 'http' | 'https' } }
  | { kind: 'name'; name: string }
  | { kind: 'outside'; host: string }
  | { kind: 'unknown' };

const OPENAPI = /(openapi\.(json|ya?ml)|swagger\.json|\/v3\/api-docs)$/i;

function inCluster(host: string): { service: string; namespace: string } | null {
  const h = host.replace(/\.svc(\.cluster\.local)?$/, '');
  const parts = h.split('.');
  if (parts.length !== 2 || parts.some((p) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(p))) return null;
  return { service: parts[0], namespace: parts[1] };
}

export function detectPaste(input: string, zones: readonly string[]): Pasted {
  const text = input.trim();
  if (!text) return { kind: 'unknown' };
  if (/^[a-z][a-z0-9-]{1,39}$/.test(text)) return { kind: 'name', name: text };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return { kind: 'unknown' };
  }
  const host = url.hostname.toLowerCase();
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const cluster = inCluster(host);
  const upstream = cluster ? { ...cluster, port: url.port ? Number(url.port) : scheme === 'https' ? 443 : 80, scheme } as const : undefined;

  // A platform zone wins over the in-cluster shape: `demo.dev` could be svc.namespace, but
  // `demo.dev.stairling.com` is an address.
  const zone = [...zones].sort((a, b) => b.length - a.length).find((z) => host.endsWith(`.${z}`));
  if (zone && !OPENAPI.test(url.pathname)) {
    const label = host.slice(0, -(zone.length + 1));
    const path = url.pathname.replace(/\/$/, '');
    return { kind: 'public', host, label, zone, ...(path ? { pathPrefix: path } : {}) };
  }
  if (OPENAPI.test(url.pathname)) return { kind: 'openapi', url: url.toString(), ...(upstream ? { upstream } : {}) };
  if (upstream) return { kind: 'upstream', ...upstream };

  if (host.includes('.')) return { kind: 'outside', host };
  return { kind: 'unknown' };
}

/** A line saying what the field understood, for the chip under it. */
export function describePaste(p: Pasted): string {
  switch (p.kind) {
    case 'public': return `Public address ${p.host}${p.pathPrefix ?? ''}`;
    case 'upstream': return `Runs at ${p.scheme}://${p.service}.${p.namespace}:${p.port}`;
    case 'openapi': return `API description ${p.url}`;
    case 'name': return `Name ${p.name}`;
    case 'outside': return `${p.host} is under no platform zone`;
    case 'unknown': return 'Not recognised — fill the fields below.';
  }
}
