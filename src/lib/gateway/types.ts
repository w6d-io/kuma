/**
 * /api/admin/gateway (GW-3, agent jinbe-gateway): the gateway's handlers and their global config.
 * Secrets never travel in plaintext: the server sends `{masked: true}` (set, value hidden) or a
 * Vault reference; kuma sends a Vault reference, or `{masked: true}` to keep what is there.
 */

export type HandlerKind = 'authenticators' | 'authorizers' | 'mutators' | 'errors';
export const HANDLER_KINDS: HandlerKind[] = ['authenticators', 'authorizers', 'mutators', 'errors'];

export type SecretValue = { masked: true } | { vault: string };

export interface GatewayHandler {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Dotted config keys that hold secrets. */
  secrets?: string[];
  usedBy: Array<{ site: string; gates: string[] }>;
  /** What must restart for a change to this handler to take effect. */
  restart?: 'oathkeeper' | 'oathkeeper+jinbe';
}

export interface GatewayState {
  version: number;
  etag: string;
  production?: boolean;
  handlers: Record<HandlerKind, GatewayHandler[]>;
  rollout?: Rollout | null;
}

export interface HandlerChange { kind: HandlerKind; name: string; enabled?: boolean; config?: Record<string, unknown> }

export type RiskLevel = 'low' | 'medium' | 'high';

export interface GatewayPreview {
  changes: Array<{ kind: HandlerKind; name: string; fields: Array<{ path: string; before: unknown; after: unknown }> }>;
  risk: { level: RiskLevel; flags: Array<{ code: string; level: RiskLevel; message: string }> };
  checks: Array<{ level: 'error' | 'warn'; code: string; message: string }>;
  blocked: Array<{ kind: HandlerKind; name: string; sites: string[] }>;
  restart: { components: string[]; expectedSec?: number };
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
