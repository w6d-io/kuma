// Many changes of one kind: planned (a dry run judged against the caller's rights), then executed,
// each item checked again by its own route's guards right before it runs. Nothing here deletes.
// Kept beside client.ts rather than inside it — same `request`, same errors.
import { request } from './client';

export type BulkOp = 'users.invite' | 'users.verification' | 'groups.members.add' | 'sites.routes.upsert';

/** What planning an item says would happen. `not_found` only for a caller who may look users up. */
export type BulkOutcome =
  | { status: 'ok'; action: string }
  | { status: 'skip'; reason: string }
  | { status: 'refused'; reason: string }
  | { status: 'not_found' };

export interface BulkPlan {
  planId: string;
  planHash: string;
  op: BulkOp;
  expiresAt: string;
  counts: { ok: number; skip: number; refused: number; not_found: number };
  items: { index: number; outcome: BulkOutcome }[];
  warnings: string[];
}

export type BulkItemStatus = 'pending' | 'done' | 'skipped' | 'refused' | 'failed';

export interface BulkJob {
  id: string;
  op: BulkOp;
  state: 'running' | 'done' | 'failed';
  total: number;
  items: { index: number; status: BulkItemStatus; action?: string; reason?: string }[];
  counts: Record<BulkItemStatus, number>;
  error?: string;
  createdAt?: string;
  finishedAt?: string;
}

/** Items per plan, as jinbe caps them. */
export const BULK_MAX_ITEMS = 200;

export const bulkApi = {
  plan: (op: BulkOp, items: unknown[], params?: Record<string, unknown>) =>
    request<BulkPlan>(`/admin/bulk/${op}/plan`, {
      method: 'POST',
      body: JSON.stringify(params ? { items, params } : { items }),
    }),

  // 202 while it runs, 200 when that plan had already finished. 409 plan_changed carries the new plan.
  execute: (op: BulkOp, plan: Pick<BulkPlan, 'planId' | 'planHash'>) =>
    request<BulkJob>(`/admin/bulk/${op}/execute`, {
      method: 'POST',
      body: JSON.stringify({ planId: plan.planId, planHash: plan.planHash }),
    }),

  job: (id: string) => request<BulkJob>(`/admin/bulk/jobs/${encodeURIComponent(id)}`),
};
