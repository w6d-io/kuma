import { request } from './client';
import type { Access, Check } from '../lib/sites/types';

/**
 * /api/admin/sites/:name/import (jinbe src/sites/openapi): an OpenAPI document → the site's routes.
 * `preview` reads the spec and proposes one route per operation, writing nothing but the uploaded
 * bytes (kept 24 h for the commit). `commit` merges the previewed spec, with the human's decisions,
 * into the DRAFT only — save and publish keep their own gates.
 *
 * Errors carry `code`: 409 spec_not_previewed / stale_base, 422 import_blocked (with checks), 413
 * draft_too_large, 422 url_import_disabled or a spec code (invalid_spec, too_many_operations…), 429
 * import_busy (and the rate limit: 10 reads a minute).
 */

export type ImportRowStatus = 'added' | 'changed' | 'unchanged' | 'removed' | 'pinned' | 'manual' | 'skipped' | 'unsupported';
export type RiskLevel = 'low' | 'medium' | 'high';
export interface RiskFlag { code: string; level: RiskLevel; message: string }

export interface ImportRoute { id: string; path: string; gate: string; access: Access; orgParam?: string; pinned?: boolean }

export interface ImportRow {
  op: string;
  operationId?: string;
  method: string;
  specPath?: string;
  status: ImportRowStatus;
  source: string | null;
  route: ImportRoute | null;
  current: ImportRoute | null;
  /** What the spec asks for that lowers protection (public, signed-in) or picks a gate: offered, never applied. */
  suggestion?: { access?: Access; gate?: string; twoFactor?: boolean; from: string; needsConfirm: true; risk: RiskFlag[] };
  reasons: string[];
  risk: RiskFlag[];
  /** A high-risk row: the commit needs `confirm: true` in its decision. */
  needsConfirm?: boolean;
  blocking?: { code: string; message: string };
}

export interface ImportOptions {
  basePath?: string;
  basePathMode?: 'prepend' | 'strip' | 'none';
  resourceFrom?: 'tag' | 'path' | 'operationId';
  listAsRead?: boolean;
  orgParam?: string;
  defaultGate?: string;
}

export interface ImportDecision {
  op: string;
  access?: Access;
  gate?: string;
  orgParam?: string | null;
  skip?: boolean;
  remove?: boolean;
  confirm?: boolean;
}

export type ImportCounts = Record<ImportRowStatus | 'suggestions' | 'overrides', number>;

export interface ImportPreview {
  spec: {
    title: string; version: string; format: string; sha256: string;
    counts: { paths: number; operations: number; webhooks: number; ignoredMethods: number };
    basePaths?: string[]; hosts?: string[]; securitySchemes?: unknown; notes?: string[];
  };
  base: { from: 'draft' | 'saved'; etag: string; complete: boolean };
  options: ImportOptions & { basePath?: string; defaultGate?: string | null };
  previous: { sha256?: string; title?: string; version?: string; importedAt?: string; importedBy?: string } | null;
  sameSpec: boolean;
  rows: ImportRow[];
  reimport: ImportCounts;
  risk: { level: RiskLevel; flags: RiskFlag[] };
  caps: { maxRoutes: number; routes: number; maxEnumerated: number; enumerated: number; enumeratedBefore: number };
  checks: Check[];
  blocking: Array<{ op: string; code: string; message: string }>;
  notes: string[];
  expiresInSeconds?: number;
}

export interface ImportCommitResult {
  changed: boolean;
  counts: ImportCounts;
  risk?: { level: RiskLevel; flags: RiskFlag[] };
  etag: string;
  draft?: { updatedAt: string; updatedBy: string; baseVersion: number };
}

const path = (name: string, step: 'preview' | 'commit') => `/admin/sites/${encodeURIComponent(name)}/import/${step}`;

export const importApi = {
  preview: (name: string, body: { source: { content: string; format?: 'auto' | 'json' | 'yaml' }; options?: ImportOptions; decisions?: ImportDecision[] }) =>
    request<ImportPreview>(path(name, 'preview'), { method: 'POST', body: JSON.stringify(body) }),
  commit: (name: string, body: { specSha256: string; baseEtag: string; options?: ImportOptions; decisions: ImportDecision[]; acceptDenied?: boolean }) =>
    request<ImportCommitResult>(path(name, 'commit'), { method: 'POST', body: JSON.stringify(body) }),
};
