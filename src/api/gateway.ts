import { useQuery } from '@tanstack/react-query';
import { request } from './client';
import { withHeaders } from './sites';
import {
  previewFromWire, rolloutFromWire, specFor, stateFromWire,
  type AdaptedState, type WirePreview, type WireRolloutStatus, type WireState,
} from '../lib/gateway/adapt';
import type { GatewayPreview, HandlerChange, Rollout } from '../lib/gateway/types';

/**
 * /api/admin/gateway (jinbe GW-2): the gateway's handlers and their global config, a preview with
 * issues and risk, the apply that rolls the gateway pods (If-Match "rv:N", or "unmanaged" to adopt
 * the live config the first time; sites:apply + a recent second factor), the rollout, and rollback.
 * The wire shape is converted in lib/gateway/adapt.ts.
 */

const BASE = '/admin/gateway';
const json = (b: unknown) => JSON.stringify(b);

export const gatewayApi = {
  get: async (): Promise<AdaptedState> => stateFromWire(await request<WireState>(BASE)),
  preview: async (state: AdaptedState, changes: HandlerChange[]): Promise<GatewayPreview & { ok: boolean }> => {
    const p = await request<WirePreview>(`${BASE}/preview`, { method: 'POST', body: json(specFor(state, changes)) });
    return { ...previewFromWire(p), ok: p.ok };
  },
  apply: (state: AdaptedState, changes: HandlerChange[], note?: string) =>
    withHeaders<{ etag: string; generation: number }>(BASE, { method: 'PUT', body: json({ ...specFor(state, changes), ...(note ? { note } : {}) }) },
      { 'If-Match': state.managed === false ? 'unmanaged' : state.etag }),
  rollout: async (): Promise<Rollout | null> => rolloutFromWire(await request<WireRolloutStatus>(`${BASE}/rollout`)),
  rollback: (note?: string) => request<{ etag: string; generation: number }>(`${BASE}/rollback`, { method: 'POST', body: json(note ? { note } : {}) }),
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
