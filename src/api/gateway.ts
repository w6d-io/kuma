import { useQuery } from '@tanstack/react-query';
import { request } from './client';
import { withHeaders } from './sites';
import type { GatewayPreview, GatewayState, HandlerChange, Rollout } from '../lib/gateway/types';

/**
 * /api/admin/gateway (GW-3): the gateway's handlers and their global config, a preview with risk
 * flags, the apply that rolls the gateway pods, the rollout it starts, and rollback. Writes carry
 * If-Match (the state's etag) and need a recent second factor, like every gateway change.
 */

const BASE = '/admin/gateway';
const json = (b: unknown) => JSON.stringify(b);

export const gatewayApi = {
  get: () => request<GatewayState>(BASE),
  preview: (changes: HandlerChange[]) => request<GatewayPreview>(`${BASE}/preview`, { method: 'POST', body: json({ changes }) }),
  apply: (changes: HandlerChange[], etag: string, note?: string) =>
    withHeaders<{ rolloutId: string; version: number }>(BASE, { method: 'PUT', body: json({ changes, ...(note ? { note } : {}) }) }, { 'If-Match': `"${etag}"` }),
  rollout: () => request<Rollout | null>(`${BASE}/rollout`),
  rollback: (toVersion?: number) => request<{ rolloutId: string; version: number }>(`${BASE}/rollback`, { method: 'POST', body: json(toVersion ? { toVersion } : {}) }),
};

export const gatewayKeys = { state: ['gateway'] as const, rollout: ['gateway', 'rollout'] as const };

export function useGateway() {
  return useQuery({ queryKey: gatewayKeys.state, queryFn: gatewayApi.get, retry: false, staleTime: 30_000 });
}

/** The current rollout; polls every 2 s while one is running. */
export function useRollout(enabled = true) {
  return useQuery({
    queryKey: gatewayKeys.rollout,
    queryFn: gatewayApi.rollout,
    enabled,
    retry: false,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 2000 : false),
  });
}
