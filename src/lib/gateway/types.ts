/**
 * /api/admin/gateway (GW-3, agent jinbe-gateway): the gateway's handlers and their global config.
 * Secrets cannot be set from the console: the operator refuses them in the rendered config, so
 * they come from the chart. The server shows them as "***" (here `{masked: true}`); kuma sends
 * them back unchanged or leaves them out.
 */

export type HandlerKind = 'authenticators' | 'authorizers' | 'mutators' | 'errors';
export const HANDLER_KINDS: HandlerKind[] = ['authenticators', 'authorizers', 'mutators', 'errors'];

/** A secret is set by the platform (chart, from a Secret) and only ever shown as masked. */
export type SecretValue = { masked: true };

export interface GatewayHandler {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Dotted config keys that hold secrets. */
  secrets?: string[];
  usedBy: Array<{ site: string; gates: string[] }>;
  /** What must restart for a change to this handler to take effect. */
  restart?: 'oathkeeper' | 'oathkeeper+jinbe';
  /** Suggested values for required fields (jinbe `defaults`). */
  defaults?: Record<string, unknown>;
  /** Why it cannot be changed from kuma (platform-locked). */
  locked?: string;
  /** The platform's own rules use it (jinbe `inUse` "(platform)"). */
  platform?: boolean;
  /** Platform rules using it (jinbe `inUse` "rule/<name>"). */
  platformRules?: string[];
  /** On every gateway pod right now (status.liveEnabled); undefined when the operator has not reported. */
  live?: boolean;
}

export interface GatewayState {
  version: number;
  etag: string;
  production?: boolean;
  /** false: the live config is not managed yet; the first apply adopts it (If-Match "unmanaged"). */
  managed?: boolean;
  source?: string;
  errorFallback?: string[];
  handlers: Record<HandlerKind, GatewayHandler[]>;
  rollout?: Rollout | null;
}

export interface HandlerChange { kind: HandlerKind; name: string; enabled?: boolean; config?: Record<string, unknown> }

export type RiskLevel = 'low' | 'medium' | 'high';

export interface GatewayPreview {
  changes: Array<{ kind: HandlerKind; name: string; fields: Array<{ path: string; before: unknown; after: unknown }> }>;
  risk: { level: RiskLevel; flags: Array<{ code: string; level: RiskLevel; message: string }> };
  checks: Array<{ level: 'error' | 'warn'; code: string; message: string }>;
  blocked: Array<{ kind: HandlerKind; name: string; sites: string[]; message?: string }>;
  restart: { components: string[]; expectedSec?: number; message?: string };
}

export type RolloutState = 'running' | 'succeeded' | 'failed' | 'rolled-back';

export interface Rollout {
  id: string;
  version: number;
  previousVersion?: number;
  state: RolloutState;
  startedAt: string;
  endedAt?: string;
  message?: string;
  stages: Array<{ id: string; label?: string; state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; detail?: string; startedAt?: string; endedAt?: string }>;
  pods?: Array<{ name: string; component: string; ready: boolean; version?: number }>;
}
