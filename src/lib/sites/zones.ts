import type { GatewayInfo, Zone, ZoneIngress } from './types';

/**
 * How a zone is reached, and whether that is behind the WAF (Settings → Zones). A zone is served by
 * the nginx Ingress, by a Gateway API Gateway (Envoy: WAF + IP reputation), or by both while it
 * migrates: attach the gateway, move DNS, then drop the Ingress. "Protected" is only said when the
 * Gateway's policies are in force (jinbe reads them from the cluster) AND no Ingress is left —
 * while one answers, anyone can reach the hosts around the WAF.
 */

export type ProtectionTone = 'success' | 'warning' | 'danger' | 'neutral';
export interface ProtectionState { tone: ProtectionTone; label: string; detail: string }

export const INGRESS_LABEL: Record<ZoneIngress, string> = {
  wildcard: 'nginx wildcard Ingress',
  'per-site': 'nginx Ingress per site',
  none: 'no Ingress',
};

export function entryOf(z: Pick<Zone, 'ingress' | 'gateway'>): 'ingress' | 'gateway' | 'both' {
  const ingress = (z.ingress ?? 'wildcard') !== 'none';
  return z.gateway ? (ingress ? 'both' : 'gateway') : 'ingress';
}

export const ENTRY_LABEL = { ingress: 'nginx', gateway: 'Envoy Gateway', both: 'nginx + Envoy (migrating)' } as const;

export function protectionOf(z: Pick<Zone, 'ingress' | 'gateway'>, gateways: readonly GatewayInfo[] | undefined): ProtectionState {
  const entry = entryOf(z);
  if (entry === 'ingress') return { tone: 'danger', label: 'No WAF', detail: 'Served by nginx: no WAF, no IP bans. Attach the zone to a Gateway.' };
  const gw = gateways?.find((g) => g.key === z.gateway);
  if (!gw) return { tone: 'neutral', label: 'Unknown', detail: `Gateway ${z.gateway} is not one this console can inspect.` };
  if (!gw.protection.protected) return { tone: 'danger', label: 'Gateway not protected', detail: gw.protection.summary };
  if (entry === 'both') {
    return { tone: 'warning', label: 'WAF bypassable', detail: 'The Gateway protects its routes, but the nginx Ingress still answers: move DNS to the Gateway, then drop the Ingress.' };
  }
  return { tone: 'success', label: 'Protected by WAF', detail: gw.protection.summary };
}

/** The Gateway listener serving `*.<domain>` with its own certificate (what TLS `default` needs). */
export function coveringListener(gw: GatewayInfo, domain: string) {
  return gw.listeners.find((l) => l.protocol === 'HTTPS' && l.hostname === `*.${domain}`) ?? null;
}

/** Why a Gateway cannot take a zone with TLS default, or null when it can. */
export function gatewayProblem(gw: GatewayInfo | undefined, domain: string, tls: 'default' | 'issuer' | 'secret'): string | null {
  if (!gw) return null;
  if (!gw.exists) return gw.message;
  if (tls === 'default' && domain && !coveringListener(gw, domain)) {
    return `${gw.key} has no HTTPS listener for *.${domain}; choose TLS "issued certificate" to bring the zone's own listener.`;
  }
  return null;
}

/** The next step of a zone's move to the Gateway, in words. */
export function nextStep(z: Pick<Zone, 'ingress' | 'gateway'>): string | null {
  switch (entryOf(z)) {
    case 'ingress': return 'Attach a Gateway: each site host gets a route behind the WAF, nginx keeps serving until DNS moves.';
    case 'both': return 'Point the site hosts’ DNS at the Gateway, then drop the Ingress.';
    default: return null;
  }
}
