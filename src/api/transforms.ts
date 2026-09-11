// Single source of truth for jinbe API shape → Kuma UI shape transforms.
//
// Previously these lived (divergently) in both useRbacData.ts and hooks.ts —
// e.g. one jinbeRuleToUi derived `service` by splitting the id, the other by a
// regex strip; only one handled `mfa`/`organizationId`/`stripPath`. Whichever
// path a refactor happened to pick changed behaviour silently (PROBLEM-MAP
// STORE-6). This module is the canonical, richer implementation.

import type { KratosIdentity, JinbeGroup, JinbeAccessRule, SearchedUser } from './client';
import type { User, GroupsMap, AccessRule, AuditEvent } from './types';

/** Relative "x ago" formatting for updated_at / audit timestamps. */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * The organisations an identity belongs to, from whoever owns them.
 *
 * jinbe answers `organizations` from the records it owns — the effective set, primary included. A
 * backend that does not own membership omits the field, and then what was written on the identity
 * (`metadata_admin.organizations`) is the best available answer. Absent and empty are different
 * answers: `[]` states that somebody belongs to nothing, so it must NOT fall through.
 *
 * Exported because the screen that EDITS membership has to start from the same answer the table
 * shows. Reading the identity while the truth lived elsewhere showed an empty list to people who
 * belong to three — and that screen saves what it shows.
 */
export function membershipsOf(
  k: { organizations?: unknown; metadata_admin?: { organizations?: unknown } | null },
): string[] {
  if (Array.isArray(k.organizations)) return k.organizations as string[];
  if (Array.isArray(k.metadata_admin?.organizations)) return k.metadata_admin!.organizations as string[];
  return [];
}

/** Kratos identity (enriched by jinbe) → Kuma User row. */
export function kratosToUser(k: KratosIdentity): User {
  // jinbe's enriched users response carries credential presence as
  // top-level `mfa: boolean`. The raw Kratos identity may also have a
  // `credentials` object when listIdentities was called with
  // include_credential — fall back to scanning that.
  const enriched = k as KratosIdentity & {
    mfa?: boolean
    credentials?: Record<string, unknown>
  };
  let mfa: boolean | undefined = enriched.mfa;
  if (mfa === undefined && enriched.credentials) {
    // Kratos auto-creates credentials.webauthn with just a `user_handle`
    // when the identity schema declares webauthn as an identifier — even
    // though no security key has actually been registered. The presence
    // of the credential key is therefore not a reliable enrollment
    // signal. Look inside each credential's config for the real artefact
    // a second-factor flow actually writes:
    //   - totp:          config.totp_url           (set on enrol)
    //   - webauthn:      config.credentials[]      (registered keys; user_handle alone doesn't count)
    //   - lookup_secret: config.recovery_codes[]   (generated codes)
    const c = enriched.credentials as Record<string, { config?: Record<string, unknown> } | undefined>;
    const totpReg     = !!c.totp?.config?.totp_url;
    const webauthnReg = Array.isArray((c.webauthn?.config as any)?.credentials) &&
                        ((c.webauthn?.config as any).credentials.length > 0);
    const lookupReg   = Array.isArray((c.lookup_secret?.config as any)?.recovery_codes) &&
                        ((c.lookup_secret?.config as any).recovery_codes.length > 0);
    if (totpReg || webauthnReg || lookupReg) mfa = true;
    else if (Object.keys(c).length > 0) mfa = false;
  }
  const organizations = membershipsOf(k);
  return {
    id: k.id,
    name: k.traits.name || k.traits.email,
    email: k.traits.email,
    // The ENFORCED memberships first, which jinbe resolves from the store the engine reads, and the
    // Kratos copy only when it answers none. It was the other way round, so a membership held only
    // where it decides was invisible — and the drawer that edits it seeds from this, so the screen
    // offered to remove a group it was not showing.
    groups: (k as any).groups || k.metadata_admin?.groups || [],
    title: '',
    active: k.state === 'active',
    last: k.updated_at ? timeAgo(k.updated_at) : 'never',
    organizationId: k.organization_id,
    organizations,
    ...(mfa !== undefined ? { mfa } : {}),
  };
}

/** Lightweight search hit → Kuma User row. jinbe enriches hits with real 2FA
 *  status (`mfa`); `last` still surfaces only on the detail drawer. */
export function searchedToUser(s: SearchedUser): User {
  return {
    id: s.id,
    name: s.name || s.email,
    email: s.email,
    groups: s.groups,
    title: '',
    active: s.active,
    last: '',
    organizationId: s.organizationId ?? undefined,
    ...(s.mfa !== undefined ? { mfa: s.mfa } : {}),
  };
}

/** jinbe groups list → { name → services map } lookup. */
export function jinbeGroupsToMap(groups: JinbeGroup[]): GroupsMap {
  const map: GroupsMap = {};
  for (const g of groups) {
    map[g.name] = g.services;
  }
  return map;
}

/** Oathkeeper access rule (jinbe shape) → Kuma AccessRule. */
export function jinbeRuleToUi(r: JinbeAccessRule): AccessRule {
  // Prefer an explicit service field when the jinbe payload carries one — it's
  // authoritative. The id-prefix split is only a fallback for rules that don't
  // (and the composite store re-associates it against the registered service
  // names, so a wrong prefix is corrected there). Splitting on '-' alone
  // invents phantom services (e.g. "reports" from a "reports-main" rule that
  // actually belongs to service "reporting"), which strands the rule and leaves
  // the service's edit drawer with empty fields.
  const explicit = (r as { service?: unknown }).service;
  const service = typeof explicit === 'string' && explicit ? explicit : r.id.split('-')[0];
  return {
    id: r.id,
    service,
    match: { url: r.match.url, methods: r.match.methods },
    authenticators: r.authenticators.map(a => a.handler),
    authorizer: r.authorizer.handler,
    mutators: r.mutators.map(m => m.handler),
    // Error handlers flattened to their names for the list/pipeline view. The
    // editor reads/writes the full config off `raw` (below) — this is display
    // only. Rules created before the feature have no `errors` → [].
    errors: (r.errors ?? []).map(e => e.handler),
    upstream: r.upstream?.url,
    stripPath: r.upstream?.strip_path,
    raw: r,
  };
}

/**
 * Normalize a raw audit list (from either /admin/audit/events enriched format
 * or the legacy /admin/rbac/history commit format) into UI AuditEvent rows.
 * Kept as one function so every audit consumer parses identically.
 * (The dual-format handling is tracked for simplification in PROBLEM-MAP API-5.)
 */
export function normalizeAuditEvents(events: any[]): AuditEvent[] {
  return events
    .map((e: any): AuditEvent => {
      // New enriched format (has who/verb/category directly)
      if (e.who || e.verb) {
        return {
          id:             e.id,
          when:           e.when || timeAgo(e.ts || ''),
          ts:             e.ts,
          who:            e.who || '',
          actorName:      e.actorName,
          kind:           e.kind,
          sessionId:      e.sessionId,
          category:       e.category || 'system',
          verb:           e.verb || 'unknown',
          target:         e.target || '',
          targetId:       e.targetId,
          targetEmail:    e.targetEmail,
          status:         e.result === 'applied' ? 'applied' : e.result === 'ok' ? undefined : e.result,
          service:        e.service,
          ip:             e.ip,
          ua:             e.ua,
          reason:         e.reason,
          mfa:            typeof e.mfa === 'boolean' ? e.mfa : undefined,
          method:         e.method,
          path:           e.path,
          statusCode:     e.statusCode,
          responseTimeMs: e.responseTimeMs,
          severity:       e.severity,
          changes:        e.changes,
        };
      }
      // Old format: { id, event: { type, timestamp, actor: JSON, details: JSON } }
      const ev = e.event || e;
      const actor = typeof ev.actor === 'string' ? JSON.parse(ev.actor) : ev.actor || {};
      const details = typeof ev.details === 'string' ? JSON.parse(ev.details) : ev.details || {};
      const target = typeof ev.target === 'string' ? (ev.target.startsWith('{') ? JSON.parse(ev.target) : { id: ev.target }) : ev.target || {};
      const type = ev.type || '';
      const [cat, verb] = type.includes('.') ? type.split('.', 2) : ['system', type];
      return {
        id:             e.id || ev.id || '',
        when:           timeAgo(ev.timestamp || ''),
        ts:             ev.timestamp,
        who:            actor.email || ev.author || 'system',
        actorName:      actor.name,
        category:       cat,
        verb:           verb,
        target:         ev.message || details.path || target.id || type,
        status:         details.statusCode && details.statusCode >= 400 ? 'failed' : undefined,
        service:        target.type === 'service' ? target.id : undefined,
        ip:             actor.ip || details.ip,
        ua:             actor.ua,
        reason:         details.reason,
        method:         details.method,
        path:           details.path,
        statusCode:     details.statusCode,
        responseTimeMs: details.responseTimeMs,
      };
    })
    .filter((e: AuditEvent) => e.id);
}

/**
 * Fetch + normalize the audit stream: enriched endpoint first, legacy history
 * fallback. Requires an `api`-shaped client injected by the caller to avoid a
 * transforms→client import cycle.
 */
export async function fetchAuditEvents(client: {
  getAuditEvents: (p?: { limit?: number; kind?: string }) => Promise<{ events?: any[] }>;
  getHistory: () => Promise<any[]>;
}): Promise<AuditEvent[]> {
  const clean = (arr: any[] | undefined) => (arr || []).filter((e: any) => e && Object.keys(e).length > 0);
  let events: any[] = [];
  // Track whether EITHER source responded. A swallowed total failure used to
  // return [], which is indistinguishable from a genuinely empty log — an
  // admin investigating a compromise would see a blank, "healthy" audit trail
  // with no hint the fetch failed. So: if neither endpoint responds, throw and
  // let useAudit surface the error. A successful-but-empty response is still a
  // valid empty result (no throw). See audit finding #6.
  let anyOk = false;
  let lastErr: unknown;

  // Two windows in parallel: the mixed newest-200 (feeds Access/Auth/Signals)
  // AND a dedicated kind=change window. Access telemetry is high-volume and would
  // otherwise crowd the compliance record (Changes) out of a single shared 200-row
  // fetch — leaving the Changes tab looking empty even though those events are
  // still retained in Redis. The server over-fetches when filtering by kind, so
  // the change window digs past the access noise. Merge + dedupe by stream id.
  const [mixed, changes] = await Promise.allSettled([
    client.getAuditEvents({ limit: 200 }),
    client.getAuditEvents({ kind: 'change', limit: 200 }),
  ]);
  if (mixed.status === 'fulfilled') { events = clean(mixed.value.events); anyOk = true; }
  else lastErr = mixed.reason;
  if (changes.status === 'fulfilled') {
    anyOk = true;
    const seen = new Set(events.map((e: any) => e.id));
    for (const e of clean(changes.value.events)) if (e.id && !seen.has(e.id)) events.push(e);
  } else lastErr = changes.reason;

  // Re-sort the merged set newest-first by stream id (`<ms>-<seq>`); normalize
  // preserves order and the UI groups/paginates on it.
  if (events.length > 1) {
    const idKey = (id: unknown): [number, number] => {
      const [ms, seq] = String(id ?? '').split('-');
      return [Number(ms) || 0, Number(seq) || 0];
    };
    events.sort((a, b) => { const [am, asq] = idKey(a.id), [bm, bsq] = idKey(b.id); return bm - am || bsq - asq; });
  }

  // Legacy fallback: only if the enriched endpoint gave us nothing at all.
  if (events.length === 0) {
    try {
      const commits = await client.getHistory();
      events = commits.map((c: any) => ({ ...c }));
      anyOk = true;
    } catch (e) { lastErr = e; /* history may also fail */ }
  }
  if (!anyOk) {
    throw new Error(
      `Audit log unavailable: could not load events from either endpoint (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`,
    );
  }
  return normalizeAuditEvents(events);
}
